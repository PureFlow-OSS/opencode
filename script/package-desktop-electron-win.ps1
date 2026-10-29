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
$originalOutputDirectory = $env:OPENCODE_ELECTRON_OUTPUT_DIR
$outputDirectory = if ([string]::IsNullOrWhiteSpace($originalOutputDirectory)) {
  Join-Path $desktopDirectory "dist"
} elseif ([IO.Path]::IsPathRooted($originalOutputDirectory.Trim())) {
  [IO.Path]::GetFullPath($originalOutputDirectory.Trim())
} else {
  [IO.Path]::GetFullPath((Join-Path $desktopDirectory $originalOutputDirectory.Trim()))
}
$openCodeVersionWasSetByScript = $false
$openCodeCliDistWasSetByScript = $false
if (-not $originalOpenCodeVersion) {
  $env:OPENCODE_VERSION = $desktopPackage.version
  $openCodeVersionWasSetByScript = $true
}

Push-Location $desktopDirectory
try {
  # The packager and changelog copy must use the same directory, resolved before either build runs.
  $env:OPENCODE_ELECTRON_OUTPUT_DIR = $outputDirectory
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
  # package:win explicitly loads electron-builder.config.ts, which reads version/output from the environment.
  Invoke-Bun @("package:win")

  if (-not (Test-Path -LiteralPath (Join-Path $outputDirectory "opencode-desktop-win-x64.exe") -PathType Leaf)) {
    throw "The configured Windows installer was not produced in $outputDirectory. Check the loaded electron-builder configuration."
  }
  Copy-Item -LiteralPath (Join-Path $desktopDirectory "../../CHANGELOG.md") -Destination (Join-Path $outputDirectory "changelog.md") -Force

  Write-Host "Packaged Windows desktop output in $outputDirectory"
}
finally {
  Pop-Location
  [Environment]::SetEnvironmentVariable("OPENCODE_TARGET", $originalOpenCodeTarget, "Process")
  [Environment]::SetEnvironmentVariable("OPENCODE_ELECTRON_OUTPUT_DIR", $originalOutputDirectory, "Process")
  if ($openCodeVersionWasSetByScript) {
    [Environment]::SetEnvironmentVariable("OPENCODE_VERSION", $originalOpenCodeVersion, "Process")
  }
  if ($openCodeCliDistWasSetByScript) {
    [Environment]::SetEnvironmentVariable("OPENCODE_CLI_DIST", $originalOpenCodeCliDist, "Process")
  }
}
