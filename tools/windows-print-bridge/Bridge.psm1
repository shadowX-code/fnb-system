Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Endpoint = 'https://ujkzdaaadnvcfayuldmh.supabase.co'

function Save-BridgeState($Path, $Value) {
    # Atomic, user-bound DPAPI journal: never resubmit after an uncertain physical write.
    $temp = "$Path.tmp"
    $secure = ConvertTo-SecureString ($Value | ConvertTo-Json -Depth 20 -Compress) -AsPlainText -Force
    $secure | Export-Clixml -LiteralPath $temp
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp, $Path, $null) }
    else { [IO.File]::Move($temp, $Path) }
}
function Read-BridgeState($Path) {
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    $value = Import-Clixml -LiteralPath $Path
    $credential = New-Object System.Management.Automation.PSCredential('state', $value)
    return ($credential.GetNetworkCredential().Password | ConvertFrom-Json)
}
function Invoke-BridgeAuth($Key, $Body, $Grant) {
    return Invoke-RestMethod -Method Post -Uri "$script:Endpoint/auth/v1/token?grant_type=$Grant" -Headers @{apikey=$Key} -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 30
}
function Invoke-BridgeRpc($Config, $Session, $Name, $Body) {
    return Invoke-RestMethod -Method Post -Uri "$script:Endpoint/rest/v1/rpc/factory_label_$Name" -Headers @{apikey=$Config.PublicKey; Authorization="Bearer $($Session.access_token)"} -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20 -Compress) -TimeoutSec 45
}
function Get-BridgePrinters {
    return @(Get-CimInstance Win32_Printer | Select-Object Name, WorkOffline, PrinterStatus)
}
function Get-BridgeRecovery($State) {
    if ($State.stage -eq 'submitting') { return 'Unknown' }
    if ($State.stage -eq 'reporting') { return $State.outcome }
    return 'ResumeClaim'
}
function Set-BridgeOutcome($State, $Outcome, $Detail, $JournalPath) {
    $State.stage='reporting'; $State.outcome=$Outcome; $State.detail=$Detail
    Save-BridgeState $JournalPath $State
}
function Invoke-BridgeCycle($Config, $Session, $StatePath) {
    $printers = Get-BridgePrinters
    $printer = $printers | Where-Object { $_.Name -ceq $Config.Printer } | Select-Object -First 1
    $ready = $null -ne $printer -and !$printer.WorkOffline -and $printer.PrinterStatus -notin @(6,7)
    $status = if($ready) {'Ready'} else {'Offline'}
    $null=Invoke-BridgeRpc $Config $Session 'device' @{p_device=$Config.DeviceId;p_name=$Config.Name;p_printer=$Config.Printer;p_transport=$Config.Transport;p_status=$status;p_printers=@($printers)}
    $state = Read-BridgeState $StatePath
    if ($state) {
        $recovery = Get-BridgeRecovery $state
        if($recovery -eq 'Unknown') {
            Set-BridgeOutcome $state 'Unknown' 'Bridge restarted during submission. Inspect the printer and Windows queue.' $StatePath
        }
        if($state.stage -eq 'reporting') {
            $null=Invoke-BridgeRpc $Config $Session 'report' @{p_device=$Config.DeviceId;p_job=$state.job;p_claim=$state.claim;p_state=$state.outcome;p_detail=$state.detail}
            Remove-Item -LiteralPath $StatePath
            return
        }
    }
    if(!$ready) { return }
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
        $command=$null
        if($Config.Transport -eq 'tspl') {
            $command=[FeedXTransport]::Tspl($bytes,$job.raster.width,$job.raster.height,$snapshot.width_mm,$snapshot.height_mm,$job.quantity,$Config.GapMm,$Config.TsplInvert)
        }
    } catch {
        Set-BridgeOutcome $state 'Failed' 'Invalid raster; no data submitted to the printer.' $StatePath;return
    }
    # This durable marker precedes every native call that can emit paper.
    $state.stage='submitting';Save-BridgeState $StatePath $state
    try {
        $name="FeedX-$($job.id)"
        if($Config.Transport -eq 'spooler') {
            [FeedXTransport]::Spool($Config.Printer,$bytes,$job.raster.width,$job.raster.height,$snapshot.width_mm,$snapshot.height_mm,$job.quantity,$name)
            $detail='Accepted by Windows spooler. Physical output requires operator confirmation.'
        } elseif($Config.Transport -eq 'tspl') {
            $spoolId=[FeedXTransport]::Raw($Config.Printer,$command,$name)
            $detail="RAW command accepted by Windows spooler (job $spoolId). Physical output requires confirmation."
        } else {throw 'Unsupported transport.'}
        Set-BridgeOutcome $state 'Sent' $detail $StatePath
    } catch {
        # Native errors can occur after a partial write, so automatic resend is unsafe.
        Set-BridgeOutcome $state 'Unknown' 'Submission interrupted or rejected. Inspect printer and Windows queue before recovery.' $StatePath
    }
}
Export-ModuleMember -Function *-Bridge*
