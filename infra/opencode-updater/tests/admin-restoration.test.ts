import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test("tester search and MCP Store OAuth survive the API and stored configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-admin-restoration-"))
  const seen: string[] = []
  let invalid = false
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push(request.headers.get("x-litellm-api-key") ?? "")
      if (new URL(request.url).pathname.endsWith("/key/info"))
        return Response.json({ info: { key_alias: "Hidden name - work" } })
      if (invalid) return Response.json({ keys: 42 })
      return Response.json({
        keys: [
          { key_alias: "Klaus - work", key: "never-expose" },
          { key_alias: "Gabor - work" },
          { key_alias: "GABOR - duplicate" },
          { username: "Johanna" },
          "hash-only",
        ],
      })
    },
  })
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const base = reservation.url.origin
  reservation.stop(true)
  await Bun.write(
    path.join(directory, "appsettings.json"),
    JSON.stringify({
      Updater: { Version: "2.1.2" },
      UpdaterBeta: {
        Enabled: true,
        Users: ["Klaus"],
        Groups: ["beta-group"],
        AiGildeGroups: ["gilde-group"],
        LiteLLM: {
          BaseUrl: gateway.url.origin,
          ApiKey: "management-test",
          KeyListPath: "key/list",
          KeyInfoPath: "key/info",
        },
      },
    }),
  )
  await Bun.write(
    path.join(directory, "appsettings.beta.json"),
    await Bun.file(path.join(directory, "appsettings.json")).text(),
  )
  const server = Bun.spawn(
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
  const stdout = new Response(server.stdout).text()
  const stderr = new Response(server.stderr).text()
  const request = (route: string, init?: RequestInit) => fetch(base + "/opencode" + route, init)
  const put = (body: object) => ({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  try {
    const deadline = Date.now() + 20000
    while (
      !(await request("/version")
        .then((response) => response.ok)
        .catch(() => false))
    ) {
      if (server.exitCode !== null) throw new Error((await stderr) + (await stdout))
      if (Date.now() > deadline) throw new Error("Isolated updater did not become ready")
      await Bun.sleep(25)
    }
    const found = await request("/admin/testers/search?q=kLa")
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ results: [{ userName: "Klaus", currentChannel: "beta" }] })
    const all = await (await request("/admin/testers/search?q=")).text()
    expect(all).not.toContain("never-expose")
    expect(all).not.toContain("hash-only")
    expect(
      JSON.parse(all).results.filter((item: { userName: string }) => item.userName.toLowerCase() === "gabor"),
    ).toHaveLength(1)
    expect(seen.every((key) => key === "management-test")).toBe(true)
    invalid = true
    expect((await request("/admin/testers/search?q=x")).status).toBeGreaterThanOrEqual(400)
    const saved = await request(
      "/admin/testers",
      put({
        betaUsers: ["Klaus"],
        betaGroups: ["beta-group"],
        aiGildeUsers: ["Gabor"],
        aiGildeGroups: ["gilde-group"],
      }),
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      betaGroups: ["beta-group"],
      aiGildeGroups: ["gilde-group"],
      aiGildeUsers: ["Gabor"],
    })
    const entry = {
      name: "oauth-server",
      url: "https://mcp.example.test/mcp",
      headerNames: [],
      oauthRequired: true,
      enabled: true,
    }
    expect((await request("/admin/mcp-store/oauth-server", put(entry))).status).toBe(200)
    expect(await (await request("/admin/mcp-store")).json()).toContainEqual(
      expect.objectContaining({ name: entry.name, oauthRequired: true }),
    )
    expect(await (await request("/mcp-store.json")).json()).toContainEqual(
      expect.objectContaining({ name: entry.name, oauthRequired: true }),
    )
    const db = new Database(path.join(directory, "data/feedback.db"))
    try {
      const stored = db
        .query<{ Config: string }, []>("SELECT Config FROM UpdaterMcpStore WHERE Name = 'oauth-server'")
        .get()
      expect(stored).not.toBeNull()
      expect(JSON.parse(stored!.Config).oauthRequired).toBe(true)
    } finally {
      db.close()
    }
    expect(
      (
        await request(
          "/admin/mcp-store/oauth-server",
          put({ ...entry, oauthRequired: false, headerNames: ["Authorization"] }),
        )
      ).status,
    ).toBe(200)
    expect(await (await request("/mcp-store.json")).json()).toContainEqual(
      expect.objectContaining({ name: entry.name, oauthRequired: false }),
    )
  } finally {
    server.kill()
    await server.exited
    gateway.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
