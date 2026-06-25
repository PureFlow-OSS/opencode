# Run as Administrator (recommended)

$registryKey = "HKCU:\Software\opencode"

# Ask user whether to delete config/auth files
Write-Host "Sollen auth.json (.local\share\opencode) und opencode.json/.jsonc (.config\opencode) ebenfalls geloescht werden? [J/n] " -NoNewline
$key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host $key.Character
$deleteConfigFiles = ($key.Character -notmatch '^[nN]$')

# Look up OpenCode installation path from registry
$installPath = $null
$uninstallKey = $null
foreach ($key in Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue) {
    $props = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    if ($props -and $props.DisplayName -imatch '^OpenCode') {
        $uninstallKey = $key.PSPath
        if ($props.UninstallString) {
            $match = [regex]::Match($props.UninstallString, '"([^"]+)"')
            if ($match.Success) {
                $installPath = (Split-Path $match.Groups[1].Value)

                Write-Host "Found OpenCode uninstall path: $installPath"
            }
        }
        break
    }
}

# Ask user whether to delete OpenCode Sessions
Write-Host "Sollen die OpenCode Sessions (%APPDATA%\ai.opencode.desktop) geloescht werden? [J/n] " -NoNewline
$key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host $key.Character
$deleteSessions = ($key.Character -notmatch '^[nN]$')

Write-Host "Stopping OpenCode..."
Get-Process opencode -ErrorAction SilentlyContinue | Stop-Process -Force

# Clean up Start Menu shortcut
$shortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\opencode.lnk"
if (Test-Path $shortcutPath) {
    Write-Host "Deleting Start Menu shortcut: $shortcutPath"
    Remove-Item -Force $shortcutPath
} else {
    Write-Host "Not found: $shortcutPath"
}

# Clean up Desktop shortcut
$desktopShortcut = "$env:USERPROFILE\Desktop\opencode.lnk"
if (Test-Path $desktopShortcut) {
    Write-Host "Deleting Desktop shortcut: $desktopShortcut"
    Remove-Item -Force $desktopShortcut
} else {
    Write-Host "Not found: $desktopShortcut"
}

# Clean up network Desktop shortcut
$networkDesktopShortcut = "\\grznas1\userdata_pfh$\lrzwsel\Desktop\opencode.lnk"
if (Test-Path $networkDesktopShortcut) {
    Write-Host "Deleting Desktop shortcut: $networkDesktopShortcut"
    Remove-Item -Force $networkDesktopShortcut
} else {
    Write-Host "Not found: $networkDesktopShortcut"
}

Write-Host "Deleting OpenCode cache, config, and data..." -ForegroundColor Yellow

$paths = @(
    "$env:LOCALAPPDATA\opencode",
    "$env:LOCALAPPDATA\@opencode-aidesktop-electron-updater",
    "$env:LOCALAPPDATA\@opencode-aidesktop-updater",
    "$env:APPDATA\opencode",
    "$env:USERPROFILE\.cache\opencode"
)

foreach ($path in $paths) {
    if (Test-Path $path) {
        Write-Host "Removing $path"
        Remove-Item -Recurse -Force $path
    } else {
        Write-Host "Not found: $path"
    }
}

# OpenCode Sessions — %APPDATA%\ai.opencode.desktop
$sessionsPath = "$env:APPDATA\ai.opencode.desktop"
if (Test-Path $sessionsPath) {
    if ($deleteSessions) {
        Write-Host "Removing $sessionsPath"
        Remove-Item -Recurse -Force $sessionsPath
    } else {
        Write-Host "Keeping $sessionsPath"
    }
} else {
    Write-Host "Not found: $sessionsPath"
}

# OpenCode installation folder
if ($installPath -and (Test-Path $installPath)) {
    Write-Host "Removing $installPath"
    Remove-Item -Recurse -Force $installPath
} else {
    Write-Host "Not found: $installPath"
}

# .local\share\opencode — auth.json wird ggf. behalten
$localSharePath = "$env:USERPROFILE\.local\share\opencode"
if (Test-Path $localSharePath) {
    if ($deleteConfigFiles) {
        Write-Host "Removing $localSharePath"
        Remove-Item -Recurse -Force $localSharePath
    } else {
        Write-Host "Removing contents of $localSharePath (keeping auth.json)"
        Get-ChildItem $localSharePath -Recurse | Where-Object { $_.Name -ne "auth.json" } |
            Sort-Object FullName -Descending |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "Not found: $localSharePath"
}

# .config\opencode — opencode.json/.jsonc wird ggf. behalten
$configPath = "$env:USERPROFILE\.config\opencode"
if (Test-Path $configPath) {
    if ($deleteConfigFiles) {
        Write-Host "Removing $configPath"
        Remove-Item -Recurse -Force $configPath
    } else {
        Write-Host "Removing contents of $configPath (keeping opencode.json/.jsonc)"
        Get-ChildItem $configPath -Recurse | Where-Object { $_.Name -notmatch '^opencode\.jsonc?$' } |
            Sort-Object FullName -Descending |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "Not found: $configPath"
}

# Read registry values and delete referenced folders
if (Test-Path $registryKey) {

    function Remove-ReferencedFolders($keyPath) {
        $props = Get-ItemProperty $keyPath -ErrorAction SilentlyContinue
        if ($props) {
            foreach ($prop in $props.PSObject.Properties) {
                if ($prop.Name -match '^PS') { continue }
                if ($prop.Value -is [string] -and (Test-Path $prop.Value)) {
                    $target = (Resolve-Path $prop.Value).Path

                    Write-Host "Deleting folder: $target"
                    try {
                        Remove-Item $target -Recurse -Force -ErrorAction Stop
                    }
                    catch {
                        Write-Warning "Failed to delete $target"
                    }
                }
            }
        }
        # Recurse into child subkeys
        foreach ($child in (Get-ChildItem $keyPath -ErrorAction SilentlyContinue)) {
            Remove-ReferencedFolders $child.PSPath
        }
    }

    Write-Host "Processing registry key: $registryKey"
    Remove-ReferencedFolders $registryKey

    Write-Host "Deleting registry key..."
    Remove-Item $registryKey -Recurse -Force
}

# Clean up uninstall registry key
if ($uninstallKey -and (Test-Path $uninstallKey)) {
    Write-Host "Deleting uninstall registry key: $uninstallKey"
    Remove-Item $uninstallKey -Recurse -Force
}

# Clean up protocol handler registry keys
$protocolKey = "HKCU:\Software\Classes\opencode"
if (Test-Path $protocolKey) {
    Write-Host "Deleting protocol handler registry key: $protocolKey"
    Remove-Item $protocolKey -Recurse -Force
}

Write-Host "Done. OpenCode has been reset." -ForegroundColor Green

$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
