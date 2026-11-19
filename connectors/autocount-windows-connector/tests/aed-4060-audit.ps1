#requires -Version 5.1
# Offline fixtures only. No SQL Server, task, device, cloud or production state is accessed.
$ErrorActionPreference='Stop'
$auditPath=Join-Path $PSScriptRoot '../../../public/downloads/FeedX-AED_TEST-4060-Audit.ps1'
$tokens=$null;$parseErrors=$null
$null=[Management.Automation.Language.Parser]::ParseFile($auditPath,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$content=[IO.File]::ReadAllText($auditPath).Replace('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',"'S-1-fixture'")
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('feedx audit '+[guid]::NewGuid().ToString('N'))
$priorLocal=$env:LOCALAPPDATA
$fixtureInstaller=Join-Path $fixtureRoot 'Programs/FeedX AutoCount Connector/installer'
$stateRoot=Join-Path $fixtureRoot 'FeedX/AutoCountConnector'
$null=[IO.Directory]::CreateDirectory($fixtureInstaller)
$null=[IO.Directory]::CreateDirectory($stateRoot)
try {
    $env:LOCALAPPDATA=$fixtureRoot
    @'
$deviceRoot=Join-Path $env:LOCALAPPDATA 'FeedX/AutoCountConnector'
$deviceCredentialPath=Join-Path $deviceRoot 'device.credential.xml'
function Get-BookDigest($Value) {
    $h=[Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() }
}
function Stop-ReadPoc($Code) { throw [InvalidOperationException]::new($Code) }
function New-AedReadConnectionString { 'Data Source=lpc:(local)\A2006;Initial Catalog=AED_TEST;Pooling=False;Integrated Security=False' }
function Open-LocalBook($Instance,$Database,$Credential) {
    if ($Instance -cne 'A2006' -or $Database -cnotin @('master','AED_TEST')) { throw 'OUT_OF_SCOPE' }
    if (-not $Credential -and $script:scenario -ceq 'ambiguous') { throw 'WINDOWS_METADATA_UNAVAILABLE' }
    if ($Credential) {
        $script:readerAttempts++
        if ($Credential.UserName -cne ('feedx_ro_'+('a'*32))) { throw 'WRONG_READER_SELECTED' }
        if ($Database -ceq 'AED_TEST' -and $script:scenario -cin @('disabled','mapping','connect')) { throw 'SQL_ERROR_4060' }
    }
    $c=[pscustomobject]@{database=$Database;reader=[bool]$Credential}
    $c | Add-Member ScriptMethod Dispose {}
    return $c
}
function Assert-ReadIdentity { @{book='AED_TEST';instanceName='A2006'} }
function Get-BookReaderPlan {}
function Read-BookCompany { @{key=if ($script:scenario -ceq 'changedIdentity') { 'c'*64 } else { 'a'*64 }} }
function Get-ScheduledTask { @{TaskName='FeedX AutoCount Connector';State='Ready';Principal=@{UserId='S-1-fixture';LogonType='Interactive'};Actions=@(@{Arguments=('-File "'+(Join-Path $env:LOCALAPPDATA 'Programs/FeedX AutoCount Connector/installer/worker.ps1')+'"')})} }
function Get-ScheduledTaskInfo { @{LastTaskResult=1;LastRunTime=[datetime]'2026-11-19T00:00:00Z';NextRunTime=[datetime]'2026-11-19T00:05:00Z';NumberOfMissedRuns=0} }
function Get-WinEvent { throw 'WINDOWS_LOG_UNAVAILABLE_IN_FIXTURE' }
function Get-ItemProperty { @{DisplayVersion='3.0.9'} }
function Invoke-ReadQuery($Connection,$Sql,$Parameters) {
    if ($Sql -match 'AS instanceName' -and $Sql -match 'originalContext') { return @{instanceName='A2006';isSqlAdmin=1;originalContext=1} }
    if ($Sql -match 'FROM sys.databases d') { return @{databaseState=if ($script:scenario -ceq 'offline') { 'OFFLINE' } else { 'ONLINE' };databaseAccess='MULTI_USER';adminHasAccess=1} }
    if ($Sql -match 'FROM sys.sql_logins l') { return @{loginDisabled=($script:scenario -ceq 'disabled');expectedLoginSid=1} }
    if ($Sql -match 'FROM sys.database_principals p WHERE p.name=@login') { return @{loginUserSidMatch=if ($script:scenario -ceq 'mapping') { 0 } else { 1 };expectedUserSid=1} }
    if ($Sql -match 'WITH memberships') { return @{principal='dedicated reader';permission='CONNECT';grantState='GRANT'} }
    if ($Sql -match 'EXECUTE AS LOGIN') { return @{readerDatabaseUser=1;connectAllowed=if ($script:scenario -ceq 'connect') { 0 } else { 1 }} }
    if ($Sql -match 'CONNECTIONPROPERTY') { return @{databaseName=$Connection.database;originalLoginMatches=1;effectiveLoginMatches=1;databaseUserMatches=1;authentication='SQL'} }
    if ($Sql -match 'COUNT_BIG') { return @{rows=137} }
    throw 'UNEXPECTED_QUERY'
}
'@ | Set-Content -LiteralPath (Join-Path $fixtureInstaller 'device.ps1')
    function Add-FixtureRecord($Key='a',$Instance='A2006',$Database='AED_TEST',[switch]$PendingOnly,[switch]$Both) {
        $folder=Join-Path $stateRoot ($Key*64)
        $null=[IO.Directory]::CreateDirectory($folder)
        @{key=($Key*64);database=$Database;instance=$Instance;bookId='12345678-1234-1234-1234-123456789012';authorized=(-not $PendingOnly)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'book.json')
        @{nextDate='2026-11-18'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'config.json')
        Set-Content -LiteralPath (Join-Path $folder 'authorization.lock') -Value ''
        $file=if ($PendingOnly) { 'reader.pending.credential.xml' } else { 'reader.credential.xml' }
        $c=[pscredential]::new(('feedx_ro_'+($Key*32)),(ConvertTo-SecureString 'fixture-secret' -AsPlainText -Force))
        try { $c | Export-Clixml -LiteralPath (Join-Path $folder $file) } finally { $c.Password.Dispose() }
        if ($Both) { Copy-Item -LiteralPath (Join-Path $folder $file) -Destination (Join-Path $folder 'reader.pending.credential.xml') }
    }
    foreach ($script:scenario in @('healthy','disabled','offline','mapping','connect','history','ambiguous','changedIdentity','pendingOnly','both','localAlias','caseAlias','malformedHistory','corruptConfig','corruptPoll','missing','invalidKey')) {
        Get-ChildItem -LiteralPath $stateRoot | Remove-Item -Recurse -Force
        $script:readerAttempts=0
        if ($script:scenario -cne 'missing') {
            if ($script:scenario -ceq 'localAlias') { Add-FixtureRecord -Instance '(local)\A2006' }
            elseif ($script:scenario -ceq 'caseAlias') { Add-FixtureRecord -Instance '.\a2006' -Database 'aed_test' }
            else { Add-FixtureRecord -PendingOnly:($script:scenario -ceq 'pendingOnly') -Both:($script:scenario -ceq 'both') }
        }
        if ($script:scenario -cin @('history','ambiguous')) { Add-FixtureRecord -Key 'b' -PendingOnly }
        if ($script:scenario -ceq 'malformedHistory') {
            Add-FixtureRecord -Key 'b'
            Set-Content -LiteralPath (Join-Path $stateRoot (('b'*64)+'/book.json')) -Value '{invalid'
        }
        if ($script:scenario -ceq 'invalidKey') {
            @{key=('d'*64);database='AED_TEST';instance='A2006'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot (('a'*64)+'/book.json'))
        }
        if ($script:scenario -ceq 'corruptConfig') { Set-Content -LiteralPath (Join-Path $stateRoot (('a'*64)+'/config.json')) -Value '{invalid' }
        if ($script:scenario -ceq 'corruptPoll') { Set-Content -LiteralPath (Join-Path $stateRoot 'poll-summary.json') -Value '{invalid' }
        $before=@(Get-ChildItem -LiteralPath $stateRoot -Recurse -File | Get-FileHash | ForEach-Object { $_.Hash }) -join '|'
        $json=& ([scriptblock]::Create($content))
        $r=$json | ConvertFrom-Json
        $after=@(Get-ChildItem -LiteralPath $stateRoot -Recurse -File | Get-FileHash | ForEach-Object { $_.Hash }) -join '|'
        if ($before -cne $after -or $r.changesPerformed) { throw "Saved state changed in $script:scenario" }
        if ($r.task.lastResult -ne 1) { throw "Independent task diagnostics lost in $script:scenario. $json" }
        $blocked=$script:scenario -cin @('ambiguous','changedIdentity','pendingOnly','missing','invalidKey')
        if ([bool]$r.auditFailure -ne $blocked) { throw "Unexpected resolution in $script:scenario. $json" }
        if ($blocked -and $script:readerAttempts -ne 0) { throw "Reader was guessed in $script:scenario" }
        if ($script:scenario -cne 'ambiguous' -and $r.windowsMetadata.database.databaseState -notin @('ONLINE','OFFLINE')) { throw "Independent SQL state lost in $script:scenario" }
        if (-not $blocked -and $script:scenario -cnotin @('disabled','offline','mapping','connect') -and -not $r.readerDatabase.readerVerified) { throw "Reader did not complete in $script:scenario. $json" }
        if ($script:scenario -ceq 'history' -and ($r.targetResolution.matchingRecords -ne 2 -or $r.targetResolution.selectedRecordId -cne ('a'*64))) { throw 'Historical record not disambiguated' }
        if ($script:scenario -ceq 'disabled' -and ($r.nextActions -join '') -notmatch 'login is disabled') { throw 'Disabled login not identified' }
        if ($script:scenario -ceq 'mapping' -and ($r.nextActions -join '') -notmatch 'mapped to a different login') { throw 'SID mismatch not identified' }
        if ($script:scenario -ceq 'connect' -and ($r.nextActions -join '') -notmatch 'denies database CONNECT') { throw 'CONNECT denial not identified' }
        if ($script:scenario -ceq 'offline' -and $r.readerDatabase.state -cne 'Skipped') { throw 'Offline book was opened' }
        if ($json -match 'fixture-secret|feedx_ro_') { throw 'Credential identity or secret leaked' }
    }
    Write-Host 'Audit parse and 17 target-resolution / SQL-state fixtures passed; saved state unchanged.'
} finally {
    $env:LOCALAPPDATA=$priorLocal
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
