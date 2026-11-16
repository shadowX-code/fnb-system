#requires -Version 5.1
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../autocount-aed-test-sql/sql-read.ps1')
. (Join-Path $PSScriptRoot '../provisioning.ps1')

function Assert-ObjectReadPermission {
    $script:checked++
}
$types=@{sqlTrigger='TR';clrTrigger='TA';triggerAlter='TR';triggerControl='TR';triggerExecute='TR';triggerColumn='TR';table='U';view='V';inlineFunction='IF'
    tableFunction='TF';clrFunction='FT';synonym='SN';externalTable='ET';internalTable='IT';queue='SQ';procedure='P';unknown='ZZ'
    defaultConstraint='D ';checkConstraint='C ';foreignKey='F ';primaryKey='PK';uniqueConstraint='UQ';edgeConstraint='EC'
    legacyRule='R ';planGuide='PG';statisticsTree='ST';tableType='TT';constraintAlter='D ';constraintColumn='D '}
$metadataOnly=@('sqlTrigger','clrTrigger','defaultConstraint','checkConstraint','foreignKey','primaryKey',
    'uniqueConstraint','edgeConstraint','legacyRule','planGuide','statisticsTree','tableType')
$overrides=@{triggerAlter='ALTER';triggerControl='CONTROL';triggerExecute='EXECUTE';procedure='EXECUTE';constraintAlter='ALTER'}
function Invoke-ReadQuery($Connection,$Sql,$Parameters) {
    if ($Sql -like "*fn_my_permissions(NULL, 'SERVER')*") {
        [pscustomobject]@{permission_name='CONNECT SQL'}
        if ($script:scenario -eq 'broadServer') { [pscustomobject]@{permission_name='CONTROL SERVER'} }
        return
    }
    if ($Sql -like "*fn_my_permissions(NULL, 'DATABASE')*") {
        [pscustomobject]@{permission_name='CONNECT'}
        if ($script:scenario -eq 'broadDatabase') { [pscustomobject]@{permission_name='SELECT'} }
        return
    }
    if ($Sql -match 'FROM sys.login_token') {
        if ($script:scenario -eq 'role') { [pscustomobject]@{name='db_datareader'} }
        return
    }
    if ($Sql -match 'FROM sys.schemas s') {
        if ($script:scenario -eq 'schema') {
            return [pscustomobject]@{schemaId=9;objectName='[legacy]';readerId=8;permission_name='SELECT'}
        }
        return
    }
    if ($Sql -match 'FROM sys.objects') {
        [pscustomobject]@{objectId=10;schemaId=1;readerId=8;objectName='[dbo].[GLMast]';objectType='U'}
        if ($script:scenario -ne 'approved') {
            $type=if ($types.ContainsKey($script:scenario)) { $types[$script:scenario] } else { 'U' }
            $name=if ($type -in @('TR','TA')) { '[dbo].[DeptChangeLog]' }
                elseif ($type -ceq 'D ') { '[dbo].[DF__Dept__Guid__54C1736E]' } else { '[dbo].[LegacyJournal]' }
            [pscustomobject]@{objectId=11;schemaId=1;readerId=8;objectName=$name;objectType=$type}
        }
        return
    }
    if ($Sql -match 'fn_my_permissions\(@object') {
        if ($Connection -cne 'reader') { throw 'Effective permissions were not checked on the reader session' }
        if ($Parameters['@object'] -cnotin @('[dbo].[LegacyJournal]','[dbo].[DeptChangeLog]','[dbo].[DF__Dept__Guid__54C1736E]')) { throw 'Unexpected effective permission check' }
        if ($script:scenario -in ($metadataOnly+@('triggerAlter','triggerControl','triggerExecute','constraintAlter'))) {
            [pscustomobject]@{permission_name='SELECT';subentity_name=$null}
            if (-not $overrides.ContainsKey($script:scenario)) { return }
            [pscustomobject]@{permission_name=$overrides[$script:scenario];subentity_name=$null}
            return
        }
        $permission=if ($overrides.ContainsKey($script:scenario)) { $overrides[$script:scenario] } else { 'SELECT' }
        return [pscustomobject]@{permission_name=$permission;subentity_name='Amount'}
    }
    if ($Sql -match 'FROM sys.user_token') {
        [pscustomobject]@{principal_id=8}
        [pscustomobject]@{principal_id=9}
        return
    }
    if ($Sql -match 'FROM sys.database_permissions') {
        $script:catalogConnection=$Connection
        if ($script:scenario -in $metadataOnly) { return }
        if ($script:scenario -eq 'noCatalog') { throw 'Do not report raw catalog failures' }
        if ($Parameters['@readerId'] -ne 8 -or $Parameters['@grantee1'] -ne 9 -or $Sql -notmatch "DATABASE_PRINCIPAL_ID\(N'public'\)") {
            throw 'Reader security token or implicit public membership not used'
        }
        if ($script:scenario -eq 'schema') {
            if ($Parameters['@schemaId'] -ne 9 -or $Parameters['@objectId'] -ne 0) { throw 'Wrong schema scope' }
            return [pscustomobject]@{grantScope='SCHEMA';grantSource='inherited token';roleName='Legacy readers';permission='SELECT';grantState='GRANT'}
        }
        if ($Parameters['@objectId'] -ne 11 -or $Parameters['@schemaId'] -ne 1) { throw 'Wrong object scope' }
        return [pscustomobject]@{grantScope='COLUMN';grantSource='public';columnName='Amount';permission='SELECT';grantState='GRANT'}
    }
    throw 'Unexpected query'
}

