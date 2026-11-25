param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Import-Module "$PSScriptRoot\Bridge.psm1" -Force
$root=Join-Path $env:LOCALAPPDATA 'FeedXPrintBridge'
$configPath=Join-Path $root 'config.json'
$sessionPath=Join-Path $root 'session.xml'
$calibrationPath=Join-Path $root 'calibration.xml'
$pausePath=Join-Path $root 'setup.pause'
$pendingDevicePath=Join-Path $root 'pending-device.xml'
$diagnosticsPath=Join-Path $root 'setup-diagnostics.xml'
$taskName='FeedX Print Bridge Staging'
$web='https://fnb-system-staging.vercel.app'
$title='FeedX Print Bridge Staging'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$script:setupStage='Secure local setup storage'
$script:windowStatus=$null

function Show-Notice($Message) {
    if($script:windowStatus -and !$script:windowStatus.IsDisposed){$script:windowStatus.Text=$Message;return}
    [void][Windows.Forms.MessageBox]::Show($Message,$title)
}
function Report-SetupFailure($Codes,$Guidance) {
    $failure=[ordered]@{TimeUtc=[datetime]::UtcNow.ToString('o');Stage=$script:setupStage;Codes=$Codes}
    try {
        $previous=Read-BridgeState $diagnosticsPath
        $recent=@($failure)
        if($previous){$recent+=@($previous.Failures | Select-Object -First 7)}
        Save-BridgeState $diagnosticsPath @{Version='1.3.0';Failures=$recent}
        $exportHint='Reopen Bridge Setup and choose Export Diagnostics if this continues.'
    } catch {
        $exportHint='The diagnostic report could not be saved. Note the step and code shown here.'
    }
    if($Codes -and $null -ne $Codes.NativeCode){$Guidance+=" Windows error $($Codes.NativeCode)."}
    if($Codes -and $script:setupStage -like '*Windows background task' -and $Codes.HResult){
        $Guidance+=" Code $($Codes.HResult)."
    }
    Show-Notice "$script:setupStage failed. $Guidance`n`n$exportHint"
}
function Show-SetupFailure($ErrorRecord) {
    $codes=Get-BridgeFailureCodes $ErrorRecord
    $guidance=switch ($script:setupStage) {
        'Load saved setup' {'Reinstall the Staging Bridge over the current copy. If this persists, export diagnostics and contact support.'}
        'Load FeedX sign-in settings' {'Check whether FeedX Staging opens in your browser, then retry.'}
        'Sign in to FeedX' {'Check the sign-in details and access to FeedX Staging, then retry.'}
        'Restore FeedX sign-in' {'Choose Reauthorize and sign in as the original operator.'}
        'Check existing print jobs' {'Check FeedX connectivity and have any held print reviewed before changing setup.'}
        'Find paired D520' {'Check Windows Bluetooth is on and the D520 is paired, then reopen Connect / Configure.'}
        'Select paired D520' {'Reopen Connect / Configure and select the paired printer again.'}
        'Read label stock dimensions' {'Reopen Connect / Configure and enter the width, feed length and gap in millimetres.'}
        'Register with FeedX' {
            if($codes.HttpStatus -in @(401,403)){
                'Check the operator has Factory Production completion access in FeedX Staging. For an existing Bridge, reauthorize as the original operator.'
            } else {'Check that FeedX Staging opens in your browser and retry setup with the same operator.'}
        }
        {$_ -in @('Save FeedX sign-in','Save printer settings','Secure local setup storage','Reserve device identity')} {
            'Retry under the same Windows account. Check that this account can write to its local app data folder and that disk space is available.'
        }
        {$_ -in @('Prepare Windows background task','Register Windows background task','Start Windows background task','Check Windows background task')} {
            'Use Reconnect from the same Windows account. If it fails again, ask your Windows administrator to check Task Scheduler access for this account.'
        }
        'Request D520 probe' {'Close the other Bridge Setup window if one is open, then run Connection Check again.'}
        'Check D520 connection' {
            if($codes.Resource -eq 'connection-status'){
                'Windows could not read the local Bridge report. Wait for the Bridge, then run Connection Check again.'
            } else {'Check printer power and range, and close other printer apps. Then run Connection Check.'}
        }
        default {'Reopen Bridge Setup and retry this step.'}
    }
    Report-SetupFailure $codes $guidance
}
function Export-SetupDiagnostics {
    $report=Read-BridgeState $diagnosticsPath
    if(!$report){Show-Notice 'No setup failure has been recorded. Retry setup or Connection Check first.';return}
    $dialog=New-Object Windows.Forms.SaveFileDialog
    try {
        $dialog.FileName='FeedX-Bridge-Setup-Diagnostics.json'
        $dialog.Filter='JSON report (*.json)|*.json'
        if($dialog.ShowDialog() -ne 'OK'){return}
        [IO.File]::WriteAllText($dialog.FileName, ($report | ConvertTo-Json -Depth 8))
        Show-Notice 'Diagnostic report saved. Share that report with FeedX support.'
    } finally {$dialog.Dispose()}
}
function Confirm-Action($Message) {
    return [Windows.Forms.MessageBox]::Show($Message,$title,'YesNo','Question','Button2') -eq 'Yes'
}
function Read-Field($Message,$Initial='',[switch]$Password,[string[]]$Options=@()) {
    $form=New-Object Windows.Forms.Form
    try {
        $form.Text=$title;$form.Width=560;$form.Height=170;$form.StartPosition='CenterScreen';$form.TopMost=$true
        $label=New-Object Windows.Forms.Label
        $label.Text=$Message;$label.SetBounds(12,12,520,26)
        if($Options.Count) {
            $inputBox=New-Object Windows.Forms.ComboBox
            $inputBox.DropDownStyle='DropDownList'
            $inputBox.Items.AddRange($Options)
            $inputBox.SelectedIndex=[Math]::Max(0,[Array]::IndexOf($Options,$Initial))
        } else {
            $inputBox=New-Object Windows.Forms.TextBox
            $inputBox.UseSystemPasswordChar=$Password.IsPresent
            $inputBox.Text=$Initial
        }
        $inputBox.SetBounds(12,44,520,28)
        $ok=New-Object Windows.Forms.Button
        $ok.Text='Continue';$ok.DialogResult='OK';$ok.SetBounds(432,84,100,26);$form.AcceptButton=$ok
        $cancel=New-Object Windows.Forms.Button
        $cancel.Text='Cancel';$cancel.DialogResult='Cancel';$cancel.SetBounds(326,84,100,26);$form.CancelButton=$cancel
        $form.Controls.AddRange(@($label,$inputBox,$ok,$cancel))
        if($form.ShowDialog() -ne 'OK'){throw [OperationCanceledException]::new()}
        return $inputBox.Text
    } finally {$form.Dispose()}
}
function Read-Number($Message,$Value,$Min,$Max) {
    [decimal]$number=0
    if(![decimal]::TryParse("$Value",[ref]$number) -or $number -lt $Min -or $number -gt $Max) {
        Show-Notice "$Message must be between $Min and $Max mm."
        throw [OperationCanceledException]::new()
    }
    return $number
}
function Start-Worker {
    $script:setupStage='Prepare Windows background task'
    $powerShell="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $action=New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$PSScriptRoot\Start-Bridge.ps1`""
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
    $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $script:setupStage='Register Windows background task'
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    $script:setupStage='Start Windows background task'
    Start-ScheduledTask -TaskName $taskName
}
function Save-Configuration($Config) {
    $tmp="$configPath.tmp"
    $Config|ConvertTo-Json|Set-Content -LiteralPath $tmp -Encoding UTF8
    if(Test-Path -LiteralPath $configPath){[IO.File]::Replace($tmp,$configPath,"$configPath.previous")}
    else {[IO.File]::Move($tmp,$configPath)}
    Remove-Item -LiteralPath "$configPath.previous" -ErrorAction SilentlyContinue
}
function Confirm-Idle($Config,$Session) {
    $script:setupStage='Check existing print jobs'
    if((Test-Path -LiteralPath (Join-Path $root 'journal.xml')) -or
        (Invoke-BridgeRpc $Config $Session 'setup_queue' @{p_device=$Config.DeviceId}) -gt 0) {
        Show-Notice 'Review queued or uncertain Job Order prints in FeedX before changing the printer or sending a test.'
        throw [OperationCanceledException]::new()
    }
}
function Register-Computer($Config,$Session) {
    $script:setupStage='Read printer configuration'
    $inventory=if(Get-BridgeBluetoothAddress $Config){Get-BridgeBluetoothPrinter $Config}
        else {Get-BridgePrinters | Select-Object -First 75}
    $script:setupStage='Register with FeedX'
    $null=Invoke-BridgeRpc $Config $Session 'device' @{
        p_device=$Config.DeviceId;p_name=$Config.Name;p_printer=$Config.Printer;p_transport=$Config.Transport
        p_status='Error';p_printers=@($inventory)
    }
}
function Get-PendingDeviceId {
    $script:setupStage='Reserve device identity'
    # Reserve the same ID across an interrupted registration without binding a local owner on denial.
    $pending=Read-BridgeState $pendingDevicePath
    if($pending){return ([guid]$pending.id).ToString()}
    $id=[guid]::NewGuid().ToString()
    Save-BridgeState $pendingDevicePath @{id=$id}
    return $id
}
function Save-RegisteredConfiguration($Config,$Session) {
    Register-Computer $Config $Session
    $script:setupStage='Save FeedX sign-in'
    Save-BridgeState $sessionPath $Session
    $script:setupStage='Save printer settings'
    Save-Configuration $Config
    if(Test-Path -LiteralPath $pendingDevicePath){Remove-Item -LiteralPath $pendingDevicePath}
}
function Submit-CalibrationLabel($Config,$Raster,$Command,$WidthDots,$HeightDots,$WidthMm,$HeightMm) {
    $address=Get-BridgeBluetoothAddress $Config
    if($address){
        Send-BridgeD520Label $address $Command
    } elseif($Config.Transport -eq 'tspl'){
        [void][FeedXTransport]::Raw($Config.Printer,[byte[]]$Command,'FeedX TEST Calibration')
    } else {
        [FeedXTransport]::Spool($Config.Printer,$Raster,$WidthDots,$HeightDots,$WidthMm,$HeightMm,1,'FeedX TEST Calibration')
    }
}
function Run-Calibration($Config,$Session,$Review=$null,[bool]$Approved=$false) {
    $record=Read-BridgeState $calibrationPath
    if(!$record) {
        Confirm-Idle $Config $Session
        $address=Get-BridgeBluetoothAddress $Config
        if($address){
            $script:setupStage='Check D520 connection'
            if(!(Claim-BridgeBluetooth $Config $Session $address)){Show-Notice 'This D520 is active on another FeedX Bridge.';return}
            try {Invoke-BridgeD520Probe $address} catch {Show-SetupFailure $_;return}
        } else {
            $printer=Get-BridgePrinters | Where-Object {$_.Name -ceq $Config.Printer -and !$_.WorkOffline -and $_.PrinterStatus -notin @(6,7)} | Select-Object -First 1
            if(!$printer){Show-Notice 'The selected printer is unavailable.';return}
        }
        if(!$Approved -and !(Confirm-Action 'Confirm the printer is idle and correct stock is loaded. Send exactly one TEST label?')){return}
        if(!("FeedXTransport" -as [type])){Add-Type -Path "$PSScriptRoot\Transport.cs" -ReferencedAssemblies System.Drawing}
        $w=[decimal]$Config.StockWidthMm;$h=[decimal]$Config.StockHeightMm
        $x=[int][Math]::Round($w*203/25.4,0,'AwayFromZero');$y=[int][Math]::Round($h*203/25.4,0,'AwayFromZero')
        $raster=[FeedXTransport]::Calibration($x,$y)
        $command=if($address){[FeedXTransport]::D520($raster,$x,$y,$w,$h,1,$Config.GapMm)}
            elseif($Config.Transport -eq 'tspl'){[FeedXTransport]::Tspl($raster,$x,$y,$w,$h,1,$Config.GapMm,$Config.TsplInvert)}
        Register-Computer $Config $Session
        if($address -and !(Claim-BridgeBluetooth $Config $Session $address)){Show-Notice 'This D520 is active on another FeedX Bridge.';return}
        $record=@{stage='submitting';quantity=1}
        Save-BridgeState $calibrationPath $record
        try {
            Submit-CalibrationLabel $Config $raster $command $x $y $w $h
            $record.stage='sent'
        } catch { $record.stage='unknown' }
        Save-BridgeState $calibrationPath $record
    }
    $result=if($Review){$Review}else{
        Read-Field 'Inspect physical output and clear any pending printer or queue output.' -Options @('Review Later','Inspected / Issue','All Passed')
    }
    if($result -eq 'Review Later'){return}
    $evidence=Join-Path $root 'recovery-evidence'
    New-Item -ItemType Directory -Force -Path $evidence | Out-Null
    Save-BridgeState (Join-Path $evidence ("setup-"+[guid]::NewGuid()+".xml")) @{result=$result;record=$record;reviewedAt=[datetime]::UtcNow}
    $Config.Calibrated=$result -eq 'All Passed'
    Save-Configuration $Config
    Remove-Item -LiteralPath $calibrationPath
    if($Config.Calibrated){Show-Notice 'Calibration passed.'}
}

