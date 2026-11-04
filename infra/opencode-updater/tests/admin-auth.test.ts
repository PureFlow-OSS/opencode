import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { keycloak } from "./support/keycloak"

test("Keycloak protects every admin route, enforces the exact group and CSRF, and leaves client feeds public", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-keycloak-"))
  const idp = await keycloak()
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const base = reservation.url.origin
  reservation.stop(true)
  const settings = { Updater: { Version: "2.2.2", PublicBaseUrl: base }, AdminAuthentication: idp.configuration(base) }
  await Bun.write(path.join(directory, "appsettings.json"), JSON.stringify(settings))
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
  const request = (route: string, init?: RequestInit) =>
    fetch(base + "/opencode" + route, { ...init, redirect: "manual" })
  try {
    const deadline = Date.now() + 20000
    while (
      !(await request("/version")
        .then((response) => response.ok)
        .catch(() => false))
    ) {
      if (server.exitCode !== null) throw new Error((await stderr) + (await stdout))
      if (Date.now() > deadline) throw new Error("Isolated authenticated updater did not become ready")
      await Bun.sleep(25)
    }
    for (const route of [
      "/admin/releases",
      "/admin/testers",
      "/admin/modelcards",
      "/admin/mcp",
      "/admin/mcp-store",
      "/admin/plugin-store",
      "/admin/future-route",
    ])
      expect((await request(route)).status).toBe(401)
    expect(
      (await request("/admin/testers", { headers: { group: "opencodeAdmin", "X-User-Groups": "opencodeAdmin" } }))
        .status,
    ).toBe(401)
    for (const route of [
      "/version",
      "/url",
      "/config",
      "/provider-config.json",
      "/mcp-store.json",
      "/plugin-store.json",
    ])
      expect((await request(route)).status).toBe(200)
    const admin = await idp.login(base)
    expect(admin.callback.status).toBe(302)
    expect(admin.session.status).toBe(200)
    expect(admin.state.csrf.length).toBeGreaterThan(20)
    expect(
      admin.callback.headers
        .getSetCookie()
        .some((value) => value.includes("OpenCode.Updater.Admin=") && value.toLowerCase().includes("httponly")),
    ).toBe(true)
    expect((await admin.request("/opencode/admin/testers")).status).toBe(200)
    expect((await admin.request("/opencode/auth/check")).status).toBe(204)
    const put = {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ betaUsers: ["fixture-user"] }),
    }
    expect((await admin.request("/opencode/admin/testers", put, false)).status).toBe(400)
    expect(
      (
        await admin.request(
          "/opencode/admin/testers",
          { ...put, headers: { ...put.headers, "X-OpenCode-CSRF": "wrong" } },
          false,
        )
      ).status,
    ).toBe(400)
    expect((await admin.request("/opencode/admin/testers", put)).status).toBe(200)
    expect((await admin.request("/opencode/auth/logout", { method: "POST" }, false)).status).toBe(400)
    expect((await request("/auth/logout")).status).toBe(405)
    for (const group of ["opencodeAdmin", ["another", "opencodeAdmin"]]) {
      const allowed = await idp.login(base, { group })
      expect(allowed.session.status).toBe(200)
      expect((await allowed.request("/opencode/admin/testers")).status).toBe(200)
    }
    for (const claims of [
      { group: ["someoneElse"] },
      { group: ["/opencodeAdmin"] },
      { group: ["opencodeadmin"] },
      { groups: ["opencodeAdmin"] },
      { realm_access: { roles: ["opencodeAdmin"] } },
    ]) {
      const denied = await idp.login(base, claims)
      expect(denied.callback.headers.get("location")).toBe("/opencode/auth/forbidden")
      expect(denied.session.status).toBe(401)
      expect((await denied.request("/opencode/admin/testers")).status).toBe(401)
    }
    for (const claims of [
      { group: ["opencodeAdmin"], aud: "different-client" },
      { group: ["opencodeAdmin"], iss: "https://wrong-issuer.invalid" },
      { group: ["opencodeAdmin"], exp: Math.floor(Date.now() / 1000) - 600 },
      { group: ["opencodeAdmin"], nonce: "wrong" },
      { group: ["opencodeAdmin"], badSignature: true },
    ]) {
      const denied = await idp.login(base, claims)
      expect(denied.callback.headers.get("location")).toBe("/opencode/auth/error")
      expect(denied.session.status).toBe(401)
    }
    const challenge = await request("/auth/login?returnUrl=https://evil.invalid", {
      headers: { Host: "evil.invalid", "X-Forwarded-Host": "evil.invalid", "X-Forwarded-Proto": "https" },
    })
    expect(new URL(challenge.headers.get("location")!).searchParams.get("redirect_uri")).toBe(
      base + "/opencode/auth/signin-oidc",
    )
    const logout = await admin.request("/opencode/auth/logout", { method: "POST" })
    expect(logout.status).toBe(302)
    expect(new URL(logout.headers.get("location")!).pathname).toBe("/realms/test/logout")
    expect((await admin.request("/opencode/admin/testers")).status).toBe(401)
    expect(idp.exchanges.length).toBe(13)
  } catch (error) {
    server.kill()
    await server.exited
    throw new Error(`${error}\n${await stderr}\n${await stdout}`)
  } finally {
    server.kill()
    await server.exited
    idp.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
