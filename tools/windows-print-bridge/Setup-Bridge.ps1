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
$taskName='FeedX Print Bridge Staging'
$web='https://fnb-system-staging.vercel.app'
$title='FeedX Print Bridge Staging'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name

function Show-Notice($Message) {
    [void][Windows.Forms.MessageBox]::Show($Message,$title)
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
    $number=0m
    if(![decimal]::TryParse((Read-Field $Message "$Value"),[ref]$number) -or $number -lt $Min -or $number -gt $Max) {
        Show-Notice "Enter a valid value between $Min and $Max."
        throw [OperationCanceledException]::new()
    }
    return $number
}
function Start-Worker {
    $powerShell="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $action=New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$PSScriptRoot\Start-Bridge.ps1`""
    $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity
    $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
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
    if((Test-Path -LiteralPath (Join-Path $root 'journal.xml')) -or
        (Invoke-BridgeRpc $Config $Session 'setup_queue' @{p_device=$Config.DeviceId}) -gt 0) {
        Show-Notice 'Review queued or uncertain Job Order prints in FeedX before changing the printer or sending a test.'
        throw [OperationCanceledException]::new()
    }
}
function Register-Computer($Config,$Session) {
    $null=Invoke-BridgeRpc $Config $Session 'device' @{
        p_device=$Config.DeviceId;p_name=$Config.Name;p_printer=$Config.Printer;p_transport=$Config.Transport
        p_status='Error';p_printers=@(Get-BridgePrinters | Select-Object -First 75)
    }
}
function Run-Calibration($Config,$Session) {
    $record=Read-BridgeState $calibrationPath
    if(!$record) {
        Confirm-Idle $Config $Session
        $printer=Get-BridgePrinters | Where-Object {$_.Name -ceq $Config.Printer -and !$_.WorkOffline -and $_.PrinterStatus -notin @(6,7)} | Select-Object -First 1
        if(!$printer){Show-Notice 'The selected printer is unavailable.';return}
        if(!(Confirm-Action 'Confirm the printer is idle and correct stock is loaded. Send exactly one TEST label?')){return}
        Add-Type -Path "$PSScriptRoot\Transport.cs" -ReferencedAssemblies System.Drawing
        $w=[decimal]$Config.StockWidthMm;$h=[decimal]$Config.StockHeightMm
        $x=[int][Math]::Round($w*203/25.4,0,'AwayFromZero');$y=[int][Math]::Round($h*203/25.4,0,'AwayFromZero')
        $raster=[FeedXTransport]::Calibration($x,$y)
        $command=if($Config.Transport -eq 'tspl'){[FeedXTransport]::Tspl($raster,$x,$y,$w,$h,1,$Config.GapMm,$Config.TsplInvert)}
        Register-Computer $Config $Session
        $record=@{stage='submitting';quantity=1}
        Save-BridgeState $calibrationPath $record
        try {
            if($Config.Transport -eq 'tspl'){[void][FeedXTransport]::Raw($Config.Printer,[byte[]]$command,'FeedX TEST Calibration')}
            else {[FeedXTransport]::Spool($Config.Printer,$raster,$x,$y,$w,$h,1,'FeedX TEST Calibration')}
            $record.stage='sent'
        } catch { $record.stage='unknown' }
        Save-BridgeState $calibrationPath $record
    }
    $result=Read-Field 'Inspect the physical output and clear any held Windows job.' -Options @('Review Later','Inspected / Issue','All Passed')
    if($result -eq 'Review Later'){return}
    $evidence=Join-Path $root 'recovery-evidence'
    New-Item -ItemType Directory -Force -Path $evidence | Out-Null
    Save-BridgeState (Join-Path $evidence ("setup-"+[guid]::NewGuid()+".xml")) @{result=$result;record=$record;reviewedAt=[datetime]::UtcNow}
    $Config.Calibrated=$result -eq 'All Passed'
    Save-Configuration $Config
    Remove-Item -LiteralPath $calibrationPath
    if($Config.Calibrated){Show-Notice 'Calibration passed. The bridge will start in the background.';Start-Process "$web/factory/settings/labels?section=printers"}
}