function Check-D520Connection($Address) {
    $requested=[datetime]::UtcNow
    $requestPath=Join-Path $root 'connection-request'
    $script:setupStage='Request D520 probe'
    try {Set-Content -LiteralPath $requestPath -Value $requested.ToString('o')} catch {
        $_.Exception.Data['BridgeResource']='connection-request'
        $_.Exception.Data['BridgeOperation']='write'
        throw
    }
    $script:setupStage='Check Windows background task'
    $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if(!$task -or $task.State -ne 'Running'){Start-Worker}
    $script:setupStage='Check D520 connection'
    $script:connectionVerified=$false
    $timer=[Diagnostics.Stopwatch]::StartNew()
    $readFailure=$null
    while($timer.Elapsed.TotalSeconds -lt 35){
        try {
            $status=Invoke-BridgeConnectionReceipt $root 'read'
            $readFailure=$null
        } catch {
            $readFailure=Get-BridgeFailureCodes $_
            if($readFailure.HResult -notin @('0x80070020','0x80070021') -and $readFailure.Exception -ne 'TimeoutException'){throw}
            $status=$null
        }
        if($status -and $status.Address -ceq $Address -and [DateTimeOffset]::Parse($status.Checked).UtcDateTime -ge $requested){
            if($status.Available){$script:connectionVerified=$true;Show-Notice 'D520 Bluetooth connection and bitmap mode verified.'}
            else {
                $codes=if($status.PSObject.Properties['Failure']){$status.Failure}
                $guidance=if($codes -and $codes.BluetoothPhase -eq 'bitmap-mode'){
                    'The serial connection opened but the printer did not verify bitmap mode 4. Check that this is the paired D520 and close other printer apps.'
                } else {$status.Detail}
                Report-SetupFailure $codes $guidance
            }
            return
        }
        if($script:windowStatus){[Windows.Forms.Application]::DoEvents()}
        Start-Sleep -Milliseconds 500
    }
    if($readFailure){
        Report-SetupFailure $readFailure 'Windows could not read the local Bridge report. Wait for the Bridge, then run Connection Check again.'
        return
    }
    $taskInfo=Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    $codes=@{NativeCode=$null;Resource='connection-status';Operation='wait-for-fresh';LastTaskResult=if($taskInfo){'0x{0:X8}' -f $taskInfo.LastTaskResult}}
    Report-SetupFailure $codes 'No fresh worker probe arrived. FeedX may still show an earlier check. If the Bridge is busy, wait for it to finish. If it is offline, choose Reconnect or Reauthorize.'
}

