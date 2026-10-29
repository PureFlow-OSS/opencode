param(
  [string] $WorkingDirectory = (Join-Path $PSScriptRoot "..\packages\desktop"),
  [switch] $SkipCliBuild
)

$ErrorActionPreference = "Stop"

function Invoke-Bun {
  param(
    [Parameter(Mandatory = $true)]
    [string[]] $Arguments
  )

  & bunx --bun bun@1.4.4 --bun run @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Bun 1.4.4 exited with status $LASTEXITCODE" }
}

$desktopDirectory = (Resolve-Path $WorkingDirectory).Path
if (-not (Test-Path (Join-Path $desktopDirectory "electron-builder.config.ts") -PathType Leaf)) {
  throw "No buildable desktop package found: $desktopDirectory"
}

$desktopPackage = Get-Content (Join-Path $desktopDirectory "package.json") -Raw | ConvertFrom-Json
$originalOpenCodeVersion = $env:OPENCODE_VERSION
$originalOpenCodeCliDist = $env:OPENCODE_CLI_DIST
$originalOpenCodeTarget = $env:OPENCODE_TARGET
$openCodeVersionWasSetByScript = $false
$openCodeCliDistWasSetByScript = $false
if (-not $originalOpenCodeVersion) {
  $env:OPENCODE_VERSION = $desktopPackage.version
  $openCodeVersionWasSetByScript = $true
}

Push-Location $desktopDirectory
try {
  if ($SkipCliBuild -and -not $env:OPENCODE_CLI_DIST) {
    throw "-SkipCliBuild requires OPENCODE_CLI_DIST to point to an existing CLI distribution"
  }

  if (-not $SkipCliBuild -and -not $env:OPENCODE_CLI_DIST) {
    $packagesDirectory = (Resolve-Path (Join-Path $desktopDirectory "..")).Path
    $cliDistribution = Join-Path $packagesDirectory "cli/.cache/local-desktop"
    $env:OPENCODE_TARGET = "windows-x64-baseline"
    Invoke-Bun @(
      "../cli/script/build.ts",
      "--skip-install",
      "--outdir=$cliDistribution"
    )
    $env:OPENCODE_CLI_DIST = $cliDistribution
    $openCodeCliDistWasSetByScript = $true
  }

  $cliExecutable = Join-Path $env:OPENCODE_CLI_DIST "cli-windows-x64-baseline/bin/opencode.exe"
  $cliManifest = Join-Path $env:OPENCODE_CLI_DIST "cli-windows-x64-baseline/package.json"
  if (-not (Test-Path $cliExecutable -PathType Leaf) -or -not (Test-Path $cliManifest -PathType Leaf)) {
    throw "OPENCODE_CLI_DIST does not contain the Windows x64 baseline CLI"
  }

  $cliPackage = Get-Content $cliManifest -Raw | ConvertFrom-Json
  if ($cliPackage.version -ne $env:OPENCODE_VERSION) {
    throw "Bundled CLI version $($cliPackage.version) does not match desktop version $env:OPENCODE_VERSION"
  }

  $env:OPENCODE_TARGET = "windows-x64"
  Invoke-Bun @("build")
  Invoke-Bun @(
    "package:win",
    "--",
    "--publish", "never",
    "-c.extraMetadata.version=$env:OPENCODE_VERSION"
  )

  $outputDirectory = if ([string]::IsNullOrWhiteSpace($env:OPENCODE_ELECTRON_OUTPUT_DIR)) {
    Join-Path $desktopDirectory "dist"
  } elseif ([IO.Path]::IsPathRooted($env:OPENCODE_ELECTRON_OUTPUT_DIR.Trim())) {
    [IO.Path]::GetFullPath($env:OPENCODE_ELECTRON_OUTPUT_DIR.Trim())
  } else {
    [IO.Path]::GetFullPath((Join-Path $desktopDirectory $env:OPENCODE_ELECTRON_OUTPUT_DIR.Trim()))
  }
  Copy-Item -LiteralPath (Join-Path $desktopDirectory "../../CHANGELOG.md") -Destination (Join-Path $outputDirectory "changelog.md") -Force

  Write-Host "Packaged Windows desktop output in $outputDirectory"
}
finally {
  Pop-Location
  [Environment]::SetEnvironmentVariable("OPENCODE_TARGET", $originalOpenCodeTarget, "Process")
  if ($openCodeVersionWasSetByScript) {
    [Environment]::SetEnvironmentVariable("OPENCODE_VERSION", $originalOpenCodeVersion, "Process")
  }
  if ($openCodeCliDistWasSetByScript) {
    [Environment]::SetEnvironmentVariable("OPENCODE_CLI_DIST", $originalOpenCodeCliDist, "Process")
  }
}
