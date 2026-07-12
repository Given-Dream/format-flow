!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
  Var FormatFlowBrowserExtensionSetup
  Var FormatFlowExtensionCheckbox
!endif

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

!ifndef BUILD_UNINSTALLER

!macro customInit
  StrCpy $FormatFlowBrowserExtensionSetup "1"
!macroend

!macro customPageAfterChangeDir
  Page custom formatFlowBrowserExtensionPageShow formatFlowBrowserExtensionPageLeave
!macroend

Function formatFlowBrowserExtensionPageShow
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 14u "浏览器插件"
  Pop $0

  ${NSD_CreateLabel} 0 20u 100% 36u "Format Flow 会把浏览器插件复制到安装目录，并打开 Chrome/Edge 扩展管理页。浏览器安全策略要求你在页面中确认加载本地插件。"
  Pop $0

  ${NSD_CreateLabel} 0 64u 100% 48u "安装时请在浏览器扩展页开启“开发者模式”，点击“加载已解压的扩展程序”，选择安装目录下的 resources\browser-extension。"
  Pop $0

  ${NSD_CreateCheckbox} 0 124u 100% 16u "安装过程中打开插件目录和 Chrome/Edge 扩展页"
  Pop $FormatFlowExtensionCheckbox
  ${If} $FormatFlowBrowserExtensionSetup == "1"
    ${NSD_Check} $FormatFlowExtensionCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function formatFlowBrowserExtensionPageLeave
  ${NSD_GetState} $FormatFlowExtensionCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $FormatFlowBrowserExtensionSetup "1"
  ${Else}
    StrCpy $FormatFlowBrowserExtensionSetup "0"
  ${EndIf}
FunctionEnd

Function formatFlowOpenBrowserExtensionPage
  StrCpy $R2 ""
  StrCpy $R3 "chrome://extensions"

  ${If} ${FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    StrCpy $R2 "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES\Google\Chrome\Application\chrome.exe"
    StrCpy $R2 "$PROGRAMFILES\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    StrCpy $R2 "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
    StrCpy $R2 "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
    StrCpy $R3 "edge://extensions"
  ${ElseIf} ${FileExists} "$PROGRAMFILES\Microsoft\Edge\Application\msedge.exe"
    StrCpy $R2 "$PROGRAMFILES\Microsoft\Edge\Application\msedge.exe"
    StrCpy $R3 "edge://extensions"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    StrCpy $R2 "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    StrCpy $R3 "edge://extensions"
  ${EndIf}

  ${If} $R2 != ""
    DetailPrint "Opening browser extension management page."
    Exec '"$R2" $R3'
  ${Else}
    DetailPrint "Chrome or Edge was not found; opening the browser extension folder only."
  ${EndIf}
FunctionEnd

Function formatFlowOpenBrowserExtensionInstaller
  DetailPrint "Opening Format Flow browser extension setup."
  MessageBox MB_OK|MB_ICONINFORMATION "Format Flow 浏览器插件已随安装包准备好。$\r$\n$\r$\n接下来安装器会打开插件目录和 Chrome/Edge 扩展页。请开启“开发者模式”，点击“加载已解压的扩展程序”，选择：$\r$\n$INSTDIR\resources\browser-extension"
  ExecShell "open" "$INSTDIR\resources\browser-extension"
  Call formatFlowOpenBrowserExtensionPage
FunctionEnd

!macro customInstall
  !ifndef BUILD_UNINSTALLER
    ${If} $FormatFlowBrowserExtensionSetup == "1"
    ${AndIfNot} ${Silent}
    ${AndIf} ${FileExists} "$INSTDIR\resources\browser-extension\manifest.json"
      Call formatFlowOpenBrowserExtensionInstaller
    ${EndIf}
  !endif
!macroend

!endif

!macro customHeader
  BrandingText "Format Flow ${VERSION}  Given-Dream"
!macroend