if($SelfTest){
    Add-Type -Path "$PSScriptRoot\BrowserAuthorization.cs"
    . "$PSScriptRoot\Setup-Window.ps1"
    if(!(Test-Path (Join-Path $PSScriptRoot 'Setup-Authorization.html'))){throw 'Browser authorization page missing.'}
    $script:config=$null
    $script:editing=$false
    $script:windowBusy=$false
    $script:connectionVerified=$false
    Show-BridgeWindow -VerifyOnly
    return
}

$setupMutex=New-Object Threading.Mutex($false,'Local\FeedXPrintBridge-Staging-Setup')
try { if(!$setupMutex.WaitOne(0)){exit} } catch [Threading.AbandonedMutexException] {}
try {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    & icacls.exe $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
    if($LASTEXITCODE -ne 0){throw [ComponentModel.Win32Exception]::new($LASTEXITCODE)}
    $script:config=$null
    $script:setupSession=$null
    $script:windowBusy=$false
    $script:editing=$false
    $script:connectionVerified=$false
    $script:choices=@{}
    $script:setupStage='Load saved setup'
    if(Test-Path -LiteralPath $configPath){
        $script:config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if(!$script:config -or $script:config.ProjectRef -ne 'ujkzdaaadnvcfayuldmh'){throw 'Unexpected environment.'}
    }
    . "$PSScriptRoot\Setup-Window.ps1"
    Show-BridgeWindow
} catch {
    Show-SetupFailure $_
} finally {
    $setupMutex.ReleaseMutex()
    $setupMutex.Dispose()
}
