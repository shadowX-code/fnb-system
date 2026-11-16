#requires -Version 5.1
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../autocount-aed-test-sql/sql-read.ps1')
. (Join-Path $PSScriptRoot '../provisioning.ps1')
. (Join-Path $PSScriptRoot '../installer/permission-review.ps1')

function Add-ReviewTable($Data,[string[]]$Columns) {
    $table=[Data.DataTable]::new()
    foreach ($name in $Columns) { $null=$table.Columns.Add($name,[object]) }
    $Data.Tables.Add($table)
}
function New-DeptReviewFixture([string]$Scenario) {
    $data=[Data.DataSet]::new()
    Add-ReviewTable $data @('objectId','userId','loginId','objectType','type_desc','loginDisabled','readerOwnsDatabase','readerOwnsSchema','readerOwnsObject','explicitObjectOwner','schemaOwner','revokeTrigger')
    Add-ReviewTable $data @('principal','type_desc','grantScope','columnName','permission_name','state_desc','grantor')
    Add-ReviewTable $data @('principal','type_desc','permission_name','state_desc')
    Add-ReviewTable $data @('readerMappingMatches','objectSelect','schemaSelect','databaseSelect')
    Add-ReviewTable $data @('permission_name','columnName')
    Add-ReviewTable $data @('columnName','columnSelect')
    try {
        $objectType=if ($Scenario -eq 'triggerMetadata') { 'TR' } else { 'U' }
        $description=if ($Scenario -eq 'triggerMetadata') { 'SQL_TRIGGER' } else { 'USER_TABLE' }
        $null=$data.Tables[0].Rows.Add(@(7,8,9,$objectType,$description,$true,0,0,($Scenario -ceq 'owner'),[DBNull]::Value,'dbo',($Scenario -ceq 'trigger')))
        $null=$data.Tables[1].Rows.Add(@('public','DATABASE_ROLE'))
        $null=$data.Tables[2].Rows.Add(@('public','SERVER_ROLE'))
        $null=$data.Tables[3].Rows.Add(@(1,($Scenario -ne 'clear'),($Scenario -ceq 'schema'),0))
        if ($Scenario -ne 'clear') { $null=$data.Tables[4].Rows.Add(@('SELECT',[DBNull]::Value)) }
        if ($Scenario -in @('direct','delegated','public','schema','role','trigger')) {
            $source=switch ($Scenario) { 'public' {'public'} 'role' {'Book audit role'} default {'dedicated reader'} }
            $scope=if ($Scenario -ceq 'schema') { 'SCHEMA' } else { 'OBJECT' }
            $state=if ($Scenario -ceq 'delegated') { 'GRANT_WITH_GRANT_OPTION' } else { 'GRANT' }
            $null=$data.Tables[1].Rows.Add(@($source,'DATABASE_ROLE',$scope,[DBNull]::Value,'SELECT',$state,'dbo'))
        }
        return Convert-DeptPermissionEvidence $data
    } finally { $data.Dispose() }
}

foreach ($scenario in @('unattributed','public','role','schema','owner','delegated','trigger','triggerMetadata','direct','clear')) {
    $evidence=New-DeptReviewFixture $scenario
    if ($evidence.repairable -ne ($scenario -ceq 'direct')) { throw "Unsafe repair classification: $scenario." }
    if ($evidence.hasSelect -ne ($scenario -ne 'clear')) { throw "Wrong effective access: $scenario." }
    if ($scenario -ceq 'triggerMetadata' -and ($evidence.lines -join ' ') -notmatch 'SQL_TRIGGER.*does not grant access to data rows.*Retry book authorization') {
        throw 'The office trigger metadata result did not direct the operator to retry authorization.'
    }
    if ($scenario -ceq 'unattributed' -and ($evidence.lines -join ' ') -notmatch 'did not identify an attributable grant') {
        throw 'The reported AED_TEST evidence did not produce an actionable, read-only diagnosis.'
    }
}

