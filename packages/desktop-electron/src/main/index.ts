import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
import type { Event } from "electron"
import { app, BrowserWindow, dialog, session } from "electron"
import pkg from "electron-updater"

import contextMenu from "electron-context-menu"
contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

// on macOS apps run in `/` which can cause issues with ripgrep
try {
  process.chdir(homedir())
} catch {}

process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

const APP_NAMES: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenCode Dev")
app.setAppUserModelId(appId)
app.setPath("userData", join(app.getPath("appData"), appId))
const updateCacheRoot =
  process.platform === "win32" ? process.env.OPENCODE_UPDATE_CACHE_DIR?.trim() || "C:/Entwicklung" : undefined
const autoUpdater = pkg.autoUpdater

if (process.platform === "win32" && updateCacheRoot) {
  const appAdapter = Reflect.get(autoUpdater, "app")
  if (appAdapter && typeof appAdapter === "object") {
    Object.defineProperty(appAdapter, "baseCachePath", {
      configurable: true,
      get() {
        return updateCacheRoot
      },
    })
  }
}

import type { InitStep, ServerReadyData, SqliteMigrationProgress, WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand, sendSqliteMigrationProgress } from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { getDefaultServerUrl, getWslConfig, setDefaultServerUrl, setWslConfig, spawnLocalServer } from "./server"
import { updateServer } from "./update-server"
import { shouldTrustUpdateServerCertificate } from "./update-server-trust"
import {
  createLoadingWindow,
  createMainWindow,
  registerRendererProtocol,
  setBackgroundColor,
  setDockIcon,
} from "./windows"
import { drizzle } from "drizzle-orm/node-sqlite/driver"
import type { Server } from "virtual:opencode-server"

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

let mainWindow: BrowserWindow | null = null
let server: Server.Listener | null = null
let sidecarStop: Promise<void> | null = null
let appExit: Promise<void> | null = null
const loadingComplete = defer<void>()

const pendingDeepLinks: string[] = []

const serverReady = defer<ServerReadyData>()
const logger = initLogging()
let updateServerConfig: Awaited<ReturnType<typeof updateServer.fetch>> | undefined
let updateServerConfigPromise: ReturnType<typeof updateServer.fetch> | undefined
const defaultMotd = { enabled: true, text: "RRZ AI Factory" }

logger.log("app starting", {
  version: app.getVersion(),
  packaged: app.isPackaged,
})

setupApp()

function setupApp() {
  ensureLoopbackNoProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    focusMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("window-all-closed", () => {
    logger.log("all windows closed")
    mainWindow = null
    if (process.platform === "darwin") return
    void exitApplication("window-all-closed")
  })

  app.on("before-quit", () => {
    void killSidecar()
  })

  app.on("will-quit", () => {
    void killSidecar()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void killSidecar()
      app.exit(0)
    })
  }

  void app.whenReady().then(async () => {
    app.setAsDefaultProtocolClient("opencode")
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      callback(shouldTrustUpdateServerCertificate(request.hostname) ? 0 : -3)
    })
    registerRendererProtocol()
    setDockIcon()
    setupAutoUpdater()
    void getUpdateServerConfig()
    await initialize()
  })
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function focusMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

function setInitStep(step: InitStep) {
  initStep = step
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

async function initialize() {
  const needsMigration = !sqliteFileExists()
  const sqliteDone = needsMigration ? defer<void>() : undefined
  let overlay: BrowserWindow | null = null

  const port = await getSidecarPort()
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  const loadingTask = (async () => {
    logger.log("sidecar connection started", { url })

    initEmitter.on("sqlite", (progress: SqliteMigrationProgress) => {
      setInitStep({ phase: "sqlite_waiting" })
      if (overlay) sendSqliteMigrationProgress(overlay, progress)
      if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress)
      if (progress.type === "Done") sqliteDone?.resolve()
    })

    if (needsMigration) {
      const { Database, JsonMigration } = await import("virtual:opencode-server")
      await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
        progress: (event: { current: number; total: number }) => {
          const percent = Math.round(event.current / event.total) * 100
          initEmitter.emit("sqlite", { type: "InProgress", value: percent })
        },
      })
      initEmitter.emit("sqlite", { type: "Done" })

      sqliteDone?.resolve()
    }

    if (needsMigration) {
      await sqliteDone?.promise
    }

    logger.log("spawning sidecar", { url })
    const { listener, health } = await spawnLocalServer(hostname, port, password)
    server = listener
    serverReady.resolve({
      url,
      username: "opencode",
      password,
    })

    await Promise.race([
      health.wait,
      delay(30_000).then(() => {
        throw new Error("Sidecar health check timed out")
      }),
    ]).catch((error) => {
      logger.error("sidecar health check failed", error)
    })

    logger.log("loading task finished")
  })()

  if (needsMigration) {
    const show = await Promise.race([loadingTask.then(() => false), delay(1_000).then(() => true)])
    if (show) {
      overlay = createLoadingWindow()
      await delay(1_000)
    }
  }

  await loadingTask
  setInitStep({ phase: "done" })

  if (overlay) {
    await loadingComplete.promise
  }

  mainWindow = createMainWindow()
  wireMenu()

  overlay?.close()
}

