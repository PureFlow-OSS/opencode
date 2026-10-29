Set-StrictMode -Version Latest

function Get-OpenCodePathUpdate {
  [CmdletBinding()]
  param(
    [AllowNull()][AllowEmptyString()][string] $PathValue,
    [Parameter(Mandatory = $true)][string] $Directory,
    [Parameter(Mandatory = $true)][ValidateSet('Install', 'Uninstall')][string] $Action
  )

  $target = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
  $original = if ($null -eq $PathValue) { '' } else { $PathValue }
  $parts = @($original.Split([char] ';'))
  $matching = @($parts | ForEach-Object {
    $entry = [Environment]::ExpandEnvironmentVariables($_.Trim().Trim('"')).Replace('/', '\').TrimEnd('\')
    [StringComparer]::OrdinalIgnoreCase.Equals($entry, $target)
  })

  $remaining = @(for ($index = 0; $index -lt $parts.Length; $index++) {
    if (-not $matching[$index]) { $parts[$index] }
  })
  if ($Action -eq 'Install') {
    # Put the console entry before older user-level shims, without changing unrelated entries.
    $updated = if ($original.Length -eq 0 -or $remaining.Count -eq 0) { $target } else { $target + ';' + ($remaining -join ';') }
    if ($updated.Length -ge 32767) { throw 'The user PATH is too long to register the OpenCode CLI safely.' }
    return [pscustomobject] @{ Changed = ($updated -cne $original); Value = $updated }
  }

  if ($matching -notcontains $true) { return [pscustomobject] @{ Changed = $false; Value = $original } }
  return [pscustomobject] @{ Changed = $true; Value = ($remaining -join ';') }
}

Export-ModuleMember -Function Get-OpenCodePathUpdate
