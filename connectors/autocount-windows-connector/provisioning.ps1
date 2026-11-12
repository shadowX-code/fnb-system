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

function Assert-ProvisionedReader($Connection,$Identity,$Plan,$Databases) {
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
SELECT p.permission_name
FROM sys.schemas s
CROSS APPLY sys.fn_my_permissions(QUOTENAME(s.name),'SCHEMA') p
WHERE s.name NOT IN ('sys','INFORMATION_SCHEMA')
  AND p.permission_name NOT IN ('VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION')
'@)
    if ($broad.Count) { Stop-ReadPoc 'READER_SCHEMA_PERMISSION_TOO_BROAD' }
    $visible=@(Invoke-ReadQuery $Connection @'
SELECT QUOTENAME(s.name)+N'.'+QUOTENAME(o.name) AS objectName
FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
WHERE o.is_ms_shipped=0
'@)
    foreach ($object in $visible) {
        if ($object.objectName -cin $Plan.names) { continue }
        if ($Plan.metadataColumns -and $object.objectName -ceq '[dbo].[Profile]') {
            $metadata = @(Invoke-ReadQuery $Connection @'
SELECT permission_name, subentity_name FROM sys.fn_my_permissions(N'dbo.Profile','OBJECT')
WHERE permission_name NOT IN ('VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION')
'@)
            if (@($metadata | Where-Object { $_.permission_name -ne 'SELECT' -or $_.subentity_name -cnotin $Plan.metadataColumns }).Count) {
                Stop-ReadPoc 'READER_PROFILE_PERMISSION_TOO_BROAD'
            }
            foreach ($field in $Plan.metadataColumns) {
                $allowed = Invoke-ReadQuery $Connection "SELECT HAS_PERMS_BY_NAME(N'dbo.Profile','OBJECT','SELECT',@field,'COLUMN') AS allowed" @{'@field'=$field}
                if ($allowed.allowed -ne 1) { Stop-ReadPoc 'READER_PROFILE_PERMISSION_MISSING' }
            }
            continue
        }
        $permissions=@(Invoke-ReadQuery $Connection "SELECT permission_name FROM sys.fn_my_permissions(@object,'OBJECT') WHERE permission_name NOT IN ('VIEW DEFINITION','VIEW SECURITY DEFINITION','VIEW PERFORMANCE DEFINITION')" @{'@object'=$object.objectName})
        if ($permissions.Count) { Stop-ReadPoc 'READER_PERMISSION_OUTSIDE_APPROVED_OBJECTS' }
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
