!include LogicLib.nsh

!ifndef nsProcess::FindProcess
  !include "nsProcess.nsh"
!endif

!macro formatFlowCloseRunningApp
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    DetailPrint "Closing running ${PRODUCT_NAME} process."
    ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R1
    Sleep 1000

    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      DetailPrint "Force closing running ${PRODUCT_NAME} process."
      ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R1
      Sleep 1000
    ${EndIf}

    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY retryCloseApp
      Quit

      retryCloseApp:
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R1
        Sleep 1000
    ${EndIf}
  ${EndIf}
!macroend

!macro formatFlowUninstallInPlace ROOT_KEY MODE_ARG
  ClearErrors
  !insertmacro readReg $R6 "${ROOT_KEY}" "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R6 != ""
    !insertmacro GetInQuotes $R7 "$R6"
    ${If} $R7 != ""
    ${AndIf} ${FileExists} "$R7"
      DetailPrint "Removing previous ${PRODUCT_NAME} installation in place."
      ExecWait '"$R7" /S ${MODE_ARG}' $R8
      ${If} $R8 != 0
        DetailPrint "In-place uninstaller exited with code $R8."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customCheckAppRunning
  !insertmacro formatFlowCloseRunningApp

  !ifndef BUILD_UNINSTALLER
    ${If} $installMode == "all"
      !insertmacro formatFlowUninstallInPlace SHELL_CONTEXT "/allusers"
    ${Else}
      !insertmacro formatFlowUninstallInPlace SHELL_CONTEXT "/currentuser"
    ${EndIf}
  !endif
!macroend

!macro customHeader
  BrandingText "Format Flow 0.1.1  Given-Dream"
!macroend