$setupMutex=New-Object Threading.Mutex($false,'Local\FeedXPrintBridge-Staging-Setup')
try { if(!$setupMutex.WaitOne(0)){exit} } catch [Threading.AbandonedMutexException] {}
$workerMutex=$null;$held=$false;$paused=$false
try {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    & icacls.exe $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Local bridge file permissions could not be secured.'}
    $config=if(Test-Path -LiteralPath $configPath){Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json}else{$null}
    if($config -and $config.ProjectRef -ne 'ujkzdaaadnvcfayuldmh'){throw 'Unexpected environment.'}
    $action=Read-Field 'Manage the FeedX Staging printer on this computer.' -Options @('Connect / Configure','Connection Check','Test / Review Calibration','Reauthorize','Open FeedX')
    if($action -eq 'Open FeedX'){Start-Process "$web/factory/settings/labels?section=printers";return}
    if($action -eq 'Connection Check'){
        if(!$config){Show-Notice 'Run Connect / Configure first.';return}
        $printer=Get-BridgePrinters | Where-Object {$_.Name -ceq $config.Printer -and !$_.WorkOffline -and $_.PrinterStatus -notin @(6,7)}
        if($printer){
            if(Confirm-Action 'Windows reports the queue available. Reconnect the background bridge?'){Start-Worker}
        } else {Show-Notice 'Check printer power, pairing and the Windows print queue.'}
        return
    }
    if(!$config -and $action -ne 'Connect / Configure'){Show-Notice 'Run Connect / Configure first.';return}
    New-Item -ItemType File -Force -Path $pausePath | Out-Null
    $paused=$true
    if($config) {
        $workerMutex=New-Object Threading.Mutex($false,"Local\FeedXPrintBridge-$($config.DeviceId)")
        try {$held=$workerMutex.WaitOne(95000)} catch [Threading.AbandonedMutexException] {$held=$true}
        if(!$held){Show-Notice 'The bridge is still busy. Wait for the current print and try again.';return}
        $session=Read-BridgeState $sessionPath
        if($action -ne 'Reauthorize' -and $session -and [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -ge [long]$session.expires_at-120){
            $session=Invoke-BridgeAuth $config.PublicKey @{refresh_token=$session.refresh_token} 'refresh_token'
            $session | Add-Member -NotePropertyName expires_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$session.expires_in) -Force
            Save-BridgeState $sessionPath $session
        }
    } else {$session=$null}
    if(!$config -or $action -eq 'Reauthorize') {
        $key=(Invoke-RestMethod "$web/api/factory-print-bridge-config" -MaximumRedirection 0 -TimeoutSec 15).publishableKey
        $email=Read-Field 'Sign in as the authorized FeedX Staging operator. Enter your email.'
        $password=Read-Field 'Enter your FeedX Staging password.' -Password
        try {$newSession=Invoke-BridgeAuth $key @{email=$email;password=$password} 'password'} finally {$password=$null}
        # Legacy configs stored the owner in the existing DPAPI session.
        $owner=if($config -and $config.PSObject.Properties['Owner']) {$config.Owner} elseif($session) {$session.user.id} else {$null}
        if($owner -and $owner -ne $newSession.user.id){
            Show-Notice 'Sign in as the original bridge operator to preserve this device and its recovery history.'
            return
        }
        $session=$newSession
        $session|Add-Member -NotePropertyName expires_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$session.expires_in) -Force
        if(!$config){$config=[pscustomobject]@{ProjectRef='ujkzdaaadnvcfayuldmh';DeviceId=[guid]::NewGuid().ToString();Name=$env:COMPUTERNAME}}
        $config|Add-Member -NotePropertyName PublicKey -NotePropertyValue $key -Force
        $config|Add-Member -NotePropertyName Owner -NotePropertyValue $session.user.id -Force
    }
    if(!$session){Show-Notice 'Use Reauthorize to restore your FeedX sign-in.';return}
    if($action -eq 'Test / Review Calibration'){
        if(!$config.PSObject.Properties['GuidedSetup']){
            Show-Notice 'Use Connect / Configure to record the printer stock before running a guided test.'
            return
        }
        Run-Calibration $config $session
    } elseif($action -eq 'Connect / Configure'){
        if(Test-Path -LiteralPath $calibrationPath){Show-Notice 'Review the previous calibration before changing printer or media.';return}
        if($config.PSObject.Properties['Printer']){Confirm-Idle $config $session}
        $discovered=@(Get-BridgePrinters | Select-Object -First 75)
        if(!$discovered.Count){Show-Notice 'Install a supported Windows printer queue first.';return}
        $legacy=$config.PSObject.Properties['Printer']
        $prior=if($legacy){$config.Printer}else{''}
        $name=Read-Field 'Choose a Windows printer queue.' $prior -Options @($discovered.Name)
        $transport=Read-Field 'Choose Windows Driver, or RAW TSPL for a verified compatible queue.' -Options @('Windows Driver','RAW TSPL')
        $transport=if($transport -eq 'RAW TSPL'){'tspl'}else{'spooler'}
        $printer=$discovered | Where-Object {$_.Name -ceq $name} | Select-Object -First 1
        if($printer.WorkOffline -or $printer.PrinterStatus -in @(6,7)){Show-Notice 'Selected printer is offline. Check its connection and retry.';return}
        $width=Read-Number 'Stock width in millimetres.' 80 20 120
        $height=Read-Number 'Stock length in the feed direction in millimetres.' 90 20 200
        $gap=if($transport -eq 'tspl'){Read-Number 'Stock gap in millimetres.' 2 0 10}else{0}
        Show-Notice 'Load stock in portrait orientation. Windows Driver uses the configured stock and gap settings. RAW TSPL uses direction 1.'
        $invert=if($legacy){$config.TsplInvert}else{$true}
        $settings=@{Printer=$name;Transport=$transport;GapMm=$gap;TsplInvert=$invert;StockWidthMm=$width;StockHeightMm=$height;GuidedSetup=$true}
        $same=$config.PSObject.Properties['Calibrated'] -and $config.Calibrated
        foreach($k in $settings.Keys){if(!$config.PSObject.Properties[$k] -or $config.$k -ne $settings[$k]){$same=$false}}
        foreach($k in $settings.Keys){$config|Add-Member -NotePropertyName $k -NotePropertyValue $settings[$k] -Force}
        $config|Add-Member -NotePropertyName Calibrated -NotePropertyValue ([bool]$same) -Force
        Save-BridgeState $sessionPath $session
        Save-Configuration $config
        Register-Computer $config $session
        Show-Notice 'Printer registered. Open Test / Review Calibration when ready to send a test.'
    } else {
        Register-Computer $config $session
        Save-BridgeState $sessionPath $session
        Save-Configuration $config
        Show-Notice 'Computer reauthorized. Printer, device identity and recovery evidence were preserved.'
    }
} catch [OperationCanceledException] {
} catch {
    Show-Notice 'Setup could not finish. Check the printer, network, and FeedX sign-in. Open the setup app to retry.'
} finally {
    if($held){$workerMutex.ReleaseMutex()}
    if($workerMutex){$workerMutex.Dispose()}
    if($paused){
        Remove-Item -LiteralPath $pausePath -ErrorAction SilentlyContinue
        if(Test-Path -LiteralPath $configPath){
            try {Start-Worker} catch {Show-Notice 'Windows could not start the bridge. Use Printer Setup to retry, or check Task Scheduler.'}
        }
    }
    $setupMutex.ReleaseMutex();$setupMutex.Dispose()
}
