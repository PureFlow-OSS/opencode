import { win32 } from "node:path"

export const WINDOWS_INSTALL_DIRECTORY = "C:/Entwicklung/OpenCode"

export function resolveInstallDirectory(input: unknown) {
  if (typeof input !== "string" || input.length === 0) return WINDOWS_INSTALL_DIRECTORY
  const normalized = win32.normalize(input.replace(/[\\/]+$/, "")).replaceAll("\\", "/")
  return normalized === WINDOWS_INSTALL_DIRECTORY ? WINDOWS_INSTALL_DIRECTORY : null
}
