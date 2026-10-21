import { app, autoUpdater } from "electron"
import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import { copyFile, mkdtemp } from "node:fs/promises"
import path from "node:path"
import { HttpProxy } from "@opencode/util/http-proxy"
import electronUpdater, { NsisUpdater } from "electron-updater"
import { Effect } from "effect"
import { fetchCorporateUpdate, isUpdateNewer, type CorporateSettings } from "./corporate"
import { updateAppAdapter, updateCacheDirectory } from "./cache"
import type { Platform } from "./machine"

const restartTimeout = 10_000

const windowsInstallDirectory = "C:/Entwicklung/OpenCode"
const updateClient = process.platform === "win32" ? windowsUpdateClient() : electronUpdater.autoUpdater

function windowsUpdateClient() {
  const cacheDirectory = updateCacheDirectory({
    platform: process.platform,
    installDirectory: windowsInstallDirectory,
  })
  if (!cacheDirectory) return electronUpdater.autoUpdater

  return new NsisUpdater(
    null,
    updateAppAdapter({
      cacheDirectory,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      version: app.getVersion(),
      name: app.getName(),
      isPackaged: app.isPackaged,
      userDataPath: app.getPath("userData"),
      whenReady: () => app.whenReady(),
      relaunch: () => app.relaunch(),
      quit: () => app.quit(),
      onQuit: (handler) => app.once("quit", (_event, exitCode) => handler(exitCode)),
    }),
  )
}

export const make = Effect.fn("Updater.platform")(function* (input: {
  readonly channel: string
  readonly currentVersion: string
  readonly corporateSettings: () => Promise<CorporateSettings>
  readonly apiKey: () => Promise<string | undefined>
}) {
  const userAgent = `opencode/${input.channel === "prod" ? "latest" : input.channel}/${app.getVersion()}/desktop`
  const windowsInstaller: { current?: string } = {}
  const runFork = Effect.runForkWith(yield* Effect.context())
  updateClient.logger = {
    info: (...args) => runFork(Effect.logInfo(...args)),
    warn: (...args) => runFork(Effect.logWarning(...args)),
    error: (...args) => runFork(Effect.logError(...args)),
    debug: (...args) => runFork(Effect.logDebug(...args)),
  }
  updateClient.channel = "latest"
  updateClient.requestHeaders = { "User-Agent": userAgent }
  updateClient.allowPrerelease = false
  updateClient.allowDowngrade = true
  updateClient.autoDownload = false
  updateClient.autoInstallOnAppQuit = process.platform === "darwin"
  yield* Effect.logInfo("auto updater configured", {
    channel: updateClient.channel,
    allowPrerelease: updateClient.allowPrerelease,
    allowDowngrade: updateClient.allowDowngrade,
    currentVersion: input.currentVersion,
  })

  return {
    checkForUpdate: Effect.tryPromise({
      try: async () => {
        const apiKey = await input.apiKey()
        const settings = await input.corporateSettings()
        HttpProxy.configure(settings)
        const corporate = await fetchCorporateUpdate(settings, { apiKey })

        if (!isUpdateNewer(input.currentVersion, corporate.version)) return undefined
        updateClient.setFeedURL({ provider: "generic", url: corporate.url })
        updateClient.requestHeaders = apiKey
          ? { "User-Agent": userAgent, "X-OpenCode-AiFactory-Api-Key": apiKey }
          : { "User-Agent": userAgent }
        await updateClient.netSession.setProxy({ mode: "direct" })

        const result = await updateClient.checkForUpdates()

        if (!result)
          throw new Error(
            `Corporate update metadata does not match feed ${corporate.url}: expected ${corporate.version}, got none`,
          )

        if (result.updateInfo.version !== corporate.version)
          throw new Error(
            `Corporate update metadata does not match feed ${corporate.url}: expected ${corporate.version}, got ${result?.updateInfo.version ?? "none"}`,
          )

        const files = result.updateInfo.files
        // electron-updater picks the installer whose name contains process.arch, which emulation on Windows ARM64
        // reports as x64. downloadUpdate() reads this same list, so keeping only the ARM64 installer moves the install
        // to the native build. macOS needs nothing here: electron-updater already prefers arm64 under Rosetta.
        const native = files.filter((file) => file.url.includes("arm64"))

        if (process.platform === "win32" && app.runningUnderARM64Translation && native.length > 0) {
          files.splice(0, files.length, ...native)
          runFork(
            Effect.logInfo("updating emulated x64 install to native ARM64", { urls: native.map((file) => file.url) }),
          )
        }

        return { mode: "restart", version: result.updateInfo.version } as const
      },
      catch: (error) => error,
    }),
    stageUpdate: (options) => stageUpdate(windowsInstaller, options),
    installAndRestart: installAndRestart(windowsInstaller),
  } satisfies Platform
})

