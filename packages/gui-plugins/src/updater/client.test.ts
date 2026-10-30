import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdir, mkdtemp, realpath, rm, symlink, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Schema } from "effect"

test.skipIf(process.platform !== "win32")(
  "custom Windows cache supports real Electron update checks and downloads",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-updater-http-"))
    const installer = Buffer.from("Regression fixture; never executed".repeat(32768))
    const requests: Array<{ path: string; key: string | null }> = []

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")

      requests.push({ path: url.pathname, key: request.headersDistinct["x-opencode-aifactory-api-key"]?.[0] ?? null })

      if (url.pathname === "/paused/latest.yml") {
        response.end("version: 2.1.2\nfiles: []\n")

        return
      }

      if (url.pathname === "/installer.exe") {
        response.setHeader("Content-Length", installer.length)
        let offset = 0

        const timer = setInterval(() => {
          response.write(installer.subarray(offset, offset + 65536))
          offset += 65536

          if (offset >= installer.length) {
            clearInterval(timer)
            response.end()
          }
        }, 80)

        response.on("close", () => clearInterval(timer))

        return
      }

      response.end(
        `version: 2.1.3\nfiles:\n  - url: installer.exe\n    sha512: ${createHash("sha512").update(installer).digest("base64")}\n    size: ${installer.length}\n`,
      )
    })

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

    const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address())

    try {
      await mkdir(path.join(directory, "user-data"))
      await mkdir(path.join(directory, "node_modules"))
      await symlink(
        await realpath(path.resolve(import.meta.dir, "../../node_modules/electron-updater")),
        path.join(directory, "node_modules/electron-updater"),
        "junction",
      )
      await Bun.write(path.join(directory, "app-update.yml"), "updaterCacheDirName: regression-updater\n")
      await Bun.write(
        path.join(directory, "start.cjs"),
        `
const { app } = require("electron")
app.setPath("userData", ${JSON.stringify(path.join(directory, "user-data"))})
app.setPath("sessionData", ${JSON.stringify(path.join(directory, "user-data"))})
app.disableHardwareAcceleration()
import("./check.mjs").catch((error) => { console.error(error); app.exit(1) })
`,
      )
      await Bun.write(
        path.join(directory, "check.ts"),
        `
import { app } from "electron"
import { windowsUpdater } from ${JSON.stringify(path.join(import.meta.dir, "client.ts"))}
import { updateAppAdapter } from ${JSON.stringify(path.join(import.meta.dir, "cache.ts"))}
import { downloadUpdate } from ${JSON.stringify(path.join(import.meta.dir, "download.ts"))}
async function run() {
  await app.whenReady()
  const client = windowsUpdater(updateAppAdapter({
    cacheDirectory: ${JSON.stringify(path.join(directory, "custom-cache"))},
    resourcesPath: ${JSON.stringify(directory)},
    appPath: ${JSON.stringify(directory)},
    version: "2.1.2", name: "Updater regression", isPackaged: true,
    userDataPath: app.getPath("userData"), whenReady: () => app.whenReady(),
    relaunch: () => app.relaunch(), quit: () => app.quit(),
    onQuit: (handler) => app.once("quit", (_event, code) => handler(code)),
  }))
  client.logger = null
  client.autoDownload = false
  client.autoInstallOnAppQuit = false
  client.disableDifferentialDownload = true
  client.requestHeaders = { "X-OpenCode-AiFactory-Api-Key": "regression-key" }
  client.setFeedURL({ provider: "generic", url: ${JSON.stringify(`http://127.0.0.1:${address.port}`)} })
  await client.netSession.setProxy({ mode: "direct" })
  const result = await client.checkForUpdates()
  if (result?.updateInfo.version !== "2.1.3") throw new Error("Unexpected update metadata")
  const progress = []
  const messages = []
  const listeners = client.listenerCount("download-progress")
  const files = await downloadUpdate(client, (value) => progress.push(value), (message) => messages.push(message))
  if (!progress.some((value) => value.total === ${installer.length} && value.transferred > 0 && value.bytesPerSecond > 0)) throw new Error("Missing actual transfer metrics")
  if (progress.at(-1)?.phase !== "verify") throw new Error("Missing verification phase")
  if (client.listenerCount("download-progress") !== listeners) throw new Error("Leaked download listener")
  if (!messages.includes("update download started") || !messages.includes("update download progress") || !messages.includes("update download verified")) throw new Error("Missing download phase logs")
  client.allowDowngrade = true
  client.setFeedURL({ provider: "generic", url: ${JSON.stringify(`http://127.0.0.1:${address.port}/paused`)} })
  let available = false
  let upToDate = false
  client.once("update-available", () => { available = true })
  client.once("update-not-available", () => { upToDate = true })
  const paused = await client.checkForUpdates()
  if (paused?.updateInfo.version !== "2.1.2" || available || !upToDate) throw new Error("Paused delivery did not report up to date")
  console.log(JSON.stringify({ version: result.updateInfo.version, installer: files[0] }))
}
run().then(() => app.exit(0), (error) => { console.error(error); app.exit(1) })
`,
      )

      const compiled = await Bun.build({
        entrypoints: [path.join(directory, "check.ts")],
        outdir: directory,
        naming: "check.mjs",
        target: "node",
        format: "esm",
        // Match the packaged main process: native ESM resolves updater subpaths at runtime.
        external: ["electron", "electron-updater"],
      })

      expect(compiled.success).toBe(true)

      const env = { ...process.env }

      // A real Electron main process is needed; Node mode would hide the missing executor.
      delete env.ELECTRON_RUN_AS_NODE

      const child = Bun.spawn(
        [
          path.resolve(import.meta.dir, "../../node_modules/electron/dist/electron.exe"),
          path.join(directory, "start.cjs"),
        ],
        { cwd: directory, env, stdout: "pipe", stderr: "pipe" },
      )

      const stdout = Bun.readableStreamToText(child.stdout)
      const stderr = Bun.readableStreamToText(child.stderr)
      const timer = setTimeout(() => child.kill(), 15000)
      const code = await child.exited.finally(() => clearTimeout(timer))
      const output = await stdout

      expect({ code, stderr: code ? await stderr : "" }).toEqual({ code: 0, stderr: "" })

      const result = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String, installer: Schema.String }))(
        JSON.parse(output.trim()),
      )

      expect(result.version).toBe("2.1.3")
      expect(result.installer.startsWith(path.join(directory, "custom-cache"))).toBe(true)
      expect(await Bun.file(result.installer).text()).toBe(installer.toString())
      expect(requests.some((request) => request.path === "/latest.yml")).toBe(true)
      expect(requests.some((request) => request.path === "/installer.exe")).toBe(true)
      expect(requests.some((request) => request.path === "/paused/latest.yml")).toBe(true)
      expect(requests.every((request) => request.key === "regression-key")).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await unlink(path.join(directory, "node_modules/electron-updater")).catch(() => {})
      await rm(directory, { recursive: true, force: true })
    }
  },
  20000,
)
