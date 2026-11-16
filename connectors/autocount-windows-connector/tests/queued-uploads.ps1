#requires -Version 5.1
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../autocount-aed-test-sql/sql-read.ps1')
. (Join-Path $PSScriptRoot '../common/staging-response.ps1')
$tokens=$null
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../sync.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Format-SyncDate','Read-QueuedSnapshot','New-SnapshotBody','Send-PendingSnapshots')) {
    $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$false)
    . ([scriptblock]::Create($definition.Extent.Text))
}

$id='0d891e1c-c954-4447-a3f9-fda89b4b0cc1'
$day=[datetime]'2026-11-16'
$rows=@(1..53 | ForEach-Object { @{key=[string]$_;description='literal "p_scope_date":{}';currency=$null} })
foreach ($dataset in @('COA','Department','Project','GL')) {
    $serialized=New-SnapshotBody $dataset $day $id $rows
    $parsed=ConvertFrom-Json -InputObject $serialized
    if ($dataset -ceq 'GL') {
        if ($parsed.p_scope_date -cne '2026-11-16') { throw 'GL must use its original ISO date' }
    } elseif ($parsed.PSObject.Properties.Name -ccontains 'p_scope_date') { throw 'Undated batches must omit the date key' }
    if ((Read-QueuedSnapshot $serialized).rows -ne 53) { throw 'Batch changed row count' }
}
$coa=New-SnapshotBody 'COA' $day $id $rows
$legacy='{"p_scope_date":{},'+$coa.Substring(1)
$expected='{"p_scope_date":null,'+$coa.Substring(1)
$normalized=Read-QueuedSnapshot $legacy
if ($normalized.body -cne $expected -or $normalized.requestId -cne $id -or $normalized.rows -ne 53 -or -not $normalized.repairedScopeDate) {
    throw 'Only the legacy date token may change for the queued batch'
}
$invalidGl=$legacy.Replace('"COA"','"GL"')
if ((Read-QueuedSnapshot $invalidGl).body -cne $invalidGl) { throw 'A malformed GL date cannot be normalized' }
$withNested='{"extra":{"p_scope_date":{}},'+$legacy.Substring(1)
try { $null=Read-QueuedSnapshot $withNested; throw 'Ambiguous date matches accepted' }
catch { if ($_.Exception.Message -cne 'STAGING_QUEUE_ENVELOPE_INVALID') { throw } }

$known='{"code":"22007","message":"invalid input syntax for type date: \"{}\"","details":"private field"}'
if ((Get-StagingUploadErrorKind $known) -cne 'upload_date_format' -or
    (Get-StagingUploadErrorKind '{"code":"PT422","message":"Invalid or duplicate accounting record"}') -cne 'upload_record_values' -or
    (Get-StagingUploadErrorKind '{"code":"22007","message":"private field"}')) { throw 'Unexpected or unsafe rejection mapping' }

function Write-LocalTextAtomically($Path,$Text) { [IO.File]::WriteAllText($Path,$Text) }
function Request-FeedX($Credential,[string]$Body) {
    if ($Body -cne $expected) { throw 'The original queue payload was changed outside the date token' }
    if ($script:reject) {
        $failure=[InvalidOperationException]::new('STAGING_HTTP_400')
        $failure.Data['FeedXUploadErrorKind']='upload_date_format'
        throw $failure
    }
    return @{state='Accepted';connectionId='fixture';requestId=$id;acceptedRows=53;snapshotId=1;duplicate=$false}
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('feedx-queue-test-'+[guid]::NewGuid().ToString('N'))
try {
    $queue=Join-Path $root 'queue'
    $null=[IO.Directory]::CreateDirectory($queue)
    $reportPath=Join-Path $root 'status.json'
    $file=Join-Path $queue ($id+'.json')
    [IO.File]::WriteAllText($file,$legacy)
    $status=@{replayed=@();receipts=@()}
    $script:reject=$true
    try { Send-PendingSnapshots 'fixture' 'fixture' -Retry; throw 'Expected rejected upload' }
    catch { if ($_.Exception.Message -cne 'STAGING_HTTP_400') { throw } }
    if ([IO.File]::ReadAllText($file) -cne $legacy -or $status.failedUpload.reason -cne 'upload_date_format' -or
        $status.failedUpload.requestId -cne $id -or $status.replayed[0].rows -ne 53) { throw 'Rejection did not retain the queue and sanitized metadata' }
    $status=@{replayed=@();receipts=@()}
    $script:reject=$false
    Send-PendingSnapshots 'fixture' 'fixture' -Retry
    Send-PendingSnapshots 'fixture' 'fixture' -Retry
    if ((Test-Path -LiteralPath $file) -or $status.receipts.Count -ne 1 -or $status.receipts[0].rows -ne 53 -or
        $status.receipts[0].requestId -cne $id -or $status.replayed.Count -ne 1) { throw 'Confirmed queue replay was not removed once' }
} finally { if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force } }
Write-Host 'Queued upload contract and 53-row replay regression passed.'
