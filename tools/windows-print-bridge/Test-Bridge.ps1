$ErrorActionPreference='Stop'
Import-Module "$PSScriptRoot\Bridge.psm1" -Force
$module=Get-Module Bridge
# Parser + pure recovery/TSPL checks run on any PowerShell 7 host. Windows DPAPI/spooler remain platform checks.
Get-ChildItem $PSScriptRoot -Filter *.ps*1 | ForEach-Object {
 $tokens=$null;$errors=$null
 $null=[Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw ($errors|Out-String)}
}
if($PSVersionTable.PSEdition -eq 'Core') {
 Add-Type -Path "$PSScriptRoot\Transport.cs" -ReferencedAssemblies System.Drawing.Common,System.Drawing.Primitives,System.ComponentModel.Primitives,System.Runtime
} else {Add-Type -Path "$PSScriptRoot\Transport.cs" -ReferencedAssemblies System.Drawing}
Add-Type -Path "$PSScriptRoot\D520Bluetooth.cs"
$socketAddress=[FeedXD520Bluetooth].GetNestedType('BluetoothAddress','NonPublic')
if([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($socketAddress)) -ne 30 -or
    [Runtime.InteropServices.Marshal]::OffsetOf($socketAddress,'Service').ToInt32() -ne 10){
    throw 'Windows Bluetooth sockaddr does not match the SDK packing.'
}
if([FeedXD520Bluetooth]::Receipt([byte[]]@(0x7e,1),2) -ne 0 -or
   [FeedXD520Bluetooth]::Receipt([byte[]]@(0x7e,1,0x7e),3) -ne 1 -or
   [FeedXD520Bluetooth]::Receipt([byte[]]@(0x7e,1,0x7e,0x7e,0,0x7e),6) -ne -1){
    throw 'D520 accepted a partial receipt or ignored a negative acknowledgment.'
}
$bytes=[byte[]]::new(80*719);$bytes[0]=128
$bytes[4095]=0x55;$bytes[-1]=0xab
$encoded=[FeedXTransport]::D520($bytes,639,719,80,90,1,2)
$hasher=[Security.Cryptography.SHA256]::Create()
try {$digest=[BitConverter]::ToString($hasher.ComputeHash($encoded)).Replace('-','').ToLowerInvariant()}
finally {$hasher.Dispose()}
# Reference generated with the macOS adapter for the same packed pixels and media.
if($digest -cne '0fc7e292cada3e22967abcc1a1657d7291b9da41675c7ac4efdab3d622f88d2a'){
    throw 'D520 mode 4 byte parity with macOS failed.'
}
$command=[FeedXTransport]::Tspl($bytes,639,719,80,90,3,2,$true)
$header=[Text.Encoding]::ASCII.GetBytes("SIZE 80 mm,90 mm`r`nGAP 2 mm,0`r`nDIRECTION 1`r`nCLS`r`nBITMAP 0,0,80,719,0,")
if($command[$header.Length] -ne 127){throw 'TSPL polarity mismatch'}
if(![Text.Encoding]::ASCII.GetString($command).EndsWith("`r`nPRINT 1,3`r`n")){throw 'Wrong TSPL copy count'}
$denied=$false;try{[FeedXTransport]::Tspl([byte[]]::new(1),639,719,80,90,1,2,$true)}catch{$denied=$true};if(!$denied){throw 'Invalid raster accepted'}
# Mock native submission only: exercise the real cycle and journal ordering without a printer.
& $module {
 $script:journal=$null;$script:calls=[Collections.Generic.List[string]]::new();$script:crash=$false;$script:offline=$false;$script:serverState='Printing'
 function Save-BridgeState($Path,$Value){$script:journal=$Value|ConvertTo-Json|ConvertFrom-Json;$script:calls.Add("journal:$($Value.stage)")}
 function Read-BridgeState($Path){return $script:journal}
 function Remove-Item {param($LiteralPath) $script:journal=$null}
 function Get-BridgePrinters {return @([pscustomobject]@{Name='QA';WorkOffline=$script:offline;PrinterStatus=3})}
 function Invoke-BridgeRpc($Config,$Session,$Name,$Body){
  $script:calls.Add($Name)
  if($Name -eq 'claim'){return [pscustomobject]@{id='job';state=$script:serverState;lease_until=[datetime]::UtcNow.AddMinutes(10).ToString('o');quantity=1;raster=[pscustomobject]@{format='mono1';width=639;height=719;data=[Convert]::ToBase64String([byte[]]::new(80*719))};snapshot=[pscustomobject]@{width_mm=80;height_mm=90}}}
  if($Name -eq 'report' -and $Body.p_state -ne 'Unknown'){throw 'Expected crash outcome to be Unknown'}
 }
 $config=[pscustomobject]@{DeviceId='device';Name='QA';Printer='QA';Transport='invalid-test-transport';GapMm=2;TsplInvert=$true}
 # The invalid native transport throws after the durable submitting marker, exercising the conservative Unknown path.
 Invoke-BridgeCycle $config ([pscustomobject]@{}) 'mock'
 if($script:journal.outcome -ne 'Unknown'){throw 'Uncertain native submission was not held'}
 $order=$script:calls.ToArray() -join ','
 if($order -notmatch 'journal:claiming,claim,journal:submitting,journal:reporting'){throw "Journal ordering: $order"}
 Invoke-BridgeCycle $config ([pscustomobject]@{}) 'mock'
 if($script:journal){throw 'Outcome receipt did not clear journal'}
 $script:journal=[pscustomobject]@{stage='submitting';claim='same-claim';job='job';outcome=$null;detail=$null}
 $script:calls.Clear();Invoke-BridgeCycle $config ([pscustomobject]@{}) 'mock'
 if($script:calls.Contains('claim')){throw 'Crash resubmitted the job'}
 $script:offline=$true;$script:calls.Clear();Invoke-BridgeCycle $config ([pscustomobject]@{}) 'mock'
 if($script:calls.Contains('claim')){throw 'Offline printer claimed a job'}
 $script:offline=$false;$script:serverState='Sent';$script:calls.Clear();Invoke-BridgeCycle $config ([pscustomobject]@{}) 'mock'
 if($script:calls.Contains('journal:submitting')){throw 'Completed claim submitted again'}
}
# Report the Windows queue and calibration separately, and never claim while blocked.
& $module {
 $script:offline=$false;$script:calibration='Pending';$script:reports=@();$script:claims=0
 function Get-BridgePrinters {
  [pscustomobject]@{Name='D520 USB fixture';WorkOffline=$script:offline;PrinterStatus=3}
 }
 function Get-BridgeCalibration($Config,$Root){return $script:calibration}
 function Read-BridgeState($Path){return $null}
 function Save-BridgeState($Path,$Value){}
 function Remove-Item {param($LiteralPath)}
 function Invoke-BridgeRpc($Config,$Session,$Name,$Body){
  if($Name -eq 'device'){$script:reports+=,$Body;return}
  if($Name -eq 'claim'){$script:claims++;return}
  throw 'Unexpected RPC in status test.'
 }
 $config=[pscustomobject]@{DeviceId='device';Name='QA';Printer='D520 USB fixture';Transport='spooler'}
 $session=[pscustomobject]@{}
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml'
 if($script:reports[-1].p_status -ne 'Error' -or $script:reports[-1].p_printers[0].Calibration -ne 'Pending' -or $script:claims){
  throw 'An available uncalibrated Windows queue must not claim work.'
 }
 $script:offline=$true;$script:calibration='Passed'
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml'
 if($script:reports[-1].p_status -ne 'Offline' -or $script:reports[-1].p_printers[0].Calibration -ne 'Passed' -or $script:claims){
  throw 'An offline queue must preserve its calibration and skip claims.'
 }
 $script:offline=$false
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml'
 if($script:reports[-1].p_status -ne 'Ready' -or $script:reports[-1].p_printers[0].Connection -ne 'Windows spooler' -or $script:claims -ne 1){
  throw 'The calibrated online queue did not report ready and resume claims.'
 }
}
# Exercise the real probe scheduler and direct-job state sequence without a radio or spooler.
& $module {
 $script:checks=0;$script:failProbe=$false;$script:journal=$null;$script:deviceReport=$null
 $script:mailbox=$null;$script:localWriteFails=$false;$script:submissions=0;$script:reportedOutcome=$null;$script:receipt='missing';$script:copies=1
 function Invoke-BridgeD520Probe($Address){$script:checks++;if($script:failProbe){throw 'Probe fixture timeout'}}
 function Get-BridgePrinters {throw 'Direct Bluetooth must not require the Windows spooler'}
 function Get-BridgeCalibration {return 'Passed'}
 function Read-BridgeState($Path){return $script:journal}
 function Remove-Item {param($LiteralPath) $script:journal=$null}
 function Save-BridgeState($Path,$Value) {
    if($Path.EndsWith('connection-status.xml')){
        if($script:localWriteFails){throw [IO.IOException]::new('Simulated local receipt write failure')}
        $script:mailbox=$Value
        return
    }
    $script:journal=$Value|ConvertTo-Json|ConvertFrom-Json
 }
 function Invoke-BridgeRpc($Config,$Session,$Name,$Body){
    if($Name -eq 'device'){$script:deviceReport=$Body;return}
    if($Name -eq 'claim'){return [pscustomobject]@{
        id='fixture-job';state='Printing';lease_until=[datetime]::UtcNow.AddMinutes(5).ToString('o');quantity=$script:copies
        raster=[pscustomobject]@{format='mono1';width=639;height=719;data=[Convert]::ToBase64String([byte[]]::new(80*719))}
        snapshot=[pscustomobject]@{width_mm=80;height_mm=90}
    }}
    if($Name -eq 'report'){$script:reportedOutcome=$Body.p_state;$script:reportedDetail=$Body.p_detail;return}
    throw 'Unexpected direct Bluetooth RPC'
 }
 function Send-BridgeD520Label($Address,$Payload){
    if($script:journal.stage -ne 'submitting' -or $Address -ne '001122334455' -or
        ![Text.Encoding]::ASCII.GetString($Payload).EndsWith("`r`nPRINT 1,$script:copies`r`n")){
        throw 'Direct transport did not receive the durable, single-copy submission.'
    }
    $script:submissions++
    if($script:receipt){
        $failure=[IO.IOException]::new('Simulated D520 acknowledgment result')
        $failure.Data['D520Receipt']=$script:receipt
        throw $failure
    }
 }
 $config=[pscustomobject]@{DeviceId='fixture';Name='QA';Printer='D520 (Bluetooth)';Transport='tspl'
     BluetoothAddress='001122334455';GapMm=2;GuidedSetup=$true;Calibrated=$true;StockWidthMm=80;StockHeightMm=90}
 $status=New-BridgeBluetoothStatus
 $t=[datetime]::UtcNow
 $root='fixture-root'
 Update-BridgeBluetoothProbe $config.BluetoothAddress $status $root $t
 Update-BridgeBluetoothProbe $config.BluetoothAddress $status $root $t.AddSeconds(59)
 if($script:checks -ne 1){throw 'Healthy D520 probes must be spaced at least 60 seconds apart.'}
 $script:failProbe=$true
 Update-BridgeBluetoothProbe $config.BluetoothAddress $status $root $t.AddSeconds(60)
 Update-BridgeBluetoothProbe $config.BluetoothAddress $status $root $t.AddSeconds(74)
 Update-BridgeBluetoothProbe $config.BluetoothAddress $status $root $t.AddSeconds(75)
 Update-BridgeBluetoothProbe $config.BluetoothAddress $status $root $t.AddSeconds(104)
 if($script:checks -ne 3 -or $status.Available -or $status.Failures -ne 2){throw 'D520 probe backoff or offline state is incorrect.'}
 $script:failProbe=$false
 $status=New-BridgeBluetoothStatus
 $session=[pscustomobject]@{}
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml' $status
 if($script:submissions -ne 1 -or $script:journal.outcome -ne 'Unknown' -or
    $script:deviceReport.p_printers[0].Connection -ne 'Bluetooth Classic SPP' -or !$script:mailbox.Available -or
    $script:deviceReport.p_printers[0].PSObject.Properties['BluetoothAddress']){
    throw 'Direct Bluetooth hold or privacy-safe status report failed.'
 }
 $savedDetail=$script:journal.detail
 if($savedDetail -notmatch 'write completed. No printer acknowledgment'){throw 'Missing ACK transport evidence was lost.'}
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml' $status
 if($script:submissions -ne 1 -or $script:reportedOutcome -ne 'Unknown'){throw 'Reporting an uncertain direct write must not resend it.'}
 if($script:reportedDetail -ne $savedDetail){throw 'The same running worker overwrote its saved Unknown receipt with recovery wording.'}
 $script:journal=[pscustomobject]@{stage='submitting';claim='interrupted-claim';job='fixture-job';outcome=$null;detail=$null}
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml' $status
 if($script:submissions -ne 1 -or $script:reportedOutcome -ne 'Unknown' -or
    $script:reportedDetail -notmatch 'no recorded transport result' -or $script:reportedDetail -match 'restart|queue'){
    throw 'Interrupted Bluetooth recovery must preserve the hold without assuming the worker restarted or using a spooler.'
 }
 $script:receipt=$null
 $script:copies=3
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml' $status
 if($script:journal.outcome -ne 'Sent' -or $script:submissions -ne 2){throw 'One three-copy submission with a positive ACK must record Sent only.'}
 $status=New-BridgeBluetoothStatus
 $script:localWriteFails=$true
 $script:failProbe=$true
 $script:deviceReport=$null
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml' $status
 if($script:deviceReport.p_status -ne 'Offline' -or $status.LocalReportAt){throw 'A local receipt failure blocked cloud reporting or prevented a retry.'}
 $script:localWriteFails=$false
 Invoke-BridgeCycle $config $session 'fixture-root\journal.xml' $status
 if($script:mailbox.Available -or $status.LocalReportAt -ne $status.Checked){throw 'The failed Bluetooth observation was not saved after the local write recovered.'}
}
Write-Output 'PASS: Packed Windows socket ABI, exact macOS D520 payload, ACK handling, probe backoff, privacy-safe status and Bluetooth Unknown recovery with preserved receipt evidence and a simulated three-copy submission.'
# Simulate startup/session-store, refresh, durable persistence and network recovery.
& $module {
 $script:reads=0;$script:auths=0;$script:saves=0;$script:cycles=0;$script:checks=0
 $script:delays=[Collections.Generic.List[int]]::new()
 function Test-BridgePaused($Root){$script:checks++;return $script:checks -gt 5}
 function Read-BridgeState($Path){
  $script:reads++
  if($script:reads -eq 1){throw 'Simulated temporarily unavailable session store'}
  return [pscustomobject]@{expires_at=0;refresh_token='old-fixture'}
 }
 function Invoke-BridgeAuth($Key,$Body,$Grant){
  $script:auths++
  if($script:auths -eq 1){throw 'Simulated network outage during refresh'}
  return [pscustomobject]@{expires_in=3600;refresh_token='new-fixture'}
 }
 function Save-BridgeState($Path,$Value){
  $script:saves++
  if($script:saves -eq 1){throw 'Simulated session persistence error'}
 }
 function Invoke-BridgeCycle($Config,$Session,$Path){
  if($Session.refresh_token -ne 'new-fixture' -or $script:saves -ne 2){throw 'Cycle received an unpersisted session'}
  $script:cycles++
  if($script:cycles -eq 1){throw 'Simulated transient report outage'}
 }
 function Start-Sleep($Seconds){$script:delays.Add($Seconds)}
 function Set-Content {param($LiteralPath,$Value) if($Value -match 'fixture'){throw 'Session leaked to status file'}}
 Invoke-BridgeWorker ([pscustomobject]@{PublicKey='public-fixture'}) 'fixture-root'
 if($script:reads -ne 2 -or $script:auths -ne 2 -or $script:saves -ne 2 -or $script:cycles -ne 2){
  throw "Worker failed to recover safely: reads=$script:reads auths=$script:auths saves=$script:saves cycles=$script:cycles"
 }
 if(($script:delays -join ',') -ne '10,20,40,60,5'){throw 'Worker backoff did not reset after recovery'}
}
Write-Output 'PASS: PowerShell parser, C# compilation, TSPL bytes/polarity/copies, raster validation, crash recovery, durable ordering, receipt retry, offline and completed-claim guards.'
if($env:OS -eq 'Windows_NT') {
 $path=Join-Path ([IO.Path]::GetTempPath()) ("feedx-bridge-qa-"+[guid]::NewGuid()+'.xml')
 try {
  Save-BridgeState $path @{stage='submitting';value='dummy-qa-value'}
  if((Get-Content $path -Raw).Contains('dummy-qa-value')){throw 'Windows state is not encrypted'}
  if((Read-BridgeState $path).stage -ne 'submitting'){throw 'DPAPI round trip failed'}
  Save-BridgeState $path @{stage='reporting';value='second-dummy-qa-value'}
  if((Read-BridgeState $path).stage -ne 'reporting'){throw 'Atomic journal replace failed'}
 } finally {Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue}
 $null=Get-BridgePrinters
 $invalidPrinter='FeedX QA unavailable '+[guid]::NewGuid()
 $denied=$false;try{[FeedXTransport]::Raw($invalidPrinter,[byte[]]@(0),'QA')}catch{$denied=$true};if(!$denied){throw 'Native RAW opened invalid printer'}
 $denied=$false;try{[FeedXTransport]::Spool($invalidPrinter,[byte[]]::new(80*719),639,719,80,90,1,'QA')}catch{$denied=$true};if(!$denied){throw 'GDI accepted invalid printer'}
 $null=New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -File Start-Bridge.ps1'
 $null=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 Write-Output 'PASS: Windows DPAPI, atomic journal replacement, printer discovery, native RAW/GDI unavailable-printer guards and scheduled-task settings.'
}
