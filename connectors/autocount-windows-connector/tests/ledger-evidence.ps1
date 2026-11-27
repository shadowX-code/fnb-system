#requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../autocount-aed-test-sql/sql-read.ps1')
. (Join-Path $PSScriptRoot '../common/accounting-read.ps1')

$objects = @{GLDTL=1;GLMast=2;Dept=3;Project=4}
$columns = foreach ($dataset in $accountingTables.Keys) {
    $def = $accountingTables[$dataset]
    $names = @($def.columns.Values)
    if ($dataset -ceq 'GL') { $names += 'TransDate' }
    for ($i=0; $i -lt $names.Count; $i++) {
        $name = $names[$i]
        $type = switch ($name) {
            'IsActive' { 'd_Boolean' }
            'GLDtlKey' { 'bigint' }
            'TransDate' { 'datetime' }
            {$_ -in @('DR','CR','HomeDR','HomeCR')} { 'd_Money' }
            default { 'nvarchar' }
        }
        [pscustomobject]@{schemaName='dbo';tableName=$def.table;columnName=$name;columnId=$i+1;objectId=$objects[$def.table];sqlType=$type}
    }
}
$detail = foreach ($spec in $ledgerEvidenceColumns.Values) {
    $name,$type,$baseType,$length = $spec
    [pscustomobject]@{schemaName='dbo';tableName='GLDTL';columnName=$name;objectId=1;sqlType=$type;baseSqlType=$baseType;maxLength=$length}
}
$keys = foreach ($definition in $accountingTables.Values) {
    [pscustomobject]@{objectId=$objects[$definition.table];indexId=1;ordinal=1;columnName=$definition.columns.key}
}
$links = foreach ($code in @('AccNo','DeptNo','ProjNo')) {
    $linked = @($columns | Where-Object columnName -CEQ $code | Where-Object objectId -NE 1)[0]
    $gl = @($columns | Where-Object columnName -CEQ $code | Where-Object objectId -EQ 1)[0]
    [pscustomobject]@{fkId=$linked.objectId;sourceId=1;sourceColumnId=$gl.columnId;targetId=$linked.objectId;targetColumnId=$linked.columnId}
}
$catalog = @{columns=$columns+$detail;uniqueKeys=$keys;foreignKeys=$links}
$legacy = Get-AccountingReadPlan $catalog
$extended = Get-AccountingReadPlan $catalog -IncludeLedgerEvidence
if ($legacy.COA.sql -cne $extended.COA.sql -or $legacy.GL.sql -match 'PaymentDocKey') { throw 'Legacy extraction shape changed' }
if ($extended.GL.sql -notmatch 'CONVERT\(nvarchar\(32\), \[PaymentDocKey\]\) AS \[paymentDocKey\]' -or
    $extended.GL.sql -notmatch 'CONVERT\(nvarchar\(32\), \[SourceDtlKey\]\) AS \[sourceDtlKey\]' -or
    $extended.GL.sql -notmatch '\[RefNo2\] AS \[refNo2\]' -or
    $extended.GL.sql -notmatch 'WHERE \[TransDate\] >= CONVERT\(datetime,@start\) AND \[TransDate\] < CONVERT\(datetime,@end\)') {
    throw 'GL query must preserve raw keys and original date scope'
}
($detail | Where-Object columnName -CEQ 'RefNo2').maxLength = 64
try { $null = Get-AccountingReadPlan $catalog -IncludeLedgerEvidence; throw 'Unverified GL schema accepted' }
catch { if ($_.Exception.Message -cne 'ACCOUNTING_GL_DETAIL_SCHEMA_CHANGED') { throw } }
$null = Get-AccountingReadPlan $catalog
Write-Host 'PASS: AED_TEST GL projection, lossless keys, date scope and schema drift.'
