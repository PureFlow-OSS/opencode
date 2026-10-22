import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Uses the compile-only dotnet artifact with disposable configuration, feeds and database.
test("publishes durable staged releases without feedback and rolls back failed promotions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-release-stages-"))
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const key = new URL(request.url).searchParams.get("key")
      return Response.json({ info: { username: key === "beta-key" ? "beta-user" : "gilde-user" } })
    },
  })
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const base = reservation.url.origin
  reservation.stop(true)
  const file = (name: string) => Bun.file(path.join(directory, name))
  const feed = (channel: string) => `data/feed/${channel}`
  const seed = async (folder: string, version: string) => {
    await mkdir(path.join(directory, folder), { recursive: true })
    await Bun.write(file(`${folder}/latest.yml`), `version: ${version}\npath: installer.exe\n`)
    await Bun.write(file(`${folder}/installer.exe`), `installer-${version}`)
  }
  await seed("feed/beta", "0.9.0")
  await seed("feed/ai-gilde", "0.7.0")
  await seed(feed("ai-gilde"), "0.8.0")
  await seed("feed", "0.6.0")
  const settings = {
    Updater: { Version: "0.6.0", PublicBaseUrl: base },
    UpdaterBeta: {
      Enabled: true,
      Users: ["beta-user"],
      AiGildeUsers: ["gilde-user"],
      LiteLLM: { BaseUrl: gateway.url.origin, ApiKey: "test-admin", KeyInfoPath: "key/info" },
    },
  }
  for (const name of ["appsettings.json", "appsettings.beta.json", "appsettings.ai-gilde.json"])
    await Bun.write(file(name), JSON.stringify(settings))
  await Bun.write(
    file("fixtures.ps1"),
    `
param([string]$Root)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($version in @('1.0.0','1.0.1','1.0.2')) {
  $source = Join-Path $Root ('zip-' + $version)
  [System.IO.Directory]::CreateDirectory($source) | Out-Null
  $bytes = [System.Text.Encoding]::UTF8.GetBytes('installer-' + $version)
  [System.IO.File]::WriteAllBytes((Join-Path $source 'installer.exe'), $bytes)
  $hash = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::HashData($bytes))
  $yaml = "version: $version\nfiles:\n  - url: installer.exe\n    sha512: $hash\n    size: $($bytes.Length)\npath: installer.exe\nsha512: $hash\n"
  [System.IO.File]::WriteAllText((Join-Path $source 'latest.yml'), $yaml)
  if ($version -eq '1.0.2') { [System.IO.File]::Delete((Join-Path $source 'installer.exe')) }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($source, (Join-Path $Root ($version + '.zip')))
}
`,
  )
  const zip = Bun.spawn(["pwsh", "-NoProfile", "-File", path.join(directory, "fixtures.ps1"), "-Root", directory], {
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(await zip.exited).toBe(0)
  const start = () => {
    const process = Bun.spawn(
      [
        "dotnet",
        path.resolve(import.meta.dir, "../bin/Debug/net10.0/OpenCode.UpdaterServer.dll"),
        "--contentRoot",
        directory,
        "--urls",
        base,
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    )
    return { process, stdout: new Response(process.stdout).text(), stderr: new Response(process.stderr).text() }
  }
  let server = start()
  const request = (route: string, init?: RequestInit) => fetch(base + "/opencode" + route, init)
  const headers = (channel: string) => ({
    "X-OpenCode-AiFactory-Api-Key": channel === "beta" ? "beta-key" : channel === "ai-gilde" ? "gilde-key" : "",
  })
  const status = async () => (await request("/admin/releases/status")).json()
  const ready = async () => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (server.process.exitCode !== null) throw new Error((await server.stderr) + (await server.stdout))
      if (
        await request("/version")
          .then((response) => response.ok)
          .catch(() => false)
      )
        return
      await Bun.sleep(25)
    }
    throw new Error("Isolated updater did not become ready")
  }
  const upload = async (version: string) => {
    const form = new FormData()
    form.set("archive", new File([await file(`${version}.zip`).arrayBuffer()], `${version}.zip`))
    return request("/admin/releases/upload", { method: "POST", body: form })
  }
  try {
    await ready()
    expect(await file(`${feed("beta")}/installer.exe`).text()).toBe("installer-0.9.0")
    expect(await file(`${feed("ai-gilde")}/installer.exe`).text()).toBe("installer-0.8.0")
    expect(await file(`${feed("normal")}/installer.exe`).text()).toBe("installer-0.6.0")
    expect((await upload("1.0.2")).status).toBeGreaterThanOrEqual(400)
    expect(await file(`${feed("beta")}/installer.exe`).text()).toBe("installer-0.9.0")
    expect((await status()).releases).toHaveLength(0)
    const uploaded = await upload("1.0.0")
    expect(uploaded.status).toBe(200)
    const release = await uploaded.json()
    const db = new Database(path.join(directory, "data/feedback.db"))
    try {
      db.exec(
        "CREATE TRIGGER fail_promotion BEFORE UPDATE OF Channel ON UpdaterReleases BEGIN SELECT RAISE(FAIL, 'promotion test failure'); END",
      )
      expect((await request(`/admin/releases/${release.id}/promote`, { method: "POST" })).status).toBe(500)
      expect(await file(`${feed("ai-gilde")}/installer.exe`).text()).toBe("installer-0.8.0")
      expect((await status()).releases.find((item: { id: string }) => item.id === release.id).channel).toBe("beta")
      db.exec("DROP TRIGGER fail_promotion")
    } finally {
      db.close()
    }
    expect((await request(`/admin/releases/${release.id}/promote`, { method: "POST" })).status).toBe(200)
    const promoted = await status()
    expect(promoted.channels.map((item: { channel: string }) => item.channel)).toEqual(["beta", "ai-gilde", "normal"])
    expect(promoted.channels.map((item: { version: string }) => item.version)).toEqual(["1.0.0", "1.0.0", "0.6.0"])
    expect(promoted.channels.every((item: { filesAvailable: boolean }) => item.filesAvailable)).toBe(true)
    expect(await file(`${feed("beta")}/installer.exe`).text()).toBe("installer-1.0.0")
    const newer = await upload("1.0.1")
    expect(newer.status).toBe(200)
    const missing = await newer.json()
    await rm(path.join(directory, feed("beta"), "installer.exe"))
    expect((await request(`/admin/releases/${missing.id}/promote`, { method: "POST" })).status).toBe(409)
    expect((await status()).releases.find((item: { id: string }) => item.id === missing.id).channel).toBe("beta")
    expect((await status()).channels[0]).toMatchObject({ version: "1.0.1", filesAvailable: false })
    expect(await file(`${feed("ai-gilde")}/installer.exe`).text()).toBe("installer-1.0.0")
    expect((await request(`/admin/releases/${release.id}/promote`, { method: "POST" })).status).toBe(200)
    expect(await file(`${feed("normal")}/installer.exe`).text()).toBe("installer-1.0.0")
    expect(await file(`${feed("normal")}/beta/latest.yml`).exists()).toBe(false)
    expect(await file(`${feed("normal")}/ai-gilde/latest.yml`).exists()).toBe(false)
    for (const channel of ["beta", "ai-gilde", "normal"]) {
      expect((await request(`/admin/releases/${channel}/stop`, { method: "POST" })).status).toBe(200)
      for (const route of ["/version", "/url", "/latest.json", "/feed/latest.yml"])
        expect((await request(route, { headers: headers(channel) })).status).toBe(503)
      expect((await request("/provider-config.json", { headers: headers(channel) })).status).toBe(200)
    }
    server.process.kill()
    await server.process.exited
    server = start()
    // Version delivery is paused, so readiness must use the independent admin endpoint.
    const deadline = Date.now() + 20000
    while (
      !(await request("/admin/releases/status")
        .then((response) => response.ok)
        .catch(() => false))
    ) {
      if (Date.now() > deadline) throw new Error("Restarted updater did not become ready")
      await Bun.sleep(25)
    }
    expect((await status()).channels.every((item: { stopped: boolean }) => item.stopped)).toBe(true)
    for (const channel of ["beta", "ai-gilde", "normal"])
      expect((await request(`/admin/releases/${channel}/clear`, { method: "POST" })).status).toBe(200)
    expect(await (await request("/version", { headers: headers("ai-gilde") })).text()).toBe("1.0.0")
    expect(await file(`${feed("beta")}/latest.yml`).text()).toContain("1.0.1")
    for (const route of ["/feedback", "/admin/feedback"]) {
      const write = await request(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "test", message: "test" }),
      })
      expect(write.status).toBe(410)
      expect(write.headers.get("Deprecation")).toBe("true")
      const archive = await request(route)
      expect(archive.status).toBe(200)
      expect(archive.headers.get("Deprecation")).toBe("true")
    }
  } finally {
    server.process.kill()
    await server.process.exited
    gateway.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
