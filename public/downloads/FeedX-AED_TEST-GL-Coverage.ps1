#requires -Version 5.1
param(
    [Parameter(Mandatory=$true)][guid]$BookId,[Parameter(Mandatory=$true)][string]$AcceptedThrough,
    [string]$VerifyFrom,[string]$VerifyThrough
)
$ErrorActionPreference='Stop'
$result=[ordered]@{state='Blocked';bookId=$BookId.ToString();book='AED_TEST';instance='A2006'}
$connection=$null
$reader=$null
try {
    $culture=[Globalization.CultureInfo]::InvariantCulture
    $observedEnd=[datetime]::ParseExact($AcceptedThrough,'yyyy-MM-dd',$culture).AddDays(1)
    $localRoot=Join-Path $env:LOCALAPPDATA 'FeedX\AutoCountConnector'
    if (-not (Test-Path -LiteralPath $localRoot -PathType Container)) { throw 'WORKING_WINDOWS_PROFILE_REQUIRED' }
    $installer=Join-Path $env:LOCALAPPDATA 'Programs\FeedX AutoCount Connector\installer'
    . (Join-Path $installer 'device.ps1')
    $local=@(Get-LocalConnectorBooks | Where-Object { $_.bookId -ceq $BookId.ToString() -and $_.instance -ieq 'A2006' -and $_.database -ceq 'AED_TEST' -and $_.authorized })
    if ($local.Count -ne 1) { throw 'CURRENT_AED_TEST_BINDING_NOT_UNIQUE' }
    $book=$local[0]
    $path=Get-RunLocalPath $book.key -BaseDirectory $deviceRoot
    $config=Get-Content -LiteralPath (Join-Path $path 'config.json') -Raw | ConvertFrom-Json
    $first=[datetime]::ParseExact([string]$config.startDate,'yyyy-MM-dd',$culture)
    $next=[datetime]::ParseExact([string]$config.nextDate,'yyyy-MM-dd',$culture)
    $today=[TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow,'Singapore Standard Time').Date
    if ($observedEnd -le $first -or $observedEnd -gt $today.AddDays(1) -or $next -lt $first -or $next -gt $today.AddDays(1)) { throw 'GL_COMPARISON_WINDOW_INVALID' }
    $reader=Import-Clixml -LiteralPath (Join-Path $path 'reader.credential.xml')
    if ($reader -isnot [Management.Automation.PSCredential] -or $reader.UserName -cnotmatch '^feedx_ro_[a-f0-9]{32}$') { throw 'READER_CREDENTIAL_PRINCIPAL_MISMATCH' }
    $connection=Open-LocalBook 'A2006' 'AED_TEST' $reader
    $identity=Assert-ReadIdentity $connection 'AED_TEST' 'A2006'
    if ($identity.login -cne $reader.UserName -or $identity.dbUser -cne $reader.UserName) { throw 'READER_CREDENTIAL_PRINCIPAL_MISMATCH' }
    Assert-ReadPermissions $connection $identity
    if ((Read-BookCompany $connection 'AED_TEST').key -cne $book.key) { throw 'BOOK_COMPANY_IDENTITY_CHANGED' }
    $plan=Get-AccountingReadPlan (Get-ReadCatalog $connection)
    $result.firstPostingDate=$first.ToString('yyyy-MM-dd',$culture)
    $result.nextPostingDate=$next.ToString('yyyy-MM-dd',$culture)
    $result.acceptedThrough=$AcceptedThrough
    $result.acceptedThroughSource='Operator supplied comparison date'
    $result.counts=Invoke-ReadQuery $connection @'
SELECT COUNT_BIG(*) AS allRows,
       CONVERT(char(10), MIN([TransDate]), 23) AS firstSourceDate,
       CONVERT(char(10), MAX([TransDate]), 23) AS lastSourceDate,
       COUNT_BIG(CASE WHEN [TransDate] IS NULL THEN 1 END) AS undated,
       COUNT_BIG(CASE WHEN [TransDate] < CONVERT(datetime,@first) THEN 1 END) AS beforeFirstPostingDate,
       COUNT_BIG(CASE WHEN [TransDate] >= CONVERT(datetime,@first) AND [TransDate] < CONVERT(datetime,@observedEnd) THEN 1 END) AS inAcceptedWindow,
       COUNT_BIG(CASE WHEN [TransDate] >= CONVERT(datetime,@observedEnd) AND [TransDate] < CONVERT(datetime,@next) THEN 1 END) AS afterAcceptedBeforeCheckpoint,
       COUNT_BIG(CASE WHEN [TransDate] >= CONVERT(datetime,@observedEnd) AND [TransDate] >= CONVERT(datetime,@next) AND [TransDate] < CONVERT(datetime,@tomorrow) THEN 1 END) AS awaitingBackfill,
       COUNT_BIG(CASE WHEN [TransDate] >= CONVERT(datetime,@tomorrow) THEN 1 END) AS futureDated
FROM [dbo].[GLDTL];
'@ @{'@first'=$first;'@observedEnd'=$observedEnd;'@next'=$next;'@tomorrow'=$today.AddDays(1)}
    if ($VerifyFrom -or $VerifyThrough) {
        $verifyStart=[datetime]::ParseExact($VerifyFrom,'yyyy-MM-dd',$culture)
        $verifyEnd=[datetime]::ParseExact($VerifyThrough,'yyyy-MM-dd',$culture)
        if ($verifyStart -lt $first -or $verifyEnd -gt $today -or $verifyEnd -lt $verifyStart -or
            ($verifyEnd-$verifyStart).Days -ge 366) { throw 'GL_PARITY_WINDOW_INVALID' }
        $lines=[Collections.Generic.List[string]]::new()
        for ($day=$verifyStart; $day -le $verifyEnd; $day=$day.AddDays(1)) {
            $dayLabel=$day.ToString('yyyy-MM-dd',$culture)
            foreach ($row in @(Read-AccountingScope $connection $plan 'GL' $day)) {
                if ($lines.Count -ge 10000) { throw 'GL_PARITY_ROW_LIMIT_EXCEEDED' }
                $fields=@($dayLabel,$row.key,$row.debit,$row.credit,$row.homeDebit,$row.homeCredit)
                $line=($fields | ForEach-Object { if ($null -eq $_) { '~' } else { $_ } }) -join '|'
                $lines.Add($line)
            }
        }
        $result.parity=@{from=$VerifyFrom;through=$VerifyThrough;rows=$lines.Count
            format='GL-key-posting-date-amounts-v1';sha256=(Get-BookDigest ($lines -join "`n"))}
    }
    $result.state='Verified'
} catch {
    $failure=$_.Exception.GetBaseException()
    $result.error=if ($failure -is [Data.SqlClient.SqlException]) { 'SQL_ERROR_'+$failure.Number }
        elseif ($failure.Message -cmatch '^[A-Z][A-Z0-9_]{4,95}$') { $failure.Message }
        else { 'LOCAL_GL_COVERAGE_CHECK_FAILED' }
} finally {
    if ($connection) { $connection.Dispose() }
    if ($reader -is [Management.Automation.PSCredential]) { $reader.Password.Dispose() }
}
$result | ConvertTo-Json -Depth 5
