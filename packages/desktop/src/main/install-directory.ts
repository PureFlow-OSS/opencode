import { win32 } from "node:path"

export const WINDOWS_INSTALL_DIRECTORY = "C:/Entwicklung/OpenCode"

function normalizeWindowsPath(value: string) {
  return win32.normalize(value.replace(/[\\/]+$/, "")).replaceAll("\\", "/")
}

export function resolveInstallDirectory(input: unknown) {
  if (typeof input !== "string" || input.length === 0) return WINDOWS_INSTALL_DIRECTORY
  return normalizeWindowsPath(input) === WINDOWS_INSTALL_DIRECTORY ? WINDOWS_INSTALL_DIRECTORY : null
}
