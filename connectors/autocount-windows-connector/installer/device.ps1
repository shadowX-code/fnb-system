#requires -Version 5.1
. (Join-Path $PSScriptRoot '..\sql\sql-read.ps1')
. (Join-Path $PSScriptRoot '..\sql\connection.ps1')
. (Join-Path $PSScriptRoot '..\common\credentials.ps1')
. (Join-Path $PSScriptRoot '..\common\accounting-read.ps1')
. (Join-Path $PSScriptRoot '..\provisioning.ps1')
Add-Type -AssemblyName System.Data

$deviceRoot = Get-RunLocalPath 'FeedX\AutoCountConnector' -BaseDirectory $env:LOCALAPPDATA
$null = [IO.Directory]::CreateDirectory($deviceRoot)
$deviceCredentialPath = Join-Path $deviceRoot 'device.credential.xml'
$apiKey = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'staging-public-key.txt')).Trim()
if ($apiKey -cnotmatch '^sb_publishable_[A-Za-z0-9_-]+$') { throw 'INSTALLER_INVALID' }

function Get-BookDigest([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-DeviceCredential([switch]$Create) {
    if (Test-Path -LiteralPath $deviceCredentialPath) { return Import-Clixml -LiteralPath $deviceCredentialPath }
    if (-not $Create) { Stop-ReadPoc 'DEVICE_NOT_PAIRED' }
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes); $secret = ConvertTo-SecureString (([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()) -AsPlainText -Force }
    finally { [Array]::Clear($bytes,0,$bytes.Length); $rng.Dispose() }
    $credential = [pscredential]::new('FeedX Connector',$secret)
    Save-ConnectorCredential $deviceCredentialPath $credential
    return $credential
}

function Invoke-DeviceApi($Credential,[string]$Rpc,[string]$Body,$Book=$null) {
    $headers = @{apikey=$apiKey;'x-feedx-connector'=$Credential.GetNetworkCredential().Password}
    if ($Book) {
        $headers['x-feedx-book'] = $Book.bookId
        $headers['x-feedx-source-book'] = $Book.database
    }
    try {
        return Invoke-RestMethod -UseBasicParsing -Uri ('https://ujkzdaaadnvcfayuldmh.supabase.co/rest/v1/rpc/'+$Rpc) -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($Body)) -TimeoutSec 35 -MaximumRedirection 0
    } catch {
        $response = $_.Exception.Response
        if ($response) { Stop-ReadPoc ('STAGING_HTTP_'+[int]$response.StatusCode) }
        Stop-ReadPoc 'STAGING_HTTPS_UNAVAILABLE'
    }
}

function Invoke-DeviceAction($Credential,[hashtable]$Command) {
    return Invoke-DeviceApi $Credential 'finance_autocount_device' ($Command | ConvertTo-Json -Compress)
}

function Get-LocalSqlInstances {
    $instances = @('MSSQLSERVER','A2006')
    foreach ($path in @('HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL')) {
        $key = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
        if ($key) { $instances += $key.GetValueNames() }
    }
    return @($instances | Where-Object { $_ -cmatch '^[A-Za-z0-9_]{1,32}$' } | Sort-Object -Unique)
}

function Open-LocalBook([string]$Instance,[string]$Database,$Credential=$null) {
    if ($Instance -notin (Get-LocalSqlInstances) -or ($Database -cne 'master' -and $Database -cnotmatch '^[A-Z][A-Z0-9_]{0,63}$')) {
        Stop-ReadPoc 'LOCAL_BOOK_TARGET_INVALID'
    }
    $builder = [Data.SqlClient.SqlConnectionStringBuilder]::new((New-AedReadConnectionString ($null -eq $Credential)))
    $builder['Data Source'] = if ($Instance -eq 'MSSQLSERVER') { 'lpc:(local)' } else { 'lpc:(local)\'+$Instance }
    $builder['Initial Catalog'] = $Database
    $connection = [Data.SqlClient.SqlConnection]::new($builder.ConnectionString)
    try {
        if ($Credential) {
            $Credential.Password.MakeReadOnly()
            $connection.Credential = [Data.SqlClient.SqlCredential]::new($Credential.UserName,$Credential.Password)
        }
        $connection.Open()
        return $connection
    } catch { $connection.Dispose(); throw }
}
function Get-InstanceIdentity([string]$Instance) {
    if ($Instance -eq 'MSSQLSERVER') { return '' }
    return $Instance
}
function Read-BookCompany($Connection,[string]$Database) {
    $rows = @(Invoke-ReadQuery $Connection @'
SELECT TOP (2) p.CompanyName AS company,p.Guid AS profileId,d.service_broker_guid AS brokerId
FROM dbo.Profile p CROSS JOIN sys.databases d WHERE d.database_id=DB_ID()
'@)
    if ($rows.Count -ne 1 -or -not $rows[0].profileId -or -not $rows[0].brokerId -or
        $rows[0].profileId -eq [guid]::Empty -or $rows[0].brokerId -eq [guid]::Empty -or
        -not $rows[0].company -or $rows[0].company.Trim().Length -gt 180) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_UNVERIFIED' }
    return @{company=$rows[0].company.Trim();key=(Get-BookDigest ('AutoCount|'+$Database+'|'+$rows[0].profileId+'|'+$rows[0].brokerId))}
}

function Get-BookReaderPlan($Connection,$Identity,[string]$Database) {
    $inventoryVisible = Invoke-ReadQuery $Connection "SELECT HAS_PERMS_BY_NAME(NULL,NULL,'VIEW ANY DATABASE') AS allowed"
    if ($inventoryVisible.allowed -ne 1) { Stop-ReadPoc 'READER_DATABASE_INVENTORY_UNVERIFIED' }
    $inventory = @(Invoke-ReadQuery $Connection "SELECT name,state_desc,user_access_desc FROM sys.databases WHERE database_id > 4 AND name <> @book" @{'@book'=$Database})
    if (@($inventory | Where-Object { $_.state_desc -ne 'ONLINE' -or $_.user_access_desc -ne 'MULTI_USER' }).Count) {
        Stop-ReadPoc 'OTHER_DATABASE_ACCESS_CANNOT_BE_VERIFIED'
    }
    $catalog = Get-ReadCatalog $Connection
    $plan = Get-AccountingReadPlan $catalog
    Assert-ProvisionedReader $Connection $Identity @{
        names=@($plan.Values | ForEach-Object { $_.table.name })
        metadataColumns=@('CompanyName','Guid')
    } @($inventory | ForEach-Object name)
    return $plan
}

function Authorize-LocalBook([string]$Instance,[string]$Database,$Confirm) {
    $admin = Open-LocalBook $Instance $Database
    $transaction = $null
    $reader = $null
    $secret = $null
    $created = $false
    $stored = $false
    $login = 'feedx_ro_'+[guid]::NewGuid().ToString('N')
    $sid = '0x'+[guid]::NewGuid().ToString('N')
    try {
        $identity = Assert-ReadIdentity $admin $Database (Get-InstanceIdentity $Instance)
        if ($identity.sysadmin -ne 1) { Stop-ReadPoc 'AUTHORIZED_WINDOWS_SYSADMIN_REQUIRED' }
        $company = Read-BookCompany $admin $Database
        if (-not (& $Confirm $company.company)) { return $null }
        $bookRoot = Join-Path $deviceRoot $company.key
        $null = [IO.Directory]::CreateDirectory($bookRoot)
        $readerPath = Join-Path $bookRoot 'reader.credential.xml'
        $script:ProvisionedLogin = $login
        if (Test-Path -LiteralPath $readerPath) {
            $bookFile = Join-Path $bookRoot 'book.json'
            if ((Test-Path -LiteralPath $bookFile) -and
                (([IO.File]::ReadAllText($bookFile) | ConvertFrom-Json).instance -ine $Instance)) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
            $credential = Import-Clixml -LiteralPath $readerPath
            $script:ProvisionedLogin = $credential.UserName
        } else {
            $mode = Invoke-ReadQuery $admin "SELECT CONVERT(int,SERVERPROPERTY('IsIntegratedSecurityOnly')) AS integratedOnly"
            if ($mode.integratedOnly -ne 0) { Stop-ReadPoc 'SQL_AUTHENTICATION_NOT_ENABLED' }
            $plan = Get-AccountingReadPlan (Get-ReadCatalog $admin)
            $secret = New-ReaderSecret
            $credential = [pscredential]::new($login,$secret)
            $transaction = $admin.BeginTransaction()
            $quoted = Quote-ReadIdentifier $login
            $target = Quote-ReadIdentifier $Database
            $ddl = "CREATE LOGIN $quoted WITH PASSWORD = <generated secret>, SID = $sid, DEFAULT_DATABASE = $target, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;"
            Invoke-ReaderSecurityCommand $admin $transaction $ddl $secret
            Invoke-ReaderSecurityCommand $admin $transaction "CREATE USER $quoted FOR LOGIN $quoted; GRANT CONNECT TO $quoted;" $null
            foreach ($entry in $plan.Values) {
                Invoke-ReaderSecurityCommand $admin $transaction "GRANT SELECT ON OBJECT::$($entry.table.name) TO $quoted;" $null
            }
            Invoke-ReaderSecurityCommand $admin $transaction "GRANT SELECT ON OBJECT::[dbo].[Profile] ([CompanyName], [Guid]) TO $quoted;" $null
            $transaction.Commit()
            $created = $true
        }
        $reader = Open-LocalBook $Instance $Database $credential
        $identity = Assert-ReadIdentity $reader $Database (Get-InstanceIdentity $Instance)
        $null = Get-BookReaderPlan $reader $identity $Database
        $confirmed = Read-BookCompany $reader $Database
        if ($confirmed.key -cne $company.key) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
        if ($created) { Save-ConnectorCredential $readerPath $credential }
        $stored = $true
        return @{root=$bookRoot;key=$company.key;company=$company.company;instance=$Instance;database=$Database}
    } catch {
        if ($created -and -not $stored) {
            if ($reader) { $reader.Dispose(); $reader = $null }
            try { Invoke-ReaderSecurityCommand $admin $null "IF SUSER_SID('$login')=$sid ALTER LOGIN [$login] DISABLE;" $null }
            catch { Stop-ReadPoc 'READER_DISABLE_FAILED_ADMIN_ACTION_REQUIRED' }
        }
        throw
    } finally {
        if ($transaction) { $transaction.Dispose() }
        if ($reader) { $reader.Dispose() }
        $admin.Dispose()
        if ($secret) { $secret.Dispose() }
    }
}
