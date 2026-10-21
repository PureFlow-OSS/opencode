import path from "node:path"
import type { AppAdapter } from "electron-updater/out/AppAdapter"

declare const OPENCODE_UPDATE_CACHE_DIR: string | undefined

export function updateCacheDirectory(input: {
  readonly platform: NodeJS.Platform
  readonly installDirectory: string
  readonly cacheDirectory?: string
}) {
  const cache = (input.cacheDirectory ?? embeddedUpdateCacheDirectory())?.trim()
  if (input.platform !== "win32" || !cache) return undefined

  const directory = path.win32.resolve(cache)
  const install = path.win32.resolve(input.installDirectory)
  // The install helper deletes the installation directory, so the cache can live anywhere outside that subtree.
  const cached = directory.toLowerCase()
  const installed = install.toLowerCase()
  if (cached === installed || cached.startsWith(installed + path.win32.sep)) return undefined
  return directory
}

export type UpdateAppAdapterInput = Omit<AppAdapter, "appUpdateConfigPath" | "baseCachePath"> & {
  readonly resourcesPath: string
  readonly appPath: string
  readonly cacheDirectory: string
}

export function updateAppAdapter(input: UpdateAppAdapterInput): AppAdapter {
  return {
    version: input.version,
    name: input.name,
    isPackaged: input.isPackaged,
    appUpdateConfigPath: input.isPackaged
      ? path.join(input.resourcesPath, "app-update.yml")
      : path.join(input.appPath, "dev-app-update.yml"),
    userDataPath: input.userDataPath,
    baseCachePath: input.cacheDirectory,
    whenReady: input.whenReady,
    relaunch: input.relaunch,
    quit: input.quit,
    onQuit: input.onQuit,
  }
}

function embeddedUpdateCacheDirectory() {
  return typeof OPENCODE_UPDATE_CACHE_DIR === "string"
    ? OPENCODE_UPDATE_CACHE_DIR
    : process.env.OPENCODE_UPDATE_CACHE_DIR
}
