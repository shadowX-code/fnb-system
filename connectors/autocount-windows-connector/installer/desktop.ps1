#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
. (Join-Path $PSScriptRoot 'device.ps1')

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
function Run-UiAction([scriptblock]$Action) {
    try {
        $form.UseWaitCursor = $true
        & $Action
    } catch {
        $failure = $_.Exception.GetBaseException()
        $reason = switch -Regex ($failure.Message) {
            '^STAGING_HTTP_401$' { 'The pairing code expired, was used, or this computer was revoked. Generate a fresh code in Windows.'; break }
            '^STAGING_HTTP_409$' { 'This computer is already registered. Open FeedX to review its connection.'; break }
            '^AUTHORIZED_WINDOWS_SYSADMIN_REQUIRED$' { 'Sign in to Windows as an authorized SQL Server administrator to approve this book.'; break }
            '^SQL_AUTHENTICATION_NOT_ENABLED$' { 'This SQL Server does not allow SQL reader accounts. Ask your SQL administrator to review its authentication mode.'; break }
            '^BOOK_COMPANY_|^MAPPING_|^ACCOUNTING_' { 'The selected database could not be verified as a supported AutoCount Account Book.'; break }
            '^OTHER_DATABASE_ACCESS_|^READER_|^PROVISIONED_READER_' { 'The reader permissions could not be verified. Ask your SQL administrator to review the selected instance.'; break }
            '^STAGING_HTTPS_' { 'FeedX Staging is unreachable. Check the network connection on this computer.'; break }
            default { 'The operation could not finish. Check SQL Server access and try again.' }
        }
        $message.Text = $reason
        $code = if ($failure.Message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $failure.Message } elseif ($failure -is [Data.SqlClient.SqlException]) { 'SQL_ERROR_'+$failure.Number } else { 'SETUP_FAILED' }
        Write-LocalTextAtomically (Join-Path $deviceRoot 'setup-status.txt') $code
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
$null = Add-Label 220 '2. Generate a pairing code for this computer'
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
        '^DEVICE_NOT_PAIRED$|^STAGING_HTTP_401$' { return 'Check pairing and book binding in FeedX.' }
        '^STAGING_HTTPS_|^STAGING_HTTP_5' { return 'Check network access to FeedX Staging.' }
        '^STAGING_HTTP_4|^STAGING_RECEIPT_' { return 'Check the book binding in FeedX. Queued uploads are kept for retry.' }
        '^ACCOUNTING_SCOPE_EXCEEDS' { return 'The posting scope exceeds the connector limit. Contact FeedX support.' }
        '^SQL_|^READER_|^PROVISIONED_READER_|^BOOK_COMPANY_|^ACCOUNTING_' { return 'Ask your SQL administrator to review the authorized book and reader.' }
        default { return 'Retry when other connector work finishes. Contact FeedX support if this persists.' }
    }
}
function Refresh-Diagnostics {
    $lines = @(foreach ($operation in @(@('Connection test','test-summary.json'),@('Sync','sync-summary.json'))) {
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
        $lines += $book.database
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
            foreach ($dataset in $synced.extracted) { $extracted += $dataset.rows }
            $when = Format-ConnectorTime $synced.finishedAt
            $pending = if ($null -ne $synced.pending) { $synced.pending } else { 'not yet reported' }
            $lines += "  Sync ($when): $extracted extracted; $accepted accepted (includes retries); $pending pending."
            if ($synced.error) { $lines += "  $($synced.error). $(Get-DiagnosticHint $synced.error)" }
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
        if (-not @(Get-AuthorizedLocalBooks).Count) {
            $message.Text = 'Authorize an Account Book on this computer first.'
            return
        }
        $credential = Get-DeviceCredential -Create
        try {
            $pairing = Invoke-DeviceAction $credential @{p_action='issue';p_company=$env:COMPUTERNAME}
            if ($pairing.code -cnotmatch '^[A-F0-9]{16}$') { Stop-ReadPoc 'PAIRING_RESPONSE_INVALID' }
            $codeBox.Text = $pairing.code -replace '(.{4})(?=.)','$1-'
            $message.Text = "Computer: $env:COMPUTERNAME. Enter the code in FeedX, then use Test Connection to send authorized books."
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
$authorize.Add_Click({
    Run-UiAction {
        $database = [string]$books.SelectedItem
        if (-not $database) { $message.Text = 'Select the Account Book database you want to authorize.'; return }
        if ([Windows.Forms.MessageBox]::Show($form,"Read the company identity of $database on $($instances.SelectedItem)?",'Review Account Book','YesNo','Question') -ne 'Yes') { return }
        $book = Authorize-LocalBook $instances.SelectedItem $database {
            param($Company)
            return [Windows.Forms.MessageBox]::Show($form,"Authorize FeedX to read $Company ($database)? This creates a reader for accounts in this book, journals, departments, projects and company identity. Confirm your SQL monitoring masks generated login passwords.",'Approve read-only access','YesNo','Warning') -eq 'Yes'
        }
        if (-not $book) { return }
        $path = Join-Path $book.root 'book.json'
        $existing = Read-ConnectorReport $path
        $book.bookId = $existing.bookId
        $book.startDate = if ($existing) { $existing.startDate } else { $date.Value.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture) }
        $book.Remove('root')
        Write-LocalTextAtomically $path ($book | ConvertTo-Json -Depth 4)
        $message.Text = 'Book authorization saved on this computer. Generate a pairing code if needed. If already paired, use Test Connection to send the book to FeedX.'
        Refresh-Diagnostics
    }
})
$test.Add_Click({ Run-UiAction { Start-ConnectorJob '-TestConnection' 'Connection test' } })
$syncNow.Add_Click({ Run-UiAction { Start-ConnectorJob '-RunNow' 'Sync' } })
$form.Add_Shown({
    if (Test-Path -LiteralPath $deviceCredentialPath) {
        Run-UiAction {
            $credential = Get-DeviceCredential
            try {
                try { $null = Invoke-DeviceAction $credential @{p_action='books'} }
                catch {
                    if ($_.Exception.GetBaseException().Message -ne 'STAGING_HTTP_401') { throw }
                    $message.Text = 'Computer awaiting pairing confirmation. Generate a new code if needed.'
                    return
                }
                Register-ConnectorSchedule
                $message.Text = 'This computer is paired. Use Test Connection to check in and send any newly authorized books.'
            } finally { $credential.Password.Dispose() }
        }
    }
})
[void]$form.ShowDialog()
