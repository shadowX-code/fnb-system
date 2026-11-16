#requires -Version 5.1
$script:ProvisionedLogin='feedx_aed_test_reader'

function New-ReaderPlan($Catalog,$Mapping,[switch]$AccountingSync) {
    $tables=if ($AccountingSync) { @((Get-AccountingReadPlan $Catalog).Values | ForEach-Object table) } else {
        @(foreach ($kind in @('COA','GL')) { (Get-ReadPlan $Catalog $Mapping $kind).tables })
    }
    $names=@($tables | ForEach-Object { $_.name } | Sort-Object -Unique)
    if (-not $names.Count) { Stop-ReadPoc 'REVIEWED_OBJECTS_REQUIRED' }
    $grants=@($names | ForEach-Object { "GRANT SELECT ON OBJECT::$_ TO [feedx_aed_test_reader];" })
    return @{
        names=$names
        signature=@($tables | ForEach-Object { "$($_.id):$($_.name)" } | Sort-Object -Unique)
        statements=@('CREATE USER [feedx_aed_test_reader] FOR LOGIN [feedx_aed_test_reader];',
                     'GRANT CONNECT TO [feedx_aed_test_reader];')+$grants
    }
}

function New-ReaderSecret {
    $bytes=New-Object byte[] 32
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
        return (ConvertTo-SecureString ('Aa1!'+[Convert]::ToBase64String($bytes)) -AsPlainText -Force)
    } finally {
        [Array]::Clear($bytes,0,$bytes.Length)
        $rng.Dispose()
    }
}

function Invoke-ReaderSecurityCommand($Connection,$Transaction,[string]$Sql,[Security.SecureString]$Secret) {
    $command=$Connection.CreateCommand()
    $pointer=[IntPtr]::Zero
    try {
        if ($Transaction) { $command.Transaction=$Transaction }
        if ($Secret) {
            $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
            $literal=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
            if ($literal -cnotmatch '^Aa1![A-Za-z0-9+/]{43}=$') { Stop-ReadPoc 'GENERATED_PASSWORD_FORMAT_INVALID' }
            # Send recognizable native DDL so SQL audit redaction can apply.
            $command.CommandText=$Sql.Replace('<generated secret>',"'"+$literal+"'")
            $literal=$null
        } else { $command.CommandText=$Sql }
        $null=$command.ExecuteNonQuery()
    } finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $command.CommandText=''
        $command.Dispose()
    }
}

function Open-ProvisioningAdmin {
    $connection=[Data.SqlClient.SqlConnection]::new((New-AedReadConnectionString $true))
    try {
        $connection.Open()
        $identity=Assert-ReadIdentity $connection
        if ($identity.sysadmin -ne 1) { Stop-ReadPoc 'AUTHORIZED_WINDOWS_SYSADMIN_REQUIRED' }
        return $connection
    } catch { $connection.Dispose(); throw }
}

function Open-ProvisionedReader([Security.SecureString]$Secret) {
    $connection=[Data.SqlClient.SqlConnection]::new((New-AedReadConnectionString $false))
    try {
        $Secret.MakeReadOnly()
        $connection.Credential=[Data.SqlClient.SqlCredential]::new($script:ProvisionedLogin,$Secret)
        $connection.Open()
        return $connection
    } catch { $connection.Dispose(); throw }
}

function Test-TriggerSelectMetadata([string]$ObjectType,[string]$Permission,[string]$Column) {
    # SQL Server can report object SELECT for DML triggers, which cannot be queried as a row source.
    return $ObjectType -cin @('TR','TA') -and $Permission -ceq 'SELECT' -and -not $Column
}

