Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Endpoint = 'https://ujkzdaaadnvcfayuldmh.supabase.co'

function Save-BridgeState($Path, $Value) {
    # Atomic, user-bound DPAPI journal: never resubmit after an uncertain physical write.
    $temp = "$Path.tmp"
    $secure = ConvertTo-SecureString ($Value | ConvertTo-Json -Depth 20 -Compress) -AsPlainText -Force
    $secure | Export-Clixml -LiteralPath $temp
    $stream = [IO.File]::Open($temp, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Flush($true) } finally { $stream.Dispose() }
    # Windows PowerShell 5.1 converts a null string argument to an empty path; use an explicit backup.
    if (Test-Path -LiteralPath $Path) {
        [IO.File]::Replace($temp, $Path, "$Path.previous")
        Remove-Item -LiteralPath "$Path.previous" -ErrorAction SilentlyContinue
    }
    else { [IO.File]::Move($temp, $Path) }
}
function Read-BridgeState($Path) {
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    $value = Import-Clixml -LiteralPath $Path
    $credential = New-Object System.Management.Automation.PSCredential('state', $value)
    return ($credential.GetNetworkCredential().Password | ConvertFrom-Json)
}
function Invoke-BridgeConnectionReceipt($Root,[ValidateSet('read','write')]$Operation,$Value) {
    $path=Join-Path $Root 'connection-status.xml'
    # Windows file replacement and Import-Clixml must not overlap across Setup and the worker.
    $gate=New-Object Threading.Mutex($false,'Local\FeedXPrintBridge-Staging-ConnectionStatus')
    try {
        try {$held=$gate.WaitOne(1000)} catch [Threading.AbandonedMutexException] {$held=$true}
        if(!$held){throw [TimeoutException]::new('The local connection report is busy.')}
        try {
            if($Operation -eq 'read'){Read-BridgeState $path}
            else {Save-BridgeState $path $Value}
        } finally {$gate.ReleaseMutex()}
    } catch {
        $_.Exception.Data['BridgeResource']='connection-status'
        $_.Exception.Data['BridgeOperation']=$Operation
        throw
    } finally {$gate.Dispose()}
}
function Invoke-BridgeAuth($Key, $Body, $Grant) {
    return Invoke-RestMethod -Method Post -Uri "$script:Endpoint/auth/v1/token?grant_type=$Grant" -Headers @{apikey=$Key} -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 30 -MaximumRedirection 0
}
function Invoke-BridgeRpc($Config, $Session, $Name, $Body) {
    return Invoke-RestMethod -Method Post -Uri "$script:Endpoint/rest/v1/rpc/factory_label_$Name" -Headers @{apikey=$Config.PublicKey; Authorization="Bearer $($Session.access_token)"} -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20 -Compress) -TimeoutSec 45 -MaximumRedirection 0
}
function Get-BridgeFailureCodes($ErrorRecord) {
    $codes=[ordered]@{Exception=$null;HResult=$null;NativeCode=$null;HttpStatus=$null;NetworkStatus=$null;BluetoothPhase=$null;BluetoothReceipt=$null;Resource=$null;Operation=$null}
    for($cause=$ErrorRecord.Exception; $cause; $cause=$cause.InnerException) {
        $codes.Exception=$cause.GetType().Name
        $codes.HResult='0x{0:X8}' -f $cause.HResult
        if($cause -is [ComponentModel.Win32Exception] -or $cause -is [Microsoft.Management.Infrastructure.CimException]) {
            $codes.NativeCode=[int]$cause.NativeErrorCode
        }
        if($cause -is [Net.WebException]) {
            $codes.NetworkStatus=$cause.Status.ToString()
            if($cause.Response -is [Net.HttpWebResponse]){$codes.HttpStatus=[int]$cause.Response.StatusCode}
        }
        if($cause.Data['D520Phase'] -in @('winsock-startup','socket-open','socket-configure','rfcomm-connect','bitmap-mode','submission')){
            $codes.BluetoothPhase=$cause.Data['D520Phase']
        }
        if($cause.Data['D520Receipt'] -in @('missing','rejected')){
            $codes.BluetoothReceipt=$cause.Data['D520Receipt']
        }
        if($cause.Data['BridgeResource'] -in @('connection-request','connection-status')){
            $codes.Resource=$cause.Data['BridgeResource']
        }
        if($cause.Data['BridgeOperation'] -in @('read','write')){
            $codes.Operation=$cause.Data['BridgeOperation']
        }
    }
    if($ErrorRecord.FullyQualifiedErrorId -match '^HRESULT (0x[0-9a-f]{8})(?:,|$)'){
        $codes.HResult=$Matches[1]
    }
    return $codes
}
function Get-BridgePrinters {
    return @(Get-CimInstance Win32_Printer | Select-Object Name, WorkOffline, PrinterStatus)
}
function Get-BridgeBluetoothAddress($Config) {
    if($Config.PSObject.Properties['BluetoothAddress'] -and $Config.Transport -eq 'tspl'){
        return $Config.BluetoothAddress
    }
}
function Initialize-BridgeBluetooth {
    if(!('FeedXD520Bluetooth' -as [type])){Add-Type -Path "$PSScriptRoot\D520Bluetooth.cs"}
}
function Get-BridgeD520Devices {
    Initialize-BridgeBluetooth
    [FeedXD520Bluetooth]::Discover()
}
function Invoke-BridgeD520Probe($Address) {
    Initialize-BridgeBluetooth
    [FeedXD520Bluetooth]::Probe($Address)
}
function Send-BridgeD520Label($Address,$Payload) {
    Initialize-BridgeBluetooth
    [FeedXD520Bluetooth]::Submit($Address,$Payload)
}
function New-BridgeBluetoothStatus {
    [pscustomobject]@{Checked=$null;LocalReportAt=$null;Failures=0;Available=$false;Detail=$null;Failure=$null}
}
function Get-BridgeBluetoothPrinter($Config,$Status) {
    $row=[ordered]@{Name=$Config.Printer;WorkOffline=$true;PrinterStatus=2;Platform='Windows';Connection='Bluetooth Classic SPP'}
    if($Status -and $Status.Checked){
        $row.ConnectionCheckedAt=$Status.Checked.ToString('o')
        $row.ConnectionDetail=$Status.Detail
        $row.WorkOffline=!$Status.Available -or ([datetime]::UtcNow-$Status.Checked).TotalSeconds -gt 90
    }
    [pscustomobject]$row
}
function Update-BridgeBluetoothProbe($Address,$Status,$Root,$Now=[datetime]::UtcNow) {
    $request=Get-Item -LiteralPath (Join-Path $Root 'connection-request') -ErrorAction SilentlyContinue
    $interval=@(60,15,30,60)[$Status.Failures]
    if($request -and $Status.Checked -and $request.LastWriteTimeUtc -gt $Status.Checked){$interval=10}
    if($Status.Checked -and ($Now-$Status.Checked).TotalSeconds -lt $interval){return}
    # Keep the observation time at probe start so an in-flight probe cannot satisfy a later manual request.
    $Status.Checked=$Now
    try {
        Invoke-BridgeD520Probe $Address
        $Status.Available=$true
        $Status.Detail=$null
        $Status.Failure=$null
        $Status.Failures=0
    } catch {
        $Status.Available=$false
        $Status.Failure=Get-BridgeFailureCodes $_
        $Status.Failure.Resource='bluetooth'
        $Status.Failure.Operation='probe'
        $Status.Detail='D520 did not verify its Bluetooth serial connection and bitmap mode. Check Windows pairing, printer power and range, and close other printer apps.'
        $Status.Failures=[Math]::Min(3,$Status.Failures+1)
    }
}
function Set-BridgeOutcome($State, $Outcome, $Detail, $JournalPath) {
    $State.stage='reporting'; $State.outcome=$Outcome; $State.detail=$Detail
    Save-BridgeState $JournalPath $State
}
function Get-BridgeCalibration($Config, $Root) {
    if (Test-Path -LiteralPath (Join-Path $Root 'calibration.xml')) { return 'Needs review' }
    if ($Config.PSObject.Properties['Calibrated'] -and $Config.Calibrated) { return 'Passed' }
    if ($Config.PSObject.Properties['GuidedSetup']) { return 'Pending' }
    return 'Not reported'
}
function Test-BridgePaused($Root) {
    $marker=Join-Path $Root 'setup.pause'
    if (!(Test-Path -LiteralPath $marker)) { return $false }
    $setup=New-Object Threading.Mutex($false,'Local\FeedXPrintBridge-Staging-Setup')
    try {
        try { if(!$setup.WaitOne(0)){return $true} } catch [Threading.AbandonedMutexException] {}
        try { Remove-Item -LiteralPath $marker -ErrorAction SilentlyContinue; return $false }
        finally { $setup.ReleaseMutex() }
    } finally { $setup.Dispose() }
}
function Invoke-BridgeCycle($Config, $Session, $StatePath, $BluetoothStatus=$null) {
    $address=Get-BridgeBluetoothAddress $Config
    $folder = Split-Path -Parent $StatePath
    if($address){
        if(!$BluetoothStatus){$BluetoothStatus=New-BridgeBluetoothStatus}
        Update-BridgeBluetoothProbe $address $BluetoothStatus $folder
        $printers=@(Get-BridgeBluetoothPrinter $Config $BluetoothStatus)
    } else {
        $printers=@(Get-BridgePrinters | Select-Object -First 75)
    }
    $printer = $printers | Where-Object { $_.Name -ceq $Config.Printer } | Select-Object -First 1
    $ready = $null -ne $printer -and !$printer.WorkOffline -and $printer.PrinterStatus -notin @(6,7)
    if($address -and $BluetoothStatus.Checked -ne $BluetoothStatus.LocalReportAt) {
        # Setup consumes the worker's local observation even if FeedX status reporting is delayed.
        try {
            Invoke-BridgeConnectionReceipt $folder 'write' @{
                Address=$address;Checked=$BluetoothStatus.Checked.ToString('o');Available=$ready;Detail=$BluetoothStatus.Detail;Failure=$BluetoothStatus.Failure
            }
            $BluetoothStatus.LocalReportAt=$BluetoothStatus.Checked
        } catch {
            Write-Verbose 'Cannot save the local Bluetooth observation. The worker will retry.'
        }
    }
    $calibration = if ($folder) { Get-BridgeCalibration $Config $folder } else { 'Not reported' }
    if ($printer) {
        $printer | Add-Member -NotePropertyName Calibration -NotePropertyValue $calibration -Force
        if(!$address){$printer | Add-Member -NotePropertyName Connection -NotePropertyValue 'Windows spooler' -Force}
        if ($Config.PSObject.Properties['StockWidthMm']) {
            $printer | Add-Member -NotePropertyName StockWidthMm -NotePropertyValue $Config.StockWidthMm -Force
            $printer | Add-Member -NotePropertyName StockHeightMm -NotePropertyValue $Config.StockHeightMm -Force
        }
    }
    $status = if(!$ready) {'Offline'} elseif($calibration -in @('Pending','Needs review')) {'Error'} else {'Ready'}
    $null=Invoke-BridgeRpc $Config $Session 'device' @{p_device=$Config.DeviceId;p_name=$Config.Name;p_printer=$Config.Printer;p_transport=$Config.Transport;p_status=$status;p_printers=@($printers)}
    $state = Read-BridgeState $StatePath
    if ($state) {
        if($state.stage -eq 'submitting') {
            $detail=if($address){'Recovered a Bluetooth submission with no recorded transport result. Inspect the D520 and any pending printer output.'}
                else {'Recovered a submission with no recorded transport result. Inspect the printer and Windows print queue.'}
            Set-BridgeOutcome $state 'Unknown' $detail $StatePath
        }
        if($state.stage -eq 'reporting') {
            $null=Invoke-BridgeRpc $Config $Session 'report' @{p_device=$Config.DeviceId;p_job=$state.job;p_claim=$state.claim;p_state=$state.outcome;p_detail=$state.detail}
            Remove-Item -LiteralPath $StatePath
            return
        }
    }
    if(!$ready -or $calibration -in @('Pending','Needs review')) { return }
    if(!$state) {
        $state=[pscustomobject]@{stage='claiming';claim=[guid]::NewGuid().ToString();job=$null;outcome=$null;detail=$null}
        Save-BridgeState $StatePath $state
    }
    $job=Invoke-BridgeRpc $Config $Session 'claim' @{p_device=$Config.DeviceId;p_claim=$state.claim}
    if(!$job) { Remove-Item -LiteralPath $StatePath; return }
    $state.job=$job.id
    if($job.state -ne 'Printing') {
        # The server already recorded/resolved this claim. Never send its bitmap again.
        Remove-Item -LiteralPath $StatePath;return
    }
    if([datetime]::Parse($job.lease_until).ToUniversalTime() -le [datetime]::UtcNow.AddSeconds(60)) {
        Set-BridgeOutcome $state 'Unknown' 'Claim expired before submission; inspect print history.' $StatePath;return
    }
    try {
        $bytes=[Convert]::FromBase64String($job.raster.data)
        if($job.raster.format -ne 'mono1') {throw 'Unsupported raster format.'}
        $snapshot=$job.snapshot
        if ($Config.PSObject.Properties['GuidedSetup'] -and $Config.Calibrated -and
            ($snapshot.width_mm -ne $Config.StockWidthMm -or $snapshot.height_mm -ne $Config.StockHeightMm)) {
            Set-BridgeOutcome $state 'Failed' 'Label dimensions differ from the calibrated stock. No label submitted.' $StatePath
            return
        }
        $command=$null
        if($address) {
            $command=[FeedXTransport]::D520($bytes,$job.raster.width,$job.raster.height,$snapshot.width_mm,$snapshot.height_mm,$job.quantity,$Config.GapMm)
        } elseif($Config.Transport -eq 'tspl') {
            $command=[FeedXTransport]::Tspl($bytes,$job.raster.width,$job.raster.height,$snapshot.width_mm,$snapshot.height_mm,$job.quantity,$Config.GapMm,$Config.TsplInvert)
        }
    } catch {
        Set-BridgeOutcome $state 'Failed' 'Invalid raster; no data submitted to the printer.' $StatePath;return
    }
    # This durable marker precedes every native call that can emit paper.
    $state.stage='submitting';Save-BridgeState $StatePath $state
    $outcome='Sent'
    try {
        $name="FeedX-$($job.id)"
        if($address) {
            Send-BridgeD520Label $address $command
            $detail='D520 acknowledged Bluetooth submission. Physical output requires confirmation.'
        } elseif($Config.Transport -eq 'spooler') {
            [FeedXTransport]::Spool($Config.Printer,$bytes,$job.raster.width,$job.raster.height,$snapshot.width_mm,$snapshot.height_mm,$job.quantity,$name)
            $detail='Accepted by Windows spooler. Physical output requires operator confirmation.'
        } elseif($Config.Transport -eq 'tspl') {
            $spoolId=[FeedXTransport]::Raw($Config.Printer,$command,$name)
            $detail="RAW command accepted by Windows spooler (job $spoolId). Physical output requires confirmation."
        } else {throw 'Unsupported transport.'}
    } catch {
        # Native errors can occur after a partial write, so automatic resend is unsafe.
        $outcome='Unknown'
        $detail=if($address){
            $codes=Get-BridgeFailureCodes $_
            switch ($codes.BluetoothReceipt) {
                'missing' {'D520 Bluetooth write completed. No printer acknowledgment was received. Inspect physical output before recovery.'}
                'rejected' {'D520 rejected the Bluetooth submission. Inspect physical output before recovery.'}
                default {
                    $message='D520 Bluetooth submission was interrupted.'
                    if($null -ne $codes.NativeCode){$message+=" Windows error $($codes.NativeCode)."}
                    "$message Inspect physical output before recovery."
                }
            }
        } else {'Submission interrupted or rejected. Inspect the printer and Windows print queue before recovery.'}
    }
    Set-BridgeOutcome $state $outcome $detail $StatePath
}
function Invoke-BridgeWorker($Config, $Root) {
 $session=$null
 $pendingSession=$false
 $backoff=5
 $bluetoothStatus=if(Get-BridgeBluetoothAddress $Config){New-BridgeBluetoothStatus}
 while(!(Test-BridgePaused $root)) {
  try {
   if(!$session) {
    $session=Read-BridgeState "$root\session.xml"
    if(!$session) {throw 'Open Printer Setup and choose Reauthorize.'}
   }
   if($pendingSession) {
    Save-BridgeState "$root\session.xml" $session
    $pendingSession=$false
   }
   if([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -gt [long]$session.expires_at-120) {
    $session=Invoke-BridgeAuth $config.PublicKey @{refresh_token=$session.refresh_token} 'refresh_token'
    $session | Add-Member -NotePropertyName expires_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$session.expires_in) -Force
    $pendingSession=$true
    Save-BridgeState "$root\session.xml" $session
    $pendingSession=$false
   }
   Invoke-BridgeCycle $config $session "$root\journal.xml" $bluetoothStatus
   $backoff=5
  } catch {
   # Do not log HTTP responses: they can contain identity or token material.
   Set-Content -LiteralPath "$root\status.txt" -Value ("{0:u} Connection or print error. Check FeedX history, printer, and sign-in. No automatic resubmission." -f [datetime]::UtcNow)
   $backoff=[Math]::Min(60,$backoff*2)
  }
  Start-Sleep -Seconds $backoff
 }
}

Export-ModuleMember -Function *-Bridge*
