param(
  [string] $WorkingDirectory = (Join-Path $PSScriptRoot "..\packages\desktop-electron")
)

$ErrorActionPreference = "Stop"

Push-Location (Resolve-Path $WorkingDirectory)
try {
  if (-not (Test-Path (Join-Path (Get-Location) "scripts\prebuild.ts"))) {
    $fallback = Resolve-Path (Join-Path $PSScriptRoot "..\packages\desktop")
    if (-not (Test-Path (Join-Path $fallback "scripts\prebuild.ts"))) {
      throw "No buildable desktop package found"
    }

    Pop-Location
    Push-Location $fallback
    Write-Host "Using buildable desktop package at $fallback"
  }

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
