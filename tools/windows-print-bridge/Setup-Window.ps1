# The setup window uses the same worker and protected local state as guided setup.
function Get-WindowPrinters {
    $choices=[Collections.Specialized.OrderedDictionary]::new()
    foreach($id in @(Get-BridgeD520Devices)) {
        $choices["D520 Bluetooth · $($id.Substring($id.Length-4))"]=@{Name='D520 (Bluetooth)';Address=$id;Transport='tspl'}
    }
    foreach($queue in @(Get-BridgePrinters | Select-Object -First 75)) {
        $choices["$($queue.Name) · Windows Driver"]=@{Name=$queue.Name;Address='';Transport='spooler'}
        $choices["$($queue.Name) · RAW TSPL"]=@{Name=$queue.Name;Address='';Transport='tspl'}
    }
    return $choices
}
function Read-WindowSession {
    $script:setupStage='Restore FeedX sign-in'
    $session=Read-BridgeState $sessionPath
    if(!$session){throw 'Use Authorize again to restore FeedX sign-in.'}
    if([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -ge [long]$session.expires_at-120){
        $session=Invoke-BridgeAuth $script:config.PublicKey @{refresh_token=$session.refresh_token} 'refresh_token'
        $session | Add-Member -NotePropertyName expires_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$session.expires_in) -Force
        Save-BridgeState $sessionPath $session
    }
    $session
}
function Use-SetupWorkerLock([scriptblock]$Action) {
    New-Item -ItemType File -Force -Path $pausePath | Out-Null
    $gate=$null
    $held=$false
    try {
        if($script:config -and (Test-Path -LiteralPath $configPath)){
            $gate=New-Object Threading.Mutex($false,"Local\FeedXPrintBridge-$($script:config.DeviceId)")
            $limit=[Diagnostics.Stopwatch]::StartNew()
            try {
                do {
                    $held=$gate.WaitOne(250)
                    [Windows.Forms.Application]::DoEvents()
                } while(!$held -and !$script:windowForm.IsDisposed -and $limit.Elapsed.TotalSeconds -lt 95)
            } catch [Threading.AbandonedMutexException] {$held=$true}
            if(!$held){throw 'The Bridge is busy. Wait for the current print.'}
        }
        & $Action
    } finally {
        if($held){$gate.ReleaseMutex()}
        if($gate){$gate.Dispose()}
        Remove-Item -LiteralPath $pausePath -ErrorAction SilentlyContinue
        if(Test-Path -LiteralPath $configPath){Start-Worker}
    }
}
function Request-BrowserAuthorization {
    $script:setupStage='Load FeedX sign-in settings'
    $key=(Invoke-RestMethod "$web/api/factory-print-bridge-config" -MaximumRedirection 0 -TimeoutSec 15).publishableKey
    $script:setupStage='Sign in to FeedX'
    if(!('FeedXBrowserAuthorization' -as [type])){Add-Type -Path "$PSScriptRoot\BrowserAuthorization.cs"}
    $html=Get-Content -LiteralPath "$PSScriptRoot\Setup-Authorization.html" -Raw -Encoding UTF8
    $listener=[FeedXBrowserAuthorization]::new($html,$key,'https://ujkzdaaadnvcfayuldmh.supabase.co','Staging')
    try {
        Show-Notice 'Complete authorization in your browser.'
        Start-Process $listener.LaunchUrl
        $timer=[Diagnostics.Stopwatch]::StartNew()
        do {
            [Windows.Forms.Application]::DoEvents()
            if($script:windowForm.IsDisposed){throw [OperationCanceledException]::new()}
            $result=$listener.Poll()
            if($result){break}
            Start-Sleep -Milliseconds 100
        } while($timer.Elapsed.TotalSeconds -lt 180)
    } finally {$listener.Dispose()}
    if(!$result){throw 'Browser authorization expired. Try Authorize again.'}
    $session=$result|ConvertFrom-Json
    if(!$session.access_token -or !$session.refresh_token -or !$session.user.id -or
       $session.expires_in -lt 1 -or $session.expires_in -gt 86400){throw 'Invalid FeedX authorization.'}
    $session | Add-Member -NotePropertyName expires_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$session.expires_in)
    $owner=if($script:config -and $script:config.PSObject.Properties['Owner']){$script:config.Owner}
        elseif($script:config){$prior=Read-BridgeState $sessionPath;if($prior){$prior.user.id}}
    if($owner -and $owner -ne $session.user.id){throw 'Authorize as the original Bridge operator.'}
    if(!$script:config){$script:config=[pscustomobject]@{ProjectRef='ujkzdaaadnvcfayuldmh';DeviceId=(Get-PendingDeviceId);Name=$env:COMPUTERNAME}}
    $script:config | Add-Member -NotePropertyName PublicKey -NotePropertyValue $key -Force
    $script:config | Add-Member -NotePropertyName Owner -NotePropertyValue $session.user.id -Force
    if($script:config.PSObject.Properties['Printer']){
        Use-SetupWorkerLock { Save-RegisteredConfiguration $script:config $session }
        Refresh-WindowPrinter
    } else {
        $script:setupSession=$session
        $script:editing=$true
        Rescan-WindowPrinters
    }
}
function Rescan-WindowPrinters {
    $script:setupStage='Find paired D520'
    $script:choices=Get-WindowPrinters
    $script:printerChoice.Items.Clear()
    foreach($printerName in $script:choices.Keys){[void]$script:printerChoice.Items.Add($printerName)}
    if($script:printerChoice.Items.Count -eq 1){$script:printerChoice.SelectedIndex=0}
    if($script:config -and $script:config.PSObject.Properties['Printer']){
        $currentAddress=Get-BridgeBluetoothAddress $script:config
        foreach($item in $script:choices.Keys){
            $option=$script:choices[$item]
            if($option.Name -eq $script:config.Printer -and $option.Transport -eq $script:config.Transport -and $option.Address -eq [string]$currentAddress){
                $script:printerChoice.SelectedItem=$item
                break
            }
        }
    }
    Show-Notice $(if($script:choices.Count){'Select your printer and stock.'}else{'Pair the D520 or install a printer queue, then rescan.'})
}
function Connect-WindowPrinter {
    if(!$script:printerChoice.SelectedItem){Show-Notice 'Select a printer first.';return}
    $choice=$script:choices[$script:printerChoice.SelectedItem]
    $script:setupStage='Read label stock dimensions'
    $settings=@{Printer=$choice.Name;Transport=$choice.Transport;BluetoothAddress=$choice.Address
        StockWidthMm=(Read-Number 'Width' $script:widthBox.Text 20 120)
        StockHeightMm=(Read-Number 'Length' $script:heightBox.Text 20 200)
        GapMm=if($choice.Transport -eq 'tspl'){Read-Number 'Gap' $script:gapBox.Text 0 10}else{0}
        GuidedSetup=$true;TsplInvert=$true}
    Use-SetupWorkerLock {
        $session=if($script:setupSession){$script:setupSession}else{Read-WindowSession}
        if($script:config.PSObject.Properties['Printer']){Confirm-Idle $script:config $session}
        if(Test-Path -LiteralPath $calibrationPath){throw 'Review the previous calibration first.'}
        $same=$script:config.PSObject.Properties['Calibrated'] -and $script:config.Calibrated
        foreach($key in $settings.Keys){
            $prior=if($script:config.PSObject.Properties[$key]){$script:config.$key}
                elseif($key -eq 'BluetoothAddress'){''}
            if($prior -ne $settings[$key]){$same=$false}
            $script:config | Add-Member -NotePropertyName $key -NotePropertyValue $settings[$key] -Force
        }
        $script:config | Add-Member -NotePropertyName Calibrated -NotePropertyValue ([bool]$same) -Force
        Save-RegisteredConfiguration $script:config $session
    }
    $script:setupSession=$null
    $script:editing=$false
    Refresh-WindowPrinter
}
function Refresh-WindowPrinter {
    $script:connectionVerified=$false
    $script:setupStage='Check Windows background task'
    $installedWorker=Get-Content -LiteralPath (Join-Path $root 'worker-version.txt') -ErrorAction SilentlyContinue
    $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if($task -and $task.State -eq 'Running' -and $installedWorker -ne '1.3.0'){Use-SetupWorkerLock {}}
    elseif(!$task -or $task.State -ne 'Running'){Start-Worker}
    $address=Get-BridgeBluetoothAddress $script:config
    if($address){
        Check-D520Connection $address
    } else {
        $script:connectionVerified=[bool](Get-BridgePrinters | Where-Object {
            $_.Name -ceq $script:config.Printer -and !$_.WorkOffline -and $_.PrinterStatus -notin @(6,7)
        } | Select-Object -First 1)
        Show-Notice $(if($script:connectionVerified){'Windows printer queue is available.'}else{'Windows printer queue is unavailable.'})
    }
}
function Update-WindowCalibration($review) {
    Use-SetupWorkerLock { Run-Calibration $script:config (Read-WindowSession) $review $true }
    Refresh-WindowPrinter
}
function Update-WindowPhase {
    $configured=$script:config -and $script:config.PSObject.Properties['Printer'] -and !$script:editing
    $reviewPending=$configured -and (Test-Path -LiteralPath $calibrationPath)
    $phase=if(!$script:config){'Authorize'}
        elseif(!$configured){'Connect Printer'}
        elseif($reviewPending){'Test Print'}
        elseif(!$script:connectionVerified){'Connect Printer'}
        elseif(!$script:config.PSObject.Properties['Calibrated'] -or !$script:config.Calibrated){'Test Print'}
        else{'Ready'}
    $script:phaseText.Text=('Install','Authorize','Connect Printer','Test Print','Ready' | ForEach-Object {
        if($_ -eq $phase){"▶ $_"}else{$_}
    }) -join '   ·   '
    $script:heading.Text=$phase
    $script:mediaPanel.Visible=$script:config -and !$configured
    $script:authorizeButton.Visible=!$script:config -or $configured
    $script:authorizeButton.Text=if($configured){'Authorize again'}else{'Authorize in browser'}
    $script:reconnectButton.Visible=$configured
    $script:changeButton.Visible=$configured -and !$reviewPending
    $script:testReady.Visible=$configured -and $script:connectionVerified -and $phase -eq 'Test Print' -and !$reviewPending
    $script:testButton.Visible=$script:testReady.Visible
    $script:passButton.Visible=$reviewPending
    $script:issueButton.Visible=$reviewPending
    $script:feedxButton.Visible=$configured
    $script:helpLabel.Text=if($reviewPending){'Inspect the physical test label and clear pending output.'}
        elseif($phase -eq 'Ready'){'Connection verified · Calibration passed'}
        elseif($configured){$script:config.Printer}else{''}
}
function Invoke-WindowAction([scriptblock]$Action) {
    if($script:windowBusy){return}
    $script:windowBusy=$true
    $script:actionsPanel.Enabled=$false
    $script:mediaPanel.Enabled=$false
    try { & $Action } catch [OperationCanceledException] {
    } catch { Show-SetupFailure $_ } finally {
        $script:windowBusy=$false
        if(!$script:windowForm.IsDisposed){
            $script:actionsPanel.Enabled=$true
            $script:mediaPanel.Enabled=$true
            Update-WindowPhase
        }
    }
}
function New-SetupButton($Text,$Handler) {
    $button=New-Object Windows.Forms.Button
    $button.AutoSize=$true
    $button.Padding=New-Object Windows.Forms.Padding(5,3,5,3)
    $button.Text=$Text
    $button.Add_Click($Handler)
    $button
}
function Show-BridgeWindow([switch]$VerifyOnly) {
    [Windows.Forms.Application]::EnableVisualStyles()
    $script:windowForm=New-Object Windows.Forms.Form
    $script:windowForm.Text=$title
    $script:windowForm.StartPosition='CenterScreen'
    $script:windowForm.ClientSize=New-Object Drawing.Size(610,460)
    $script:windowForm.MinimumSize=New-Object Drawing.Size(610,490)
    $script:windowForm.Font=New-Object Drawing.Font('Segoe UI',10)
    $content=New-Object Windows.Forms.FlowLayoutPanel
    $content.FlowDirection='TopDown';$content.WrapContents=$false;$content.Dock='Fill';$content.AutoScroll=$true
    $content.Padding=New-Object Windows.Forms.Padding(18)
    function Add-WindowLabel($Text,$FontSize){
        $label=New-Object Windows.Forms.Label
        $label.Text=$Text;$label.AutoSize=$true;$label.MaximumSize=New-Object Drawing.Size(545,0)
        $label.Font=New-Object Drawing.Font('Segoe UI',$FontSize)
        $label.Margin=New-Object Windows.Forms.Padding(2,3,2,8)
        $content.Controls.Add($label)
        $label
    }
    [void](Add-WindowLabel 'Printer Setup' 20)
    [void](Add-WindowLabel 'FeedX Staging · Bridge v1.3.0' 10)
    $script:phaseText=Add-WindowLabel '' 10
    $script:heading=Add-WindowLabel '' 15
    $script:helpLabel=Add-WindowLabel '' 10
    $script:mediaPanel=New-Object Windows.Forms.FlowLayoutPanel
    $script:mediaPanel.FlowDirection='TopDown';$script:mediaPanel.WrapContents=$false
    $script:mediaPanel.AutoSize=$true
    $script:printerChoice=New-Object Windows.Forms.ComboBox
    $script:printerChoice.DropDownStyle='DropDownList';$script:printerChoice.Width=420
    $script:mediaPanel.Controls.Add($script:printerChoice)
    $media=New-Object Windows.Forms.FlowLayoutPanel
    $media.AutoSize=$true
    foreach($item in @(@('Width (mm)','StockWidthMm','80'),@('Length (mm)','StockHeightMm','90'),@('Gap (mm)','GapMm','2'))){
        $field=New-Object Windows.Forms.Label
        $field.Text=$item[0];$field.AutoSize=$true
        $box=New-Object Windows.Forms.TextBox
        $box.Width=65
        $key=$item[1]
        $box.Text=if($script:config -and $script:config.PSObject.Properties[$key]){"$($script:config.$key)"}else{$item[2]}
        $media.Controls.AddRange(@($field,$box))
        switch($key){'StockWidthMm'{$script:widthBox=$box};'StockHeightMm'{$script:heightBox=$box};'GapMm'{$script:gapBox=$box}}
    }
    $script:mediaPanel.Controls.Add($media)
    $script:mediaPanel.Controls.Add((New-SetupButton 'Rescan printers' {Invoke-WindowAction {Rescan-WindowPrinters}}))
    $script:mediaPanel.Controls.Add((New-SetupButton 'Connect Printer' {Invoke-WindowAction {Connect-WindowPrinter}}))
    $content.Controls.Add($script:mediaPanel)
    $script:actionsPanel=New-Object Windows.Forms.FlowLayoutPanel
    $script:actionsPanel.Width=545;$script:actionsPanel.AutoSize=$true
    $script:testReady=New-Object Windows.Forms.CheckBox
    $script:testReady.AutoSize=$true
    $script:testReady.Text='Printer idle, correct stock loaded, no pending output'
    $script:authorizeButton=New-SetupButton 'Authorize in browser' {Invoke-WindowAction {Request-BrowserAuthorization}}
    $script:reconnectButton=New-SetupButton 'Reconnect' {Invoke-WindowAction {Refresh-WindowPrinter}}
    $script:changeButton=New-SetupButton 'Change printer or stock' {Invoke-WindowAction {$script:editing=$true;Rescan-WindowPrinters}}
    $script:testButton=New-SetupButton 'Send 1 TEST label' {Invoke-WindowAction {
        if(!$script:testReady.Checked){Show-Notice 'Confirm the stock and printer are ready.';return}
        $script:testReady.Checked=$false
        Update-WindowCalibration 'Review Later'
    }}
    $script:passButton=New-SetupButton 'Printed correctly' {Invoke-WindowAction {Update-WindowCalibration 'All Passed'}}
    $script:issueButton=New-SetupButton 'Inspected · Record issue' {Invoke-WindowAction {Update-WindowCalibration 'Inspected / Issue'}}
    $script:feedxButton=New-SetupButton 'Open FeedX' {Start-Process "$web/factory/settings/labels?section=printers"}
    $diagnostics=New-SetupButton 'Troubleshooting' {Invoke-WindowAction {Export-SetupDiagnostics}}
    $script:actionsPanel.Controls.AddRange(@($script:testReady,$script:testButton,$script:passButton,$script:issueButton,
        $script:authorizeButton,$script:reconnectButton,$script:changeButton,$script:feedxButton,$diagnostics))
    $content.Controls.Add($script:actionsPanel)
    $script:windowStatus=Add-WindowLabel '' 10
    $script:windowForm.Controls.Add($content)
    Update-WindowPhase
    if($VerifyOnly){
        if($script:heading.Text -ne 'Authorize' -or $script:authorizeButton.Text -ne 'Authorize in browser'){
            throw 'The clean setup window did not start at authorization.'
        }
        $script:windowForm.Dispose()
        return
    }
    $script:windowForm.Add_FormClosing({ param($sender,$eventArgs) if($script:windowBusy){$eventArgs.Cancel=$true} })
    $script:windowForm.Add_Shown({
        if($script:config -and $script:config.PSObject.Properties['Printer']){
            Invoke-WindowAction {Refresh-WindowPrinter}
        }
    })
    [void]$script:windowForm.ShowDialog()
    $script:windowForm.Dispose()
}
