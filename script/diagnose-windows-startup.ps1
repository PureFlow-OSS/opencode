<#
Collects executable integrity and window-count diagnostics without reading API keys.
-ProbeCli additionally runs each matching CLI with --version, never serve or the desktop app.
Does not change settings, service registrations, security policies or cached executables.
#>
[CmdletBinding()]
param(
  [string]$InstallDirectory = 'C:\Entwicklung\OpenCode',
  [string]$UserDataDirectory = (Join-Path $env:APPDATA 'ai.opencode.desktop'),
  [switch]$ProbeCli
)

$ErrorActionPreference = 'Stop'
$bundled = Join-Path $InstallDirectory 'resources\opencode-cli.exe'
$settings = Join-Path $UserDataDirectory 'opencode.settings'
$windows = if (Test-Path -LiteralPath $settings) {
  try {
    $value = (Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json).windowIds
    $ids = @($value | Where-Object { $value -is [array] -and $null -ne $_ })
    $valid = @($ids | Where-Object { $_ -is [string] -and $_.Length -gt 0 })
    [ordered]@{
      stored = @($ids).Count
      distinct = @($valid | Sort-Object -Unique -CaseSensitive).Count
    }
  } catch {
    @{ error = 'Cannot parse window settings' }
  }
} else {
  @{ missing = $true }
}

$fingerprint = if (Test-Path -LiteralPath $bundled) { (Get-FileHash -LiteralPath $bundled -Algorithm SHA256).Hash }
$cache = Join-Path $UserDataDirectory 'cli'
$staged = if ($fingerprint -and (Test-Path -LiteralPath $cache)) {
  Get-ChildItem -LiteralPath $cache -Directory |
    Where-Object { $_.Name.EndsWith('-' + $fingerprint, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Join-Path $_.FullName 'opencode-cli.exe' }
}

$executables = @(@($bundled) + @($staged) | Where-Object { $_ } | ForEach-Object {
  $binary = $_
  $info = [ordered]@{ path = $binary; exists = (Test-Path -LiteralPath $binary) }
  if ($info.exists) {
    $info.bytes = (Get-Item -LiteralPath $binary).Length
    $info.sha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
    $info.matchesBundled = $info.sha256 -eq $fingerprint
    $info.signature = [string](Get-AuthenticodeSignature -LiteralPath $binary).Status
    if ($ProbeCli) {
      $probe = New-Object System.Diagnostics.Process
      try {
        $probe.StartInfo.FileName = $binary
        $probe.StartInfo.Arguments = '--version'
        $probe.StartInfo.WorkingDirectory = $env:USERPROFILE
        $probe.StartInfo.UseShellExecute = $false
        $probe.StartInfo.CreateNoWindow = $true
        $probe.StartInfo.RedirectStandardOutput = $true
        $probe.StartInfo.RedirectStandardError = $true
        [void]$probe.Start()
        $stdout = $probe.StandardOutput.ReadToEndAsync()
        $stderr = $probe.StandardError.ReadToEndAsync()
        if ($probe.WaitForExit(15000)) {
          $info.probe = @{ exitCode = $probe.ExitCode; stdout = $stdout.Result.Trim(); stderr = $stderr.Result.Trim() }
        } else {
          $probe.Kill()
          $info.probe = @{ error = '--version timed out after 15 seconds' }
        }
      } catch {
        $failure = $_.Exception
        while ($failure.InnerException) { $failure = $failure.InnerException }
        $info.probe = @{ error = $failure.Message; nativeErrorCode = $failure.NativeErrorCode }
      } finally {
        $probe.Dispose()
      }
    }
  }
  $info
})

[ordered]@{ windows = $windows; executables = $executables; stagedMatches = @($staged).Count } |
  ConvertTo-Json -Depth 6