function stageUpdate(windowsInstaller: { current?: string }, options: { readonly differential: boolean }) {
  if (process.platform !== "darwin")
    return Effect.tryPromise({
      try: async () => {
        // Only the NSIS cache goes stale: macOS refreshes its cached zip with every download and AppImage reads the
        // blockmap embedded in the running file. An emulated x64 install updates to the ARM64 installer, which cannot
        // be patched from the cached x64 one.
        updateClient.disableDifferentialDownload =
          process.platform === "win32" && (!options.differential || app.runningUnderARM64Translation)
        await updateClient.netSession.setProxy({ mode: "direct" })

        const [installer] = await updateClient.downloadUpdate()
        if (!installer) throw new Error("Windows updater did not download an installer")
        windowsInstaller.current = installer
      },
      catch: (error) => error,
    }).pipe(Effect.asVoid)

  return Effect.callback<void, Error>((resume) => {
    const cleanup = () => {
      autoUpdater.removeListener("update-downloaded", complete)
      updateClient.removeListener("error", fail)
    }

    const complete = () => {
      cleanup()
      resume(Effect.void)
    }

    const fail = (error: Error) => {
      cleanup()
      resume(Effect.fail(error))
    }

    autoUpdater.once("update-downloaded", complete)
    updateClient.once("error", fail)
    void updateClient.downloadUpdate().catch(fail)

    return Effect.sync(cleanup)
  })
}

function installAndRestart(windowsInstaller: { current?: string }) {
  return Effect.callback<void, Error>((resume) => {
    // The packaged helper waits for this process to exit, clears the fixed corporate directory, then runs
    // the NSIS installer. That handoff owns the moment Windows unlocks files, which quitAndInstall cannot.
    if (process.platform === "win32") {
      const installer = windowsInstaller.current
      if (!installer) resume(Effect.fail(new Error("Windows update is not staged")))
      else
        startWindowsHelper(installer).then(
          () => resume(Effect.void),
          (error) => resume(Effect.fail(error)),
        )

      return Effect.sync(() => {})
    }

    const cleanup = () => {
      autoUpdater.removeListener("before-quit-for-update", started)
      updateClient.removeListener("error", fail)
    }

    const started = () => {
      cleanup()
      resume(Effect.void)
    }

    const fail = (error: Error) => {
      cleanup()
      resume(Effect.fail(error))
    }

    autoUpdater.once("before-quit-for-update", started)
    updateClient.once("error", fail)

    try {
      updateClient.quitAndInstall()
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }

    return Effect.sync(cleanup)
  }).pipe(
    Effect.timeoutOrElse({
      duration: restartTimeout,
      orElse: () =>
        Effect.logError("update restart did not start").pipe(
          Effect.andThen(Effect.fail(new Error("Update restart did not start"))),
        ),
    }),
  )
}

/** Starts a temporary copy of the packaged helper, outside the directory it must clean before installing. */
async function startWindowsHelper(installer: string) {
  const helper = path.join(process.resourcesPath, "updater-helper", "OpenCode.UpdaterHelper.exe")
  await access(helper)
  const directory = await mkdtemp(path.join(app.getPath("temp"), "opencode-updater-"))
  const stagedHelper = path.join(directory, "OpenCode.UpdaterHelper.exe")
  await copyFile(helper, stagedHelper)
  const child = spawn(
    stagedHelper,
    ["--parent-pid", String(process.pid), "--installer-path", installer, "--install-dir", windowsInstallDirectory],
    { detached: true, stdio: "ignore", windowsHide: true },
  )
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
  child.unref()
  app.quit()
}
