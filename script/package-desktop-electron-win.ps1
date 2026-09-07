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

  $hasKeyVaultSigning =
    ($env:AZURE_KEYVAULT_URL -or $env:KEYVAULT_URL) -and
    ($env:AZURE_KEYVAULT_CLIENT_ID -or $env:AZURE_CLIENT_ID) -and
    ($env:AZURE_KEYVAULT_CLIENT_SECRET -or $env:AZURE_CLIENT_SECRET) -and
    ($env:AZURE_KEYVAULT_TENANT_ID -or $env:AZURE_TENANT_ID) -and
    ($env:AZURE_KEYVAULT_CERT -or $env:CERT_ALIAS -or $env:CertificateName)
  $hasTrustedSigning =
    $env:AZURE_TRUSTED_SIGNING_ENDPOINT -and
    $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME -and
    $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE

  if ($hasKeyVaultSigning -or $hasTrustedSigning) {
    $signedOutputDir = Resolve-Path $outputDir
    Write-Host "Signing packaged Windows output in $signedOutputDir"
    & pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "sign-windows.ps1") $signedOutputDir
  }
  else {
    Write-Host "No signing configuration found; leaving the local package unsigned"
  }
}
finally {
  Pop-Location
}
