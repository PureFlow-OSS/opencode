import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test.each([false, true])(
  "admin stays closed in production with missing or insecure configuration (%s)",
  async (insecure) => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-auth-closed-"))
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
    const base = reservation.url.origin
    reservation.stop(true)
    await Bun.write(path.join(directory, "appsettings.json"), JSON.stringify({ Updater: { Version: "2.2.2" } }))
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
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: "Production",
          DOTNET_ENVIRONMENT: "Production",
          AdminAuthentication__Authority: "http://127.0.0.1:1/realms/unused",
          AdminAuthentication__PublicOrigin: base,
          AdminAuthentication__ClientSecret: insecure ? "unused-test-secret" : "",
          AdminAuthentication__AllowHttpLoopback: "true",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const stdout = new Response(server.stdout).text()
    const stderr = new Response(server.stderr).text()
    try {
      const deadline = Date.now() + 20000
      while (
        !(await fetch(base + "/opencode/version")
          .then((response) => response.ok)
          .catch(() => false))
      ) {
        if (server.exitCode !== null) throw new Error((await stderr) + (await stdout))
        if (Date.now() > deadline) throw new Error("Isolated updater did not become ready")
        await Bun.sleep(25)
      }
      for (const route of [
        "/opencode/admin/releases",
        "/opencode/admin/testers",
        "/opencode/auth/session",
        "/opencode/auth/login",
      ])
        expect((await fetch(base + route, { redirect: "manual" })).status).toBe(503)
      expect((await fetch(base + "/opencode/auth/check")).status).toBe(403)
      expect((await fetch(base + "/opencode/version")).status).toBe(200)
      expect((await fetch(base + "/opencode/provider-config.json")).status).toBe(200)
    } finally {
      server.kill()
      await server.exited
      await rm(directory, { recursive: true, force: true })
    }
  },
  30000,
)
