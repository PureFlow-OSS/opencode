; OpenCode is intentionally installed at a fixed per-user location. This prevents
; NSIS command-line parsing from turning a slash-based path into C:EntwicklungOpenCode.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  WriteRegStr HKCU "Software\${APP_GUID}" InstallLocation "C:\Entwicklung\OpenCode"
!macroend
