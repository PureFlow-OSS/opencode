!macro customInstall
  ; Chromium's sandbox needs read/execute access to the installed runtime files.
  ; https://github.com/electron/electron/issues/49143#issuecomment-3618354787
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)"'
  Pop $0
!macroend

; Keep the Windows installation path fixed. Passing slash paths through NSIS
; command-line parsing can otherwise collapse C:/Entwicklung/OpenCode.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  WriteRegStr HKCU "Software\${APP_GUID}" InstallLocation "C:\Entwicklung\OpenCode"
!macroend
