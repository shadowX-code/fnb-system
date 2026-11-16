#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
. (Join-Path $PSScriptRoot 'device.ps1')
. (Join-Path $PSScriptRoot 'permission-review.ps1')

$form = [Windows.Forms.Form]::new()
$form.Text = 'FeedX AutoCount Connector'
$form.ClientSize = [Drawing.Size]::new(640,650)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.Font = [Drawing.Font]::new('Segoe UI',10)
function Add-Control($Control,[int]$X,[int]$Y,[int]$Width,[int]$Height,[string]$Text) {
    $Control.Location = [Drawing.Point]::new($X,$Y)
    $Control.Size = [Drawing.Size]::new($Width,$Height)
    $Control.Text = $Text
    $form.Controls.Add($Control)
    return $Control
}
function Add-Label([int]$Y,[string]$Text,[int]$Height=25) {
    return Add-Control ([Windows.Forms.Label]::new()) 20 $Y 595 $Height $Text
}
function Register-ConnectorSchedule {
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $worker = Join-Path $PSScriptRoot 'worker.ps1'
    $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$worker+'"')
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $user),
                  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)))
    $null = Register-ScheduledTask -TaskName 'FeedX AutoCount Connector' -Action $action -Principal $principal -Settings $settings -Trigger $triggers -Force
}
function Run-UiAction([scriptblock]$Action,[string]$Area='Device setup') {
    try {
        $form.UseWaitCursor = $true
        & $Action
    } catch {
        $failure = $_.Exception
        $stage = $null
        while ($failure) {
            if ($failure.Data['FeedXStage']) { $stage = $failure.Data['FeedXStage']; break }
            if (-not $failure.InnerException) { break }
            $failure = $failure.InnerException
        }
        $code = if ($failure.Message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $failure.Message } elseif ($failure -is [Data.SqlClient.SqlException]) { 'SQL_ERROR_'+$failure.Number } else { 'SETUP_FAILED' }
        $reason = switch -Regex ($code) {
            '^STAGING_HTTP_401$' { 'The pairing code expired, was used, or this computer was revoked. Generate a fresh code in Windows.'; break }
            '^DEVICE_REGISTRATION_INACTIVE$' { 'FeedX did not confirm an active pairing for this computer. Review device access in FeedX.'; break }
            '^AUTHORIZED_WINDOWS_SYSADMIN_REQUIRED$|^SQL_ERROR_(51001|18456|229)$' { 'Ask the SQL administrator to run this action under the Windows account that has both SQL admin access and the saved reader.'; break }
            '^READER_REVIEW_CREDENTIAL_MISSING$' { 'Use the Windows account that saved the reader for this book, or begin book authorization first.'; break }
            '^READER_REVIEW_TARGET_UNSUPPORTED$' { 'This permission review is available for AED_TEST on A2006.'; break }
            '^READER_REPAIR_STATE_CHANGED$' { 'The reader or its permissions changed. Diagnose again before reviewing a repair.'; break }
            '^READER_REPAIR_VERIFICATION_FAILED$' { 'The permission could not be verified after repair. The change was rolled back.'; break }
            '^SQL_ERROR_5100[234]$|^READER_REVIEW_INCOMPLETE$' { 'The administrator review could not verify the selected reader and object. Ask your SQL administrator to review the local setup.'; break }
            '^SQL_AUTHENTICATION_NOT_ENABLED$' { 'This SQL Server does not allow SQL reader accounts. Ask your SQL administrator to review its authentication mode.'; break }
            '^BOOK_COMPANY_|^MAPPING_|^ACCOUNTING_' { 'The selected database could not be verified as a supported AutoCount Account Book.'; break }
            '^OTHER_DATABASE_ACCESS_|^READER_|^PROVISIONED_READER_' { 'The reader permissions could not be verified. Ask your SQL administrator to review the selected instance.'; break }
            '^STAGING_HTTPS_' { 'FeedX Staging is unreachable. Check the network connection on this computer.'; break }
            default { 'The operation could not finish. Check SQL Server access and try again.' }
        }
        $message.Text = $reason
        $file = switch ($Area) {
            'Book authorization' { 'authorization-summary.json' }
            'Permission review' { 'permission-review.json' }
            default { 'device-setup.json' }
        }
        $details = $failure.Data['FeedXPermissionDetails']
        $report = @{state='Failed';stage=$stage;code=$code;details=$details;finishedAt=[datetime]::UtcNow.ToString('o')}
        Write-LocalTextAtomically (Join-Path $deviceRoot $file) ($report | ConvertTo-Json -Depth 6)
        Refresh-Diagnostics
    } finally { $form.UseWaitCursor = $false }
}
$products = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*AutoCount*Accounting*' } | Select-Object -ExpandProperty DisplayName -Unique)
$description = if ($products.Count) { '1. Authorize an Account Book | '+$products[0] } else { '1. Find and authorize each Account Book' }
$null = Add-Label 20 $description
$instances = Add-Control ([Windows.Forms.ComboBox]::new()) 20 54 260 28 ''
$instances.AccessibleName = 'Local SQL instance'
$instances.DropDownStyle = 'DropDownList'
$instances.Items.AddRange([object[]](Get-LocalSqlInstances))
if ($instances.Items.Contains('A2006')) { $instances.SelectedItem = 'A2006' } else { $instances.SelectedIndex = 0 }
$scan = Add-Control ([Windows.Forms.Button]::new()) 300 51 315 32 'Find accessible databases'
$books = Add-Control ([Windows.Forms.ComboBox]::new()) 20 98 260 28 ''
$books.AccessibleName = 'Database candidate'
$books.DropDownStyle = 'DropDownList'
$authorize = Add-Control ([Windows.Forms.Button]::new()) 300 95 315 32 'Review and authorize selected book'
$null = Add-Label 137 'First posting date for this book'
$date = Add-Control ([Windows.Forms.DateTimePicker]::new()) 20 165 260 28 ''
$date.AccessibleName = 'First posting date'
$date.Format = 'Short'
$date.MinDate = [datetime]'2000-01-01'
$date.MaxDate = [datetime]::Today
$date.Value = [datetime]::Today.AddDays(-7)
$diagnose = Add-Control ([Windows.Forms.Button]::new()) 300 162 153 32 'Diagnose Permissions'
$reviewRepair = Add-Control ([Windows.Forms.Button]::new()) 461 162 154 32 'Review && Repair'
$diagnose.Enabled = $false
$reviewRepair.Enabled = $false
$null = Add-Label 220 '2. Pair this computer. You can pair before book authorization is complete.'
$pair = Add-Control ([Windows.Forms.Button]::new()) 20 248 185 32 'Generate pairing code'
$codeBox = Add-Control ([Windows.Forms.TextBox]::new()) 220 251 185 28 ''
$codeBox.AccessibleName = 'Pairing code'
$codeBox.ReadOnly = $true
$open = Add-Control ([Windows.Forms.Button]::new()) 420 248 195 32 'Open FeedX Staging'
$null = Add-Label 290 'Enter the code in FeedX and confirm this computer. Codes expire in 15 minutes.'
$null = Add-Label 320 '3. Match each authorized book to a Legal Entity in FeedX and connect.'
$test = Add-Control ([Windows.Forms.Button]::new()) 20 355 185 32 'Test Connection'
$syncNow = Add-Control ([Windows.Forms.Button]::new()) 220 355 185 32 'Sync Now'
$copyDiagnostics = Add-Control ([Windows.Forms.Button]::new()) 420 355 195 32 'Copy diagnostics'
$message = Add-Label 395 'Authorize and connect a book before running its connection test or sync.' 55
$null = Add-Label 450 'Diagnostics'
$diagnostics = Add-Control ([Windows.Forms.TextBox]::new()) 20 477 595 150 ''
$diagnostics.AccessibleName = 'Connector diagnostics'
$diagnostics.Multiline = $true
$diagnostics.ReadOnly = $true
$diagnostics.ScrollBars = 'Vertical'
$script:job = $null

