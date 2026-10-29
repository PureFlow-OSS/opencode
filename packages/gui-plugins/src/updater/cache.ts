import path from "node:path"
import type { AppAdapter } from "electron-updater/out/AppAdapter"

declare const OPENCODE_UPDATE_CACHE_DIR: string | undefined

export function updateCacheDirectory(input: {
  readonly platform: NodeJS.Platform
  readonly installDirectory: string
  readonly cacheDirectory?: string
}) {
  if (input.platform !== "win32") return undefined

  const fallback = "C:\\Entwicklung\\ai.opencode.desktop\\updates"
  const cache = (input.cacheDirectory ?? embeddedUpdateCacheDirectory())?.trim() || fallback

  const directory = path.win32.resolve(cache)
  const install = path.win32.resolve(input.installDirectory)
  // Executables must remain below the corporate allowlisted directory and outside the installation it replaces.
  const cached = directory.toLowerCase()
  const installed = install.toLowerCase()

  if (!cached.startsWith("c:\\entwicklung\\")) return cached === "c:\\entwicklung" ? directory : fallback

  if (cached === installed || cached.startsWith(installed + path.win32.sep)) return fallback

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
  // SAFETY: Vite replaces this declared string constant; unbundled tests have no binding, so typeof avoids ReferenceError.
  // eslint-disable-next-line anti-slop/no-runtime-typeof
  const bundled = typeof OPENCODE_UPDATE_CACHE_DIR === "string" ? OPENCODE_UPDATE_CACHE_DIR : undefined

  return bundled ?? process.env.OPENCODE_UPDATE_CACHE_DIR
}
