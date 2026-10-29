[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Install', 'Uninstall')][string] $Action,
  [Parameter(Mandatory = $true)][string] $Directory
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'cli-path.psm1') -Force

# This per-user installer owns exactly this PATH entry, never the machine PATH or other installations.
if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($Directory).TrimEnd('\'), 'C:\Entwicklung\OpenCode\bin')) {
  throw 'The CLI directory must be C:\Entwicklung\OpenCode\bin.'
}

$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($null -eq $key) {
  if ($Action -eq 'Uninstall') { exit 0 }
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
}

try {
  $exists = $key.GetValueNames() -contains 'Path'
  $kind = if ($exists) { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  if ($kind -notin @([Microsoft.Win32.RegistryValueKind]::String, [Microsoft.Win32.RegistryValueKind]::ExpandString)) {
    throw 'The existing user PATH is not a string. It has not been modified.'
  }
  # Keep %VARIABLE% references verbatim and avoid NSIS/setx string-length truncation.
  $current = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $change = Get-OpenCodePathUpdate -PathValue $current -Directory $Directory -Action $Action
  if ($change.Changed) {
    if ($change.Value.Length -eq 0) { $key.DeleteValue('Path', $false) }
    else { $key.SetValue('Path', $change.Value, $kind) }
  }
} finally {
  $key.Dispose()
}
