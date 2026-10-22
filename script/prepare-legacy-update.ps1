param(
  [Parameter(Mandatory = $true)]
  [string] $OutputDirectory,
  [Parameter(Mandatory = $true)]
  [string] $Version,
  [switch] $SkipSigning
)

$ErrorActionPreference = "Stop"
$directory = (Resolve-Path -LiteralPath $OutputDirectory).Path
if (-not $SkipSigning -and -not ($env:TAURI_SIGNING_PRIVATE_KEY -or $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
  throw "The original TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is required; do not generate a new key"
}
if (Test-Path -LiteralPath (Join-Path $directory 'latest.json') -PathType Leaf) {
  Remove-Item -LiteralPath (Join-Path $directory 'latest.json')
}

$files = @(Get-ChildItem -LiteralPath $directory -File | Where-Object { $_.Name -match '^opencode-desktop-win-(x64|arm64)\.exe$' })
if (-not $files.Count) { throw "No Windows Electron installer found in $directory" }
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne 'Valid') { throw "Installer must have a valid Authenticode signature before preparing the legacy update: $($file.Name)" }
  if (-not $SkipSigning) {
    & bunx --bun '@tauri-apps/cli@2.10.1' signer sign $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "Tauri signer exited with status $LASTEXITCODE" }
  }
}

& bunx --bun bun@1.4.2 --bun run (Join-Path $PSScriptRoot '../packages/desktop/scripts/legacy-update.ts') $directory $Version
if ($LASTEXITCODE -ne 0) { throw "Legacy update verification failed with status $LASTEXITCODE" }
