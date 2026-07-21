import { app, dialog } from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"
import pkg from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { createUpdaterController, type UpdaterReadyRecord } from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { updateServer } from "./update-server"

const { autoUpdater } = pkg
const key = "ready"

export function setupAutoUpdater(stop: () => Promise<void>) {
  const logger = getLogger()
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })

  const store = getStore("opencode.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: {
      async checkForUpdates() {
        const remote = await updateServer.fetch()
        if (!remote) return null
        if (updateServer.compareVersions(app.getVersion(), remote.version) >= 0) {
          return { isUpdateAvailable: false, updateInfo: { version: remote.version } }
        }

        autoUpdater.setFeedURL({ provider: "generic", url: remote.url })
        const result = await autoUpdater.checkForUpdates()
        if (result?.updateInfo?.version !== remote.version) {
          return {
            isUpdateAvailable: false,
            updateInfo: { version: remote.version },
          }
        }
        return result
      },
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => autoUpdater.quitAndInstall(),
    },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    stop,
    log: (message, data) => logger.log(message, data),
  })
}

export async function checkUpdate(controller: ReturnType<typeof setupAutoUpdater>) {
  const state = await controller.check()
  return {
    updateAvailable: state.status === "ready",
    version: state.status === "ready" ? state.version : undefined,
    failed: state.status === "error",
    message: state.status === "error" ? state.message : undefined,
  }
}

export async function installUpdate(controller: ReturnType<typeof setupAutoUpdater>) {
  const result = await checkUpdate(controller)
  if (!result.updateAvailable) return result
  await controller.install()
  return result
}

export async function resetData() {
  if (process.platform !== "win32") return
  const root = "C:\\Entwicklung\\opencode"
  rmSync(root, { recursive: true, force: true })
  rmSync(join(root, "feed"), { recursive: true, force: true })
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupAutoUpdater>, alertOnFail: boolean) {
  const result = await checkUpdate(controller)
  if (result.failed) {
    if (!alertOnFail) return
    await dialog.showMessageBox({ type: "error", message: "Update check failed.", title: "Update Error" })
    return
  }
  if (!result.updateAvailable) {
    if (!alertOnFail) return
    await dialog.showMessageBox({ type: "info", message: "You're up to date.", title: "No Updates" })
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
  if (response.response === 0) await installUpdate(controller)
}
