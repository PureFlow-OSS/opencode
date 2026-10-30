import type { AppUpdater, ProgressInfo } from "electron-updater"
import type { UpdaterProgress } from "@opencode/plugin/gui/updater"

/** Own listeners for one transfer only; a failed or cancelled download cannot update the next attempt. */
export async function downloadUpdate(
  client: AppUpdater,
  publish: (progress: UpdaterProgress) => void,
  log: (message: string, data: Partial<UpdaterProgress> & { elapsedMs?: number; differential?: boolean; message?: string }) => void,
) {
  let logged = -Infinity
  let latest: UpdaterProgress = { phase: "download" }
  const started = Date.now()

  const progress = (info: ProgressInfo) => {
    latest = {
      phase: info.percent >= 100 ? "verify" : "download",
      percent: info.percent,
      transferred: info.transferred,
      total: info.total,
      bytesPerSecond: info.bytesPerSecond,
    }
    publish(latest)

    if (Date.now() - logged < 10000 && info.percent < 100) return
    logged = Date.now()
    log("update download progress", {
      percent: info.percent,
      transferred: info.transferred,
      total: info.total,
      bytesPerSecond: info.bytesPerSecond,
      elapsedMs: Date.now() - started,
    })
  }

  publish({ phase: "download" })
  log("update download started", { differential: !client.disableDifferentialDownload })
  client.on("download-progress", progress)

  const heartbeat = setInterval(
    () => log("update download active", { ...latest, elapsedMs: Date.now() - started }),
    30000,
  )

  heartbeat.unref()

  try {
    const files = await client.downloadUpdate()
    publish({ phase: "verify" })
    log("update download verified", { elapsedMs: Date.now() - started })

    return files
  } catch (error) {
    log("update download failed", {
      elapsedMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    clearInterval(heartbeat)
    client.removeListener("download-progress", progress)
  }
}
