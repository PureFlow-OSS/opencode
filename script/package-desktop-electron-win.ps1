param(
  [string] $WorkingDirectory = (Join-Path $PSScriptRoot "..\packages\desktop-electron")
)

$ErrorActionPreference = "Stop"

Push-Location (Resolve-Path $WorkingDirectory)
try {
  bun run package:win

  $outputDir = $env:OPENCODE_ELECTRON_OUTPUT_DIR
  if (-not $outputDir) {
    $outputDir = "dist"
  }

  $signedOutputDir = Resolve-Path $outputDir
  Write-Host "Signing packaged Windows output in $signedOutputDir"
  & pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sign-windows.ps1") $signedOutputDir
}
finally {
  Pop-Location
}