function Read-ConnectorReport([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        try { return [IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { return $null }
    }
}
function Format-ConnectorTime([string]$Value) {
    if (-not $Value) { return 'time unavailable' }
    try { return [datetimeoffset]::Parse($Value).LocalDateTime.ToString('g') } catch { return 'time unavailable' }
}
function Get-DiagnosticHint([string]$Code) {
    switch -Regex ($Code) {
        '^AUTHORIZED_WINDOWS_SYSADMIN_REQUIRED$|^SQL_ERROR_(51001|18456|229)$' { return 'Use the Windows account that has both SQL administrator access and the saved reader.' }
        '^READER_REPAIR_STATE_CHANGED$' { return 'Diagnose permissions again before attempting repair.' }
        '^READER_REPAIR_VERIFICATION_FAILED$' { return 'The approved change was rolled back because verification failed.' }
        '^READER_REVIEW_CREDENTIAL_MISSING$|^SQL_ERROR_5100[234]$' { return 'Verify the saved reader and selected book with your SQL administrator.' }
        '^DEVICE_REGISTRATION_INACTIVE$' { return 'Review this computer''s device access in FeedX.' }
        '^DEVICE_NOT_PAIRED$|^STAGING_HTTP_401$' { return 'Check pairing and book binding in FeedX.' }
        '^STAGING_HTTPS_|^STAGING_HTTP_5' { return 'Check network access to FeedX Staging.' }
        '^upload_date_format$' { return 'The posting date format was rejected. Update the connector and retry the queued upload.' }
        '^upload_envelope$' { return 'FeedX rejected the dataset, date range, or batch envelope. Share these diagnostics with FeedX support.' }
        '^upload_record_shape$' { return 'FeedX rejected the row count or required fields. Share these diagnostics with FeedX support.' }
        '^upload_record_values$' { return 'FeedX rejected a field value or duplicate source key. Share these diagnostics with FeedX support.' }
        '^upload_request_conflict$' { return 'FeedX already has this request ID with different content. Keep the queue and contact FeedX support.' }
        '^STAGING_QUEUE_ENVELOPE_INVALID$' { return 'The saved upload envelope is invalid. Keep the queue and contact FeedX support.' }
        '^STAGING_HTTP_4|^STAGING_RECEIPT_' { return 'Check the book binding in FeedX. Queued uploads are kept for retry.' }
        '^READER_OTHER_DATABASE_ACCESS_OR_UNKNOWN$' { return 'Ask your SQL administrator to check for unintended reader access outside this book.' }
        '^READER_DATABASE_INVENTORY_UNVERIFIED$' { return 'Ask your SQL administrator to verify database metadata visibility for this reader.' }
        '^READER_PERMISSION_OUTSIDE_APPROVED_OBJECTS$|^READER_SCHEMA_PERMISSION_TOO_BROAD$|^READER_PROFILE_PERMISSION_TOO_BROAD$' { return 'Share Copy diagnostics with your SQL administrator. Review the reported effective permission and matching grant scope before changing any access.' }
        '^READER_PENDING_IDENTITY_MISMATCH$' { return 'Ask your SQL administrator to review the pending reader identity. The connector did not replace it.' }
        '^READER_DISABLE_FAILED' { return 'Ask your SQL administrator to review and disable the pending reader before retrying.' }
        '^SQL_ERROR_18456$' { return 'Ask your SQL administrator to check SQL authentication and reader sign-in.' }
        '^ACCOUNTING_SCOPE_EXCEEDS' { return 'The posting scope exceeds the connector limit. Contact FeedX support.' }
        '^SQL_|^READER_|^PROVISIONED_READER_|^BOOK_COMPANY_|^ACCOUNTING_' { return 'Ask your SQL administrator to review the authorized book and reader.' }
        default { return 'Retry when other connector work finishes. Contact FeedX support if this persists.' }
    }
}
function Refresh-Diagnostics {
    $lines = @()
    $deviceSetup = Read-ConnectorReport (Join-Path $deviceRoot 'device-setup.json')
    $lines += if ($deviceSetup) { "Device setup: $($deviceSetup.state) $($deviceSetup.code)" } else { 'Device setup: not tested' }
    $authorization = Read-ConnectorReport (Join-Path $deviceRoot 'authorization-summary.json')
    if ($authorization) {
        $lines += "Book authorization: $($authorization.state) ($(Format-ConnectorTime $authorization.finishedAt))"
        if ($authorization.code) {
            $lines += "$($authorization.stage): $($authorization.code). $(Get-DiagnosticHint $authorization.code)"
        }
        if ($authorization.details) { $lines += ($authorization.details | ConvertTo-Json -Depth 6 -Compress) }
    } else {
        $legacy = Join-Path $deviceRoot 'setup-status.txt'
        if (Test-Path -LiteralPath $legacy) {
            $legacyCode = [IO.File]::ReadAllText($legacy).Trim()
            if ($legacyCode -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $lines += "Previous setup: $legacyCode. $(Get-DiagnosticHint $legacyCode)" }
        }
    }
    $permissions = Read-ConnectorReport (Join-Path $deviceRoot 'permission-review.json')
    if ($permissions) {
        $lines += "Permission review: $($permissions.state) ($(Format-ConnectorTime $permissions.finishedAt))"
        if ($permissions.code) { $lines += "$($permissions.code). $(Get-DiagnosticHint $permissions.code)" }
        $lines += @($permissions.lines | Where-Object { $_ })
    }
    $testReport = Read-ConnectorReport (Join-Path $deviceRoot 'test-summary.json')
    if ($testReport) {
        $lines += if ($testReport.paired) { 'Device check-in: Paired' } else { 'Device check-in: Unverified' }
        if ($testReport.catalogChecked) { $lines += "Cloud binding: $($testReport.bound) authorized and bound books" }
    }
    $lines += @(foreach ($operation in @(@('Connection test','test-summary.json'),@('Sync','sync-summary.json'))) {
        $result = Read-ConnectorReport (Join-Path $deviceRoot $operation[1])
        if (-not $result) { continue }
        $when = Format-ConnectorTime $result.finishedAt
        if ($result.error) { "$($operation[0]): $($result.error) ($when). $(Get-DiagnosticHint $result.error)" }
        elseif (-not $result.attempted) { "$($operation[0]): FeedX pairing verified. Connect an authorized book in Finance. ($when)" }
        else { "$($operation[0]): $($result.passed) of $($result.attempted) books passed. ($when)" }
    })
    foreach ($folder in @(Get-ChildItem -LiteralPath $deviceRoot -Directory | Where-Object Name -cmatch '^[a-f0-9]{64}$')) {
        $book = Read-ConnectorReport (Join-Path $folder.FullName 'book.json')
        if ($book.database -cnotmatch '^[A-Z][A-Z0-9_]{0,63}$') { continue }
        $authorized = $book.authorized -ne $false -and (Test-Path -LiteralPath (Join-Path $folder.FullName 'reader.credential.xml'))
        $authorizationLabel = if ($authorized) { 'Authorized on Windows' } else { 'Authorization Required' }
        $lines += "$($book.database): $authorizationLabel"
        if (-not $authorized) { continue }
        $checked = Read-ConnectorReport (Join-Path $folder.FullName 'connection-test.json')
        if ($checked) {
            $lines += "  Last test ($(Format-ConnectorTime $checked.finishedAt)): SQL $($checked.sqlConnection); FeedX $($checked.stagingConnection)."
            if ($checked.error) { $lines += "  $($checked.error). $(Get-DiagnosticHint $checked.error)" }
        }
        $synced = Read-ConnectorReport (Join-Path $folder.FullName 'status.json')
        if ($synced) {
            $accepted = 0
            foreach ($receipt in $synced.receipts) { $accepted += $receipt.rows }
            $extracted = 0
            foreach ($dataset in (@($synced.extracted)+@($synced.replayed))) { $extracted += $dataset.rows }
            $when = Format-ConnectorTime $synced.finishedAt
            $pending = if ($null -ne $synced.pending) { $synced.pending } else { 'not yet reported' }
            $lines += "  Sync ($when): $extracted source rows (includes retries); $accepted accepted; $pending pending."
            if ($synced.failedUpload) {
                $failed = $synced.failedUpload
                $hint = if ($failed.reason) { Get-DiagnosticHint $failed.reason } else { Get-DiagnosticHint $synced.error }
                $lines += "  Rejected $($failed.dataset) batch $($failed.requestId), $($failed.rows) source rows ($($synced.error)). $hint"
            } elseif ($synced.error) { $lines += "  $($synced.error). $(Get-DiagnosticHint $synced.error)" }
            foreach ($receipt in @($synced.receipts | Where-Object repairedScopeDate)) {
                $lines += "  Recovered queued $($receipt.dataset) batch $($receipt.requestId). $($receipt.rows) accepted rows; duplicate receipt: $($receipt.duplicate)."
            }
        }
    }
    $text = if ($lines.Count) { $lines -join [Environment]::NewLine } else { 'No connection test or sync has been recorded on this computer.' }
    if ($diagnostics.Text -cne $text) { $diagnostics.Text = $text }
}
function Start-ConnectorJob([string]$Switch,[string]$Label) {
    $worker = Join-Path $PSScriptRoot 'worker.ps1'
    $script:job = Start-Process (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$worker+'" '+$Switch) -PassThru
    $test.Enabled = $false
    $syncNow.Enabled = $false
    $message.Text = "$Label in progress..."
}
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 2000
$timer.Add_Tick({
    if ($script:job -and $script:job.HasExited) {
        $message.Text = if ($script:job.ExitCode -eq 0) { 'Operation finished. See diagnostics for the result.' } else { 'Operation needs attention. See diagnostics for the result.' }
        $script:job.Dispose()
        $script:job = $null
        $test.Enabled = $true
        $syncNow.Enabled = $true
    }
    Refresh-Diagnostics
})
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose(); if ($script:job) { $script:job.Dispose() } })
$timer.Start()
Refresh-Diagnostics

