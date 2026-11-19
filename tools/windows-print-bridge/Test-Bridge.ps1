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
$bytes=[byte[]]::new(80*719);$bytes[0]=128
$command=[FeedXTransport]::Tspl($bytes,639,719,80,90,3,2,$true)
$header=[Text.Encoding]::ASCII.GetBytes("SIZE 80 mm,90 mm`r`nGAP 2 mm,0`r`nDIRECTION 1`r`nCLS`r`nBITMAP 0,0,80,719,0,")
if($command[$header.Length] -ne 127){throw 'TSPL polarity mismatch'}
if(![Text.Encoding]::ASCII.GetString($command).EndsWith("`r`nPRINT 1,3`r`n")){throw 'Wrong TSPL copy count'}
$denied=$false;try{[FeedXTransport]::Tspl([byte[]]::new(1),639,719,80,90,1,2,$true)}catch{$denied=$true};if(!$denied){throw 'Invalid raster accepted'}
if((Get-BridgeRecovery ([pscustomobject]@{stage='submitting'})) -ne 'Unknown'){throw 'Crash would resend'}
if((Get-BridgeRecovery ([pscustomobject]@{stage='reporting';outcome='Sent'})) -ne 'Sent'){throw 'Saved receipt lost'}
if((Get-BridgeRecovery ([pscustomobject]@{stage='claiming'})) -ne 'ResumeClaim'){throw 'Stable claim cannot retry'}
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
