#requires -Version 5.1
. (Join-Path $PSScriptRoot 'local-paths.ps1')

function Stop-ReadPoc([string]$Code) {
    throw [InvalidOperationException]::new($Code)
}
function Invoke-ReadQuery($Connection,[string]$Sql,[hashtable]$Parameters=@{}) {
    $cmd=$Connection.CreateCommand()
    $cmd.CommandTimeout=30
    try {
        $cmd.CommandText=$Sql
        foreach ($name in $Parameters.Keys) {
            $value=$Parameters[$name]
            if ($value -is [int]) { $p=$cmd.Parameters.Add($name,[Data.SqlDbType]::Int) }
            elseif ($value -is [datetime]) { $p=$cmd.Parameters.Add($name,[Data.SqlDbType]::DateTime2) }
            else { $p=$cmd.Parameters.Add($name,[Data.SqlDbType]::NVarChar,512) }
            $p.Value=$value
        }
        $reader=$cmd.ExecuteReader()
        try {
            while ($reader.Read()) {
                $row=[ordered]@{}
                for ($i=0;$i -lt $reader.FieldCount;$i++) {
                    # SqlDecimal preserves precision beyond System.Decimal.
                    $v=if ($reader.IsDBNull($i)) { $null } elseif ($reader.GetDataTypeName($i) -in @('decimal','numeric')) { $reader.GetSqlDecimal($i).ToString() } else { $reader.GetValue($i) }
                    $row[$reader.GetName($i)]=$v
                }
                [pscustomobject]$row
            }
        } finally { $reader.Dispose() }
    } finally { $cmd.Dispose() }
}
function Assert-ReadIdentity($Connection,[string]$Book='AED_TEST',[string]$Instance='A2006') {
    $identity=Invoke-ReadQuery $Connection @'
SELECT DB_NAME() AS book, CONVERT(nvarchar(20), CONNECTIONPROPERTY('net_transport')) AS transport,
       CONVERT(nvarchar(128), SERVERPROPERTY('InstanceName')) AS instanceName, USER_NAME() AS dbUser, ORIGINAL_LOGIN() AS login, IS_SRVROLEMEMBER('sysadmin') AS sysadmin,
       IS_ROLEMEMBER('db_owner') AS dbOwner, IS_ROLEMEMBER('db_datareader') AS allReader,
       IS_ROLEMEMBER('db_datawriter') AS dbWriter, IS_ROLEMEMBER('db_ddladmin') AS dbDdl,
       IS_ROLEMEMBER('db_securityadmin') AS dbSecurity, IS_ROLEMEMBER('db_accessadmin') AS dbAccess,
       IS_ROLEMEMBER('db_backupoperator') AS dbBackup
'@
    if (-not $identity.login -or -not $identity.dbUser -or $identity.book -cne $Book -or ([string]$identity.instanceName) -ine $Instance -or $identity.transport -ne 'Shared memory') { Stop-ReadPoc 'TARGET_OR_TRANSPORT_MISMATCH' }
    return $identity
}
function Stop-ReadPermission([string]$Code,$Details) {
    $failure=[InvalidOperationException]::new($Code)
    $failure.Data['FeedXPermissionDetails']=$Details
    throw $failure
}

