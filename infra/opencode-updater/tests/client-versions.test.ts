import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { keycloak } from "./support/keycloak"

test("records authenticated client versions in all channels and keeps update checks available", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-client-versions-"))
  const idp = await keycloak()
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const key = new URL(request.url).searchParams.get("key")
      if (key === "bad-key") return new Response("Denied", { status: 401 })
      return Response.json({
        info: {
          key_alias:
            key === "beta-key"
              ? "alice - laptop"
              : key === "gilde-key"
                ? "Bob"
                : key === "group-key"
                  ? "Charlie - workstation"
                  : key === "no-rules-key" ? "No rules user" : "Normal user",
          groups: key === "group-key" ? ["beta-team"] : [],
        },
      })
    },
  })
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const base = reservation.url.origin
  reservation.stop(true)
  await Bun.write(
    path.join(directory, "appsettings.json"),
    JSON.stringify({
      AdminAuthentication: idp.configuration(base),
      Updater: { Version: "2.2.2", PublicBaseUrl: base },
    }),
  )
  await Bun.write(
    path.join(directory, "appsettings.beta.json"),
    JSON.stringify({
      Updater: { Version: "2.2.3", PublicBaseUrl: base },
      UpdaterBeta: {
        Enabled: true,
        Users: ["Alice"],
        Groups: ["beta-team"],
        AiGildeUsers: ["Bob", "Never checked"],
        LiteLLM: { BaseUrl: gateway.url.origin, ApiKey: "management-key", KeyInfoPath: "key/info" },
      },
    }),
  )
  await Bun.write(
    path.join(directory, "appsettings.ai-gilde.json"),
    JSON.stringify({ Updater: { Version: "2.2.2", PublicBaseUrl: base } }),
  )
  for (const channel of ["beta", "ai-gilde"]) {
    await mkdir(path.join(directory, "data/feed", channel), { recursive: true })
    await Bun.write(
      path.join(directory, "data/feed", channel, "latest.yml"),
      `version: ${channel === "beta" ? "2.2.3" : "2.2.2"}\n`,
    )
  }
  const server = Bun.spawn(
    [
      "dotnet",
      path.resolve(import.meta.dir, "../bin/Debug/net10.0/OpenCode.UpdaterServer.dll"),
      "--contentRoot",
      directory,
      "--urls",
      base,
    ],
    {
      cwd: directory,
      env: { ...process.env, DOTNET_ENVIRONMENT: "Testing", ASPNETCORE_ENVIRONMENT: "Testing" },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const stdout = new Response(server.stdout).text()
  const stderr = new Response(server.stderr).text()
  const check = (key?: string, version?: string) =>
    fetch(base + "/opencode/version", {
      headers: {
        ...(key ? { "X-OpenCode-AiFactory-Api-Key": key } : {}),
        ...(version ? { "X-OpenCode-Version": version } : {}),
      },
    })
  try {
    const deadline = Date.now() + 20000
    while (
      !(await check()
        .then((response) => response.ok)
        .catch(() => false))
    ) {
      if (server.exitCode !== null) throw new Error((await stderr) + (await stdout))
      if (Date.now() > deadline) throw new Error("Isolated updater did not become ready")
      await Bun.sleep(25)
    }
    expect((await fetch(base + "/opencode/admin/testers/versions", { redirect: "manual" })).status).toBe(401)
    expect((await fetch(base + "/opencode/admin/client-versions", { redirect: "manual" })).status).toBe(401)
    const browser = await idp.login(base)
    const reports = async () => (await browser.request(base + "/opencode/admin/testers/versions")).json()
    expect((await reports()).clients).toEqual([])
    expect(await (await check("beta-key", "2.2.2")).text()).toBe("2.2.3")
    expect(await (await check("gilde-key", "2.2.2")).text()).toBe("2.2.2")
    expect((await check("group-key", "2.2.1")).status).toBe(200)
    for (const [key, version] of [
      ["normal-key", "2.2.2"],
      ["bad-key", "2.2.2"],
      [undefined, "2.2.2"],
      ["beta-key", "invalid"],
      ["beta-key", undefined],
    ])
      expect((await check(key, version)).status).toBe(200)
    const first = await reports()
    expect(first.clients).toHaveLength(3)
    const inventory = await browser.request(base + "/opencode/admin/client-versions")
    expect(inventory.headers.get("cache-control")).toBe("no-store")
    const all = await inventory.json()
    expect(all.clients).toHaveLength(4)
    expect(all.clients).toContainEqual(expect.objectContaining({
      userName: "Normal user", channel: "normal", version: "2.2.2",
    }))
    expect(all.channels).toContainEqual({ channel: "normal", stopped: false })
    expect(first.clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userName: "Alice", channel: "beta", version: "2.2.2" }),
        expect.objectContaining({ userName: "Bob", channel: "ai-gilde", version: "2.2.2" }),
        expect.objectContaining({ userName: "Charlie", channel: "beta", version: "2.2.1" }),
      ]),
    )
    expect(
      first.clients.every((report: { lastSeenAt: string }) => Number.isFinite(Date.parse(report.lastSeenAt))),
    ).toBe(true)
    expect(first.channels).toContainEqual({ channel: "beta", version: "2.2.3", stopped: false })
    expect(JSON.stringify(first)).not.toContain("beta-key")
    expect(JSON.stringify(first)).not.toContain("management-key")
    expect((await check("beta-key", "2.2.3")).status).toBe(200)
    const updated = await reports()
    expect(updated.clients).toHaveLength(3)
    expect(updated.clients.find((report: { userName: string }) => report.userName === "Alice").version).toBe("2.2.3")
    const db = new Database(path.join(directory, "data/feedback.db"))
    try {
      db.exec("BEGIN IMMEDIATE")
      try {
        expect((await check("beta-key", "2.2.3")).status).toBe(200)
      } finally {
        db.exec("ROLLBACK")
      }
      expect(db.query("SELECT Version FROM UpdaterClientVersions WHERE UserName = 'alice'").get()).toEqual({
        Version: "2.2.3",
      })
      expect((await browser.request(base + "/opencode/admin/releases/beta/stop", { method: "POST" })).status).toBe(200)
      expect(await (await check("beta-key", "2.2.2")).text()).toBe("2.2.2")
      expect((await reports()).channels).toContainEqual({ channel: "beta", version: "2.2.3", stopped: true })
      await Bun.write(
        path.join(directory, "appsettings.beta.json"),
        JSON.stringify({
          UpdaterBeta: {
            Enabled: false,
            LiteLLM: { BaseUrl: gateway.url.origin, ApiKey: "management-key", KeyInfoPath: "key/info" },
          },
        }),
      )
      expect(await (await check("no-rules-key", "2.2.3")).text()).toBe("2.2.2")
      expect((await (await browser.request(base + "/opencode/admin/client-versions")).json()).clients).toContainEqual(
        expect.objectContaining({ userName: "No rules user", channel: "normal", version: "2.2.3" }),
      )
      db.exec("DROP TABLE UpdaterClientVersions")
      expect(await (await check("beta-key", "2.2.2")).text()).toBe("2.2.2")
    } finally {
      db.close()
    }
  } finally {
    server.kill()
    await server.exited
    gateway.stop(true)
    idp.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
