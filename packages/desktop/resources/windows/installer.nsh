; Corporate policy requires executables below C:\Entwicklung. Keep GUI and console entry points
; separate: adding the GUI directory to PATH would make opencode launch OpenCode.exe instead of the CLI.
; Temporarily opt-in while investigating post-extraction installer aborts in corporate environments.
!ifndef OPENCODE_REGISTER_CLI
  !define OPENCODE_REGISTER_CLI 0
!endif

!ifndef BUILD_UNINSTALLER
  Var /GLOBAL sharedInstallDir
!endif

!macro customInit
  StrCpy $sharedInstallDir ""
  StrCpy $INSTDIR "C:\Entwicklung\OpenCode"
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
  WriteRegStr HKCU "Software\${APP_GUID}" InstallLocation "C:\Entwicklung\OpenCode"
!macroend

!macro customInstall
  ; Chromium's sandbox needs read/execute access to the installed runtime files.
  ; https://github.com/electron/electron/issues/49143#issuecomment-3618354787
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)"'
  Pop $0
  !insertmacro leaveSharedInstall
  !if ${OPENCODE_REGISTER_CLI} != 0
    !insertmacro installCliCommand
  !endif
!macroend

!macro cliUserPath ACTION
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows\cli-path.ps1" -Action ${ACTION} -Directory "$INSTDIR\bin"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    SetErrorLevel 1
    Abort
  ${EndIf}
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1a, p 0, w "Environment", i 2, i 5000, *p .r0)'
!macroend

!macro installCliCommand
  ClearErrors
  CreateDirectory "$INSTDIR\bin"
  ${If} ${Errors}
    SetErrorLevel 1
    Abort
  ${EndIf}
  Delete "$INSTDIR\bin\opencode.exe"
  ; A hard link preserves the signed console binary without storing a second large copy.
  System::Call 'kernel32::CreateHardLinkW(w "$INSTDIR\bin\opencode.exe", w "$INSTDIR\resources\opencode-cli.exe", p 0) i .r0'
  ${If} $0 == 0
    ClearErrors
    CopyFiles /SILENT "$INSTDIR\resources\opencode-cli.exe" "$INSTDIR\bin\opencode.exe"
    ${If} ${Errors}
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
  !insertmacro cliUserPath Install
!macroend

; Removes this channel's files from the shared directory, and the directory with the files every
; channel shared once no other channel's uninstaller is left in it. A taskbar pin still starts the
; old executable, so it is pointed at the new one.
!macro leaveSharedInstall
  ${If} $sharedInstallDir != ""
    Delete "$sharedInstallDir\${APP_EXECUTABLE_FILENAME}"
    Delete "$sharedInstallDir\${UNINSTALL_FILENAME}"
    !insertmacro removeStagedUpdates $sharedInstallDir
    FindFirst $R0 $R1 "$sharedInstallDir\Uninstall *.exe"
    FindClose $R0
    ${If} $R1 == ""
      RMDir /r $sharedInstallDir
    ${EndIf}
    ${If} ${FileExists} "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk"
      CreateShortCut "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
      WinShell::SetLnkAUMI "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    !if ${OPENCODE_REGISTER_CLI} != 0
      !insertmacro cliUserPath Uninstall
    !endif
    !insertmacro removeStagedUpdates $INSTDIR
  ${EndIf}
!macroend

; The stock check starts Windows PowerShell up to five times per installer and again in the old
; uninstaller, about 1.2 s each. This walks the process list in-process instead and keeps the stock
; behaviour: stop every process whose image lives under $INSTDIR. An update gives the quitting app
; 10 s to exit on its own; a manual install asks first, then stops it at once.
!macro customCheckAppRunning
  System::Call "kernel32::GetCurrentProcessId() i .R9"
  ; $R8 is the tick count after which processes still running are terminated.
  System::Call "kernel32::GetTickCount() i .R8"
  IntOp $R8 $R8 + 10000
  StrCpy $0 ""

  ${Do}
    System::Call "kernel32::GetTickCount() i .r1"
    IntOp $1 $1 - $R8
    StrCpy $R7 0
    System::Call "kernel32::CreateToolhelp32Snapshot(i 2, i 0) p .R0"
    ${If} $R0 <> -1
      ; PROCESSENTRY32W for the 32-bit installer: nine 4-byte fields, then WCHAR szExeFile[260].
      System::Alloc 556
      Pop $R1
      System::Call "*$R1(i 556)"
      System::Call "kernel32::Process32FirstW(p R0, p R1) i .R2"
      ${DoWhile} $R2 != 0
        System::Call "*$R1(i, i, i .R3)"
        ${If} $R3 != $R9
          System::Call "kernel32::OpenProcess(i 0x1000, i 0, i R3) p .R4"
          ${If} $R4 != 0
            System::Call "kernel32::QueryFullProcessImageNameW(p R4, i 0, w .R5, *i ${NSIS_MAX_STRLEN}) i .R6"
            System::Call "kernel32::CloseHandle(p R4)"
            ${If} $R6 != 0
              ; A channel leaving the shared directory stops its own app there, but not the others'.
              StrCpy $2 0
              !ifndef BUILD_UNINSTALLER
                ${If} $sharedInstallDir != ""
                ${AndIf} $R5 == "$sharedInstallDir\${APP_EXECUTABLE_FILENAME}"
                  StrCpy $2 1
                ${EndIf}
              !endif
              StrLen $R6 "$INSTDIR\"
              StrCpy $R5 $R5 $R6
              ${If} $R5 == "$INSTDIR\"
                StrCpy $2 1
              ${EndIf}
              ${If} $2 == 1
                IntOp $R7 $R7 + 1
                ${If} $1 >= 0
                  System::Call "kernel32::OpenProcess(i 1, i 0, i R3) p .R4"
                  ${If} $R4 != 0
                    System::Call "kernel32::TerminateProcess(p R4, i 1)"
                    System::Call "kernel32::CloseHandle(p R4)"
                  ${EndIf}
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
        System::Call "kernel32::Process32NextW(p R0, p R1) i .R2"
      ${Loop}
      System::Free $R1
      System::Call "kernel32::CloseHandle(p R0)"
    ${EndIf}

    ${If} $R7 == 0
      ${ExitDo}
    ${EndIf}

    ${If} $0 == ""
      StrCpy $0 "running"
      ${IfNot} ${isUpdated}
        ${If} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDCANCEL`
          Quit
        ${EndIf}
        System::Call "kernel32::GetTickCount() i .R8"
      ${EndIf}
      DetailPrint "$(appClosing)"
    ${ElseIf} $1 >= 2000
      ${If} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDCANCEL`
        Quit
      ${EndIf}
      System::Call "kernel32::GetTickCount() i .R8"
    ${EndIf}

    Sleep 100
  ${Loop}