$script:ProvisionedLogin='fixture-reader'
$identity=@{login='fixture-reader';dbUser='fixture-reader';sysadmin=0;dbOwner=0;allReader=0;dbWriter=0
    dbDdl=0;dbSecurity=0;dbAccess=0;dbBackup=0}
$plan=@{names=@('[dbo].[GLMast]');metadataColumns=@('CompanyName','Guid')}
$script:checked=0
foreach ($script:scenario in (@('approved')+$metadataOnly)) {
    $script:checked=0
    Assert-ProvisionedReader 'reader' $identity $plan @() 'admin'
    if ($script:checked -ne 1) { throw 'Approved table did not receive the existing SELECT-only check' }
}

$blocked=@('public','schema','noCatalog','table','view','inlineFunction','tableFunction','clrFunction','synonym','externalTable',
    'internalTable','queue','procedure','unknown','triggerAlter','triggerControl','triggerExecute','triggerColumn',
    'constraintAlter','constraintColumn','broadServer','broadDatabase','role')
foreach ($script:scenario in $blocked) {
    $expected=switch ($script:scenario) {
        'schema' { 'READER_SCHEMA_PERMISSION_TOO_BROAD' }
        'role' { 'PROVISIONED_READER_HAS_ROLE' }
        { $_ -in @('broadServer','broadDatabase') } { 'SQL_IDENTITY_OVERPRIVILEGED' }
        default { 'READER_PERMISSION_OUTSIDE_APPROVED_OBJECTS' }
    }
    $observer=if ($script:scenario -ne 'noCatalog') { 'admin' }
    try {
        Assert-ProvisionedReader 'reader' $identity $plan @() $observer
        throw 'Unexpected effective permission was accepted'
    } catch {
        if ($_.Exception.Message -cne $expected) { throw }
        $details=$_.Exception.Data['FeedXPermissionDetails']
        if ($script:scenario -in @('broadServer','broadDatabase','role')) { continue }
        $expectedPermission=if ($overrides.ContainsKey($script:scenario)) { $overrides[$script:scenario] } else { 'SELECT' }
        if ($details.effective[0].permission -cne $expectedPermission -or $details.approvedObjects[0] -cne '[dbo].[GLMast]' -or
            ($details | ConvertTo-Json -Depth 6) -match 'fixture-reader|Do not report raw') { throw 'Unsafe or incomplete diagnostic' }
        switch ($script:scenario) {
            'public' {
                if ($details.securable -cne '[dbo].[LegacyJournal]' -or $details.effective[0].column -cne 'Amount' -or
                    $details.grantCatalogEntries[0].source -cne 'public' -or $details.grantCatalogEntries[0].scope -cne 'COLUMN' -or
                    $script:catalogConnection -cne 'admin') { throw 'Missing public grant attribution' }
            }
            'schema' {
                if ($details.securable -cne '[legacy]' -or $details.grantCatalogEntries[0].role -cne 'Legacy readers' -or
                    $details.grantCatalogEntries[0].scope -cne 'SCHEMA') { throw 'Missing inherited schema grant attribution' }
            }
            'noCatalog' {
                if ($details.grantEvidenceStatus -cne 'Unavailable' -or $details.grantEvidenceError -cne 'GRANT_CATALOG_LOOKUP_FAILED' -or
                    $script:catalogConnection -cne 'reader') { throw 'Grant lookup failure masked the rejection or leaked its exception' }
            }
        }
    }
}
Write-Host 'Non-rowset metadata SELECT, trigger and constraint permissions, readable rowsets, inherited access and broad grants checked.'
