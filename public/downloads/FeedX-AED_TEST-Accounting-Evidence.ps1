#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$NativeReportDirectory,
    [switch]$IncludeWindowsCatalog
)
$ErrorActionPreference = 'Stop'
$bookId = '3037f4f7-94e6-4050-a6c0-a790559fb056'
$priority = @('PBalance','AccPeriod','AccType','PLFormat','BSFormat')
$report = [ordered]@{
    format = 'FeedX-AED_TEST-accounting-evidence-v1'
    bookId = $bookId
    database = 'AED_TEST'
    instance = 'A2006'
    capturedAtUtc = [datetime]::UtcNow.ToString('o')
    state = 'Blocked'
    nativeExportFiles = @()
    sql = $null
}
$connection = $null
$catalogConnection = $null
$reader = $null

function Get-AssessmentFailure($ErrorRecord) {
    $failure = $ErrorRecord.Exception
    while ($failure.InnerException -and $failure -isnot [Data.SqlClient.SqlException]) {
        $failure = $failure.InnerException
    }
    if ($failure -is [Data.SqlClient.SqlException]) { return 'SQL_ERROR_'+$failure.Number }
    if ($failure.Message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { return $failure.Message }
    return 'LOCAL_ACCOUNTING_ASSESSMENT_FAILED'
}

# Every query reads the catalog. Matching names are leads for review.
$candidates = @'
WITH Candidates AS (
    SELECT o.object_id, o.name, o.type, o.type_desc, s.name AS schema_name
    FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
    WHERE o.is_ms_shipped = 0 AND o.type IN ('U','V','P','PC','FN','FS','IF','TF','FT','SN')
      AND (
          LOWER(o.name) IN ('glmast','gldtl','profile','pbalance','accperiod','acctype','plformat','bsformat')
          OR LOWER(o.name) LIKE '%balance%' OR LOWER(o.name) LIKE '%opening%'
          OR LOWER(o.name) LIKE '%fiscal%' OR LOWER(o.name) LIKE '%yearend%'
          OR LOWER(o.name) LIKE '%period%' OR LOWER(o.name) LIKE '%format%'
          OR LOWER(o.name) LIKE '%aging%' OR LOWER(o.name) LIKE '%ageing%'
          OR LOWER(o.name) LIKE '%knockoff%' OR LOWER(o.name) LIKE '%valuation%'
          OR LOWER(o.name) LIKE '%stockvalue%' OR LOWER(o.name) LIKE '%stockcost%'
          OR LOWER(o.name) LIKE 'ar[_]%' OR LOWER(o.name) LIKE 'ap[_]%'
          OR LOWER(o.name) LIKE 'st[_]%' OR LOWER(o.name) LIKE 'debtor%'
          OR LOWER(o.name) LIKE 'creditor%'
      )
)
'@

function Read-AssessmentCatalog($Connection,$ReaderConnection) {
    $visibleToReader = @(Invoke-ReadQuery $ReaderConnection ($candidates + @'

SELECT TOP (501) o.object_id AS objectId,
       HAS_PERMS_BY_NAME(QUOTENAME(o.schema_name)+N'.'+QUOTENAME(o.name),'OBJECT','SELECT') AS canSelect
FROM Candidates o ORDER BY o.object_id;
'@))
    $readerPermissions = @{}
    foreach ($entry in $visibleToReader) { $readerPermissions[$entry.objectId] = $entry.canSelect }

    $objects = @(Invoke-ReadQuery $Connection ($candidates + @'

SELECT TOP (501) o.object_id AS objectId, o.schema_name AS schemaName,
       o.name AS objectName, o.type_desc AS objectType,
       CASE WHEN o.type='U' THEN p.approximateRows END AS approximateRows
FROM Candidates o OUTER APPLY (
    SELECT SUM(part.rows) AS approximateRows
    FROM sys.partitions part WHERE part.object_id=o.object_id AND part.index_id IN (0,1)
) p
ORDER BY o.schema_name,o.name;
'@))
    $columns = @(Invoke-ReadQuery $Connection ($candidates + @'

SELECT TOP (20001) c.object_id AS objectId, c.column_id AS ordinal,
       c.name AS columnName, t.name AS sqlType, TYPE_NAME(c.system_type_id) AS baseType,
       c.precision, c.scale, c.max_length AS maxLength, c.is_nullable AS nullable,
       c.is_computed AS computed, cc.is_persisted AS persisted
FROM Candidates o JOIN sys.columns c ON o.object_id=c.object_id
JOIN sys.types t ON c.user_type_id=t.user_type_id
LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id
ORDER BY c.object_id,c.column_id;
'@))
    $keys = @(Invoke-ReadQuery $Connection ($candidates + @'

SELECT TOP (20001) o.object_id AS objectId, ix.index_id AS keyId, ix.is_primary_key AS primaryKey,
       ix.is_unique AS uniqueKey, ix.is_disabled AS disabled, ix.has_filter AS filtered,
       ic.key_ordinal AS ordinal, c.name AS columnName
FROM Candidates o JOIN sys.indexes ix ON ix.object_id=o.object_id AND ix.is_unique=1 AND ix.is_hypothetical=0
JOIN sys.index_columns ic ON ix.object_id=ic.object_id AND ix.index_id=ic.index_id AND ic.key_ordinal>0
JOIN sys.columns c ON ic.object_id=c.object_id AND ic.column_id=c.column_id
ORDER BY o.object_id,ix.index_id,ic.key_ordinal;
'@))
    $relations = @(Invoke-ReadQuery $Connection ($candidates + @'

SELECT TOP (20001) fk.object_id AS relationId, fk.is_disabled AS disabled,
       fk.is_not_trusted AS untrusted, fkc.constraint_column_id AS ordinal,
       fromSchema.name AS fromSchema, fromObject.name AS fromObject, fromColumn.name AS fromColumn,
       toSchema.name AS toSchema, toObject.name AS toObject, toColumn.name AS toColumn
FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fk.object_id=fkc.constraint_object_id
JOIN sys.objects fromObject ON fkc.parent_object_id=fromObject.object_id
JOIN sys.schemas fromSchema ON fromObject.schema_id=fromSchema.schema_id
JOIN sys.columns fromColumn ON fromObject.object_id=fromColumn.object_id AND fkc.parent_column_id=fromColumn.column_id
JOIN sys.objects toObject ON fkc.referenced_object_id=toObject.object_id
JOIN sys.schemas toSchema ON toObject.schema_id=toSchema.schema_id
JOIN sys.columns toColumn ON toObject.object_id=toColumn.object_id AND fkc.referenced_column_id=toColumn.column_id
WHERE EXISTS (SELECT 1 FROM Candidates o WHERE o.object_id IN (fromObject.object_id,toObject.object_id))
ORDER BY fk.object_id,fkc.constraint_column_id;
'@))
    $dependencies = [ordered]@{state='Captured';rows=@()}
    try {
        $dependencies.rows = @(Invoke-ReadQuery $Connection ($candidates + @'

SELECT TOP (20001) o.object_id AS objectId,
       CASE WHEN d.referenced_database_name IS NULL AND d.referenced_server_name IS NULL
            THEN d.referenced_schema_name END AS referencedSchema,
       CASE WHEN d.referenced_database_name IS NULL AND d.referenced_server_name IS NULL
            THEN d.referenced_entity_name END AS referencedObject,
       CAST(CASE WHEN d.referenced_database_name IS NOT NULL OR d.referenced_server_name IS NOT NULL
                 THEN 1 ELSE 0 END AS bit) AS explicitlyQualifiedReference,
       d.is_caller_dependent AS callerDependent, d.is_ambiguous AS ambiguous
FROM Candidates o JOIN sys.sql_expression_dependencies d ON o.object_id=d.referencing_id
ORDER BY o.object_id,d.referenced_id,d.referenced_minor_id;
'@))
    } catch {
        $dependencies.state = 'Unavailable'
        $dependencies.error = Get-AssessmentFailure $_
    }

    if ($objects.Count -gt 500 -or $visibleToReader.Count -gt 500 -or $columns.Count -gt 20000 -or
        $keys.Count -gt 20000 -or $relations.Count -gt 20000 -or $dependencies.rows.Count -gt 20000) {
        Stop-ReadPoc 'ACCOUNTING_CATALOG_LIMIT_REACHED'
    }
    foreach ($object in $objects) {
        $canRead = if ($readerPermissions.ContainsKey($object.objectId)) {
            if ($readerPermissions[$object.objectId] -eq 1) { 'Granted' } else { 'Not confirmed' }
        } else { 'Not visible to reader' }
        $object | Add-Member -NotePropertyName readerObjectSelect -NotePropertyValue $canRead
    }
    $canSeeDefinitions = Invoke-ReadQuery $Connection "SELECT HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION') AS allowed"
    return [ordered]@{
        databaseViewDefinition = ($canSeeDefinitions.allowed -eq 1)
        priority = @($priority | ForEach-Object {
            $name = $_
            $matches = @($objects | Where-Object objectName -IEQ $name)
            $state = if ($matches.Count) { 'Found' } elseif ($canSeeDefinitions.allowed -eq 1) { 'Not found in catalog' } else { 'Not visible' }
            [ordered]@{name=$name; state=$state; objectIds=@($matches | ForEach-Object objectId)}
        })
        objects = $objects
        columns = $columns
        uniqueKeys = $keys
        foreignKeys = $relations
        expressionDependencies = $dependencies
    }
}

if ($NativeReportDirectory) {
    try {
        $directory = Get-Item -LiteralPath $NativeReportDirectory
        if (-not $directory.PSIsContainer -or $directory.PSProvider.Name -ne 'FileSystem') { throw 'NATIVE_EXPORT_DIRECTORY_INVALID' }
        $files = @(Get-ChildItem -LiteralPath $directory.FullName -File | Where-Object Extension -In @('.xls','.xlsx','.csv','.pdf'))
        if ($files.Count -gt 40 -or @($files | Where-Object Length -GT 50MB).Count) { throw 'NATIVE_EXPORT_LIMIT_REACHED' }
        $report.nativeExportFiles = @($files | ForEach-Object {
            [ordered]@{name=$_.Name; bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
        })
    } catch { $report.nativeExportError = Get-AssessmentFailure $_ }
}

try {
    $localRoot = Join-Path $env:LOCALAPPDATA 'FeedX\AutoCountConnector'
    if (-not (Test-Path -LiteralPath $localRoot -PathType Container)) { throw 'WORKING_WINDOWS_PROFILE_REQUIRED' }
    $installer = Join-Path $env:LOCALAPPDATA 'Programs\FeedX AutoCount Connector\installer'
    . (Join-Path $installer 'device.ps1')
    $local = @(Get-LocalConnectorBooks | Where-Object {
        $_.bookId -ceq $bookId -and $_.instance -ieq 'A2006' -and $_.database -ceq 'AED_TEST' -and $_.authorized
    })
    if ($local.Count -ne 1) { Stop-ReadPoc 'CURRENT_AED_TEST_BINDING_NOT_UNIQUE' }
    $book = $local[0]
    $path = Get-RunLocalPath $book.key -BaseDirectory $deviceRoot
    $reader = Import-Clixml -LiteralPath (Join-Path $path 'reader.credential.xml')
    if ($reader -isnot [Management.Automation.PSCredential] -or $reader.UserName -cnotmatch '^feedx_ro_[a-f0-9]{32}$') {
        Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH'
    }
    $connection = Open-LocalBook 'A2006' 'AED_TEST' $reader
    $identity = Assert-ReadIdentity $connection 'AED_TEST' 'A2006'
    if ($identity.login -cne $reader.UserName -or $identity.dbUser -cne $reader.UserName) {
        Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH'
    }
    Assert-ReadPermissions $connection $identity
    $observed = Read-BookCompany $connection 'AED_TEST'
    if ($observed.key -cne $book.key) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
    $report.company = $observed.company
    $report.sql = Read-AssessmentCatalog $connection $connection
    $report.catalogContext = 'Existing connector reader'
    if ($IncludeWindowsCatalog) {
        try {
            # The Windows login is used only for catalog SELECTs after the saved reader proves the exact book.
            $catalogConnection = Open-LocalBook 'A2006' 'AED_TEST'
            $null = Assert-ReadIdentity $catalogConnection 'AED_TEST' 'A2006'
            $report.sql = Read-AssessmentCatalog $catalogConnection $connection
            $report.catalogContext = 'Windows integrated catalog visibility'
        } catch { $report.windowsCatalogError = Get-AssessmentFailure $_ }
    }
    $report.state = 'Catalog captured'
} catch {
    $report.error = Get-AssessmentFailure $_
} finally {
    if ($catalogConnection) { $catalogConnection.Dispose() }
    if ($connection) { $connection.Dispose() }
    if ($reader -is [Management.Automation.PSCredential]) { $reader.Password.Dispose() }
}
$report | ConvertTo-Json -Depth 8
if ($report.state -eq 'Blocked') { exit 1 }
