$ErrorActionPreference='Stop'
Import-Module "$PSScriptRoot\Bridge.psm1" -Force

# Exercise the actual setup functions with isolated state and no dialogs, cloud mutations or printer calls.
# Validate the installed authorization listener without authenticating or calling a printer.
Add-Type -Path "$PSScriptRoot\BrowserAuthorization.cs"
$authTemplate=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\print-bridge\Setup-Authorization.html') -Raw
$listener=[FeedXBrowserAuthorization]::new($authTemplate,'sb_publishable_fixture','https://oyfobxdoyfuzsodogpgs.supabase.co','Production')
try {
    $address=[uri]$listener.LaunchUrl
    $path=$address.AbsolutePath.Replace('/authorize/','/session/')
    foreach($origin in @('https://foreign.invalid',$listener.Url)){
        $client=[Net.Sockets.TcpClient]::new()
        try {
            $client.Connect('127.0.0.1',$address.Port)
            $stream=$client.GetStream()
            $body='{"fixture":"local authorization response"}'
            $raw=[Text.Encoding]::ASCII.GetBytes("POST $path HTTP/1.1`r`nHost: $($address.Authority)`r`nOrigin: $origin`r`nContent-Type: application/json`r`nContent-Length: $($body.Length)`r`n`r`n$body")
            $stream.Write($raw,0,$raw.Length)
            $received=$listener.Poll()
            if($origin -eq $listener.Url -and $received -ne $body){throw 'Native authorization did not receive the same-origin response.'}
            if($origin -ne $listener.Url -and $null -ne $received){throw 'Native authorization accepted a foreign origin.'}
        } finally {$client.Dispose()}
    }
} finally {$listener.Dispose()}

$setupFunctions=@('Start-Worker','Save-Configuration','Confirm-Idle','Register-Computer',
    'Get-PendingDeviceId','Save-RegisteredConfiguration','Read-Number','Report-SetupFailure','Show-SetupFailure','Run-Calibration','Check-D520Connection')
$tokens=$null;$errors=$null
$setup=[Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot 'Setup-Bridge.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$definitions=$setup.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $setupFunctions -contains $node.Name
},$false)
if($definitions.Count -ne $setupFunctions.Count){throw 'Could not load the installed setup functions for simulation.'}
# Recreated script blocks have no script-file location of their own.
$setupRoot=$PSScriptRoot
foreach($definition in $definitions){
    $source=$definition.Extent.Text.Replace('$PSScriptRoot','$setupRoot')
    . ([scriptblock]::Create($source))
}

$module=Get-Module Bridge
$session=& $module {
    function Invoke-RestMethod($Method,$Uri,$Headers,$ContentType,$Body,$TimeoutSec,$MaximumRedirection) {
        if($Uri -cne 'https://oyfobxdoyfuzsodogpgs.supabase.co/auth/v1/token?grant_type=password' -or
            $Method -ne 'Post' -or $Headers.apikey -ne 'sb_publishable_fixture' -or $MaximumRedirection -ne 0) {
            throw 'Guided sign-in must use the Production Auth endpoint without following redirects.'
        }
        if(($Body|ConvertFrom-Json).email -ne 'operator@example.invalid'){throw 'Sign-in body was not serialized.'}
        return [pscustomobject]@{user=[pscustomobject]@{id='operator-fixture'};access_token='access-fixture';expires_in=3600}
    }
    Invoke-BridgeAuth 'sb_publishable_fixture' @{email='operator@example.invalid';password='password-fixture'} 'password'
}
if($session.user.id -ne 'operator-fixture'){throw 'Production sign-in response was not passed through.'}

$root=Join-Path $env:TEMP ('feedx-setup-fixture-'+[guid]::NewGuid())
$configPath=Join-Path $root 'config.json'
$sessionPath=Join-Path $root 'session.xml'
$calibrationPath=Join-Path $root 'calibration.xml'
$pendingDevicePath=Join-Path $root 'pending-device.xml'
$diagnosticsPath=Join-Path $root 'setup-diagnostics.xml'
$web='https://os.feedx.my'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName='FeedX Windows setup fixture'
$script:registrationDenied=$true
$script:approveTest=$false
$script:calibrationAnswer='Review Later'
$script:submissions=0
$script:registeredTask=$false
$script:startedTask=$false
$script:notice=$null
$script:taskDenied=$false

