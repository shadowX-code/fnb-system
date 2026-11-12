#requires -Version 5.1
$accountingTables = [ordered]@{
    COA = @{ table='GLMast'; columns=[ordered]@{key='AccNo';parent='ParentAccNo';description='Description';type='AccType';currency='CurrencyCode'} }
    GL = @{ table='GLDTL'; columns=[ordered]@{key='GLDtlKey';account='AccNo';department='DeptNo';project='ProjNo';currency='CurrencyCode';debit='DR';credit='CR';homeDebit='HomeDR';homeCredit='HomeCR'} }
    Department = @{ table='Dept'; columns=[ordered]@{key='DeptNo';parent='ParentDeptNo';description='Description';active='IsActive'} }
    Project = @{ table='Project'; columns=[ordered]@{key='ProjNo';parent='ParentProjNo';description='Description';active='IsActive'} }
}
function Get-AccountingReadPlan($Catalog) {
    $tables = @{}
    foreach ($kind in $accountingTables.Keys) {
        $definition = $accountingTables[$kind]
        $table = Get-ReadTable $Catalog @{schema='dbo';table=$definition.table}
        Assert-UniqueReadKey $Catalog $table @($definition.columns.key)
        $select = foreach ($field in $definition.columns.Keys) {
            $column = Get-ReadColumn $table $definition.columns[$field]
            $identifier = Quote-ReadIdentifier $column.columnName
            # AutoCount uses alias types. Keep money as invariant SQL text and bigint keys as strings.
            if ($field -eq 'active') {
                if ($column.sqlType -cne 'd_Boolean') { Stop-ReadPoc 'ACCOUNTING_SCHEMA_CHANGED' }
                $identifier = "CAST($identifier AS bit)"
            } elseif ($field -eq 'key' -and $kind -eq 'GL') {
                if ($column.sqlType -cne 'bigint') { Stop-ReadPoc 'ACCOUNTING_SCHEMA_CHANGED' }
                $identifier = "CONVERT(nvarchar(32), $identifier)"
            } elseif ($field -in @('debit','credit','homeDebit','homeCredit')) {
                if ($column.sqlType -cne 'd_Money') { Stop-ReadPoc 'ACCOUNTING_SCHEMA_CHANGED' }
                if ($column.baseSqlType -and $column.baseSqlType -notin @('numeric','decimal','money','smallmoney')) {
                    Stop-ReadPoc 'ACCOUNTING_AMOUNT_TYPE_UNSUPPORTED'
                }
                # Style 2 preserves all four decimals for SQL Server money; exact numerics retain their scale.
                $identifier = "CONVERT(varchar(80), $identifier, 2)"
            } elseif ($column.sqlType -cnotin @('nvarchar','d_AccNo','d_AccDescription','d_AccType','d_Dept','d_Project','d_CurrencyCode')) {
                Stop-ReadPoc 'ACCOUNTING_SCHEMA_CHANGED'
            }
            "$identifier AS $(Quote-ReadIdentifier $field)"
        }
        $where = ''
        if ($kind -eq 'GL') {
            $null = Get-ReadColumn $table 'TransDate' @('datetime')
            $where = ' WHERE [TransDate] >= CONVERT(datetime,@start) AND [TransDate] < CONVERT(datetime,@end)'
        }
        $order = Quote-ReadIdentifier $definition.columns.key
        $tables[$kind] = @{table=$table;sql="SELECT TOP (@limit) $($select -join ', ') FROM $($table.name)$where ORDER BY $order"}
    }
    foreach ($link in @(@('AccNo','COA'),@('DeptNo','Department'),@('ProjNo','Project'))) {
        $from = Get-ReadColumn $tables.GL.table $link[0]
        $to = Get-ReadColumn $tables[$link[1]].table $accountingTables[$link[1]].columns.key
        $matches = @($Catalog.foreignKeys | Where-Object {
            -not $_.disabled -and -not $_.untrusted -and $_.sourceId -eq $from.objectId -and
            $_.sourceColumnId -eq $from.columnId -and $_.targetId -eq $to.objectId -and $_.targetColumnId -eq $to.columnId
        })
        if ($matches.Count -ne 1 -or @($Catalog.foreignKeys | Where-Object fkId -EQ $matches[0].fkId).Count -ne 1) {
            Stop-ReadPoc 'ACCOUNTING_SOURCE_RELATIONSHIP_UNVERIFIED'
        }
    }
    return $tables
}
function Read-AccountingScope($Connection,$Plan,[string]$Dataset,[datetime]$Day) {
    $parameters = @{'@limit'=5001}
    if ($Dataset -eq 'GL') { $parameters['@start']=$Day; $parameters['@end']=$Day.AddDays(1) }
    $rows = @(Invoke-ReadQuery $Connection $Plan[$Dataset].sql $parameters)
    if ($rows.Count -gt 5000) { Stop-ReadPoc 'ACCOUNTING_SCOPE_EXCEEDS_ROW_LIMIT' }
    if ($Dataset -eq 'COA' -and -not $rows.Count) { Stop-ReadPoc 'ACCOUNTING_COA_EMPTY' }
    return $rows
}
