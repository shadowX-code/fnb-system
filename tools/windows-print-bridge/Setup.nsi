Unicode true
!include LogicLib.nsh
!include WinVer.nsh
Name "FeedX Print Bridge Production"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\FeedX Print Bridge Production"
RequestExecutionLevel user
VIProductVersion "1.3.0.0"
VIAddVersionKey "ProductName" "FeedX Print Bridge Production"
VIAddVersionKey "FileDescription" "FeedX Print Bridge Production Installer"
VIAddVersionKey "FileVersion" "1.3.0.0"
VIAddVersionKey "LegalCopyright" "FeedX"
SetCompressor /SOLID lzma
Page directory
ShowInstDetails nevershow
Page instfiles

Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Windows 10 or newer is required."
    Abort
  ${EndIf}
FunctionEnd

Section
  SetShellVarContext current
  SetDetailsPrint none
  SetOutPath "$INSTDIR"
  File "Bridge.psm1"
  File "Setup-Bridge.ps1"
  File "Setup-Window.ps1"
  File "BrowserAuthorization.cs"
  File "..\print-bridge\Setup-Authorization.html"
  File "Start-Bridge.ps1"
  File "Transport.cs"
  File "D520Bluetooth.cs"
  File "README.md"
  CreateShortcut "$SMPROGRAMS\FeedX Print Bridge Production.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -STA -File "$INSTDIR\Setup-Bridge.ps1"'
  WriteRegStr HKCU "Software\Classes\feedx-printer-production" "" "URL:FeedX Print Bridge Production"
  WriteRegStr HKCU "Software\Classes\feedx-printer-production" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\feedx-printer-production\shell\open\command" "" '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -STA -File "$INSTDIR\Setup-Bridge.ps1"'
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedX Print Bridge Production" "DisplayName" "FeedX Print Bridge Production"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedX Print Bridge Production" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  IfSilent +2
  ExecShell "open" "$SMPROGRAMS\FeedX Print Bridge Production.lnk"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Uninstall pauses the bridge. Resolve any active print first. Device configuration, calibration, and recovery files are kept." IDOK +2
    Abort
  ExecWait '"$SYSDIR\schtasks.exe" /End /TN "FeedX Print Bridge Production"'
  ExecWait '"$SYSDIR\schtasks.exe" /Delete /TN "FeedX Print Bridge Production" /F'
  Delete "$SMPROGRAMS\FeedX Print Bridge Production.lnk"
  DeleteRegKey HKCU "Software\Classes\feedx-printer-production"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedX Print Bridge Production"
  Delete "$INSTDIR\Bridge.psm1"
  Delete "$INSTDIR\Setup-Bridge.ps1"
  Delete "$INSTDIR\Setup-Window.ps1"
  Delete "$INSTDIR\BrowserAuthorization.cs"
  Delete "$INSTDIR\Setup-Authorization.html"
  Delete "$INSTDIR\Start-Bridge.ps1"
  Delete "$INSTDIR\Transport.cs"
  Delete "$INSTDIR\D520Bluetooth.cs"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