function wireMenu() {
  if (!mainWindow) return
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => {
      void checkForUpdates(true)
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      void killSidecar().finally(() => {
        app.relaunch()
        app.exit(0)
      })
    },
  })
}

registerIpcHandlers({
  killSidecar: () => killSidecar(),
  awaitInitialization: async (sendStep) => {
    sendStep(initStep)
    const listener = (step: InitStep) => sendStep(step)
    initEmitter.on("step", listener)
    try {
      logger.log("awaiting server ready")
      const res = await serverReady.promise
      logger.log("server ready", { url: res.url })
      return res
    } finally {
      initEmitter.off("step", listener)
    }
  },
  getMotd: async () => {
    const motd = (await getUpdateServerConfig(true))?.motd
    if (motd?.enabled === false) return null
    return motd ?? defaultMotd
  },
  getWindowConfig: () => ({ updaterEnabled: UPDATER_ENABLED }),
  consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
  getDefaultServerUrl: () => getDefaultServerUrl(),
  setDefaultServerUrl: (url) => setDefaultServerUrl(url),
  getWslConfig: () => Promise.resolve(getWslConfig()),
  setWslConfig: (config: WslConfig) => setWslConfig(config),
  getDisplayBackend: async () => null,
  setDisplayBackend: async () => undefined,
  parseMarkdown: async (markdown) => parseMarkdown(markdown),
  checkAppExists: async (appName) => checkAppExists(appName),
  wslPath: async (path, mode) => wslPath(path, mode),
  resolveAppPath: async (appName) => resolveAppPath(appName),
  loadingWindowComplete: () => loadingComplete.resolve(),
  runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail),
  checkUpdate: async () => checkUpdate(),
  installUpdate: async () => installUpdate(),
  setBackgroundColor: (color) => setBackgroundColor(color),
})

async function killSidecar() {
  if (sidecarStop) return sidecarStop
  if (!server) return
  const active = server
  server = null
  sidecarStop = active.stop(true).catch(() => undefined).finally(() => {
    sidecarStop = null
  })
  await sidecarStop
}

async function exitApplication(reason: string) {
  if (appExit) return appExit
  appExit = (async () => {
    logger.log("exiting application", { reason })
    await killSidecar()
    await delay(100)
    app.exit(0)
  })().finally(() => {
    appExit = null
  })
  await appExit
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

async function getSidecarPort() {
  const fromEnv = process.env.OPENCODE_PORT
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (!Number.isNaN(parsed)) return parsed
  }

  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function sqliteFileExists() {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
  return existsSync(join(base, "opencode", "opencode.db"))
}

function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.disableWebInstaller = true
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
    cacheRoot: updateCacheRoot ?? null,
  })
}

let downloadedUpdateVersion: string | undefined

async function getUpdateServerConfig(refresh = false) {
  if (!refresh && updateServerConfig !== undefined) return updateServerConfig
  if (!refresh && updateServerConfigPromise) return updateServerConfigPromise
  updateServerConfigPromise = updateServer.fetch()
  updateServerConfig = await updateServerConfigPromise
  updateServerConfigPromise = undefined
  return updateServerConfig
}

