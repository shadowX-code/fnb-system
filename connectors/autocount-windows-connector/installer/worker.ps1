#requires -Version 5.1
param([switch]$RunNow,[switch]$TestConnection)
$ErrorActionPreference = 'Stop'
$workerLock=$null
$credential=$null
$failed=$false
$summary=[ordered]@{state='Running';stage='Startup';startedAt=[datetime]::UtcNow.ToString('o');paired=$false
    bound=0;catalogChecked=$false;attempted=0;passed=0;error=$null;books=@();historical=@()}
try {
    . (Join-Path $PSScriptRoot 'device.ps1')
    . (Join-Path $PSScriptRoot 'scheduler.ps1')
    $summary.stage='Worker lock'
    try {
        $workerLock=[IO.File]::Open((Join-Path $deviceRoot 'worker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    } catch [IO.IOException] {
        # Only a sharing/lock violation means another worker owns this report.
        if (($_.Exception.HResult -band 0xffff) -in @(32,33)) { return }
        throw
    }
    if (-not (Test-Path -LiteralPath $deviceCredentialPath)) {
        if ($TestConnection -or $RunNow) { Stop-ReadPoc 'DEVICE_NOT_PAIRED' }
        return
    }
    $summary.stage='Saved device credential'
    $credential=Get-DeviceCredential
    $summary.stage='Cloud check-in'
    $schedule=$null
    try { $schedule=Get-ConnectorSchedule } catch { $summary.scheduleError=Get-ConnectorFailure $_ }
    if ($schedule -and $schedule.mode -in @('unattended','signed_in','disabled','missing')) {
        try { $state=Invoke-DeviceAction $credential @{p_background_mode=$schedule.mode;p_next_poll_at=$schedule.nextPollAt} }
        catch { $state=Invoke-DeviceAction $credential @{p_action='books'} }
    } else { $state=Invoke-DeviceAction $credential @{p_action='books'} }
    $summary.paired=$true
    $summary.stage='Current Account Book identity'
    $resolved=Resolve-LocalConnectorBooks @(Get-LocalConnectorBooks)
    $localBooks=@($resolved.books)
    $summary.historical=@($resolved.historical)
    foreach ($issue in @($resolved.failures)) {
        $failed=$true
        $summary.error=$issue.failure.code
        $summary.books+=@{key=$issue.key;bookId=$issue.bookId;stage=$summary.stage;state='Blocked';failure=$issue.failure}
        if (@($state.books | Where-Object { $_.bookId -ceq $issue.bookId -and $_.bound }).Count) {
            $sourceCode=switch -Regex ($issue.failure.code) {
                '^SQL_ERROR_(18456|4060)$' { 'source_login'; break }
                '^SQL_ERROR_(-2|2|26|40|53|17142)$' { 'source_unreachable'; break }
                '^READER_|^PROVISIONED_READER_|^SQL_IDENTITY_|^SQL_PERMISSION_|^SQL_ERROR_229$' { 'source_permissions'; break }
                '^BOOK_|^CURRENT_BOOK_' { 'source_schema'; break }
                default { 'source_read' }
            }
            try { $null=Invoke-DeviceAction $credential @{p_action='source_error';p_book_key=$issue.key;p_code=$sourceCode} }
            catch { $summary.sourceErrorReport=Get-ConnectorFailure $_ }
        }
    }
    # Historical identities retain their bindings, queues and history, but cannot read today's database.
    foreach ($old in @($resolved.historical)) {
        if (@($state.books | Where-Object { $_.bookId -ceq $old.bookId -and $_.bound }).Count) {
            try { $null=Invoke-DeviceAction $credential @{p_action='source_error';p_book_key=$old.key;p_code='source_schema'} }
            catch { $summary.sourceErrorReport=Get-ConnectorFailure $_ }
        }
    }
    $published=$false
    $summary.stage='Current book publication'
    foreach ($book in $localBooks) {
        if (@($state.books | Where-Object { $_.bookId -ceq $book.bookId -and $_.ready -eq $book.authorized }).Count) { continue }
        $authorizationLock=$null
        try {
            $root=Get-RunLocalPath $book.key -BaseDirectory $deviceRoot
            $authorizationLock=[IO.File]::Open((Join-Path $root 'authorization.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
            $current=[IO.File]::ReadAllText((Join-Path $root 'book.json')) | ConvertFrom-Json
            $currentAuthorized=$current.authorized -ne $false -and (Test-Path -LiteralPath (Join-Path $root 'reader.credential.xml'))
            if ($current.key -cne $book.key -or $currentAuthorized -ne $book.authorized -or $current.bookId -cne $book.bookId) { Stop-ReadPoc 'BOOK_LOCAL_AUTHORIZATION_CHANGED' }
            $action=if ($book.authorized) { 'discover' } else { 'authorization_required' }
            $remote=Invoke-DeviceAction $credential @{p_action=$action;p_book_key=$book.key;p_book=$book.database;p_company=$book.company}
            if ($remote.bookId -cnotmatch '^[a-f0-9-]{36}$') { Stop-ReadPoc 'BOOK_DISCOVERY_RESPONSE_INVALID' }
            $book.bookId=$remote.bookId
            Write-LocalTextAtomically (Join-Path $root 'book.json') ($book | ConvertTo-Json -Depth 4)
            $published=$true
        } catch {
            $failed=$true
            $failure=Get-ConnectorFailure $_
            $summary.error=$failure.code
            $summary.books+=@{key=$book.key;bookId=$book.bookId;stage=$summary.stage;state='Failed';failure=$failure}
        } finally { if ($authorizationLock) { $authorizationLock.Dispose() } }
    }
    if ($published) { $state=Invoke-DeviceAction $credential @{p_action='books'} }
    $summary.catalogChecked=$true
    $summary.stage='Bound book synchronization'
    foreach ($book in $localBooks) {
        if (-not $book.authorized) { continue }
        $records=@($state.books | Where-Object { $_.bookId -ceq $book.bookId -and $_.ready -and $_.bound })
        if ($records.Count -ne 1) {
            $summary.books+=@{key=$book.key;bookId=$book.bookId;state='Binding required';code='CURRENT_BOOK_BINDING_REQUIRED'}
            continue
        }
        $record=$records[0]
        $summary.bound++
        try {
            $lastSync=$null
            if ($record.lastSyncAt -is [datetime] -or $record.lastSyncAt -is [datetimeoffset]) { $lastSync=[datetimeoffset]$record.lastSyncAt }
            elseif ($record.lastSyncAt) { $lastSync=[datetimeoffset]::Parse([string]$record.lastSyncAt,[Globalization.CultureInfo]::InvariantCulture) }
            if (-not $TestConnection -and -not $RunNow) {
                $bookDirectory=Get-RunLocalPath $book.key -BaseDirectory $deviceRoot
                $pending=@(Get-ChildItem -LiteralPath (Join-Path $bookDirectory 'queue') -File -Filter '*.json' -ErrorAction SilentlyContinue).Count -gt 0
                if (-not $pending -and -not $record.requested -and -not $record.needsRetry -and $lastSync -and $lastSync -gt [datetimeoffset]::UtcNow.AddDays(-1)) {
                    $coverage=Get-CloudGlPlan $credential $book $record.connectionId $book.startDate
                    if ($coverage.remainingDays -eq 0) {
                        $summary.books+=@{key=$book.key;bookId=$book.bookId;state='Up to date'}
                        continue
                    }
                }
            }
            $summary.attempted++
            & (Join-Path $PSScriptRoot '..\sync.ps1') -InstalledBook $book -ExpectedBinding $record.connectionId -ConnectionTest:$TestConnection
            $summary.passed++
            $summary.books+=@{key=$book.key;bookId=$book.bookId;state=if ($TestConnection) { 'Connection verified' } else { 'Complete' }}
        } catch {
            $failed=$true
            $failure=Get-ConnectorFailure $_
            $summary.error=$failure.code
            $summary.books+=@{key=$book.key;bookId=$book.bookId;stage=$summary.stage;state='Failed';failure=$failure}
        }
    }
} catch {
    $failed=$true
    if (Get-Command Get-ConnectorFailure -ErrorAction SilentlyContinue) { $failure=Get-ConnectorFailure $_ }
    else { $failure=@{code='WORKER_STARTUP_FAILED';failureType=$_.Exception.GetType().FullName;line=$_.InvocationInfo.ScriptLineNumber} }
    $summary.failure=$failure
    $summary.error=if (-not $summary.paired -and $failure.code -ceq 'STAGING_HTTP_401') { 'DEVICE_NOT_PAIRED' } else { $failure.code }
} finally {
    if ($credential -is [Management.Automation.PSCredential]) { $credential.Password.Dispose() }
    $summary.state=if ($failed) { 'Failed' } elseif ($summary.attempted) { 'Complete' } elseif (@($summary.books | Where-Object state -EQ 'Binding required').Count) { 'Binding required' } else { 'No work due' }
    $summary.finishedAt=[datetime]::UtcNow.ToString('o')
    if ($workerLock) {
        try {
            Write-LocalTextAtomically (Join-Path $deviceRoot 'poll-summary.json') ($summary | ConvertTo-Json -Depth 8 -Compress)
            if ($TestConnection -or $RunNow -or $summary.attempted -or $failed) {
                $statusPath=Join-Path $deviceRoot $(if ($TestConnection) { 'test-summary.json' } else { 'sync-summary.json' })
                Write-LocalTextAtomically $statusPath ($summary | ConvertTo-Json -Depth 8 -Compress)
            }
        } finally { $workerLock.Dispose() }
    } elseif ($failed) {
        # The installed helpers may have failed to load. Save only sanitized startup evidence.
        $root=Join-Path $env:LOCALAPPDATA 'FeedX\AutoCountConnector'
        if (Test-Path -LiteralPath $root -PathType Container) {
            [IO.File]::WriteAllText((Join-Path $root 'worker-startup-error.json'),($summary | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        }
    }
}
if ($failed) { exit 1 }
exit 0
