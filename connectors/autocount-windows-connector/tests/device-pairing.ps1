#requires -Version 5.1
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '../installer/device.ps1'
$tokens=$null
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Confirm-ActiveDevicePairing','Request-DevicePairing')) {
    $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$false)
    . ([scriptblock]::Create($definition.Extent.Text))
}

function Stop-ReadPoc([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Invoke-DeviceAction($Credential,[hashtable]$Command) {
    if (-not [object]::ReferenceEquals($Credential,$deviceCredential)) { throw 'Device identity was replaced' }
    $script:actions += $Command.p_action
    if ($Command.p_action -ceq 'issue') {
        switch ($script:scenario) {
            'new' { return @{code='0123456789ABCDEF'} }
            'issueFailed' { Stop-ReadPoc 'STAGING_HTTP_503' }
            default { Stop-ReadPoc 'STAGING_HTTP_409' }
        }
    }
    if ($Command.p_action -cne 'books') { throw 'Unexpected device operation' }
    switch ($script:scenario) {
        'paired' { return @{deviceId='a463983b-927e-4656-a2ee-473ee0050123';books=@()} }
        'inactive' { Stop-ReadPoc 'STAGING_HTTP_401' }
        'malformed' { return @{deviceId=[guid]::Empty;books=@()} }
        'checkInFailed' { Stop-ReadPoc 'STAGING_HTTP_503' }
        default { throw 'Unexpected device check-in' }
    }
}

$deviceCredential=[pscustomobject]@{}
$expectedFailures=@{inactive='DEVICE_REGISTRATION_INACTIVE';malformed='DEVICE_CHECK_IN_RESPONSE_INVALID';issueFailed='STAGING_HTTP_503';checkInFailed='STAGING_HTTP_503'}
foreach ($script:scenario in @('new','paired','inactive','malformed','issueFailed','checkInFailed')) {
    $script:actions=@()
    $expectedError=$expectedFailures[$script:scenario]
    try {
        $pairing=Request-DevicePairing $deviceCredential 'Office-PC'
        if ($expectedError) { throw "Expected ${expectedError}." }
        if ($script:scenario -ceq 'new' -and ($pairing.state -cne 'Awaiting confirmation' -or $pairing.code -cne '0123456789ABCDEF')) { throw 'Pairing code was lost' }
        if ($script:scenario -ceq 'paired' -and ($pairing.state -cne 'Paired' -or $pairing.code)) { throw 'Active device did not retain pairing' }
    } catch {
        if ($_.Exception.GetBaseException().Message -cne $expectedError) { throw }
    }
    $expectedActions=if ($script:scenario -in @('new','issueFailed')) { 'issue' } else { 'issue,books' }
    if (($script:actions -join ',') -cne $expectedActions) { throw 'Unexpected device operations' }
}
Write-Host 'New pairing, same-device retry, inactive enrollment, malformed check-in and network failure checks passed.'