!macroend

; Staged updates. Once an update has downloaded, the running app starts its installer with --stage.
; That unpacks the app next to the install directory, as "<install dir>.update-<payload hash>",
; while the user keeps working. After the restart, the install renames that directory into place
; instead of decompressing 700 MB. Anything unexpected falls back to the normal extraction.
!macro removeStagedUpdates DIR
  RMDir /r "${DIR}.staging"
  ${StdUtils.GetParentPath} $R8 "${DIR}"
  FindFirst $R9 $R7 "${DIR}.update-*"
  ${DoWhile} $R7 != ""
    RMDir /r "$R8\$R7"
    FindNext $R9 $R7
  ${Loop}
  FindClose $R9
!macroend

!ifndef BUILD_UNINSTALLER
!ifdef APP_64 | APP_ARM64
  !ifdef APP_64 & APP_ARM64
    !error "Staged updates expect one architecture per installer"
  !endif
  !ifdef APP_ARM64
    !define STAGED_PACKAGE "${APP_ARM64}"
    !define STAGED_PACKAGE_HASH "${APP_ARM64_HASH}"
    !define STAGED_PACKAGE_SIZE "${APP_ARM64_UNPACKED_SIZE}"
  !else
    !define STAGED_PACKAGE "${APP_64}"
    !define STAGED_PACKAGE_HASH "${APP_64_HASH}"
    !define STAGED_PACKAGE_SIZE "${APP_64_UNPACKED_SIZE}"
  !endif

  ; Runs first in .onInit, before the single-instance check, and exits 0 only when it staged.
  !macro preInit
    ${StdUtils.TestParameter} $R0 "stage"
    ${If} $R0 == "true"
      SetErrorLevel 2
      ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ; Leave room for the staged copy and as much again, in MB.
      ${DriveSpace} "$R1" "/D=F /S=M" $R2
      IntOp $R3 ${STAGED_PACKAGE_SIZE} / 512
      ${If} $R1 != ""
      ${AndIf} ${FileExists} "$R1\${APP_EXECUTABLE_FILENAME}"
      ${AndIf} $R2 > $R3
        !insertmacro removeStagedUpdates $R1
        ; Stage beside the directory the install will use, which customInit moves out of the shared one.
        ${StdUtils.GetParentPath} $R5 $R1
        ${If} $R1 == "$R5\${APP_FILENAME}"
          StrCpy $R1 "$R5\${APP_ID}"
          !insertmacro removeStagedUpdates $R1
        ${EndIf}
        InitPluginsDir
        ; Stored like the template's copy, so the installer keeps one copy of the payload.
        !ifdef COMPRESS
          SetCompress off
        !endif
        File /oname=$PLUGINSDIR\staged.7z "${STAGED_PACKAGE}"
        !ifdef COMPRESS
          SetCompress "${COMPRESS}"
        !endif
        ClearErrors
        SetOutPath "$R1.staging"
        ${IfNot} ${Errors}
          Nsis7z::Extract "$PLUGINSDIR\staged.7z"
          SetOutPath $PLUGINSDIR
          StrCpy $R4 "${STAGED_PACKAGE_HASH}" 16
          ClearErrors
          Rename "$R1.staging" "$R1.update-$R4"
          ${IfNot} ${Errors}
            SetErrorLevel 0
          ${EndIf}
        ${EndIf}
      ${EndIf}
      Quit
    ${EndIf}
  !macroend

  ; Called by the patched app-builder-lib template in place of extraction. Sets $R0 to "installed"
  ; when it moved the staged app into the empty install directory.
  !macro customInstallStagedApp
    StrCpy $R0 ""
    StrCpy $R1 "${STAGED_PACKAGE_HASH}" 16
    ${If} ${FileExists} "$INSTDIR.update-$R1\${APP_EXECUTABLE_FILENAME}"
      SetOutPath $PLUGINSDIR
      ; Removes the directory only while it is empty, so the rename never mixes two versions.
      RMDir $INSTDIR
      ClearErrors
      Rename "$INSTDIR.update-$R1" $INSTDIR
      ${IfNot} ${Errors}
        StrCpy $R0 "installed"
      ${EndIf}
      SetOutPath $INSTDIR
    ${EndIf}
    !insertmacro removeStagedUpdates $INSTDIR
  !macroend
!endif
!endif
