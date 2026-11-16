#requires -Version 5.1
. (Join-Path $PSScriptRoot '..\sql\sql-read.ps1')
. (Join-Path $PSScriptRoot '..\sql\connection.ps1')
. (Join-Path $PSScriptRoot '..\common\credentials.ps1')
. (Join-Path $PSScriptRoot '..\common\staging-response.ps1')
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
        Stop-StagingRequest $_ -AccountingEndpoint:($Rpc -ceq 'finance_accept_accounting_snapshot')
    }
}

function Invoke-DeviceAction($Credential,[hashtable]$Command) {
    return Invoke-DeviceApi $Credential 'finance_autocount_device' ($Command | ConvertTo-Json -Compress)
}

function Confirm-ActiveDevicePairing($Credential) {
    $device = Invoke-DeviceAction $Credential @{p_action='books'}
    $id = [guid]::Empty
    if (-not [guid]::TryParseExact([string]$device.deviceId,'D',[ref]$id) -or $id -eq [guid]::Empty) {
        Stop-ReadPoc 'DEVICE_CHECK_IN_RESPONSE_INVALID'
    }
}

function Request-DevicePairing($Credential,[string]$ComputerName) {
    try {
        $issued = Invoke-DeviceAction $Credential @{p_action='issue';p_company=$ComputerName}
    } catch {
        if ($_.Exception.GetBaseException().Message -cne 'STAGING_HTTP_409') { throw }
        try { Confirm-ActiveDevicePairing $Credential }
        catch {
            if ($_.Exception.GetBaseException().Message -ceq 'STAGING_HTTP_401') { Stop-ReadPoc 'DEVICE_REGISTRATION_INACTIVE' }
            throw
        }
        return @{state='Paired'}
    }

    if ($issued.code -cnotmatch '^[A-F0-9]{16}$') { Stop-ReadPoc 'PAIRING_RESPONSE_INVALID' }
    return @{state='Awaiting confirmation';code=$issued.code}
}