function Invoke-BridgeRpc($Config,$Session,$Name,$Body) {
    if($Name -eq 'setup_queue'){return 0}
    if($Name -ne 'device' -or $Body.p_device -ne $Config.DeviceId -or $Body.p_printer -ne 'D520 USB fixture'){
        throw 'Unexpected registration request.'
    }
    if($script:registrationDenied){throw 'Permission denied fixture'}
    return $true
}
function Get-BridgePrinters {
    [pscustomobject]@{Name='D520 USB fixture';WorkOffline=$false;PrinterStatus=3}
}
function Confirm-Action($Message) {
    if($Message -notmatch 'exactly one TEST label'){throw 'The operator prompt must specify one label.'}
    return $script:approveTest
}
function Read-Field($Message,$Initial='',[string[]]$Options=@()) {
    if(!$Options.Count){return $Initial}
    if($Options -notcontains 'All Passed'){throw 'The calibration review choices are missing.'}
    return $script:calibrationAnswer
}
function Show-Notice($Message) {$script:notice=$Message}
function Start-Process($FilePath) {
    if($FilePath -ne "$web/factory/settings/labels?section=printers"){throw 'Unexpected browser destination.'}
}
function Submit-CalibrationLabel($Config,$Raster,$Command,$WidthDots,$HeightDots,$WidthMm,$HeightMm) {
    $record=Read-BridgeState $calibrationPath
    if($record.stage -ne 'submitting' -or $record.quantity -ne 1){throw 'The single-label marker was not persisted before submission.'}
    if($WidthDots -ne 639 -or $HeightDots -ne 719 -or $Raster.Length -ne (80*719) -or $Config.Transport -ne 'spooler'){
        throw 'The D520 driver test did not receive the expected 80 x 90 mm raster.'
    }
    $script:submissions++
}
function Register-ScheduledTask($TaskName,$Action,$Trigger,$Principal,$Settings,[switch]$Force) {
    if(!$Force -or $Settings.MultipleInstances.ToString() -ne 'IgnoreNew' -or $Action.Arguments -notmatch 'Start-Bridge.ps1'){
        throw 'The worker launch must use the existing single-instance scheduled task.'
    }
    if($script:taskDenied){
        $denial=[Management.Automation.ErrorRecord]::new([UnauthorizedAccessException]::new('private task payload'), 'HRESULT 0x80070005', 'PermissionDenied', $null)
        throw $denial
    }
    $script:registeredTask=$true
}
function Start-ScheduledTask($TaskName) {
    if(!$script:registeredTask){throw 'Attempted to start an unregistered worker.'}
    $script:startedTask=$true
}

