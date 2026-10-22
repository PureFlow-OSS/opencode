!include FileFunc.nsh
!include LogicLib.nsh

Var legacyTauriRestart

!macro customInstall
  ; Chromium's sandbox needs read/execute access to the installed runtime files.
  ; https://github.com/electron/electron/issues/49143#issuecomment-3618354787
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)"'
  Pop $0
  !ifdef APP_EXECUTABLE_FILENAME
    ${If} $legacyTauriRestart == "1"
      ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
    ${EndIf}
  !endif
!macroend

; Keep the Windows installation path fixed. Passing slash paths through NSIS
; command-line parsing can otherwise collapse C:/Entwicklung/OpenCode.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  WriteRegStr HKCU "Software\${APP_GUID}" InstallLocation "C:\Entwicklung\OpenCode"
!macroend

; Run after initMultiUser and /D parsing in every installer instance, including
; the elevated inner instance used for silent per-machine upgrades.
!macro customInit
  StrCpy $INSTDIR "C:\Entwicklung\OpenCode"
  ; Tauri 2.9 launches NSIS with /P /R /UPDATE /ARGS. Electron uses different flags.
  StrCpy $legacyTauriRestart "0"
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    ClearErrors
    ${GetOptions} $CMDLINE "/P" $0
    ${IfNot} ${Errors}
      SetSilent silent
    ${EndIf}
    ClearErrors
    ${GetOptions} $CMDLINE "/R" $0
    ${IfNot} ${Errors}
      StrCpy $legacyTauriRestart "1"
    ${EndIf}
  ${EndIf}
!macroend
