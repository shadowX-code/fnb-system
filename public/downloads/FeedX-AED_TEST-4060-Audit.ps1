#requires -Version 5.1
# Read-only metadata audit. Uses the installed connector and saved reader without changing either.
$ErrorActionPreference='Stop'
$installer=Join-Path $env:LOCALAPPDATA 'Programs\FeedX AutoCount Connector\installer'
. (Join-Path $installer 'device.ps1')

function Get-AuditError($Record) {
    $failure=$Record.Exception
    while ($failure.InnerException -and $failure -isnot [Data.SqlClient.SqlException]) { $failure=$failure.InnerException }
    if ($failure -is [Data.SqlClient.SqlException]) {
        return @{code='SQL_ERROR_'+$failure.Number
            sql=@($failure.Errors | ForEach-Object { @{number=$_.Number;state=$_.State;severity=$_.Class} })}
    }
    return @{code=if ($failure.Message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $failure.Message } else { 'LOCAL_AUDIT_CHECK_FAILED' }}
}
function Read-AuditJson([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
}
function Invoke-AuditQuery($Connection,[string]$Query,[hashtable]$Parameters=@{}) {
    Invoke-ReadQuery $Connection $Query $Parameters
}

$report=[ordered]@{target='lpc:(local)\A2006 / AED_TEST';checkedAtUtc=[datetime]::UtcNow.ToString('o')
    changesPerformed=$false;task=@{};savedReader=@{};windowsMetadata=@{};readerDatabase=@{};readerServer=@{};nextActions=@()}
$credential=$null
$windows=$null
$adminBook=$null
$reader=$null
$readerMaster=$null
$lock=$null
try {
    $version=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FeedXAutoCount' -Name DisplayVersion -ErrorAction SilentlyContinue
    $report.installedVersion=$version.DisplayVersion
    $report.installedScripts=@(foreach ($relative in @('worker.ps1','device.ps1','..\sync.ps1')) {
        $path=Join-Path $installer $relative
        if (Test-Path -LiteralPath $path) {
            @{file=$relative;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
                modifiedUtc=(Get-Item -LiteralPath $path).LastWriteTimeUtc.ToString('o')}
        }
    })
    $local=@(Get-LocalConnectorBooks | Where-Object { $_.instance -ieq 'A2006' -and $_.database -ceq 'AED_TEST' })
    if ($local.Count -ne 1) { Stop-ReadPoc 'AED_TEST_SAVED_TARGET_NOT_UNIQUE' }
    $book=$local[0]
    if ($book.key -cnotmatch '^[a-f0-9]{64}$') { Stop-ReadPoc 'AED_TEST_SAVED_BOOK_INVALID' }
    $directory=Get-RunLocalPath $book.key -BaseDirectory $deviceRoot
    $lock=[IO.File]::Open((Join-Path $directory 'authorization.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $active=Join-Path $directory 'reader.credential.xml'
    $pending=Join-Path $directory 'reader.pending.credential.xml'
    if (-not (Test-Path -LiteralPath $active) -or (Test-Path -LiteralPath $pending)) { Stop-ReadPoc 'SAVED_READER_STATE_REQUIRES_REVIEW' }
    $credential=Import-Clixml -LiteralPath $active
    if ($credential -isnot [Management.Automation.PSCredential] -or $credential.UserName -cnotmatch '^feedx_ro_[a-f0-9]{32}$') {
        Stop-ReadPoc 'READER_CREDENTIAL_PRINCIPAL_MISMATCH'
    }
    $login=$credential.UserName
    $report.savedReader=@{dpapiReadable=$true;authorized=$book.authorized;credentialModifiedUtc=(Get-Item -LiteralPath $active).LastWriteTimeUtc.ToString('o')
        metadataFingerprint=Get-BookDigest ((Get-Item -LiteralPath $active).LastWriteTimeUtc.ToString('o')+'|'+$login)}
    $config=Read-AuditJson (Join-Path $directory 'config.json')
    $report.savedTarget=@{instance=$book.instance;database=$book.database;hasBinding=[bool]$book.bookId
        nextGlDate=$config.nextDate}
    $builder=[Data.SqlClient.SqlConnectionStringBuilder]::new((New-AedReadConnectionString $false))
    $report.savedTarget.connection=@{dataSource=$builder['Data Source'];database=$builder['Initial Catalog']
        integratedSecurity=$builder['Integrated Security'];pooling=$builder['Pooling'];credentialSource='existing saved SQL reader'}

    try {
        $task=Get-ScheduledTask -TaskName 'FeedX AutoCount Connector' -TaskPath '\' -ErrorAction Stop
        $taskInfo=Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath '\' -ErrorAction Stop
        $taskOwner=$task.Principal.UserId
        if ($taskOwner -notmatch '^S-1-') { $taskOwner=([Security.Principal.NTAccount]::new($taskOwner)).Translate([Security.Principal.SecurityIdentifier]).Value }
        $expectedWorker=Join-Path $installer 'worker.ps1'
        $report.task=@{state=[string]$task.State;logonType=[string]$task.Principal.LogonType
            sameWindowsIdentity=($taskOwner -ceq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
            lastResult=$taskInfo.LastTaskResult;lastRunUtc=$taskInfo.LastRunTime.ToUniversalTime().ToString('o')
            nextRunUtc=$taskInfo.NextRunTime.ToUniversalTime().ToString('o');missedRuns=$taskInfo.NumberOfMissedRuns
            workerPathMatches=(@($task.Actions | Where-Object { $_.Arguments -like ('*"'+$expectedWorker+'"*') }).Count -eq 1)}
    } catch { $report.task=Get-AuditError $_ }
    try {
        $events=@(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational';StartTime=(Get-Date).AddHours(-2)} -MaxEvents 150 -ErrorAction Stop)
        $report.taskEvents=@(foreach ($event in $events) {
            $xml=[xml]$event.ToXml()
            $fields=@{}
            foreach ($field in $xml.Event.EventData.Data) { $fields[[string]$field.Name]=[string]$field.'#text' }
            if ($fields.TaskName -ceq '\FeedX AutoCount Connector') {
                @{eventId=$event.Id;utc=$event.TimeCreated.ToUniversalTime().ToString('o');resultCode=$fields.ResultCode}
            }
        })
    } catch { $report.taskEventsStatus='Task Scheduler operational log is unavailable or has no recent events.' }
    $poll=Read-AuditJson (Join-Path $deviceRoot 'poll-summary.json')
    $test=Read-AuditJson (Join-Path $directory 'connection-test.json')
    $sync=Read-AuditJson (Join-Path $directory 'status.json')
    $report.localResults=@{
        worker=@{state=$poll.state;error=$poll.error;finishedAt=$poll.finishedAt;paired=$poll.paired}
        connectionTest=@{error=$test.error;failureType=$test.failureType;line=$test.line;finishedAt=$test.finishedAt;sql=$test.sqlConnection}
        sync=@{error=$sync.error;failureType=$sync.failureType;line=$sync.line;finishedAt=$sync.finishedAt;sql=$sync.sqlConnection;pending=$sync.pending}
    }

    try {
        $windows=Open-LocalBook 'A2006' 'master'
        $observer=Invoke-AuditQuery $windows @'
SELECT CONVERT(nvarchar(128),SERVERPROPERTY('InstanceName')) AS instanceName,
       IS_SRVROLEMEMBER('sysadmin') AS isSqlAdmin,
       CASE WHEN ORIGINAL_LOGIN()=SUSER_SNAME() THEN 1 ELSE 0 END AS originalContext;
'@
        if ($observer.instanceName -ine 'A2006' -or $observer.originalContext -ne 1) { Stop-ReadPoc 'AUDIT_OBSERVER_TARGET_MISMATCH' }
        $report.windowsMetadata.observerAdmin=$observer.isSqlAdmin -eq 1
        if ($observer.isSqlAdmin -ne 1) {
            $report.nextActions+='An authorized local SQL administrator must run this audit to establish database and login state.'
        } else {
            $state=@(Invoke-AuditQuery $windows @'
SELECT d.state_desc AS databaseState,d.user_access_desc AS databaseAccess,d.is_read_only AS databaseReadOnly,
       HAS_DBACCESS(d.name) AS adminHasAccess,
       CASE WHEN d.owner_sid=SUSER_SID(@login) THEN 1 ELSE 0 END AS readerOwnsDatabase
FROM sys.databases d WHERE d.name=N'AED_TEST';
'@ @{'@login'=$login})
            $report.windowsMetadata.database=if ($state.Count -eq 1) { $state[0] } else { @{missing=$true} }
            $loginState=@(Invoke-AuditQuery $windows @'
SELECT l.is_disabled AS loginDisabled,
       CASE WHEN l.sid=CONVERT(varbinary(16),N'0x'+SUBSTRING(@login,10,32),1) THEN 1 ELSE 0 END AS expectedLoginSid,
       CASE WHEN l.default_database_name=N'AED_TEST' THEN 1 ELSE 0 END AS defaultDatabaseIsTarget,
       CONVERT(int,LOGINPROPERTY(l.name,N'IsLocked')) AS passwordLocked,
       CONVERT(int,LOGINPROPERTY(l.name,N'IsExpired')) AS passwordExpired,
       CONVERT(int,LOGINPROPERTY(l.name,N'IsMustChange')) AS passwordMustChange
FROM sys.sql_logins l WHERE l.name=@login;
'@ @{'@login'=$login})
            $report.windowsMetadata.login=if ($loginState.Count -eq 1) { $loginState[0] } else { @{missing=$true} }
            if ($state.Count -eq 1 -and $state[0].databaseState -ceq 'ONLINE' -and $state[0].databaseAccess -ceq 'MULTI_USER') {
                try {
                    $adminBook=Open-LocalBook 'A2006' 'AED_TEST'
                    $null=Assert-ReadIdentity $adminBook 'AED_TEST' 'A2006'
                    $report.windowsMetadata.sameBookIdentity=(Read-BookCompany $adminBook 'AED_TEST').key -ceq $book.key
                    $mapping=@(Invoke-AuditQuery $adminBook @'
SELECT CASE WHEN p.sid=SUSER_SID(@login) THEN 1 ELSE 0 END AS loginUserSidMatch,
       CASE WHEN p.sid=CONVERT(varbinary(16),N'0x'+SUBSTRING(@login,10,32),1) THEN 1 ELSE 0 END AS expectedUserSid,
       p.type_desc AS databasePrincipalType
FROM sys.database_principals p WHERE p.name=@login;
'@ @{'@login'=$login})
                    $report.windowsMetadata.user=if ($mapping.Count -eq 1) { $mapping[0] } else { @{missing=$true} }
                    $report.windowsMetadata.connectGrants=@(Invoke-AuditQuery $adminBook @'
;WITH memberships AS (
 SELECT principal_id FROM sys.database_principals WHERE name=@login OR name=N'public'
 UNION ALL
 SELECT m.role_principal_id FROM sys.database_role_members m JOIN memberships p ON m.member_principal_id=p.principal_id
)
SELECT DISTINCT CASE WHEN p.name=@login THEN N'dedicated reader' ELSE p.name END AS principal,
       p.type_desc AS principalType,a.permission_name AS permission,a.state_desc AS grantState
FROM memberships m JOIN sys.database_principals p ON p.principal_id=m.principal_id
LEFT JOIN sys.database_permissions a ON a.grantee_principal_id=m.principal_id AND a.class=0
  AND a.permission_name IN ('CONNECT','CONTROL')
ORDER BY principal,permission;
'@ @{'@login'=$login})
                    if ($mapping.Count -eq 1 -and $loginState.Count -eq 1 -and $loginState[0].expectedLoginSid -eq 1) {
                        $effective="EXECUTE AS LOGIN = N'$login'; BEGIN TRY " + @'
SELECT CASE WHEN USER_NAME()=@login THEN 1 ELSE 0 END AS readerDatabaseUser,
       HAS_DBACCESS(N'AED_TEST') AS hasBookAccess,
       HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONNECT') AS connectAllowed,
       IS_SRVROLEMEMBER(N'sysadmin') AS sysadmin,IS_ROLEMEMBER(N'db_owner') AS dbOwner;
'@ + ' REVERT; END TRY BEGIN CATCH REVERT; THROW; END CATCH;'
                        $report.windowsMetadata.effectiveConnect=Invoke-AuditQuery $adminBook $effective @{'@login'=$login}
                    }
                } catch { $report.windowsMetadata.databaseInspection=Get-AuditError $_ }
            } else { $report.nextActions+='Restore normal AED_TEST database availability before attempting reader or permission repairs.' }
        }
    } catch { $report.windowsMetadata.observerFailure=Get-AuditError $_ }

    # Opening the saved reader against master is only an authentication diagnostic.
    # It does not require that the reader be granted master or other-book access.
    foreach ($catalog in @('AED_TEST','master')) {
        if ($catalog -ceq 'AED_TEST' -and $report.windowsMetadata.database -and
            ($report.windowsMetadata.database.databaseState -cne 'ONLINE' -or $report.windowsMetadata.database.databaseAccess -cne 'MULTI_USER')) {
            $report.readerDatabase=@{state='Skipped';reason='Database unavailable or restricted'}
            continue
        }
        try {
            $connection=Open-LocalBook 'A2006' $catalog $credential
            if ($catalog -ceq 'AED_TEST') { $reader=$connection } else { $readerMaster=$connection }
            $actual=Invoke-AuditQuery $connection @'
SELECT DB_NAME() AS databaseName,CONVERT(nvarchar(128),SERVERPROPERTY('InstanceName')) AS instanceName,
       CASE WHEN ORIGINAL_LOGIN()=@login THEN 1 ELSE 0 END AS originalLoginMatches,
       CASE WHEN SUSER_SNAME()=@login THEN 1 ELSE 0 END AS effectiveLoginMatches,
       CASE WHEN USER_NAME()=@login THEN 1 ELSE 0 END AS databaseUserMatches,
       CONVERT(nvarchar(20),CONNECTIONPROPERTY('auth_scheme')) AS authentication,
       CONVERT(nvarchar(20),CONNECTIONPROPERTY('net_transport')) AS transport;
'@ @{'@login'=$login}
            $result=@{state='Opened';identity=$actual}
            if ($catalog -ceq 'AED_TEST') {
                if ($actual.originalLoginMatches -ne 1 -or $actual.effectiveLoginMatches -ne 1 -or
                    $actual.databaseUserMatches -ne 1 -or $actual.databaseName -cne 'AED_TEST') { Stop-ReadPoc 'READER_PRINCIPAL_OR_TARGET_MISMATCH' }
                $identity=Assert-ReadIdentity $reader 'AED_TEST' 'A2006'
                $script:ProvisionedLogin=$login
                $null=Get-BookReaderPlan $reader $identity 'AED_TEST'
                if ((Read-BookCompany $reader 'AED_TEST').key -cne $book.key) { Stop-ReadPoc 'BOOK_COMPANY_IDENTITY_CHANGED' }
                $result.readerVerified=$true
                $result.coaRows=(Invoke-AuditQuery $reader 'SELECT COUNT_BIG(*) AS [rows] FROM dbo.GLMast;').rows
                $report.readerDatabase=$result
            } else { $report.readerServer=$result }
        } catch {
            if ($catalog -ceq 'AED_TEST') { $report.readerDatabase=Get-AuditError $_ }
            else { $report.readerServer=Get-AuditError $_ }
        }
    }
    if ($report.readerDatabase.readerVerified) {
        $report.nextActions+='The current saved reader works. Trigger the existing scheduled task and compare its diagnostics with this interactive result.'
    } elseif ($report.windowsMetadata.login.loginDisabled) {
        $report.nextActions+='The saved SQL login is disabled. Review the reader authorization history with the SQL administrator before enabling anything.'
    } elseif ($report.windowsMetadata.user.loginUserSidMatch -eq 0 -or $report.windowsMetadata.user.missing) {
        $report.nextActions+='The selected database user is missing or mapped to a different login. Review AED_TEST restore or user-mapping history before an administrator repair.'
    } elseif ($report.windowsMetadata.effectiveConnect.connectAllowed -eq 0) {
        $report.nextActions+='SQL Server denies database CONNECT for this reader. Review the exact CONNECT path with the SQL administrator.'
    } else {
        $report.nextActions+='Use the reported database, login, SID, CONNECT and SQL error states to identify the database-open failure before changing access.'
    }
} catch { $report.auditFailure=Get-AuditError $_ }
finally {
    foreach ($connection in @($reader,$readerMaster,$adminBook,$windows)) { if ($connection) { $connection.Dispose() } }
    if ($credential -is [Management.Automation.PSCredential]) { $credential.Password.Dispose() }
    if ($lock) { $lock.Dispose() }
}
$report | ConvertTo-Json -Depth 10
