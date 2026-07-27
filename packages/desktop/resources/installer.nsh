; Keep the Windows installation path fixed. Passing slash paths through NSIS
; command-line parsing can otherwise collapse C:/Entwicklung/OpenCode.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  WriteRegStr HKCU "Software\${APP_GUID}" InstallLocation "C:\Entwicklung\OpenCode"
!macroend
