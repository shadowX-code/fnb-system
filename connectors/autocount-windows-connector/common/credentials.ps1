#requires -Version 5.1
function Get-ConnectorCredential([string]$Path,[string]$Prompt,[switch]$Save,[switch]$Replace) {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_DPAPI_REQUIRED' }
    $safe=Get-RunLocalPath $Path
    if (-not $Replace -and (Test-Path -LiteralPath $safe -PathType Leaf)) {
        try { $credential=Import-Clixml -LiteralPath $safe -ErrorAction Stop } catch { throw 'LOCAL_CREDENTIAL_UNREADABLE_USE_REPLACE_CREDENTIALS' }
    } else { $credential=Get-Credential -Message $Prompt }
    if ($credential -isnot [Management.Automation.PSCredential] -or -not $credential.UserName -or -not $credential.Password.Length) {
        throw 'AUTHORIZED_CREDENTIAL_REQUIRED'
    }
    if ($Save -and ($Replace -or -not (Test-Path -LiteralPath $safe -PathType Leaf))) {
        Save-ConnectorCredential $safe $credential
    }
    return $credential
}

function Save-ConnectorCredential([string]$Path,[Management.Automation.PSCredential]$Credential) {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_DPAPI_REQUIRED' }
    $safe=Get-RunLocalPath $Path
    $temporary=$safe+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try {
        $Credential | Export-Clixml -LiteralPath $temporary
        Write-LocalTextAtomically $safe ([IO.File]::ReadAllText($temporary))
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
