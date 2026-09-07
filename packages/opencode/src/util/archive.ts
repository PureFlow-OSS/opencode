import path from "path"
import { which } from "@opencode-ai/core/util/which"
import * as Process from "./process"

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // tar.exe (bsdtar, bundled with Windows 10 1803+) extracts zip archives directly.
    // Unqualified Expand-Archive is unreliable: third-party PSModulePath entries such as
    // PSCX shadow it and lack -DestinationPath, even under -NoProfile.
    const tarPath = which("tar.exe")
    if (tarPath) {
      await Process.run([tarPath, "-xf", winZipPath, "-C", winDestDir])
      return
    }
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Microsoft.PowerShell.Archive\\Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
