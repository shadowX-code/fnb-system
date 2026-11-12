Unicode True
Name "FeedX AutoCount Connector"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\FeedX AutoCount Connector"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "3.0.2.0"
VIAddVersionKey "ProductName" "FeedX AutoCount Connector"
VIAddVersionKey "FileDescription" "FeedX AutoCount Connector Setup"
VIAddVersionKey "CompanyName" "FeedX"
VIAddVersionKey "FileVersion" "3.0.2"

!include "MUI2.nsh"
!include "x64.nsh"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchConnector
!define MUI_FINISHPAGE_RUN_TEXT "Open FeedX AutoCount Connector"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "FeedX Connector requires 64-bit Windows."
    Abort
  ${EndIf}
FunctionEnd

Section
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\FeedX"
  CreateShortCut "$SMPROGRAMS\FeedX\AutoCount Connector.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\installer\desktop.ps1"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedXAutoCount" "DisplayName" "FeedX AutoCount Connector"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedXAutoCount" "DisplayVersion" "3.0.2"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedXAutoCount" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd

Function LaunchConnector
  ${DisableX64FSRedirection}
  Exec '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\installer\desktop.ps1"'
  ${EnableX64FSRedirection}
FunctionEnd

Section "Uninstall"
  nsExec::Exec '"$WINDIR\Sysnative\schtasks.exe" /Delete /TN "FeedX AutoCount Connector" /F'
  Delete "$SMPROGRAMS\FeedX\AutoCount Connector.lnk"
  RMDir "$SMPROGRAMS\FeedX"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedXAutoCount"
  RMDir /r "$INSTDIR"
SectionEnd
