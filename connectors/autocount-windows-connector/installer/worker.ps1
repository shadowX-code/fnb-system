#requires -Version 5.1
param([switch]$RunNow)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'device.ps1')

if (-not (Test-Path -LiteralPath $deviceCredentialPath)) { return }
$credential = Get-DeviceCredential
$failed = $false
try {
    $state = Invoke-DeviceAction $credential @{p_action='books'}
    foreach ($record in $state.books) {
        if (-not $record.ready -or -not $record.bound) { continue }
        $lastSync = if ($record.lastSyncAt) { [datetimeoffset]::Parse($record.lastSyncAt) }
        $book = @(Get-ChildItem -LiteralPath $deviceRoot -Directory | Where-Object Name -cmatch '^[a-f0-9]{64}$' | ForEach-Object {
            $path = Join-Path $_.FullName 'book.json'
            if (Test-Path -LiteralPath $path) {
                $item = [IO.File]::ReadAllText($path) | ConvertFrom-Json
                if ($item.bookId -ceq $record.bookId -and $item.key -ceq $_.Name) { $item }
            }
        })
        if ($book.Count -ne 1) { continue }
        $checkpoint = Join-Path (Join-Path $deviceRoot $book[0].key) 'config.json'
        $today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow,'Singapore Standard Time').ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
        $caughtUp = (Test-Path -LiteralPath $checkpoint) -and
            (([IO.File]::ReadAllText($checkpoint) | ConvertFrom-Json).nextDate -gt $today)
        if ($caughtUp -and -not $RunNow -and -not $record.requested -and -not $record.needsRetry -and $lastSync -and $lastSync -gt [datetimeoffset]::UtcNow.AddDays(-1)) { continue }
        try {
            & (Join-Path $PSScriptRoot '..\sync.ps1') -InstalledBook $book[0] -ExpectedBinding $record.connectionId
        } catch { $failed = $true }
    }
} catch {
    $failed = $true
    $message = $_.Exception.GetBaseException().Message
    if ($message -cnotmatch '^[A-Z][A-Z0-9_]{4,95}$') { $message = 'CONNECTOR_CHECK_FAILED' }
    Write-LocalTextAtomically (Join-Path $deviceRoot 'worker-status.txt') $message
} finally { $credential.Password.Dispose() }
if ($failed) { exit 1 }
