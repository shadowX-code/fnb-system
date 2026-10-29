param([ValidateSet('spooler','tspl')][string]$Transport='spooler',[switch]$Uninstall)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$taskName='FeedX Print Bridge Staging'
$destination="$env:LOCALAPPDATA\FeedXPrintBridge"
if($Uninstall) {
 Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
 # Keep the interrupted-job journal for inspection. Removing it could hide uncertain output.
 Remove-Item "$destination\session.xml" -ErrorAction SilentlyContinue
 Write-Host 'Bridge stopped and sign-in removed. Inspect any Printing/Unknown jobs in FeedX.';exit
}
if([Environment]::OSVersion.Version.Major -lt 10) {throw 'Windows 10/11 is required.'}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $destination /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0) {throw 'Unable to secure local bridge files.'}
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
foreach($name in @('Bridge.psm1','Transport.cs','Start-Bridge.ps1','README.md')) {Copy-Item "$PSScriptRoot\$name" "$destination\$name" -Force}
Import-Module "$destination\Bridge.psm1" -Force
$printers=Get-BridgePrinters
$printers | Format-Table Name,WorkOffline,PrinterStatus
$printer=Read-Host 'Exact Windows printer name'
if(!($printers | Where-Object {$_.Name -ceq $printer})) {throw 'Select an installed Windows printer.'}
$key=Read-Host 'Staging Supabase publishable / anon key (from FeedX Staging setup)'
$credential=Get-Credential -Message 'Sign in with your authorized FeedX Staging operator account'
$session=Invoke-BridgeAuth $key @{email=$credential.UserName;password=$credential.GetNetworkCredential().Password} 'password'
$credential=$null
$session | Add-Member -NotePropertyName expires_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$session.expires_in) -Force
$configPath="$destination\config.json"
$device=if(Test-Path $configPath){(Get-Content $configPath -Raw|ConvertFrom-Json).DeviceId}else{[guid]::NewGuid().ToString()}
$config=[pscustomobject]@{ProjectRef='ujkzdaaadnvcfayuldmh';PublicKey=$key;DeviceId=$device;Name=$env:COMPUTERNAME;Printer=$printer;Transport=$Transport;GapMm=2;TsplInvert=$true}
$null=Invoke-BridgeRpc $config $session 'device' @{p_device=$device;p_name=$config.Name;p_printer=$printer;p_transport=$Transport;p_status='Offline';p_printers=@($printers)}
$config|ConvertTo-Json|Set-Content $configPath -Encoding UTF8
Save-BridgeState "$destination\session.xml" $session
$powerShell="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action=New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$destination\Start-Bridge.ps1`""
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host 'FeedX Staging bridge installed. It runs while this Windows user is signed in. Check its status in Print Labels.'
