import path from "node:path"

export function cliStageRoot(userData: string) {
  // Corporate Windows policy permits executables only below C:\Entwicklung. Keep channels separate.
  return process.platform === "win32"
    ? path.join("C:\\Entwicklung", path.basename(userData), "cli")
    : path.join(userData, "cli")
}
