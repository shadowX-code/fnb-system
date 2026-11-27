$ErrorActionPreference='Stop'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('accounting-evidence-'+[guid]::NewGuid().ToString('N'))
$env:LOCALAPPDATA=$fixture
$bookFolder=Join-Path $fixture ('FeedX/AutoCountConnector/'+('a'*64))
$installer=Join-Path $fixture 'Programs/FeedX AutoCount Connector/installer'
$native=Join-Path $fixture 'Native exports'
$null=New-Item -ItemType Directory -Path $bookFolder,$installer,$native -Force
Set-Content (Join-Path $native 'Trial Balance.csv') 'fixture only'
[pscredential]::new(('feedx_ro_'+('b'*32)),(ConvertTo-SecureString 'fixture-value' -AsPlainText -Force)) | Export-Clixml (Join-Path $bookFolder 'reader.credential.xml')
@'
$deviceRoot=Join-Path $env:LOCALAPPDATA 'FeedX/AutoCountConnector'
function Get-LocalConnectorBooks {
    @{ bookId='3037f4f7-94e6-4050-a6c0-a790559fb056'; instance='A2006'; database='AED_TEST'; authorized=$true; key=('a'*64) }
}
function Get-RunLocalPath($Name,$BaseDirectory) { Join-Path $BaseDirectory $Name }
function Stop-ReadPoc($Code) { throw $Code }
function Open-LocalBook($instance,$database,$credential) {
    if ($instance -ne 'A2006' -or $database -ne 'AED_TEST') { throw 'WRONG_BOOK' }
    if (-not $credential -and $env:FEEDX_TEST_DENY_WINDOWS) { throw 'UNEXPECTED_WINDOWS_CONNECTION' }
    $obj=[pscustomobject]@{ mode=if ($credential) { 'reader' } else { 'windows' } }
    $obj | Add-Member ScriptMethod Dispose {}
    $obj
}
function Assert-ReadIdentity($connection) {
    @{login=('feedx_ro_'+('b'*32));dbUser=('feedx_ro_'+('b'*32))}
}
function Assert-ReadPermissions($connection) {}
function Read-BookCompany($connection) {
    @{company='TEST COMPANY';key=if ($env:FEEDX_TEST_WRONG_BOOK) { ('c'*64) } else { ('a'*64) }}
}
function Invoke-ReadQuery($connection,$query) {
    if ($query -match '(?im)^\s*(insert|update|delete|execute|grant|alter)\b') { throw 'MUTATION_ATTEMPTED' }
    if ($query -match 'FROM dbo.GLDTL|FROM dbo.GLMast') {
        if ($connection.mode -ne 'reader' -or $query -notmatch 'COUNT_BIG') { throw 'INVALID_EVIDENCE_QUERY' }
        return @{rows=59}
    }
    if ($query -notmatch '(?i)(sys\.|HAS_PERMS_BY_NAME)') { throw 'NOT_CATALOG_ONLY' }
    switch -Regex ($query) {
        'AS canSelect' { return [pscustomobject]@{objectId=1;canSelect=1} }
        'approximateRows' {
            [pscustomobject]@{objectId=1;objectName='GLDTL';objectType='USER_TABLE';objectKind='U';schemaName='dbo';approximateRows=59}
            if ($connection.mode -eq 'windows') { [pscustomobject]@{objectId=2;objectName='PBalance';objectType='USER_TABLE';objectKind='U';schemaName='dbo';approximateRows=50} }
            return
        }
        'sql_expression_dependencies' {
            if ($connection.mode -eq 'reader' -or $env:FEEDX_TEST_DENY_DEPENDENCIES) { throw 'CATALOG_DEPENDENCY_PERMISSION' }
            return @{objectId=2;referencedObject='RelatedObject'}
        }
        '^SELECT HAS_PERMS_BY_NAME' { return @{ allowed=[int]($connection.mode -eq 'windows') } }
    }
}
'@ | Set-Content (Join-Path $installer 'device.ps1')
$source = Join-Path $PSScriptRoot '../../../public/downloads/FeedX-AED_TEST-Accounting-Evidence.ps1'
$probe = Join-Path $fixture 'Evidence capture.ps1'
Copy-Item -LiteralPath $source -Destination $probe
function Read-Host($Prompt) {
    if ($env:FEEDX_TEST_DECLINE_APPROVAL) { return 'Declined' }
    if ($Prompt -match 'CATALOG') { return 'AED_TEST CATALOG' }
    if ($Prompt -match 'AGGREGATES') { return 'AED_TEST AGGREGATES' }
    throw 'Unexpected prompt'
}
try {
    $readerJson=& $probe -NativeReportDirectory $native
    $readerResult=$readerJson | ConvertFrom-Json
    if ($readerResult.state -ne 'Partial catalog' -or $readerResult.sql.priority[0].state -ne 'Not visible' -or $readerResult.nativeExportFiles.Count -ne 1 -or
        $readerResult.nativeExportFiles[0].sha256 -notmatch '^[a-f0-9]{64}$' -or ($readerJson -join '') -match 'fixture-value|feedx_ro_') { throw 'Reader evidence mismatch' }
    $windowsResult=(& $probe -IncludeWindowsCatalog) | ConvertFrom-Json
    if ($windowsResult.sql.priority[0].state -ne 'Found' -or $windowsResult.sql.priority[1].state -ne 'Not found in catalog' -or
        $windowsResult.sql.objects[1].readerObjectSelect -ne 'Not visible to reader' -or $windowsResult.sql.expressionDependencies.state -ne 'Captured') { throw 'Catalog states mismatch' }
    $env:FEEDX_TEST_DENY_DEPENDENCIES='yes'
    $partial=(& $probe -IncludeWindowsCatalog) | ConvertFrom-Json
    if ($partial.state -ne 'Partial catalog' -or $partial.sql.expressionDependencies.error -ne 'CATALOG_DEPENDENCY_PERMISSION') {
        throw 'Dependency denial should preserve the captured catalog'
    }
    Remove-Item Env:FEEDX_TEST_DENY_DEPENDENCIES
    $env:FEEDX_TEST_DECLINE_APPROVAL='yes'
    $env:FEEDX_TEST_DENY_WINDOWS='yes'
    & $probe -Guided
    $declined=Get-ChildItem -LiteralPath $fixture -Filter '*.json' | Get-Content -Raw | ConvertFrom-Json
    if ($declined.windowsCatalogError -ne 'CATALOG_APPROVAL_DECLINED' -or $declined.readerEvidence.state -ne 'Declined') {
        throw 'Declined approvals were not preserved'
    }
    Get-ChildItem -LiteralPath $fixture -Filter '*.json' | Remove-Item
    Remove-Item Env:FEEDX_TEST_DECLINE_APPROVAL,Env:FEEDX_TEST_DENY_WINDOWS
    & $probe -Guided
    $guided=Get-ChildItem -LiteralPath $fixture -Filter '*.json' | Get-Content -Raw | ConvertFrom-Json
    if ($guided.state -ne 'Catalog captured' -or $guided.readerEvidence.state -ne 'Captured' -or $guided.readerEvidence.glFieldPopulation.rows -ne 59) {
        throw 'Guided evidence mismatch'
    }
    $env:FEEDX_TEST_WRONG_BOOK='yes'
    $wrong=(& $probe) | ConvertFrom-Json
    if ($wrong.state -ne 'Blocked' -or $wrong.error -ne 'BOOK_COMPANY_IDENTITY_CHANGED' -or $wrong.sql) { throw 'Wrong book was not blocked before catalog read' }
    Write-Output 'PASS: exact identity gate, reader vs Windows metadata visibility, dependency failure and local export hashes'
} finally { Remove-Item -LiteralPath $fixture -Recurse -Force }
