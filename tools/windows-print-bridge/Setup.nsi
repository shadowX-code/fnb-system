Unicode true
!include LogicLib.nsh
!include WinVer.nsh
Name "FeedX Print Bridge Staging"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\FeedX Print Bridge Staging"
RequestExecutionLevel user
VIProductVersion "1.2.3.0"
VIAddVersionKey "ProductName" "FeedX Print Bridge Staging"
VIAddVersionKey "FileDescription" "FeedX Print Bridge Staging Installer"
VIAddVersionKey "FileVersion" "1.2.3.0"
VIAddVersionKey "LegalCopyright" "FeedX"
SetCompressor /SOLID lzma
Page directory
Page instfiles

Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Windows 10 or newer is required."
    Abort
  ${EndIf}
FunctionEnd

Section
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "Bridge.psm1"
  File "Setup-Bridge.ps1"
  File "Start-Bridge.ps1"
  File "Transport.cs"
  File "D520Bluetooth.cs"
  File "README.md"
  CreateShortcut "$SMPROGRAMS\FeedX Print Bridge Staging.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -STA -File "$INSTDIR\Setup-Bridge.ps1"'
  WriteRegStr HKCU "Software\Classes\feedx-printer-staging" "" "URL:FeedX Print Bridge Staging"
  WriteRegStr HKCU "Software\Classes\feedx-printer-staging" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\feedx-printer-staging\shell\open\command" "" '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -STA -File "$INSTDIR\Setup-Bridge.ps1"'
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedX Print Bridge Staging" "DisplayName" "FeedX Print Bridge Staging"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedX Print Bridge Staging" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  IfSilent +2
  ExecShell "open" "$SMPROGRAMS\FeedX Print Bridge Staging.lnk"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Uninstall pauses the bridge. Resolve any active print first. Device configuration, calibration, and recovery files are kept." IDOK +2
    Abort
  ExecWait '"$SYSDIR\schtasks.exe" /End /TN "FeedX Print Bridge Staging"'
  ExecWait '"$SYSDIR\schtasks.exe" /Delete /TN "FeedX Print Bridge Staging" /F'
  Delete "$SMPROGRAMS\FeedX Print Bridge Staging.lnk"
  DeleteRegKey HKCU "Software\Classes\feedx-printer-staging"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedX Print Bridge Staging"
  Delete "$INSTDIR\Bridge.psm1"
  Delete "$INSTDIR\Setup-Bridge.ps1"
  Delete "$INSTDIR\Start-Bridge.ps1"
  Delete "$INSTDIR\Transport.cs"
  Delete "$INSTDIR\D520Bluetooth.cs"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