$open.Add_Click({ Start-Process 'https://fnb-system-staging.vercel.app/finance/data-sources' })
$copyDiagnostics.Add_Click({ Run-UiAction { [Windows.Forms.Clipboard]::SetText($diagnostics.Text); $message.Text = 'Diagnostics copied.' } })
$pair.Add_Click({
    Run-UiAction {
        $credential = Get-DeviceCredential -Create
        try {
            $codeBox.Clear()
            $pairing = Request-DevicePairing $credential $env:COMPUTERNAME
            if ($pairing.state -ceq 'Paired') {
                $message.Text = 'This computer is already paired. Use Test Connection to send any newly authorized books.'
            } else {
                $codeBox.Text = $pairing.code -replace '(.{4})(?=.)','$1-'
                $message.Text = "Computer: $env:COMPUTERNAME. Enter the code in FeedX, then use Test Connection to send authorized books."
            }
            $report = @{state=$pairing.state;finishedAt=[datetime]::UtcNow.ToString('o')}
            Write-LocalTextAtomically (Join-Path $deviceRoot 'device-setup.json') ($report | ConvertTo-Json -Compress)
            Register-ConnectorSchedule
        } finally { $credential.Password.Dispose() }
    }
})
$scan.Add_Click({
    Run-UiAction {
        $books.Items.Clear()
        $master = Open-LocalBook $instances.SelectedItem 'master'
        try {
            $names = @(Invoke-ReadQuery $master "SELECT TOP (200) name FROM sys.databases WHERE database_id>4 AND state_desc='ONLINE' AND HAS_DBACCESS(name)=1 ORDER BY name")
            foreach ($item in $names) { if ($item.name -cmatch '^[A-Z][A-Z0-9_]{0,63}$') { $null = $books.Items.Add($item.name) } }
        } finally { $master.Dispose() }
        if ($books.Items.Contains('AED_TEST')) { $books.SelectedItem = 'AED_TEST' }
        $message.Text = 'Select the database you explicitly want to inspect. Discovery has read SQL instance metadata only.'
    }
})
$instances.Add_SelectedIndexChanged({ $books.Items.Clear() })
$books.Add_SelectedIndexChanged({
    $diagnose.Enabled = $instances.SelectedItem -ieq 'A2006' -and $books.SelectedItem -ceq 'AED_TEST'
    $reviewRepair.Enabled = $false
})
function Save-AuthorizedBookReport {
    $report = @{state='Authorized';finishedAt=[datetime]::UtcNow.ToString('o')}
    Write-LocalTextAtomically (Join-Path $deviceRoot 'authorization-summary.json') ($report | ConvertTo-Json -Compress)
}
function Show-DeptPermissionReview([switch]$Repair) {
    $reviewRepair.Enabled = $false
    $instance = [string]$instances.SelectedItem
    $database = [string]$books.SelectedItem
    $confirm = if ($Repair) {{
        param($Statement)
        [Windows.Forms.MessageBox]::Show($form,"Review the proposed change for A2006 / AED_TEST. This revokes one direct SELECT grant from the saved FeedX reader, then attempts normal authorization by reopening the saved reader with its existing credential.`r`n`r`n$Statement`r`n`r`nApply this change?",'Confirm SQL reader repair','YesNo','Warning','Button2') -eq 'Yes'
    }}
    $result = Invoke-DeptPermissionReview $instance $database $confirm
    $report = @{state=if ($result.repaired) { 'Direct grant removed' } else { 'Reviewed' }
                lines=$result.lines;finishedAt=[datetime]::UtcNow.ToString('o')}
    Write-LocalTextAtomically (Join-Path $deviceRoot 'permission-review.json') ($report | ConvertTo-Json -Depth 4)
    $reviewRepair.Enabled = [bool]$result.repairable
    $message.Text = if ($result.repairable) { 'One direct grant is eligible for review. See diagnostics.' } else { 'Permission review complete. See diagnostics for the next step.' }
    Refresh-Diagnostics
    if ($result.repaired) {
        Run-UiAction {
            $null = Authorize-LocalBook $instance $database $result.startDate { $true } -ExpectedBookKey $result.bookKey -ExpectedReader $result.reader
            Save-AuthorizedBookReport
            $message.Text = 'Reader reverified. Run Test Connection to send the authorized book to FeedX.'
            Refresh-Diagnostics
        } 'Book authorization'
    }
}
$diagnose.Add_Click({ Run-UiAction { Show-DeptPermissionReview } 'Permission review' })
$reviewRepair.Add_Click({ Run-UiAction { Show-DeptPermissionReview -Repair } 'Permission review' })