function Open-LocalBook($Instance,$Database) {
    if ($Instance -cne 'A2006' -or $Database -cne 'AED_TEST') { throw 'Unexpected target' }
    $connection=[pscustomobject]@{}
    $connection | Add-Member ScriptMethod Dispose {}
    $connection | Add-Member ScriptMethod BeginTransaction {
        param($Isolation)
        if ($Isolation -ne [Data.IsolationLevel]::Serializable) { throw 'Repair isolation missing' }
        $transaction=[pscustomobject]@{}
        $transaction | Add-Member ScriptMethod Commit { $script:committed=$true }
        $transaction | Add-Member ScriptMethod Dispose { if (-not $script:committed) { $script:rolledBack=$true } }
        $transaction
    }
    return $connection
}
function Assert-ReadIdentity { return @{sysadmin=1} }
function Get-InstanceIdentity { return 'A2006' }
function Get-RunLocalPath($Name,$BaseDirectory) { Join-Path $BaseDirectory $Name }
function Read-BookCompany { return @{key=('a'*64)} }
function Get-DeptPermissionEvidence($Admin,$Login,$Transaction) {
    if ($Login -cne $fixtureLogin) { throw 'Saved reader changed' }
    if (-not $Transaction) {
        if ($script:scenario -ceq 'unattributed') { return New-DeptReviewFixture 'unattributed' }
        return New-DeptReviewFixture 'direct'
    }
    if ($script:scenario -ceq 'changed') { return New-DeptReviewFixture 'public' }
    if ($script:scenario -ceq 'approved' -and $script:writes) { return New-DeptReviewFixture 'clear' }
    return New-DeptReviewFixture 'direct'
}
function Invoke-ReaderSecurityCommand($Admin,$Transaction,$Statement,$Secret) {
    if (-not $Transaction -or $Secret -or $Statement -cne $fixtureStatement) { throw 'Unexpected repair statement' }
    $script:writes++
}

$fixtureLogin='feedx_ro_'+('a'*32)
$fixtureStatement="REVOKE SELECT ON OBJECT::[dbo].[DeptChangeLog] FROM [$fixtureLogin] AS [dbo];"
$deviceRoot=Join-Path ([IO.Path]::GetTempPath()) ('feedx-dept-permissions-'+[guid]::NewGuid().ToString('N'))
$bookRoot=Join-Path $deviceRoot ('a'*64)
$null=[IO.Directory]::CreateDirectory($bookRoot)
try {
    @{key=('a'*64);instance='A2006';database='AED_TEST';startDate='2026-11-16'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bookRoot 'book.json')
    $pending=Join-Path $bookRoot 'reader.pending.credential.xml'
    [pscredential]::new($fixtureLogin,(ConvertTo-SecureString 'fixture-only' -AsPlainText -Force)) | Export-Clixml -LiteralPath $pending
    $original=[IO.File]::ReadAllText($pending)
    foreach ($script:scenario in @('diagnose','unattributed','declined','changed','verifyFailed','approved')) {
        $script:writes=0
        $script:committed=$false
        $script:rolledBack=$false
        $expectedError=switch ($script:scenario) { 'changed' {'READER_REPAIR_STATE_CHANGED'} 'verifyFailed' {'READER_REPAIR_VERIFICATION_FAILED'} }
        $approve=if ($script:scenario -cne 'diagnose') {{
            param($Preview)
            if ($script:scenario -ceq 'unattributed') { throw 'Ambiguous evidence opened a repair preview' }
            if ($Preview -cne $fixtureStatement) { throw 'The preview must match the only SQL change' }
            return $script:scenario -cne 'declined'
        }}
        try {
            $result=Invoke-DeptPermissionReview 'A2006' 'AED_TEST' $approve
            if ($expectedError) { throw "Expected $expectedError." }
            if ([bool]$result.repaired -ne ($script:scenario -ceq 'approved')) { throw 'Unexpected repair result' }
            if (($result.lines -join ' ') -match $fixtureLogin) { throw 'Login leaked into diagnostics' }
        } catch { if ($_.Exception.GetBaseException().Message -cne $expectedError) { throw } }
        $expectedWrite=$script:scenario -in @('verifyFailed','approved')
        if ($script:writes -ne [int]$expectedWrite -or $script:committed -ne ($script:scenario -ceq 'approved') -or
            $script:rolledBack -ne ($script:scenario -in @('changed','verifyFailed')) -or [IO.File]::ReadAllText($pending) -cne $original) {
            throw "Repair safety failed: $script:scenario."
        }
    }
} finally { Remove-Item -LiteralPath $deviceRoot -Recurse -Force }
Write-Host 'AED_TEST observed evidence, isolated direct grant, shared grants, roles, ownership, approval, stale review and rollback passed.'