function Get-LocalConnectorBooks {
    foreach ($folder in (Get-ChildItem -LiteralPath $deviceRoot -Directory | Where-Object Name -cmatch '^[a-f0-9]{64}$')) {
        $path = Join-Path $folder.FullName 'book.json'
        if (-not (Test-Path -LiteralPath $path)) { continue }
        try { $book = [IO.File]::ReadAllText($path) | ConvertFrom-Json } catch { continue }
        if ($book.key -cne $folder.Name -or $book.database -cnotmatch '^[A-Z][A-Z0-9_]{0,63}$') { continue }
        $authorized = $book.authorized -ne $false -and (Test-Path -LiteralPath (Join-Path $folder.FullName 'reader.credential.xml'))
        $book | Add-Member -NotePropertyName authorized -NotePropertyValue $authorized -Force
        $book
    }
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

function Get-BookReaderPlan($Connection,$Identity,[string]$Database,$GrantCatalogConnection) {
    $inventoryVisible = Invoke-ReadQuery $Connection "SELECT HAS_PERMS_BY_NAME(NULL,NULL,'VIEW ANY DATABASE') AS allowed"
    if ($inventoryVisible.allowed -ne 1) { Stop-ReadPoc 'READER_DATABASE_INVENTORY_UNVERIFIED' }
    # Offline databases cannot be opened. Recheck inventory before every extraction.
    $inventory = @(Invoke-ReadQuery $Connection "SELECT name,state_desc,user_access_desc FROM sys.databases WHERE database_id > 4 AND state_desc <> 'OFFLINE' AND name <> @book" @{'@book'=$Database})
    $unverified = @($inventory | Where-Object { $_.state_desc -ne 'ONLINE' -or $_.user_access_desc -ne 'MULTI_USER' })
    if ($unverified.Count) {
        Stop-ReadPermission 'OTHER_DATABASE_ACCESS_CANNOT_BE_VERIFIED' @{
            unavailableCount=@($unverified | Where-Object state_desc -NE 'ONLINE').Count
            restrictedCount=@($unverified | Where-Object user_access_desc -NE 'MULTI_USER').Count
        }
    }
    $catalog = Get-ReadCatalog $Connection
    $plan = Get-AccountingReadPlan $catalog
    Assert-ProvisionedReader $Connection $Identity @{
        names=@($plan.Values | ForEach-Object { $_.table.name })
        metadataColumns=@('CompanyName','Guid')
    } @($inventory | ForEach-Object name) $GrantCatalogConnection
    return $plan
}

function Authorize-LocalBook([string]$Instance,[string]$Database,[string]$StartDate,$Confirm,[string]$ExpectedBookKey,[string]$ExpectedReader) {
    $admin = $null
    $lock = $null
    $transaction = $null
    $reader = $null
    $credential = $null
    $guardLogin = $false
    $stage = 'Book identity'
    try {
        $admin = Open-LocalBook $Instance $Database
        $identity = Assert-ReadIdentity $admin $Database (Get-InstanceIdentity $Instance)
        if ($identity.sysadmin -ne 1) { Stop-ReadPoc 'AUTHORIZED_WINDOWS_SYSADMIN_REQUIRED' }
        $company = Read-BookCompany $admin $Database
        if ($ExpectedBookKey -and $company.key -cne $ExpectedBookKey) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
        if (-not (& $Confirm $company.company)) { return $false }

        $root = Get-RunLocalPath $company.key -BaseDirectory $deviceRoot
        $null = [IO.Directory]::CreateDirectory($root)
        $lock = [IO.File]::Open((Join-Path $root 'authorization.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $bookPath = Join-Path $root 'book.json'
        $readerPath = Join-Path $root 'reader.credential.xml'
        $pendingPath = Join-Path $root 'reader.pending.credential.xml'
        if ($ExpectedReader -and ((Test-Path -LiteralPath $readerPath) -or -not (Test-Path -LiteralPath $pendingPath) -or
            -not (Test-Path -LiteralPath $bookPath))) {
            Stop-ReadPoc 'READER_REPAIR_STATE_CHANGED'
        }
        $book = [pscustomobject]@{key=$company.key;company=$company.company;instance=$Instance;database=$Database;startDate=$StartDate;bookId=$null;authorized=$false}
        if (Test-Path -LiteralPath $bookPath) {
            $previous = [IO.File]::ReadAllText($bookPath) | ConvertFrom-Json
            if ($previous.instance -ine $Instance) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
            $book.startDate = $previous.startDate
            $book.bookId = $previous.bookId
        }
        Write-LocalTextAtomically $bookPath ($book | ConvertTo-Json -Depth 4)

        $stage = 'SQL reader provisioning'
        if (Test-Path -LiteralPath $readerPath) {
            $credential = Import-Clixml -LiteralPath $readerPath
        } else {
            if (Test-Path -LiteralPath $pendingPath) {
                $credential = Import-Clixml -LiteralPath $pendingPath
            } else {
                $login = 'feedx_ro_'+[guid]::NewGuid().ToString('N')
                $credential = [pscredential]::new($login,(New-ReaderSecret))
                Save-ConnectorCredential $pendingPath $credential
            }
            $login = $credential.UserName
            if ($ExpectedReader -and $login -cne $ExpectedReader) { Stop-ReadPoc 'READER_REPAIR_STATE_CHANGED' }
            if ($login -cnotmatch '^feedx_ro_[a-f0-9]{32}$') { Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH' }
            $sid = '0x'+$login.Substring(9)
            $quoted = Quote-ReadIdentifier $login
            $existing = Invoke-ReadQuery $admin @'
SELECT SUSER_ID(@login) AS loginId, USER_ID(@login) AS userId,
       CONVERT(varchar(34),SUSER_SID(@login),1) AS loginSid,
       (SELECT CONVERT(varchar(34),sid,1) FROM sys.database_principals WHERE name=@login) AS userSid,
       (SELECT is_disabled FROM sys.sql_logins WHERE name=@login) AS disabled
'@ @{'@login'=$login}
            if ($existing.loginId -or $existing.userId) {
                if ($existing.loginSid -ine $sid -or $existing.userSid -ine $sid) { Stop-ReadPoc 'READER_PENDING_IDENTITY_MISMATCH' }
                if ($existing.disabled) { Invoke-ReaderSecurityCommand $admin $null "ALTER LOGIN $quoted ENABLE;" $null }
                $guardLogin = $true
            } else {
                if ($ExpectedReader) { Stop-ReadPoc 'READER_REPAIR_STATE_CHANGED' }
                $mode = Invoke-ReadQuery $admin "SELECT CONVERT(int,SERVERPROPERTY('IsIntegratedSecurityOnly')) AS integratedOnly"
                if ($mode.integratedOnly -ne 0) { Stop-ReadPoc 'SQL_AUTHENTICATION_NOT_ENABLED' }
                $plan = Get-AccountingReadPlan (Get-ReadCatalog $admin)
                $transaction = $admin.BeginTransaction()
                $target = Quote-ReadIdentifier $Database
                $ddl = "CREATE LOGIN $quoted WITH PASSWORD = <generated secret>, SID = $sid, DEFAULT_DATABASE = $target, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;"
                Invoke-ReaderSecurityCommand $admin $transaction $ddl $credential.Password
                Invoke-ReaderSecurityCommand $admin $transaction "CREATE USER $quoted FOR LOGIN $quoted; GRANT CONNECT TO $quoted;" $null
                foreach ($entry in $plan.Values) {
                    Invoke-ReaderSecurityCommand $admin $transaction "GRANT SELECT ON OBJECT::$($entry.table.name) TO $quoted;" $null
                }
                Invoke-ReaderSecurityCommand $admin $transaction "GRANT SELECT ON OBJECT::[dbo].[Profile] ([CompanyName], [Guid]) TO $quoted;" $null
                $transaction.Commit()
                $guardLogin = $true
            }
        }
        $stage = 'SQL reader sign-in'
        if ($credential -isnot [Management.Automation.PSCredential] -or $credential.UserName -cnotmatch '^feedx_ro_[a-f0-9]{32}$') {
            Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH'
        }
        $script:ProvisionedLogin = $credential.UserName
        $reader = Open-LocalBook $Instance $Database $credential
        $identity = Assert-ReadIdentity $reader $Database (Get-InstanceIdentity $Instance)
        $stage = 'SQL reader permissions'
        $null = Get-BookReaderPlan $reader $identity $Database $admin
        $confirmed = Read-BookCompany $reader $Database
        if ($confirmed.key -cne $company.key) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
        $stage = 'Save book authorization'
        if ($guardLogin) {
            [IO.File]::Move($pendingPath,$readerPath)
            $guardLogin = $false
        }
        $book.authorized = $true
        Write-LocalTextAtomically $bookPath ($book | ConvertTo-Json -Depth 4)
        return $true
    } catch {
        $original = $_.Exception
        if ($guardLogin) {
            if ($reader) { $reader.Dispose(); $reader = $null }
            try { Invoke-ReaderSecurityCommand $admin $null "IF SUSER_SID('$login')=$sid ALTER LOGIN $quoted DISABLE;" $null }
            catch {
                $failure = [InvalidOperationException]::new('READER_DISABLE_FAILED_ADMIN_ACTION_REQUIRED',$original)
                $failure.Data['FeedXStage'] = $stage
                $failure.Data['FeedXPermissionDetails'] = $original.Data['FeedXPermissionDetails']
                throw $failure
            }
        }
        $original.Data['FeedXStage'] = $stage
        throw
    } finally {
        if ($transaction) { $transaction.Dispose() }
        if ($reader) { $reader.Dispose() }
        if ($admin) { $admin.Dispose() }
        if ($credential -is [Management.Automation.PSCredential]) { $credential.Password.Dispose() }
        if ($lock) { $lock.Dispose() }
    }
}
