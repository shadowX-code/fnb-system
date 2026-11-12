#requires -Version 5.1
[CmdletBinding()]
param([switch]$Setup,[switch]$ReEnroll,[switch]$ConnectionTest,[switch]$Schedule,[switch]$ProvisionReader,[string]$ReplayFrom,$InstalledBook,[string]$ExpectedBinding)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data
. (Join-Path $PSScriptRoot 'sql\sql-read.ps1')
. (Join-Path $PSScriptRoot 'sql\connection.ps1')
. (Join-Path $PSScriptRoot 'common\credentials.ps1')
. (Join-Path $PSScriptRoot 'common\accounting-read.ps1')
. (Join-Path $PSScriptRoot 'provisioning.ps1')

$sqlPrivate = Get-RunLocalPath 'sql\private' -BaseDirectory $PSScriptRoot
if ($InstalledBook) {
    . (Join-Path $PSScriptRoot 'installer\device.ps1')
    if ($InstalledBook.key -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedBinding -notmatch '^[a-f0-9-]{36}$') { Stop-ReadPoc 'INSTALLED_BINDING_INVALID' }
}
$private = if ($InstalledBook) { Get-RunLocalPath $InstalledBook.key -BaseDirectory $deviceRoot } else {
    Get-RunLocalPath 'private\sync' -BaseDirectory $PSScriptRoot
}
$queue = Get-RunLocalPath 'queue' -BaseDirectory $private
$null = [IO.Directory]::CreateDirectory($queue)
$null = [IO.Directory]::CreateDirectory($sqlPrivate)
$configPath = Join-Path $private 'config.json'
$credentialPath = Join-Path $private 'staging.credential.xml'
$pendingCredential = Join-Path $private 'staging.pending.credential.xml'
$reportName = if ($InstalledBook -and $ConnectionTest) { 'connection-test.json' } else { 'status.json' }
$reportPath = Join-Path $private $reportName
$lock = [IO.File]::Open((Join-Path $private 'sync.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$connection = $null
$reader = $null
$saveReader = $false
$cloud = $null
$runId = $null
$status = [ordered]@{target=if ($InstalledBook) { $InstalledBook.database } else { 'AED_TEST' };startedAt=[datetime]::UtcNow.ToString('o');sqlConnection='Not tested';stagingConnection='Not tested';extracted=@();receipts=@();reconciled='Not verified';nativeReports='Blocked pending supported no-upgrade SDK startup and native read contracts'}

function Parse-SyncDate([string]$Text) {
    return [datetime]::ParseExact($Text,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
}
function Format-SyncDate([datetime]$Day) {
    return $Day.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
}
function Request-FeedX($Credential,[string]$Body) {
    if ($InstalledBook) {
        return Invoke-DeviceApi $Credential 'finance_accept_accounting_snapshot' $Body $InstalledBook
    }
    $headers = @{apikey=$Credential.UserName;'x-feedx-connector'=$Credential.GetNetworkCredential().Password;'x-feedx-source-book'=$identity.book}
    try {
        return Invoke-RestMethod -Uri 'https://ujkzdaaadnvcfayuldmh.supabase.co/rest/v1/rpc/finance_accept_accounting_snapshot' -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($Body)) -TimeoutSec 35 -MaximumRedirection 0
    } catch {
        $response = $_.Exception.Response
        if ($response) { Stop-ReadPoc ('STAGING_HTTP_'+[int]$response.StatusCode) }
        Stop-ReadPoc 'STAGING_HTTPS_UNAVAILABLE'
    }
}
function Report-SyncProgress([string]$State,[string]$ErrorKind) {
    $pending = @(Get-ChildItem -LiteralPath $queue -File -Filter '*.json').Count
    $sourceRows = 0
    foreach ($dataset in $status.extracted) { $sourceRows += $dataset.rows }
    $progress = @{runId=$runId;state=$State;pending=$pending;sourceRows=$sourceRows}
    if ($ErrorKind) { $progress.error=$ErrorKind }
    $body = @{p_progress=$progress} | ConvertTo-Json -Compress
    $result = Request-FeedX $cloud $body
    if ($result.state -cne 'Recorded') { Stop-ReadPoc 'STAGING_PROGRESS_RESPONSE_INVALID' }
}

function Send-PendingSnapshots($Credential,[string]$ConnectionId) {
    foreach ($file in @(Get-ChildItem -LiteralPath $queue -File -Filter '*.json' | Sort-Object Name)) {
        $body = [IO.File]::ReadAllText($file.FullName)
        $snapshot = $body | ConvertFrom-Json
        $receipt = Request-FeedX $Credential $body
        if ($receipt.state -cne 'Accepted' -or $receipt.connectionId -cne $ConnectionId -or
            $receipt.requestId -cne $snapshot.p_request_id -or $receipt.acceptedRows -ne $snapshot.p_rows.Count -or
            $receipt.snapshotId -lt 1) { Stop-ReadPoc 'STAGING_RECEIPT_MISMATCH' }
        $status.receipts += @{dataset=$snapshot.p_dataset;date=$snapshot.p_scope_date;rows=$receipt.acceptedRows;duplicate=$receipt.duplicate;snapshotId=$receipt.snapshotId;uploaded='Confirmed';accepted='Confirmed'}
        Write-LocalTextAtomically $reportPath ($status | ConvertTo-Json -Depth 8)
        [IO.File]::Delete($file.FullName)
    }
}
function Submit-Snapshot([string]$Dataset,[datetime]$Day) {
    $rows = @(Read-AccountingScope $connection $plan $Dataset $Day)
    $scopeDate = if ($Dataset -eq 'GL') { Format-SyncDate $Day }
    $status.extracted += @{dataset=$Dataset;date=$scopeDate;rows=$rows.Count}
    $id = [guid]::NewGuid().ToString()
    $payload = @{p_request_id=$id;p_dataset=$Dataset;p_scope_date=$scopeDate;p_rows=$rows} | ConvertTo-Json -Depth 8 -Compress
    $path = Get-RunLocalPath ($id+'.json') -BaseDirectory $queue
    Write-LocalTextAtomically $path $payload -CreateNew
    Send-PendingSnapshots $cloud $config.connectionId
}

try {
    $today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow,'Singapore Standard Time').Date
    if ($InstalledBook) {
        $cloud = Get-DeviceCredential
        if (-not $ConnectionTest) {
            if (-not (Test-Path -LiteralPath $configPath)) {
                Write-LocalTextAtomically $configPath (@{startDate=$InstalledBook.startDate;nextDate=$InstalledBook.startDate;connectionId=$ExpectedBinding} | ConvertTo-Json) -CreateNew
            }
            $config = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
            if ($config.connectionId -cne $ExpectedBinding) { Stop-ReadPoc 'STAGING_BINDING_CHANGED' }
        }
        $reader = Import-Clixml -LiteralPath (Join-Path $private 'reader.credential.xml')
        if ($reader -isnot [Management.Automation.PSCredential] -or $reader.UserName -cnotmatch '^feedx_ro_[a-f0-9]{32}$') { Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH' }
        $script:ProvisionedLogin = $reader.UserName
        $connection = Open-LocalBook $InstalledBook.instance $InstalledBook.database $reader
        $identity = Assert-ReadIdentity $connection $InstalledBook.database (Get-InstanceIdentity $InstalledBook.instance)
        $plan = Get-BookReaderPlan $connection $identity $InstalledBook.database
        $observed = Read-BookCompany $connection $InstalledBook.database
        if ($observed.key -cne $InstalledBook.key) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
        $status.sqlConnection = 'Connected'
        $connectionStatus = Request-FeedX $cloud '{}'
        if ($connectionStatus.state -cne 'Connected' -or $connectionStatus.connectionId -cne $ExpectedBinding) { Stop-ReadPoc 'STAGING_CONNECTION_RESPONSE_INVALID' }
        $status.stagingConnection = 'Connected'
        if ($ConnectionTest) { return }
    } else {
    $selectedCredential = if ($ReEnroll) { $pendingCredential } else { $credentialPath }
    if ($Setup -and -not (Test-Path -LiteralPath $selectedCredential)) {
        $apiKey = if ($ReEnroll -and (Test-Path -LiteralPath $credentialPath)) {
            (Import-Clixml -LiteralPath $credentialPath).UserName
        } else { Read-Host 'Staging Supabase publishable key (sb_publishable_...)' }
        if ($apiKey -cnotmatch '^sb_publishable_[A-Za-z0-9_-]{15,100}$') { Stop-ReadPoc 'STAGING_PUBLISHABLE_KEY_REQUIRED' }
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes); $token = ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant() }
        finally { [Array]::Clear($bytes,0,$bytes.Length); $rng.Dispose() }
        $cloud = [pscredential]::new($apiKey,(ConvertTo-SecureString $token -AsPlainText -Force))
        Save-ConnectorCredential $selectedCredential $cloud
        $token = $null
    }
    if ($ProvisionReader -and -not (Test-Path -LiteralPath (Join-Path $sqlPrivate 'read-sql.credential.xml'))) {
        $provisioned = Invoke-ProvisionAedReader $sqlPrivate $null -AccountingSync
        $provisioned.credential.Password.Dispose()
    }
    if (-not (Test-Path -LiteralPath $selectedCredential)) { Stop-ReadPoc 'RUN_GUIDED_SETUP_FIRST' }
    if (-not $cloud) { $cloud = Import-Clixml -LiteralPath $selectedCredential }
    if ($Setup) {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cloud.GetNetworkCredential().Password)))).Replace('-','').ToLowerInvariant() }
        finally { $sha.Dispose() }
        Write-Host ('Give the Staging administrator this enrollment fingerprint: '+$hash)
        if (-not (Test-Path -LiteralPath $configPath)) {
            $start = Parse-SyncDate (Read-Host 'First AED_TEST posting date to sync (yyyy-MM-dd)')
            if ($start -lt [datetime]'2000-01-01' -or $start -gt $today) { Stop-ReadPoc 'SYNC_START_DATE_INVALID' }
            $initial = @{startDate=(Format-SyncDate $start);nextDate=(Format-SyncDate $start);connectionId=$null}
            Write-LocalTextAtomically $configPath ($initial | ConvertTo-Json) -CreateNew
        }
        $null = Read-Host 'Press Enter when the administrator has registered this fingerprint and verified the test entity binding'
    }
    if (-not (Test-Path -LiteralPath $configPath)) { Stop-ReadPoc 'RUN_GUIDED_SETUP_FIRST' }
    $config = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
    $readerFile = Join-Path $sqlPrivate 'read-sql.credential.xml'
    if (Test-Path -LiteralPath $readerFile) {
        $reader = Import-Clixml -LiteralPath $readerFile
    } elseif ($Setup) {
        $reader = Get-Credential -UserName 'feedx_aed_test_reader' -Message 'Use the administrator-approved AED_TEST-only SQL reader'
        $saveReader = $true
    } else { Stop-ReadPoc 'PROVISION_OR_INSTALL_AED_TEST_READER_CREDENTIAL' }
    if ($reader -isnot [Management.Automation.PSCredential] -or $reader.UserName -cne 'feedx_aed_test_reader') { Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH' }
    $connection = Open-ProvisionedReader $reader.Password
    $identity = Assert-ReadIdentity $connection
    Assert-ReadPermissions $connection $identity
    $plan = Get-AccountingReadPlan (Get-ReadCatalog $connection)
    $inventoryVisible = Invoke-ReadQuery $connection "SELECT HAS_PERMS_BY_NAME(NULL,NULL,'VIEW ANY DATABASE') AS allowed"
    if ($inventoryVisible.allowed -ne 1) { Stop-ReadPoc 'READER_DATABASE_INVENTORY_UNVERIFIED' }
    $inventory = @(Invoke-ReadQuery $connection "SELECT name,state_desc,user_access_desc FROM sys.databases WHERE database_id > 4 AND name <> 'AED_TEST'")
    if (@($inventory | Where-Object { $_.state_desc -ne 'ONLINE' -or $_.user_access_desc -ne 'MULTI_USER' }).Count) {
        Stop-ReadPoc 'OTHER_DATABASE_ACCESS_CANNOT_BE_VERIFIED'
    }
    $databases = @($inventory | ForEach-Object name)
    Assert-ProvisionedReader $connection $identity @{names=@($plan.Values | ForEach-Object { $_.table.name })} $databases
    if ($saveReader) { Save-ConnectorCredential $readerFile $reader }
    $status.sqlConnection = 'Connected'
    $connectionStatus = Request-FeedX $cloud '{}'
    if ($connectionStatus.state -cne 'Connected' -or $connectionStatus.connectionId -notmatch '^[0-9a-f-]{36}$') { Stop-ReadPoc 'STAGING_CONNECTION_RESPONSE_INVALID' }
    if ($config.connectionId -and $config.connectionId -cne $connectionStatus.connectionId) { Stop-ReadPoc 'STAGING_BINDING_CHANGED' }
    $config.connectionId = $connectionStatus.connectionId
    Write-LocalTextAtomically $configPath ($config | ConvertTo-Json)
    $status.stagingConnection = 'Connected'
    if ($ReEnroll) {
        Save-ConnectorCredential $credentialPath $cloud
        [IO.File]::Delete($pendingCredential)
    }
    if ($Schedule) {
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'start.ps1')+'" -SyncNow')
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
        $triggers = @((New-ScheduledTaskTrigger -Daily -At '04:00'),(New-ScheduledTaskTrigger -AtLogOn -User $user))
        $null = Register-ScheduledTask -TaskName 'FeedX AutoCount AED_TEST' -Action $action -Principal $principal -Settings $settings -Trigger $triggers -Force
        $status.schedule = 'Registered for the current Windows user'
    }
    if ($ConnectionTest -or $Setup -or $Schedule) { return }
    }

    $start = Parse-SyncDate $config.startDate
    $next = Parse-SyncDate $config.nextDate
    if ($next -lt $start -or $next -gt $today.AddDays(1)) { Stop-ReadPoc 'SYNC_CHECKPOINT_INVALID' }
    $replay = $null
    if ($ReplayFrom) {
        $replay = Parse-SyncDate $ReplayFrom
        if ($replay -lt $start -or $replay -lt $today.AddDays(-30) -or $replay -gt $today) { Stop-ReadPoc 'REPLAY_DATE_OUTSIDE_CONFIGURED_WINDOW' }
    }
    $runId = [guid]::NewGuid().ToString()
    Report-SyncProgress 'running'
    Send-PendingSnapshots $cloud $config.connectionId
    foreach ($kind in @('COA','Department','Project')) { Submit-Snapshot $kind $today }

    # Retry prior days for late edits and capture at most seven new days per run.
    $dates = [Collections.Generic.SortedSet[datetime]]::new()
    $tail = $today.AddDays(-6)
    if ($next -le $today) {
        for ($day=$next; $day -le $today -and $day -lt $next.AddDays(7); $day=$day.AddDays(1)) { $null = $dates.Add($day) }
    }
    if ($replay) { $tail = $replay }
    for ($day=$tail; $day -le $today -and $day -lt $next; $day=$day.AddDays(1)) {
        if ($day -ge $start) { $null = $dates.Add($day) }
    }
    foreach ($day in $dates) {
        Submit-Snapshot 'GL' $day
        if ($day -eq (Parse-SyncDate $config.nextDate)) {
            $config.nextDate = Format-SyncDate ($day.AddDays(1))
            Write-LocalTextAtomically $configPath ($config | ConvertTo-Json)
        }
    }
    $status.nextGlDate = $config.nextDate
    Report-SyncProgress 'succeeded'
} catch {
    $failure = $_.Exception.GetBaseException()
    $status.error = if ($failure.Message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $failure.Message } elseif ($failure -is [Data.SqlClient.SqlException]) { 'SQL_ERROR_'+$failure.Number } else { 'LOCAL_SYNC_ERROR' }
    if ($InstalledBook -and -not $ConnectionTest -and -not $runId -and $cloud -and $status.sqlConnection -ne 'Connected') {
        try { $null = Invoke-DeviceAction $cloud @{p_action='source_error';p_book_key=$InstalledBook.key} }
        catch { $status.progressReport = 'Not delivered' }
    }
    if ($runId) {
        $errorKind = switch -Regex ($status.error) {
            'SCOPE_EXCEEDS' { 'scope_limit'; break }
            '^SQL_ERROR_|^ACCOUNTING_' { 'source_read'; break }
            '^STAGING_HTTP_4' { 'upload_rejected'; break }
            '^STAGING_HTTP_5|HTTPS_UNAVAILABLE' { 'network'; break }
            'RECEIPT_MISMATCH' { 'receipt'; break }
            default { 'local' }
        }
        try { Report-SyncProgress 'failed' $errorKind }
        catch { $status.progressReport = 'Not delivered' }
    }
    $status.failureType = $failure.GetType().FullName
    $status.line = $_.InvocationInfo.ScriptLineNumber
    throw [InvalidOperationException]::new($status.error)
} finally {
    if ($connection) { $connection.Dispose() }
    if ($reader -is [Management.Automation.PSCredential]) { $reader.Password.Dispose() }
    if ($cloud -is [Management.Automation.PSCredential]) { $cloud.Password.Dispose() }
    try {
        $status.finishedAt = [datetime]::UtcNow.ToString('o')
        $status.pending = @(Get-ChildItem -LiteralPath $queue -File -Filter '*.json').Count
        Write-LocalTextAtomically $reportPath ($status | ConvertTo-Json -Depth 8)
        Write-Host ('Sync diagnostics: '+$reportPath)
    } finally { $lock.Dispose() }
}