New-Item -ItemType Directory -Path $root | Out-Null
try {
    # Stock dimensions are the first input after selecting a paired D520.
    if((Read-Number 'Stock width in millimetres.' 80 20 120) -ne 80 -or
       (Read-Number 'Stock length in the feed direction in millimetres.' 90 20 200) -ne 90 -or
       (Read-Number 'Stock gap in millimetres.' 2 0 10) -ne 2){
        throw 'Setup could not read valid stock measurements.'
    }
    $deviceId=Get-PendingDeviceId
    $config=[pscustomobject]@{DeviceId=$deviceId;Name='Fixture';Printer='D520 USB fixture';Transport='spooler';
        StockWidthMm=80;StockHeightMm=90;GuidedSetup=$true;Calibrated=$false;Owner=$session.user.id}
    $rejected=$false
    try {Save-RegisteredConfiguration $config $session} catch {
        if($_.Exception.Message -ne 'Permission denied fixture'){throw}
        $rejected=$true
    }
    if(!$rejected -or (Test-Path $configPath) -or (Test-Path $sessionPath) -or (Get-PendingDeviceId) -ne $deviceId){
        throw 'Denied first registration committed local sign-in state or lost its retry ID.'
    }
    $script:registrationDenied=$false
    Save-RegisteredConfiguration $config $session
    if((Test-Path $pendingDevicePath) -or (Read-BridgeState $sessionPath).user.id -ne $session.user.id -or
        (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).DeviceId -ne $deviceId){
        throw 'Successful registration did not persist the same device and session.'
    }
    Start-Worker
    if(!$script:startedTask){throw 'Background worker startup was not requested.'}

    # The real manual check must consume the worker's fresh DPAPI receipt, even when the cloud status update fails.
    $probeConfig=[pscustomobject]@{DeviceId=$deviceId;Name='Fixture';Printer='D520 (Bluetooth)';Transport='tspl'
        BluetoothAddress='001122334455';GuidedSetup=$true;Calibrated=$false}
    Save-BridgeState (Join-Path $root 'connection-status.xml') @{
        Address=$probeConfig.BluetoothAddress;Checked=[datetime]::UtcNow.AddMinutes(-1).ToString('o');Available=$false;Detail='Stale fixture'
    }
    $receiptPath=Join-Path $root 'connection-status.xml'
    $gateReady=Join-Path $root 'fixture-worker-ready'
    $releaseGate=Join-Path $root 'fixture-worker-release'
    $worker=Start-Job -ArgumentList $setupRoot,$root -ScriptBlock {
        param($BridgeFolder,$Root)
        $ErrorActionPreference='Stop'
        Import-Module (Join-Path $BridgeFolder 'Bridge.psm1') -Force
        & (Get-Module Bridge) {
            param($Root)
            $persist=(Get-Item Function:Save-BridgeState).ScriptBlock
            function Save-BridgeState($Path,$Value) {
                # Hold the existing file as an exclusive Windows writer so the sharing conflict is deterministic.
                $stream=[IO.File]::Open($Path,'Open','ReadWrite','None')
                try {
                    New-Item (Join-Path $Root 'fixture-worker-ready') -ItemType File | Out-Null
                    $deadline=[datetime]::UtcNow.AddSeconds(15)
                    while(!(Test-Path (Join-Path $Root 'fixture-worker-release'))){
                        if([datetime]::UtcNow -ge $deadline){throw 'Fixture timed out holding the status file.'}
                        Start-Sleep -Milliseconds 20
                    }
                    Start-Sleep -Milliseconds 200
                } finally {$stream.Dispose()}
                & $persist $Path $Value
            }
            Invoke-BridgeConnectionReceipt $Root 'write' @{
                Address='001122334455';Available=$true;Checked=[datetime]::UtcNow.ToString('o');Detail='Fresh worker fixture'
            }
        } $Root
    }
    try {
        $deadline=[datetime]::UtcNow.AddSeconds(20)
        while(!(Test-Path $gateReady)){
            if($worker.State -in @('Failed','Completed') -or [datetime]::UtcNow -ge $deadline){
                Receive-Job $worker
                throw 'Worker did not lock the status file for the fixture.'
            }
            Start-Sleep -Milliseconds 20
        }
        $legacyFailure=$null
        try {Read-BridgeState $receiptPath | Out-Null} catch {$legacyFailure=Get-BridgeFailureCodes $_}
        if(!$legacyFailure -or $legacyFailure.HResult -ne '0x80070020'){
            throw 'The old unguarded reader did not reproduce the operator sharing violation.'
        }
        $lockedFailure=$null
        try {Invoke-BridgeConnectionReceipt $root 'read' | Out-Null} catch {$lockedFailure=Get-BridgeFailureCodes $_}
        if(!$lockedFailure -or $lockedFailure.Exception -ne 'TimeoutException' -or
           $lockedFailure.Resource -ne 'connection-status' -or $lockedFailure.Operation -ne 'read'){
            throw 'The bounded reader did not report a sanitized local status contention.'
        }
        New-Item $releaseGate -ItemType File | Out-Null
        $receipt=Invoke-BridgeConnectionReceipt $root 'read'
        if(!$receipt.Available -or $receipt.Detail -ne 'Fresh worker fixture'){
            throw 'Setup did not wait for and read the worker replacement.'
        }
        Wait-Job $worker -Timeout 10 | Out-Null
        Receive-Job $worker
        if($worker.State -ne 'Completed'){throw 'Worker replacement did not finish.'}
    } finally {
        New-Item $releaseGate -ItemType File -Force | Out-Null
        Remove-Job $worker -Force
    }
    Write-Output 'PASS: Reproduced 0x80070020 with the legacy reader and verified a serialized worker replacement.'

    $script:workerCycles=0
    $script:startedTask=$false
    function Get-ScheduledTask {return @{State='Running'}}
    function Start-Sleep {
        param([int]$Milliseconds)
        $script:workerCycles++
        if($script:workerCycles -ne 1){throw 'Manual check missed the fresh worker probe during a cloud status failure.'}
        & $module {
            param($Root,$Config,$Session)
            $script:nativeProbes=0
            function Invoke-BridgeD520Probe($Address){$script:nativeProbes++}
            function Invoke-BridgeRpc($Config,$Session,$Name,$Body){
                if($Name -ne 'device'){throw 'Pending calibration must not claim a print.'}
                if($Body.p_printers[0].WorkOffline){throw 'The successful worker probe was not published as available.'}
                throw [Net.WebException]::new('Simulated cloud status timeout', [Net.WebExceptionStatus]::Timeout)
            }
            try {Invoke-BridgeCycle $Config $Session (Join-Path $Root 'journal.xml')}
            catch [Net.WebException] {
                if($_.Exception.Status -ne [Net.WebExceptionStatus]::Timeout){throw}
            }
            if($script:nativeProbes -ne 1){throw 'Expected one worker-owned probe.'}
        } $root $probeConfig $session
    }
    Check-D520Connection $probeConfig.BluetoothAddress
    if($script:workerCycles -ne 1 -or $script:startedTask -or $script:notice -notmatch 'bitmap mode verified'){
        throw 'Manual check accepted a stale result or restarted the running worker.'
    }

    $script:setupStage='Check D520 connection'
    $native=[ComponentModel.Win32Exception]::new(10060,'private Bluetooth address 001122334455')
    $native.Data['D520Phase']='rfcomm-connect'
    $wrapped=[InvalidOperationException]::new('private sign-in fixture',$native)
    try {throw $wrapped} catch {Show-SetupFailure $_}
    $report=Read-BridgeState $diagnosticsPath
    if($report.Failures[0].Stage -ne 'Check D520 connection' -or $report.Failures[0].Codes.NativeCode -ne 10060 -or
       $report.Failures[0].Codes.BluetoothPhase -ne 'rfcomm-connect' -or $script:notice -notmatch 'Windows error 10060'){
        throw 'Connection diagnostics lost the native Bluetooth error or phase.'
    }
    $script:taskDenied=$true
    try {Start-Worker} catch {Show-SetupFailure $_}
    $report=Read-BridgeState $diagnosticsPath
    if($report.Failures[0].Stage -ne 'Register Windows background task' -or $report.Failures[0].Codes.HResult -ne '0x80070005' -or
       $script:notice -notmatch 'Reconnect'){
        throw 'Task failure diagnostics lost the Windows stage, HRESULT or recovery action.'
    }
    $script:setupStage='Sign in to FeedX'
    for($i=0;$i -lt 9;$i++){
        try {throw [Net.WebException]::new('private password-fixture access-fixture', [Net.WebExceptionStatus]::Timeout)}
        catch {Show-SetupFailure $_}
    }
    $report=Read-BridgeState $diagnosticsPath
    $serialized=$report | ConvertTo-Json -Depth 8
    if($report.Failures.Count -ne 8 -or $report.Failures[0].Codes.NetworkStatus -ne 'Timeout' -or
       $serialized -match 'private|password-fixture|access-fixture|001122334455|operator@example.invalid' -or $script:notice -match 'password-fixture|access-fixture'){
        throw 'Setup diagnostics must retain bounded, sanitized evidence.'
    }

    Run-Calibration $config $session
    if($script:submissions -or (Test-Path $calibrationPath)){throw 'Declining the TEST approval submitted output.'}
    $script:approveTest=$true
    Run-Calibration $config $session
    if($script:submissions -ne 1 -or (Get-BridgeCalibration $config $root) -ne 'Needs review' -or $config.Calibrated){
        throw 'A simulated spooler submission must wait for physical review.'
    }
    $script:calibrationAnswer='All Passed'
    Run-Calibration $config $session
    if($script:submissions -ne 1 -or (Get-BridgeCalibration $config $root) -ne 'Passed'){
        throw 'Physical review did not complete calibration without resubmission.'
    }
    Save-BridgeState $calibrationPath @{stage='unknown';quantity=1}
    $script:calibrationAnswer='Inspected / Issue'
    Run-Calibration $config $session
    if($script:submissions -ne 1 -or (Test-Path $calibrationPath) -or (Get-BridgeCalibration $config $root) -ne 'Pending'){
        throw 'An uncertain calibration was resubmitted or incorrectly passed.'
    }
    if(@(Get-ChildItem (Join-Path $root 'recovery-evidence') -Filter '*.xml').Count -ne 2){
        throw 'Calibration review evidence was lost.'
    }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
Write-Output 'PASS: Stock inputs, bounded diagnostic sanitization, Windows native codes, Production sign-in simulation, denied registration retry, logon task request, exactly one approved calibration, physical review and Unknown recovery.'