async function checkUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  if (downloadedUpdateVersion) {
    logger.log("returning cached downloaded update", {
      version: downloadedUpdateVersion,
    })
    return { updateAvailable: true, version: downloadedUpdateVersion }
  }
  const remote = await getUpdateServerConfig(true)
  if (!remote) {
    logger.log("update server unreachable")
    return { updateAvailable: false }
  }
  if (!remote.version || !remote.url) {
    logger.log("update server config has no update metadata")
    return { updateAvailable: false }
  }
  if (updateServer.compareVersions(app.getVersion(), remote.version) <= 0) {
    logger.log("no update available", {
      reason: "custom server version not newer",
      currentVersion: app.getVersion(),
      remoteVersion: remote.version,
    })
    return { updateAvailable: false }
  }
  autoUpdater.setFeedURL(remote.url)
  logger.log("checking for updates", {
    currentVersion: app.getVersion(),
    remoteVersion: remote.version,
    feedUrl: remote.url,
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
  })
  try {
    const result = await autoUpdater.checkForUpdates()
    const updateInfo = result?.updateInfo
    logger.log("update metadata fetched", {
      releaseVersion: updateInfo?.version ?? null,
      releaseDate: updateInfo?.releaseDate ?? null,
      releaseName: updateInfo?.releaseName ?? null,
      files: updateInfo?.files?.map((file) => file.url) ?? [],
    })
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable === false || !version) {
      logger.log("no update available", {
        reason: "provider returned no newer version",
      })
      return { updateAvailable: false }
    }
    logger.log("update available", { version })
    await autoUpdater.downloadUpdate()
    logger.log("update download completed", { version })
    downloadedUpdateVersion = version
    return { updateAvailable: true, version }
  } catch (error) {
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

async function installUpdate() {
  if (!downloadedUpdateVersion) {
    logger.log("install update skipped", {
      reason: "no downloaded update ready",
    })
    return
  }
  logger.log("installing downloaded update", {
    version: downloadedUpdateVersion,
  })
  if (process.platform === "win32") {
    const installerPath = Reflect.get(autoUpdater, "installerPath")
    const downloadedUpdateHelper = Reflect.get(autoUpdater, "downloadedUpdateHelper")
    const packageFile = Reflect.get(downloadedUpdateHelper, "packageFile")
    const installDirectory = resolveInstallDirectory(Reflect.get(autoUpdater, "installDirectory"))
    const args = [
      "--updated",
      "--force-run",
      ...(typeof packageFile === "string" && packageFile.length > 0 ? [`--package-file=${packageFile}`] : []),
      ...(typeof installDirectory === "string" && installDirectory.length > 0 ? [`/D=${installDirectory}`] : []),
    ]

    if (typeof installerPath === "string" && installerPath.length > 0) {
      const helperLogPath = await scheduleWindowsInstaller(installerPath, args, installDirectory)
      logger.log("scheduling deferred installer launch", {
        version: downloadedUpdateVersion,
        installerPath,
        args,
        installDirectory,
        helperLogPath,
      })
      await killSidecar()
      BrowserWindow.getAllWindows().forEach((win) => {
        win.hide()
        win.destroy()
      })
      await dialog.showMessageBox({
        type: "info",
        title: "Installer wird gestartet",
        message: "OpenCode wird beendet. Der Installer startet danach automatisch.",
        detail: `Falls nichts passiert, pruefe diese Logdatei:\n${helperLogPath}`,
        buttons: ["OK"],
        defaultId: 0,
      })
      await exitApplication("install-update")
      return
    }
  }
  await killSidecar()
  await delay(250)
  autoUpdater.quitAndInstall()
}

async function checkForUpdates(alertOnFail: boolean) {
  if (!UPDATER_ENABLED) return
  logger.log("checkForUpdates invoked", { alertOnFail })
  const result = await checkUpdate()
  if (!result.updateAvailable) {
    if (result.failed) {
      logger.log("no update decision", { reason: "update check failed" })
      return
    }

    logger.log("no update decision", { reason: "already up to date" })
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date.",
      title: "No Updates",
    })
    return
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${result.version ?? ""} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  logger.log("update prompt response", {
    version: result.version ?? null,
    restartNow: response.response === 0,
  })
  if (response.response === 0) {
    await installUpdate()
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveInstallDirectory(input: unknown) {
  if (typeof input === "string" && input.length > 0) return input
  if (process.platform === "win32") return "C:/Entwicklung/OpenCode"
  if (!app.isPackaged) return
  return dirname(process.execPath)
}

async function scheduleWindowsInstaller(installerPath: string, args: string[], installDirectory: unknown) {
  const helperId = randomUUID()
  const logPath = join(app.getPath("temp"), `opencode-installer-${helperId}.log`)
  const helperSourcePath = resolveUpdaterHelperPath()
  const helperTargetPath = join(dirname(installerPath), `OpenCode.UpdaterHelper-${helperId}.exe`)
  const packageFileArg = args.find((value) => value.startsWith("--package-file="))
  const packageFile = packageFileArg ? packageFileArg.slice("--package-file=".length) : undefined
  const resolvedInstallDirectory = typeof installDirectory === "string" && installDirectory.length > 0 ? installDirectory : undefined
  await mkdir(dirname(helperTargetPath), { recursive: true })
  await writeFile(logPath, `${new Date().toISOString()} helper scheduled\r\n`, "utf8")
  await copyFile(helperSourcePath, helperTargetPath)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      helperTargetPath,
      [
        "--parent-pid",
        String(process.pid),
        "--installer-path",
        installerPath,
        "--log-path",
        logPath,
        ...(resolvedInstallDirectory ? ["--install-dir", resolvedInstallDirectory] : []),
        ...(packageFile ? ["--package-file", packageFile] : []),
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    )
    child.on("error", reject)
    child.unref()
    resolve()
  })
  return logPath
}

function resolveUpdaterHelperPath() {
  const filename = "OpenCode.UpdaterHelper.exe"
  if (app.isPackaged) return join(process.resourcesPath, "updater-helper", filename)
  return join(app.getAppPath(), "build", "updater-helper", "win-x64", filename)
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
