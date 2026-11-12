#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
. (Join-Path $PSScriptRoot 'device.ps1')

$form = [Windows.Forms.Form]::new()
$form.Text = 'FeedX AutoCount Connector'
$form.ClientSize = [Drawing.Size]::new(640,485)
$form.MinimumSize = [Drawing.Size]::new(655,525)
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
            '^STAGING_HTTP_401$' { 'The pairing code expired, was used, or this computer was revoked. Generate a fresh code in FeedX.'; break }
            '^STAGING_HTTP_409$' { 'The code is out of date or the book belongs to another connector. Use Replace computer in FeedX.'; break }
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
$null = Add-Label 20 '1. Pair this computer with FeedX'
$open = Add-Control ([Windows.Forms.Button]::new()) 20 52 170 32 'Open FeedX Staging'
$codeBox = Add-Control ([Windows.Forms.TextBox]::new()) 203 53 227 27 ''
$codeBox.MaxLength = 20
$codeBox.AccessibleName = 'Pairing code'
$pair = Add-Control ([Windows.Forms.Button]::new()) 445 52 170 32 'Pair computer'
$null = Add-Label 90 'Generate a pairing code in Finance > Data Sources > Connect provider.'
$products = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*AutoCount*Accounting*' } | Select-Object -ExpandProperty DisplayName -Unique)
$description = if ($products.Count) { '2. Authorize an Account Book | '+$products[0] } else { '2. Find and authorize each Account Book' }
$null = Add-Label 130 $description
$instances = Add-Control ([Windows.Forms.ComboBox]::new()) 20 164 260 28 ''
$instances.AccessibleName = 'Local SQL instance'
$instances.DropDownStyle = 'DropDownList'
$instances.Items.AddRange([object[]](Get-LocalSqlInstances))
if ($instances.Items.Contains('A2006')) { $instances.SelectedItem = 'A2006' } else { $instances.SelectedIndex = 0 }
$scan = Add-Control ([Windows.Forms.Button]::new()) 300 161 315 32 'Find accessible databases'
$books = Add-Control ([Windows.Forms.ComboBox]::new()) 20 208 260 28 ''
$books.AccessibleName = 'Database candidate'
$books.DropDownStyle = 'DropDownList'
$authorize = Add-Control ([Windows.Forms.Button]::new()) 300 205 315 32 'Review and authorize selected book'
$null = Add-Label 247 'First posting date for this book'
$date = Add-Control ([Windows.Forms.DateTimePicker]::new()) 20 275 260 28 ''
$date.AccessibleName = 'First posting date'
$date.Format = 'Short'
$date.MinDate = [datetime]'2000-01-01'
$date.MaxDate = [datetime]::Today
$date.Value = [datetime]::Today.AddDays(-7)
$null = Add-Label 320 '3. Match the authorized book to a Legal Entity in FeedX.'
$syncNow = Add-Control ([Windows.Forms.Button]::new()) 20 355 220 32 'Sync approved books now'
$logs = Add-Control ([Windows.Forms.Button]::new()) 255 355 175 32 'Open local diagnostics'
$message = Add-Label 410 'The connector sends financial rows only for books authorized here and connected in FeedX.' 56

$open.Add_Click({ Start-Process 'https://fnb-system-staging.vercel.app/finance/data-sources' })
$logs.Add_Click({ Start-Process explorer.exe ('"'+$deviceRoot+'"') })
$pair.Add_Click({
    Run-UiAction {
        $code = ($codeBox.Text -replace '[-\s]','').ToUpperInvariant()
        if ($code -cnotmatch '^[A-F0-9]{16}$') { $message.Text = 'Enter the 16-character pairing code shown in FeedX.'; return }
        $credential = Get-DeviceCredential -Create
        try {
            try { $null = Invoke-DeviceAction $credential @{p_action='pair';p_code=$code} }
            catch {
                # A response may be lost after successful redemption. Check with the same credential.
                if ($_.Exception.GetBaseException().Message -ne 'STAGING_HTTPS_UNAVAILABLE') { throw }
                $null = Invoke-DeviceAction $credential @{p_action='books'}
            }
            $codeBox.Clear()
            Register-ConnectorSchedule
            $message.Text = 'Computer paired. Find and authorize the Account Book you want to connect.'
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
        $credential = Get-DeviceCredential
        try {
            $null = Invoke-DeviceAction $credential @{p_action='books'}
            if ([Windows.Forms.MessageBox]::Show($form,"Read the company identity of $database on $($instances.SelectedItem)?",'Review Account Book','YesNo','Question') -ne 'Yes') { return }
            $book = Authorize-LocalBook $instances.SelectedItem $database {
                param($Company)
                return [Windows.Forms.MessageBox]::Show($form,"Authorize FeedX to read $Company ($database)? This creates a reader for accounts in this book, journals, departments, projects and company identity. Confirm your SQL monitoring masks generated login passwords.",'Approve read-only access','YesNo','Warning') -eq 'Yes'
            }
            if (-not $book) { return }
            $remote = Invoke-DeviceAction $credential @{p_action='discover';p_book_key=$book.key;p_book=$book.database;p_company=$book.company}
            $path = Join-Path $book.root 'book.json'
            $existing = if (Test-Path -LiteralPath $path) { [IO.File]::ReadAllText($path) | ConvertFrom-Json }
            $book.bookId = $remote.bookId
            $book.startDate = if ($existing) { $existing.startDate } else { $date.Value.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture) }
            $book.Remove('root')
            Write-LocalTextAtomically $path ($book | ConvertTo-Json -Depth 4)
            $message.Text = 'Book authorized. Select its Legal Entity and click Connect in FeedX. Initial sync starts on the next background check.'
        } finally { $credential.Password.Dispose() }
    }
})
$syncNow.Add_Click({
    Run-UiAction {
        Start-Process (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'worker.ps1')+'" -RunNow')
        $message.Text = 'Sync requested for approved and bound books. Check progress in FeedX.'
    }
})
$form.Add_Shown({
    if (Test-Path -LiteralPath $deviceCredentialPath) {
        Run-UiAction {
            $credential = Get-DeviceCredential
            try {
                $null = Invoke-DeviceAction $credential @{p_action='books'}
                Register-ConnectorSchedule
                $message.Text = 'This computer is already paired. Authorize a book or open Finance to review existing connections.'
            } finally { $credential.Password.Dispose() }
        }
    }
})
[void]$form.ShowDialog()
