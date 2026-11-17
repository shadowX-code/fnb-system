#requires -Version 5.1
$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('feedx-background-'+[guid]::NewGuid().ToString('N'))
try {
    $installer=Join-Path $root 'installer'
    $key='a'*64
    $bookDirectory=Join-Path $root $key
    $queue=Join-Path $bookDirectory 'queue'
    $null=[IO.Directory]::CreateDirectory($installer)
    $null=[IO.Directory]::CreateDirectory($queue)
    Copy-Item (Join-Path $PSScriptRoot '../installer/worker.ps1') -Destination $installer
    $worker=Join-Path $installer 'worker.ps1'
    Set-Content -LiteralPath (Join-Path $installer 'device.ps1') -Value @'
$deviceRoot=Split-Path $PSScriptRoot
$deviceCredentialPath=Join-Path $deviceRoot 'paired'
function Get-DeviceCredential { return [pscredential]::new('fixture',(ConvertTo-SecureString 'fixture' -AsPlainText -Force)) }
function Get-LocalConnectorBooks {
    return @{bookId='fixture';key=('a'*64);authorized=$true;database='AED_TEST'}
}
function Invoke-DeviceAction($Credential,$Request) {
    if ($Request.p_background_mode -ne 'unattended' -or -not $Request.p_next_poll_at) { throw 'Schedule evidence not sent' }
    $record=Get-Content -Raw (Join-Path $deviceRoot 'cloud.json') | ConvertFrom-Json
    return @{books=@($record)}
}
function Write-LocalTextAtomically($Path,$Text) { [IO.File]::WriteAllText($Path,$Text) }
'@
    Set-Content -LiteralPath (Join-Path $installer 'scheduler.ps1') -Value "function Get-ConnectorSchedule { return @{mode='unattended';nextPollAt='2026-11-17T02:00:00Z'} }"
    Set-Content -LiteralPath (Join-Path $root 'sync.ps1') -Value @'
param($InstalledBook,$ExpectedBinding,[switch]$ConnectionTest)
if ($InstalledBook.database -cne 'AED_TEST' -or $ExpectedBinding -cne 'existing-binding') { throw 'Book or binding changed' }
Add-Content (Join-Path $PSScriptRoot 'synced') 'AED_TEST'
'@
    $checkpoint=Join-Path $bookDirectory 'config.json'
    $pending=Join-Path $queue 'pending.json'
    $synced=Join-Path $root 'synced'
    Set-Content -LiteralPath (Join-Path $root 'paired') -Value 'fixture'
    foreach ($scenario in @('idle','daily','catchup','requested','retry','localQueue')) {
        $record=@{bookId='fixture';ready=$true;bound=$true;connectionId='existing-binding';requested=$scenario -eq 'requested'
            needsRetry=$scenario -eq 'retry';lastSyncAt=[datetimeoffset]::UtcNow.AddHours(-2).ToString('o')}
        if ($scenario -eq 'daily') { $record.lastSyncAt=[datetimeoffset]::UtcNow.AddHours(-25).ToString('o') }
        $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'cloud.json')
        $next=if ($scenario -eq 'catchup') { '2000-01-01' } else { '2999-01-01' }
        @{nextDate=$next} | ConvertTo-Json | Set-Content -LiteralPath $checkpoint
        if ($scenario -eq 'localQueue') { Set-Content -LiteralPath $pending -Value '{}' }
        $before=@(Get-Content -LiteralPath $synced -ErrorAction SilentlyContinue).Count
        & $worker
        $after=@(Get-Content -LiteralPath $synced -ErrorAction SilentlyContinue).Count
        $poll=Get-Content -LiteralPath (Join-Path $root 'poll-summary.json') -Raw | ConvertFrom-Json
        if ($after-$before -ne [int]($scenario -ne 'idle') -or -not $poll.paired -or -not $poll.finishedAt -or $poll.error) {
            throw "Background scenario failed: $scenario ($before -> $after). $($poll | ConvertTo-Json -Compress)"
        }
    }
} finally { if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force } }
Write-Host 'Background polling and automatic, requested, catch-up and queue-driven sync passed.'