$authorize.Add_Click({
    Run-UiAction {
        $database = [string]$books.SelectedItem
        if (-not $database) { $message.Text = 'Select the Account Book database you want to authorize.'; return }
        if ([Windows.Forms.MessageBox]::Show($form,"Read the company identity of $database on $($instances.SelectedItem)?",'Review Account Book','YesNo','Question') -ne 'Yes') { return }
        $startDate = $date.Value.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
        $approved = Authorize-LocalBook $instances.SelectedItem $database $startDate {
            param($Company)
            return [Windows.Forms.MessageBox]::Show($form,"Authorize FeedX to read $Company ($database)? This may create a reader for accounts in this book, journals, departments, projects and company identity. Confirm your SQL monitoring masks generated login passwords.",'Approve read-only access','YesNo','Warning') -eq 'Yes'
        }
        if (-not $approved) { return }
        Save-AuthorizedBookReport
        $reviewRepair.Enabled = $false
        $message.Text = 'Book authorization saved. If already paired, use Test Connection to send the book to FeedX.'
        Refresh-Diagnostics
    } 'Book authorization'
})
$test.Add_Click({ Run-UiAction { Start-ConnectorJob '-TestConnection' 'Connection test' } })
$syncNow.Add_Click({ Run-UiAction { Start-ConnectorJob '-RunNow' 'Sync' } })
$form.Add_Shown({
    if (Test-Path -LiteralPath $deviceCredentialPath) {
        Run-UiAction {
            $credential = Get-DeviceCredential
            try {
                try { Confirm-ActiveDevicePairing $credential }
                catch {
                    if ($_.Exception.GetBaseException().Message -ne 'STAGING_HTTP_401') { throw }
                    $message.Text = 'Computer awaiting pairing confirmation. Generate a new code if needed.'
                    return
                }
                Write-LocalTextAtomically (Join-Path $deviceRoot 'device-setup.json') '{"state":"Paired"}'
                Register-ConnectorSchedule
                $message.Text = 'This computer is paired. Use Test Connection to check in and send any newly authorized books.'
            } finally { $credential.Password.Dispose() }
        }
    }
})
[void]$form.ShowDialog()