function Get-ReaderPermissionDetails($Connection,$GrantCatalogConnection,$Object,$EffectivePermissions,$Plan) {
    $details=[ordered]@{
        scope=if ($Object.objectId) { 'OBJECT' } else { 'SCHEMA' }
        securable=$Object.objectName -replace '[\p{C}]','?'
        objectType=$Object.objectType
        effective=@(foreach ($entry in $EffectivePermissions) {
            @{permission=$entry.permission_name;column=$entry.subentity_name -replace '[\p{C}]','?'}
        })
        approvedObjects=@($Plan.names | ForEach-Object { $_ -replace '[\p{C}]','?' })
        approvedProfileColumns=@($Plan.metadataColumns | Where-Object { $_ })
        grantEvidenceStatus='Unavailable'
        grantCatalogEntries=@()
    }
    try {
        # The reader supplies its own security token. The existing admin session can see public and role grants hidden from the reader.
        $tokens=@(Invoke-ReadQuery $Connection @'
SELECT DISTINCT principal_id FROM sys.user_token
WHERE usage=N'GRANT OR DENY' AND principal_id>0
'@)
        $parameters=@{'@objectId'=[int]$Object.objectId;'@schemaId'=[int]$Object.schemaId;'@readerId'=[int]$Object.readerId}
        $tokenParameters=@(for ($i=0; $i -lt $tokens.Count; $i++) {
            $key="@grantee$i"
            $parameters[$key]=[int]$tokens[$i].principal_id
            $key
        })
        $grantees=(@('@readerId',"DATABASE_PRINCIPAL_ID(N'public')")+$tokenParameters) -join ','
        $catalog=if ($GrantCatalogConnection) { $GrantCatalogConnection } else { $Connection }
        $grants=@(Invoke-ReadQuery $catalog @"
SELECT TOP (33)
       CASE WHEN p.class=1 AND p.minor_id>0 THEN 'COLUMN'
            WHEN p.class=1 THEN 'OBJECT' WHEN p.class=3 THEN 'SCHEMA' ELSE 'DATABASE' END AS grantScope,
       CASE WHEN g.name=N'public' THEN 'public'
            WHEN g.principal_id=@readerId THEN 'direct reader'
            ELSE 'inherited token' END AS grantSource,
       CASE WHEN g.type='R' AND g.name<>N'public' THEN g.name END AS roleName,
       p.permission_name AS permission, p.state_desc AS grantState,
       CASE WHEN p.class=1 AND p.minor_id>0 THEN COL_NAME(p.major_id,p.minor_id) END AS columnName
FROM sys.database_permissions p
JOIN sys.database_principals g ON g.principal_id=p.grantee_principal_id
WHERE p.grantee_principal_id IN ($grantees)
  AND (p.class=0 OR (p.class=3 AND p.major_id=@schemaId) OR (p.class=1 AND p.major_id=@objectId))
  AND p.permission_name NOT IN ('CONNECT','VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION',
       'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION','VIEW ANY COLUMN MASTER KEY DEFINITION')
ORDER BY p.class DESC,p.minor_id,p.permission_name,g.principal_id
"@ $parameters)
        $details.grantEvidenceStatus=if ($GrantCatalogConnection) { 'Administrator catalog' } else { 'Reader-visible catalog only' }
        $details.grantCatalogEntries=@($grants | Select-Object -First 32 | ForEach-Object {
            @{scope=$_.grantScope;source=$_.grantSource;role=$_.roleName -replace '[\p{C}]','?'
              permission=$_.permission;state=$_.grantState;column=$_.columnName -replace '[\p{C}]','?'}
        })
        if ($grants.Count -gt 32) { $details.grantEvidenceTruncated=$true }
    } catch {
        # Failure to read attribution evidence must not replace the effective permission rejection.
        $failure=$_.Exception.GetBaseException()
        $details.grantEvidenceError=if ($failure -is [Data.SqlClient.SqlException]) { 'SQL_ERROR_'+$failure.Number } else { 'GRANT_CATALOG_LOOKUP_FAILED' }
    }
    return $details
}

function Assert-ProvisionedReader($Connection,$Identity,$Plan,$Databases,$GrantCatalogConnection) {
    Assert-ReadPermissions $Connection $Identity
    if ($Identity.login -cne $script:ProvisionedLogin -or $Identity.dbUser -cne $script:ProvisionedLogin) {
        Stop-ReadPoc 'PROVISIONED_READER_PRINCIPAL_MISMATCH'
    }
    $roles=@(Invoke-ReadQuery $Connection @'
SELECT name FROM sys.login_token WHERE type LIKE '%ROLE' AND name<>'public'
UNION ALL
SELECT name FROM sys.user_token WHERE type LIKE '%ROLE' AND name<>'public'
'@)
    if ($roles.Count) { Stop-ReadPermission 'PROVISIONED_READER_HAS_ROLE' @{roleCount=$roles.Count} }
    $accessible=0
    $indeterminate=0
    foreach ($database in $Databases) {
        $access=Invoke-ReadQuery $Connection 'SELECT HAS_DBACCESS(@db) AS allowed' @{'@db'=$database}
        if ($access.allowed -eq 1) { $accessible++ }
        elseif ($access.allowed -ne 0 -or $null -eq $access.allowed) { $indeterminate++ }
    }
    if ($accessible -or $indeterminate) {
        Stop-ReadPermission 'READER_OTHER_DATABASE_ACCESS_OR_UNKNOWN' @{accessibleCount=$accessible;indeterminateCount=$indeterminate}
    }
    $broad=@(Invoke-ReadQuery $Connection @'
SELECT TOP (32) s.schema_id AS schemaId, QUOTENAME(s.name) AS objectName,
       USER_ID() AS readerId, p.permission_name
FROM sys.schemas s
CROSS APPLY sys.fn_my_permissions(QUOTENAME(s.name),'SCHEMA') p
WHERE s.name NOT IN ('sys','INFORMATION_SCHEMA')
  AND p.permission_name NOT IN ('VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION')
ORDER BY s.schema_id,p.permission_name
'@)
    if ($broad.Count) {
        $first=$broad[0]
        $effective=@($broad | Where-Object schemaId -EQ $first.schemaId)
        Stop-ReadPermission 'READER_SCHEMA_PERMISSION_TOO_BROAD' (Get-ReaderPermissionDetails $Connection $GrantCatalogConnection $first $effective $Plan)
    }
    $visible=@(Invoke-ReadQuery $Connection @'
SELECT o.object_id AS objectId, o.schema_id AS schemaId, o.type AS objectType, USER_ID() AS readerId,
       QUOTENAME(s.name)+N'.'+QUOTENAME(o.name) AS objectName
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
WHERE o.is_ms_shipped=0
ORDER BY s.name,o.name,o.object_id
'@)
    foreach ($object in $visible) {
        if ($object.objectName -cin $Plan.names) { continue }
        $permissions=@(Invoke-ReadQuery $Connection @'
SELECT permission_name,subentity_name FROM sys.fn_my_permissions(@object,'OBJECT')
WHERE permission_name NOT IN ('VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION')
ORDER BY permission_name,subentity_name
'@ @{'@object'=$object.objectName} | Where-Object {
            -not (Test-TriggerSelectMetadata $object.objectType $_.permission_name $_.subentity_name)
        })
        if ($Plan.metadataColumns -and $object.objectName -ceq '[dbo].[Profile]') {
            $unexpected=@($permissions | Where-Object { $_.permission_name -ne 'SELECT' -or $_.subentity_name -cnotin $Plan.metadataColumns })
            if ($unexpected.Count) {
                Stop-ReadPermission 'READER_PROFILE_PERMISSION_TOO_BROAD' (Get-ReaderPermissionDetails $Connection $GrantCatalogConnection $object $unexpected $Plan)
            }
            foreach ($field in $Plan.metadataColumns) {
                $allowed = Invoke-ReadQuery $Connection "SELECT HAS_PERMS_BY_NAME(N'dbo.Profile','OBJECT','SELECT',@field,'COLUMN') AS allowed" @{'@field'=$field}
                if ($allowed.allowed -ne 1) { Stop-ReadPoc 'READER_PROFILE_PERMISSION_MISSING' }
            }
            continue
        }
        if ($permissions.Count) {
            Stop-ReadPermission 'READER_PERMISSION_OUTSIDE_APPROVED_OBJECTS' (Get-ReaderPermissionDetails $Connection $GrantCatalogConnection $object $permissions $Plan)
        }
    }
    foreach ($name in $Plan.names) { Assert-ObjectReadPermission $Connection @{name=$name} }
}

function Invoke-ProvisionAedReader($PrivatePath,$MappingPath,[switch]$AccountingSync) {
    $admin=$null
    $reader=$null
    $transaction=$null
    $secret=$null
    $created=$false
    $verified=$false
    $sid='0x'+[guid]::NewGuid().ToString('N')
    $staged=Join-Path $PrivatePath ('pending-reader-'+[guid]::NewGuid().ToString('N')+'.credential.xml')
    $final=Join-Path $PrivatePath 'read-sql.credential.xml'
    try {
        $admin=Open-ProvisioningAdmin
        $server=Invoke-ReadQuery $admin "SELECT CONVERT(int,SERVERPROPERTY('IsIntegratedSecurityOnly')) AS integratedOnly, SUSER_ID('feedx_aed_test_reader') AS loginId, USER_ID('feedx_aed_test_reader') AS userId"
        if ($server.integratedOnly -ne 0) { Stop-ReadPoc 'SQL_AUTHENTICATION_NOT_ENABLED' }
        if ($server.loginId -or $server.userId -or (Test-Path -LiteralPath $final)) { Stop-ReadPoc 'READER_OR_LOCAL_CREDENTIAL_ALREADY_EXISTS' }
        $catalog=Get-ReadCatalog $admin
        Write-LocalTextAtomically (Join-Path $PrivatePath 'schema.latest.json') ($catalog | ConvertTo-Json -Depth 10)
        Write-Host ('Administrator catalog and mapping: '+$PrivatePath)
        if ($AccountingSync) {
            $plan=New-ReaderPlan $catalog $null -AccountingSync
        } else {
        while ($true) {
            if ((Read-Host 'Type REVIEW READER GRANTS after reviewing the COA and GL mappings, or Enter to stop') -cne 'REVIEW READER GRANTS') {
                Stop-ReadPoc 'READER_PROVISIONING_REVIEW_PENDING'
            }
            try {
                $mapping=[IO.File]::ReadAllText((Get-RunLocalPath $MappingPath)) | ConvertFrom-Json
                $plan=New-ReaderPlan $catalog $mapping
                break
            } catch {
                $reason=$_.Exception.GetBaseException().Message
                if ($reason -cnotmatch '^[A-Z][A-Z0-9_]{3,80}$') { $reason='MAPPING_JSON_INVALID' }
                Write-Host ('Correct the private mapping, then retry: '+$reason)
            }
        }
        }
        $loginOptions=", SID = $sid, DEFAULT_DATABASE = [AED_TEST], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;"
        $createBatch='CREATE LOGIN [feedx_aed_test_reader] WITH PASSWORD = <generated secret>'+$loginOptions
        Write-Host $createBatch
        $plan.statements | ForEach-Object { Write-Host $_ }
        Write-Host 'If verification fails after commit, disable only this newly created login: ALTER LOGIN [feedx_aed_test_reader] DISABLE;'
        Write-Host 'Administrator: verify that SQL Server audit and tracing redact CREATE LOGIN passwords before approving.'
        if ((Read-Host 'Type APPROVE AED_TEST READER to execute exactly the displayed security changes') -cne 'APPROVE AED_TEST READER') {
            Stop-ReadPoc 'READER_PROVISIONING_APPROVAL_REQUIRED'
        }
        # Inventory database names from server metadata only. Never connect to another book.
        $inventory=@(Invoke-ReadQuery $admin "SELECT name,state_desc,user_access_desc FROM sys.databases WHERE database_id>4 AND name<>'AED_TEST'")
        if (@($inventory | Where-Object { $_.state_desc -ne 'ONLINE' -or $_.user_access_desc -ne 'MULTI_USER' }).Count) {
            Stop-ReadPoc 'OTHER_DATABASE_ACCESS_CANNOT_BE_VERIFIED'
        }
        $databases=@($inventory | ForEach-Object { $_.name })
        $currentPlan=New-ReaderPlan (Get-ReadCatalog $admin) $mapping -AccountingSync:$AccountingSync
        if (($plan.signature -join '|') -cne ($currentPlan.signature -join '|')) { Stop-ReadPoc 'REVIEWED_OBJECTS_CHANGED' }
        $secret=New-ReaderSecret
        $credential=[pscredential]::new($script:ProvisionedLogin,$secret)
        Save-ConnectorCredential $staged $credential
        $transaction=$admin.BeginTransaction()
        Invoke-ReaderSecurityCommand $admin $transaction $createBatch $secret
        foreach ($statement in $plan.statements) { Invoke-ReaderSecurityCommand $admin $transaction $statement }
        $transaction.Commit()
        $created=$true
        $transaction.Dispose()
        $transaction=$null
        $admin.Dispose()
        $admin=$null

        $reader=Open-ProvisionedReader $secret
        $identity=Assert-ReadIdentity $reader
        Assert-ProvisionedReader $reader $identity $plan $databases
        [IO.File]::Move($staged,$final)
        $verified=$true
        return @{credential=$credential;approvedObjects=$plan.names.Count;otherDatabasesChecked=$databases.Count}
    } catch {
        if ($transaction) { try { $transaction.Rollback() } catch {} }
        if ($created -and -not $verified) {
            if ($reader) { $reader.Dispose(); $reader=$null }
            try {
                if (-not $admin) { $admin=Open-ProvisioningAdmin }
                Invoke-ReaderSecurityCommand $admin $null "IF SUSER_SID('feedx_aed_test_reader') IS NULL OR SUSER_SID('feedx_aed_test_reader') <> $sid THROW 51000, 'Reader identity changed.', 1; ALTER LOGIN [feedx_aed_test_reader] DISABLE;"
                Write-Host 'The newly created reader was disabled after verification failed.'
            } catch { Stop-ReadPoc 'READER_DISABLE_FAILED_ADMIN_ACTION_REQUIRED' }
        }
        throw
    } finally {
        if ($transaction) { $transaction.Dispose() }
        if ($reader) { $reader.Dispose() }
        if ($admin) { $admin.Dispose() }
        if (-not $verified -and $secret) { $secret.Dispose() }
        if (-not $verified -and [IO.File]::Exists($staged)) { [IO.File]::Delete($staged) }
    }
}
