#requires -Version 5.1
param([switch]$RunNow,[switch]$TestConnection)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'device.ps1')

$statusPath = Join-Path $deviceRoot $(if ($TestConnection) { 'test-summary.json' } else { 'sync-summary.json' })
$summary = [ordered]@{state='Running';paired=$false;attempted=0;passed=0;error=$null}
$credential = $null
$failed = $false
try {
    if (-not (Test-Path -LiteralPath $deviceCredentialPath)) {
        if ($TestConnection -or $RunNow) { Stop-ReadPoc 'DEVICE_NOT_PAIRED' }
        return
    }
    $credential = Get-DeviceCredential
    $state = Invoke-DeviceAction $credential @{p_action='books'}
    $summary.paired = $true
    $localBooks = @(Get-AuthorizedLocalBooks)
    $published = $false
    foreach ($book in $localBooks) {
        if (@($state.books | Where-Object { $_.bookId -ceq $book.bookId -and $_.ready }).Count) { continue }
        try {
            $remote = Invoke-DeviceAction $credential @{
                p_action='discover';p_book_key=$book.key;p_book=$book.database;p_company=$book.company
            }
            if ($remote.bookId -cnotmatch '^[a-f0-9-]{36}$') { Stop-ReadPoc 'BOOK_DISCOVERY_RESPONSE_INVALID' }
            $book.bookId = $remote.bookId
            $path = Join-Path (Join-Path $deviceRoot $book.key) 'book.json'
            Write-LocalTextAtomically $path ($book | ConvertTo-Json -Depth 4)
            $published = $true
        } catch {
            $failed = $true
            $message = $_.Exception.GetBaseException().Message
            $summary.error = if ($message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $message } else { 'BOOK_DISCOVERY_FAILED' }
        }
    }
    if ($published) { $state = Invoke-DeviceAction $credential @{p_action='books'} }
    foreach ($record in $state.books) {
        if (-not $record.ready -or -not $record.bound) { continue }
        $lastSync = if ($record.lastSyncAt) { [datetimeoffset]::Parse($record.lastSyncAt) }
        $book = @($localBooks | Where-Object bookId -CEQ $record.bookId)
        if ($book.Count -ne 1) { continue }
        if (-not $TestConnection -and -not $RunNow) {
            $checkpoint = Join-Path (Join-Path $deviceRoot $book[0].key) 'config.json'
            $today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow,'Singapore Standard Time').ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
            $caughtUp = (Test-Path -LiteralPath $checkpoint) -and
                (([IO.File]::ReadAllText($checkpoint) | ConvertFrom-Json).nextDate -gt $today)
            if ($caughtUp -and -not $record.requested -and -not $record.needsRetry -and $lastSync -and $lastSync -gt [datetimeoffset]::UtcNow.AddDays(-1)) { continue }
        }
        $summary.attempted++
        try {
            & (Join-Path $PSScriptRoot '..\sync.ps1') -InstalledBook $book[0] -ExpectedBinding $record.connectionId -ConnectionTest:$TestConnection
            $summary.passed++
        } catch {
            $failed = $true
            $message = $_.Exception.GetBaseException().Message
            $summary.error = if ($message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $message } else { 'BOOK_OPERATION_FAILED' }
        }
    }
} catch {
    $failed = $true
    $message = $_.Exception.GetBaseException().Message
    if ($message -cnotmatch '^[A-Z][A-Z0-9_]{4,95}$') { $message = 'CONNECTOR_CHECK_FAILED' }
    $summary.error = if (-not $summary.paired -and $message -eq 'STAGING_HTTP_401') { 'DEVICE_NOT_PAIRED' } else { $message }
} finally {
    if ($credential) { $credential.Password.Dispose() }
    $summary.state = if ($failed) { 'Failed' } elseif ($summary.attempted) { 'Complete' } else { 'No eligible books' }
    $summary.finishedAt = [datetime]::UtcNow.ToString('o')
    # Keep the last observed sync result when the background poll has no work.
    if ($TestConnection -or $RunNow -or $summary.attempted -or $failed) {
        Write-LocalTextAtomically $statusPath ($summary | ConvertTo-Json -Compress)
    }
}
if ($failed) { exit 1 }