function Assert-ReadPermissions($Connection,$Identity) {
    $blockedPrincipals=@('dbo','guest' | Where-Object { $_ -eq $Identity.dbUser })
    $roles=[ordered]@{
        sysadmin='sysadmin'; db_owner='dbOwner'; db_datareader='allReader'; db_datawriter='dbWriter'
        db_ddladmin='dbDdl'; db_securityadmin='dbSecurity'; db_accessadmin='dbAccess'; db_backupoperator='dbBackup'
    }
    $memberships=@()
    $unknown=@()
    foreach ($role in $roles.Keys) {
        $property=$roles[$role]
        if ($Identity.$property -eq 1) { $memberships+=$role }
        elseif ($Identity.$property -ne 0) { $unknown+=$role }
    }
    $rejected=[ordered]@{}
    $missing=@()
    foreach ($scope in @('SERVER','DATABASE')) {
        $required=if ($scope -eq 'SERVER') { 'CONNECT SQL' } else { 'CONNECT' }
        $allowed=if ($scope -eq 'SERVER') { @('CONNECT SQL','VIEW ANY DATABASE') } else { @('CONNECT','VIEW DEFINITION','VIEW ANY COLUMN ENCRYPTION KEY DEFINITION','VIEW ANY COLUMN MASTER KEY DEFINITION') }
        $permissions=@(Invoke-ReadQuery $Connection "SELECT permission_name FROM sys.fn_my_permissions(NULL, '$scope')" | Select-Object -ExpandProperty permission_name)
        if ($required -notin $permissions) { $missing+="$scope/$required" }
        # Retain only SQL permission vocabulary. Principal and object names never enter this payload.
        $rejected[$scope]=@($permissions | Where-Object { $_ -notin $allowed } | ForEach-Object {
            if ($_ -cmatch '^[A-Z][A-Z ]{0,99}$') { $_ } else { 'UNRECOGNIZED_PERMISSION' }
        } | Sort-Object -Unique)
    }
    $details=[ordered]@{blockedPrincipalTypes=$blockedPrincipals;forbiddenRoles=$memberships;indeterminateRoles=$unknown;disallowedPermissions=$rejected;missingRequiredPermissions=$missing}
    if ($blockedPrincipals.Count -or $memberships.Count -or $rejected.SERVER.Count -or $rejected.DATABASE.Count) {
        Stop-ReadPermission 'SQL_IDENTITY_OVERPRIVILEGED' $details
    }
    if ($unknown.Count -or $missing.Count) { Stop-ReadPermission 'SQL_PERMISSION_EVIDENCE_INCOMPLETE' $details }
}
function Get-ReadCatalog($Connection) {
    $columns=@(Invoke-ReadQuery $Connection @'
SELECT TOP (20001) t.object_id AS objectId, s.name AS schemaName, t.name AS tableName,
       c.name AS columnName, c.column_id AS columnId, ty.name AS sqlType, c.max_length AS maxLength,
       c.is_nullable AS nullable, c.is_computed AS computed, c.collation_name AS collationName,
       TYPE_NAME(c.system_type_id) AS baseSqlType
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id
JOIN sys.types ty ON ty.user_type_id=c.user_type_id
WHERE t.is_ms_shipped=0 AND t.type='U'
ORDER BY t.object_id,c.column_id
'@)
    if (-not $columns.Count) { Stop-ReadPoc 'NO_VISIBLE_USER_TABLES' }
    $keys=@(Invoke-ReadQuery $Connection @'
SELECT TOP (20001) i.object_id AS objectId, i.index_id AS indexId, ic.key_ordinal AS ordinal, c.name AS columnName
FROM sys.indexes i JOIN sys.tables t ON t.object_id=i.object_id
JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE i.is_unique=1 AND i.is_disabled=0 AND i.is_hypothetical=0 AND i.has_filter=0 AND ic.key_ordinal>0 AND t.is_ms_shipped=0
ORDER BY i.object_id,i.index_id,ic.key_ordinal
'@)
    $links=@(Invoke-ReadQuery $Connection @'
SELECT TOP (20001) f.object_id AS fkId, f.name AS fkName, f.is_disabled AS disabled, f.is_not_trusted AS untrusted,
       fc.parent_object_id AS sourceId, fc.parent_column_id AS sourceColumnId,
       fc.referenced_object_id AS targetId, fc.referenced_column_id AS targetColumnId
FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
ORDER BY f.object_id,fc.constraint_column_id
'@)
    if ($columns.Count -gt 20000 -or $keys.Count -gt 20000 -or $links.Count -gt 20000) { Stop-ReadPoc 'CATALOG_LIMIT_REACHED' }
    # Discovery hints only. The operator must review application semantics.
    $hints=[ordered]@{}
    foreach ($pair in @(@('coa','account|accno|coa|glmast'),@('gl','ledger|journal|gldtl|posting|transaction'),@('classification','class|acctype|category'),@('fiscal','fiscal|period|year'),@('department','dept|department'),@('project','project'))) {
        $hints[$pair[0]]=@($columns | Where-Object { $_.tableName -match $pair[1] -or $_.columnName -match $pair[1] } | Select-Object schemaName,tableName -Unique)
    }
    return @{columns=$columns;uniqueKeys=$keys;foreignKeys=$links;hints=$hints}
}
function Quote-ReadIdentifier([string]$Name) {
    if (-not $Name -or $Name.Length -gt 128 -or $Name -match '[\x00-\x1f]') { Stop-ReadPoc 'MAPPING_IDENTIFIER_INVALID' }
    return '['+$Name.Replace(']',']]')+']'
}
function Get-ReadTable($Catalog,$Spec) {
    $cols=@($Catalog.columns | Where-Object { $_.schemaName -ceq $Spec.schema -and $_.tableName -ceq $Spec.table })
    if (-not $cols.Count) { Stop-ReadPoc 'MAPPING_TABLE_NOT_VISIBLE' }
    return @{id=$cols[0].objectId;columns=$cols;name=((Quote-ReadIdentifier $cols[0].schemaName)+'.'+(Quote-ReadIdentifier $cols[0].tableName))}
}
function Get-ReadColumn($Table,[string]$Name,[string[]]$Types=@()) {
    $matches=@($Table.columns | Where-Object columnName -CEQ $Name)
    if ($matches.Count -ne 1 -or $matches[0].computed) { Stop-ReadPoc 'MAPPING_COLUMN_MISSING_OR_COMPUTED' }
    if ($Types.Count -and $matches[0].sqlType -notin $Types) { Stop-ReadPoc 'MAPPING_COLUMN_TYPE_UNSUPPORTED' }
    return $matches[0]
}
function Assert-UniqueReadKey($Catalog,$Table,[string[]]$Names) {
    if ($Names.Count -lt 1 -or $Names.Count -gt 4 -or @($Names | Select-Object -Unique).Count -ne $Names.Count) { Stop-ReadPoc 'MAPPING_KEY_INVALID' }
    foreach ($name in $Names) { if ((Get-ReadColumn $Table $name).nullable) { Stop-ReadPoc 'MAPPING_KEY_NULLABLE' } }
    foreach ($index in @($Catalog.uniqueKeys | Where-Object objectId -EQ $Table.id | Group-Object indexId)) {
        $keys=@($index.Group | Sort-Object ordinal | Select-Object -ExpandProperty columnName)
        if (($keys -join [char]0) -ceq ($Names -join [char]0)) { return }
    }
    Stop-ReadPoc 'MAPPING_KEY_NOT_UNIQUE'
}
function Assert-ObjectReadPermission($Connection,$Table) {
    $permissions=@(Invoke-ReadQuery $Connection "SELECT permission_name FROM sys.fn_my_permissions(@object, 'OBJECT')" @{'@object'=$Table.name} | Select-Object -ExpandProperty permission_name)
    $denied=@($permissions | Where-Object { $_ -notin @('SELECT','VIEW DEFINITION') } | ForEach-Object {
        if ($_ -cmatch '^[A-Z][A-Z ]{0,99}$') { $_ } else { 'UNRECOGNIZED_PERMISSION' }
    } | Sort-Object -Unique)
    if ($denied.Count -or 'SELECT' -notin $permissions) {
        Stop-ReadPermission 'OBJECT_PERMISSION_NOT_SELECT_ONLY' @{scope='OBJECT';disallowedPermissions=$denied;missingSelect=('SELECT' -notin $permissions)}
    }
}
function Get-ReadPlan($Catalog,$Mapping,[ValidateSet('COA','GL')][string]$Kind) {
    $textTypes=@('char','varchar','nchar','nvarchar')
    $dateTypes=@('date','datetime','smalldatetime','datetime2')
    $amountTypes=@('tinyint','smallint','int','bigint','decimal','numeric','money','smallmoney')
    $safeTypes=$textTypes+$dateTypes+$amountTypes+@('bit','uniqueidentifier')
    $codes=@($Mapping.accountCodes)
    if ($codes.Count -lt 1 -or $codes.Count -gt 2 -or @($codes | Select-Object -Unique).Count -ne $codes.Count) { Stop-ReadPoc 'BOUNDED_CODES_REQUIRED' }
    $params=@{}
    for ($i=0;$i -lt $codes.Count;$i++) {
        $code=$codes[$i]
        if ($code -isnot [string] -or -not $code -or $code.Length -gt 100 -or $code -cne $code.Trim() -or $code -match '[\x00-\x1f]') { Stop-ReadPoc 'BOUNDED_CODES_REQUIRED' }
        $params["@code$i"]=$code
    }
    if ([string]::IsNullOrWhiteSpace($Mapping.coa.reviewReference)) { Stop-ReadPoc 'COA_MAPPING_REVIEW_REQUIRED' }
    $coa=Get-ReadTable $Catalog $Mapping.coa
    $coaCode=Get-ReadColumn $coa $Mapping.coa.codeColumn $textTypes
    if ($coaCode.maxLength -lt 1 -or $coaCode.maxLength -gt 2048) { Stop-ReadPoc 'MAPPING_FIELD_TOO_LARGE' }
    Assert-UniqueReadKey $Catalog $coa @($coaCode.columnName)
    $list=(@(0..($codes.Count-1) | ForEach-Object { "@code$_" }) -join ',')
    $tables=@($coa)
    $aliases=@{}
    $projection=@()
    if ($Kind -eq 'COA') {
        $fields=$Mapping.coa.fields
        $aliases['c']=$coa
        $projection+=('c.'+(Quote-ReadIdentifier $coaCode.columnName)+' AS [accountCode]')
        $from=$coa.name+' AS c'
        $account='c.'+(Quote-ReadIdentifier $coaCode.columnName)
        $where="$account IN ($list)"
        $order=$account
        $params['@take']=$codes.Count
    } else {
        $g=$Mapping.gl
        if ([string]::IsNullOrWhiteSpace($g.reviewReference)) { Stop-ReadPoc 'GL_MAPPING_REVIEW_REQUIRED' }
        $line=Get-ReadTable $Catalog $g
        $tables+=@($line); $aliases['g']=$line
        if ($line.id -eq $coa.id) { Stop-ReadPoc 'GL_COA_SAME_TABLE' }
        $lineAccount=Get-ReadColumn $line $g.accountColumn $textTypes
        if ($lineAccount.maxLength -lt 1 -or $lineAccount.maxLength -gt 2048) { Stop-ReadPoc 'MAPPING_FIELD_TOO_LARGE' }
        $account='g.'+(Quote-ReadIdentifier $lineAccount.columnName)
        $projection+=("$account AS [accountCode]")
        $from=$line.name+' AS g'
        $fields=$g.fields
        $dateTable=$line; $dateAlias='g'
        if ($g.header -and $g.header.table) {
            $header=Get-ReadTable $Catalog $g.header
            if ($header.id -in @($line.id,$coa.id)) { Stop-ReadPoc 'GL_JOIN_INVALID' }
            $join=Get-ReadJoin $Catalog $line $header $g.header.lineColumn $g.header.keyColumn $g.header.reviewReference 'g' 'h'
            $from+=" LEFT JOIN $($header.name) AS h ON $join"
            $tables+=@($header); $aliases['h']=$header
            $dateTable=$header; $dateAlias='h'
        }
        # A COA relationship is mandatory; a trusted single-column FK or separately reviewed logical join.
        $join=Get-ReadJoin $Catalog $line $coa $g.accountColumn $Mapping.coa.codeColumn $g.accountJoinReviewReference 'g' 'c'
        $from+=" LEFT JOIN $($coa.name) AS c ON $join"
        $projection+=('c.'+(Quote-ReadIdentifier $coaCode.columnName)+' AS [joinedAccountCode]')
        $date=Get-ReadColumn $dateTable $g.dateColumn $dateTypes
        $dateExpr=$dateAlias+'.'+(Quote-ReadIdentifier $date.columnName)
        $projection+=("$dateExpr AS [postingDate]")
        $start=[datetime]::MinValue; $end=[datetime]::MinValue
        $culture=[Globalization.CultureInfo]::InvariantCulture
        if (-not [datetime]::TryParseExact([string]$g.startDate,'yyyy-MM-dd',$culture,0,[ref]$start) -or
            -not [datetime]::TryParseExact([string]$g.endExclusive,'yyyy-MM-dd',$culture,0,[ref]$end) -or
            $start.Year -lt 1900 -or $end -le $start -or ($end-$start).TotalDays -gt 31) { Stop-ReadPoc 'GL_WINDOW_INVALID' }
        if (($g.maxRows -isnot [int] -and $g.maxRows -isnot [long]) -or $g.maxRows -lt 1 -or $g.maxRows -gt 200) { Stop-ReadPoc 'GL_LIMIT_INVALID' }
        $key=@($g.keyColumns)
        Assert-UniqueReadKey $Catalog $line $key
        $order=$dateExpr
        for ($i=0;$i -lt $key.Count;$i++) {
            $column=Get-ReadColumn $line $key[$i] $safeTypes
            if ($column.maxLength -eq -1 -or $column.maxLength -gt 2048) { Stop-ReadPoc 'MAPPING_FIELD_TOO_LARGE' }
            $q='g.'+(Quote-ReadIdentifier $column.columnName)
            $order+=','+$q
            $projection+=("$q AS [lineKey$($i+1)]")
        }
        $params['@take']=[int]$g.maxRows+1
        $params['@start']=$start; $params['@end']=$end
        $where="$account IN ($list) AND $dateExpr >= @start AND $dateExpr < @end"
    }
    $custom=@($fields | Where-Object { $_ })
    if ($custom.Count -lt 1 -or $custom.Count -gt 16) { Stop-ReadPoc 'MAPPING_FIELDS_REQUIRED' }
    $used=@('accountCode','joinedAccountCode','postingDate','lineKey1','lineKey2','lineKey3','lineKey4')
    foreach ($f in $custom) {
        if ($f.name -cnotmatch '^[A-Za-z][A-Za-z0-9_]{0,39}$' -or $f.name -in $used -or $f.source -cnotin @('c','g','h') -or -not $aliases.ContainsKey($f.source)) { Stop-ReadPoc 'MAPPING_FIELD_INVALID' }
        $column=Get-ReadColumn $aliases[$f.source] $f.column $safeTypes
        if ($column.maxLength -eq -1 -or $column.maxLength -gt 2048) { Stop-ReadPoc 'MAPPING_FIELD_TOO_LARGE' }
        if ($Kind -eq 'GL' -and $f.name -in @('amount','debit','credit') -and $column.sqlType -notin $amountTypes) { Stop-ReadPoc 'GL_AMOUNT_TYPE_UNSUPPORTED' }
        $projection+=($f.source+'.'+(Quote-ReadIdentifier $column.columnName)+' AS '+(Quote-ReadIdentifier $f.name))
        $used+=$f.name
    }
    if ($Kind -eq 'GL' -and ('amount' -notin $used -and ('debit' -notin $used -or 'credit' -notin $used))) { Stop-ReadPoc 'GL_AMOUNT_MAPPING_REQUIRED' }
    return @{sql=('SELECT TOP (@take) '+($projection -join ',')+' FROM '+$from+' WHERE '+$where+' ORDER BY '+$order);parameters=$params;tables=$tables}
}
function Get-ReadJoin($Catalog,$Source,$Target,[string]$From,[string]$To,[string]$Review,[string]$Left,[string]$Right) {
    $a=Get-ReadColumn $Source $From
    $b=Get-ReadColumn $Target $To
    if ($a.sqlType -cne $b.sqlType -or $a.collationName -cne $b.collationName) { Stop-ReadPoc 'GL_JOIN_TYPE_OR_COLLATION_MISMATCH' }
    Assert-UniqueReadKey $Catalog $Target @($To)
    $verified=$false
    foreach ($group in @($Catalog.foreignKeys | Where-Object sourceId -EQ $Source.id | Group-Object fkId)) {
        if ($group.Count -eq 1) {
            $f=$group.Group[0]
            if (-not $f.disabled -and -not $f.untrusted -and $f.targetId -eq $Target.id -and $f.sourceColumnId -eq $a.columnId -and $f.targetColumnId -eq $b.columnId) { $verified=$true }
        }
    }
    if (-not $verified -and [string]::IsNullOrWhiteSpace($Review)) { Stop-ReadPoc 'GL_JOIN_REVIEW_REQUIRED' }
    return ($Left+'.'+(Quote-ReadIdentifier $From)+'='+$Right+'.'+(Quote-ReadIdentifier $To))
}
