#requires -Version 5.1
$ErrorActionPreference='Stop'
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('feedx sync '+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($fixtureRoot)
try {
    foreach ($folder in @('sql','common','installer',('state/'+('a'*64)))) { $null=[IO.Directory]::CreateDirectory((Join-Path $fixtureRoot $folder)) }
    Copy-Item (Join-Path $PSScriptRoot '../sync.ps1') (Join-Path $fixtureRoot 'sync.ps1')
    foreach ($name in @('connection.ps1','common/credentials.ps1','provisioning.ps1')) {
        $destination=if ($name -eq 'connection.ps1') { 'sql/connection.ps1' } else { $name }
        Set-Content -LiteralPath (Join-Path $fixtureRoot $destination) -Value '# Fixture: no external access'
    }
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'sql/sql-read.ps1') -Value @'
function Get-RunLocalPath($Path,$BaseDirectory) { if ($BaseDirectory) { Join-Path $BaseDirectory $Path } else { $Path } }
function Stop-ReadPoc($Code) { throw [InvalidOperationException]::new($Code) }
function Write-LocalTextAtomically($Path,$Text,[switch]$CreateNew) { if ($CreateNew -and (Test-Path $Path)) { throw 'WOULD_OVERWRITE' }; [IO.File]::WriteAllText($Path,$Text) }
'@
    Copy-Item (Join-Path $PSScriptRoot '../common/staging-response.ps1') (Join-Path $fixtureRoot 'common/staging-response.ps1')
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'common/accounting-read.ps1') -Value @'
function Read-AccountingScope($Connection,$Plan,$Dataset,$Day) { if ($Dataset -ceq 'COA') { @{key='1000';description='Fixture A'}; @{key='2000';description='Fixture B'} } }
'@
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'installer/device.ps1') -Value @'
$deviceRoot=Join-Path (Split-Path $PSScriptRoot) 'state'
function Get-DeviceCredential { [pscredential]::new('fixture-device',(ConvertTo-SecureString 'fixture-only' -AsPlainText -Force)) }
function Get-InstanceIdentity($Value) { $Value }
function Open-LocalBook($Instance,$Database,$Credential) {
    if ($Instance -cne 'A2006' -or $Database -cne 'AED_TEST' -or $Credential.UserName -cne ('feedx_ro_'+('a'*32))) { throw 'WRONG_TEST_TARGET' }
    $c=[pscustomobject]@{}
    $c | Add-Member ScriptMethod Dispose {}
    return $c
}
function Assert-ReadIdentity { @{book='AED_TEST'} }
function Get-BookReaderPlan { @{} }
function Read-BookCompany { @{key=('a'*64)} }
function Invoke-DeviceApi($Credential,$Rpc,$Body,$Book) {
    if ($Book.key -cne ('a'*64) -or $Book.database -cne 'AED_TEST') { throw 'BOOK_CHANGED' }
    $payload=ConvertFrom-Json -InputObject $Body
    if ($payload.p_progress) { return @{state='Recorded'} }
    if (-not $payload.p_request_id) { return @{state='Connected';connectionId='12345678-1234-1234-1234-123456789012'} }
    $serverPath=Join-Path $deviceRoot 'server.json'
    $server=Get-Content -LiteralPath $serverPath -Raw | ConvertFrom-Json
    $requests=@($server.requests)
    $snapshots=@($server.snapshots)
    $existing=@($requests | Where-Object requestId -CEQ $payload.p_request_id)
    $fingerprint=$payload.p_dataset+'|'+$payload.p_scope_date+'|'+($payload.p_rows | ConvertTo-Json -Compress)
    $same=@($snapshots | Where-Object fingerprint -CEQ $fingerprint)
    if (-not $same.Count) { $same=@(@{fingerprint=$fingerprint;id=($snapshots.Count+1)}); $snapshots+=$same[0] }
    if (-not $existing.Count) { $requests+=@{requestId=$payload.p_request_id;snapshotId=$same[0].id} }
    @{requests=$requests;snapshots=$snapshots} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $serverPath
    if (Test-Path -LiteralPath (Join-Path $deviceRoot 'lose-response')) {
        Remove-Item -LiteralPath (Join-Path $deviceRoot 'lose-response')
        throw 'STAGING_HTTPS_UNAVAILABLE'
    }
    return @{state='Accepted';connectionId='12345678-1234-1234-1234-123456789012';requestId=$payload.p_request_id;acceptedRows=@($payload.p_rows).Count;snapshotId=$same[0].id;duplicate=($existing.Count -gt 0 -or $same[0].id -le @($server.snapshots).Count)}
}
'@
    $deviceRoot=Join-Path $fixtureRoot 'state'
    $directory=Join-Path $deviceRoot ('a'*64)
    $today=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow,'Singapore Standard Time').ToString('yyyy-MM-dd')
    $book=@{key=('a'*64);bookId='23456789-1234-1234-1234-123456789012';database='AED_TEST';instance='A2006';startDate=$today;authorized=$true}
    $book | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'book.json')
    $reader=[pscredential]::new(('feedx_ro_'+('a'*32)),(ConvertTo-SecureString 'fixture-only' -AsPlainText -Force))
    try { $reader | Export-Clixml -LiteralPath (Join-Path $directory 'reader.credential.xml') } finally { $reader.Password.Dispose() }
    @{requests=@();snapshots=@()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $deviceRoot 'server.json')
    Set-Content -LiteralPath (Join-Path $deviceRoot 'lose-response') -Value ''
    $scriptPath=Join-Path $fixtureRoot 'sync.ps1'
    try { & $scriptPath -InstalledBook $book -ExpectedBinding '12345678-1234-1234-1234-123456789012'; throw 'Lost receipt was not propagated' }
    catch { if ($_.Exception.Message -cne 'STAGING_HTTPS_UNAVAILABLE') { throw } }
    $queued=@(Get-ChildItem -LiteralPath (Join-Path $directory 'queue') -File)
    if ($queued.Count -ne 1) { throw 'Lost response did not preserve queued upload' }
    $original=Get-Content -LiteralPath $queued[0].FullName -Raw | ConvertFrom-Json
    & $scriptPath -InstalledBook $book -ExpectedBinding '12345678-1234-1234-1234-123456789012'
    $status=Get-Content -LiteralPath (Join-Path $directory 'status.json') -Raw | ConvertFrom-Json
    if ($status.error -or $status.pending -ne 0 -or -not @($status.receipts | Where-Object { $_.requestId -ceq $original.p_request_id -and $_.duplicate }).Count) { throw 'Original receipt was not safely recovered' }
    $before=Get-Content -LiteralPath (Join-Path $deviceRoot 'server.json') -Raw | ConvertFrom-Json
    & $scriptPath -InstalledBook $book -ExpectedBinding '12345678-1234-1234-1234-123456789012'
    $after=Get-Content -LiteralPath (Join-Path $deviceRoot 'server.json') -Raw | ConvertFrom-Json
    if ($before.snapshots.Count -ne $after.snapshots.Count -or @($after.requests | Where-Object requestId -CEQ $original.p_request_id).Count -ne 1) { throw 'Repeated sync duplicated accepted snapshots or request' }
    Write-Host 'Actual installed sync script: lost receipt recovery, original request reuse, empty datasets, checkpoint and repeated-sync fixtures passed (simulated SQL/HTTPS only).'
} finally { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
