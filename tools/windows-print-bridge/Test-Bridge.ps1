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
Write-Output 'PASS: PowerShell parser, C# compilation, TSPL bytes/polarity/copies, raster validation, crash recovery, durable ordering, receipt retry, offline and completed-claim guards.'
