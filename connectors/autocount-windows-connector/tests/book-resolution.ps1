#requires -Version 5.1
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../installer/device.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Get-ConnectorFailure','Resolve-LocalConnectorBooks')) {
    $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$false)
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Stop-ReadPoc($Code) { throw [InvalidOperationException]::new($Code) }
function Get-RunLocalPath($Path,$BaseDirectory) { Join-Path $BaseDirectory $Path }
function Get-InstanceIdentity($Instance) { $Instance }
function Open-LocalBook($Instance,$Database,$Credential) {
    if ($Instance -cne 'A2006' -or $Database -cne 'AED_TEST') { throw 'UNAPPROVED_TARGET' }
    $key=if ($Credential.UserName -ceq ('feedx_ro_'+('a'*32))) { 'a' } else { 'b' }
    if ($key -ceq 'b' -and $script:scenario -ceq 'historicalLoginFailure') { throw 'SQL_ERROR_4060' }
    $c=[pscustomobject]@{key=$key;login=$Credential.UserName}
    $c | Add-Member ScriptMethod Dispose {}
    return $c
}
function Assert-ReadIdentity($Connection) { @{login=$Connection.login;dbUser=$Connection.login} }
function Assert-ReadPermissions($Connection) { if ($script:scenario -ceq 'overprivileged') { throw 'SQL_IDENTITY_OVERPRIVILEGED' } }
function Read-BookCompany($Connection) {
    if ($script:scenario -ceq 'changing') { return @{key=($Connection.key*64)} }
    return @{key=('a'*64)}
}
$deviceRoot=Join-Path ([IO.Path]::GetTempPath()) ('feedx identity '+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($deviceRoot)
try {
    $books=@(foreach ($key in @('a','b')) {
        $folder=Join-Path $deviceRoot ($key*64)
        $null=[IO.Directory]::CreateDirectory($folder)
        Set-Content -LiteralPath (Join-Path $folder 'authorization.lock') -Value ''
        $reader=[pscredential]::new(('feedx_ro_'+($key*32)),(ConvertTo-SecureString 'fixture-only' -AsPlainText -Force))
        try { $reader | Export-Clixml -LiteralPath (Join-Path $folder 'reader.credential.xml') } finally { $reader.Password.Dispose() }
        Set-Content -LiteralPath (Join-Path $folder 'book.json') -Value '{}'
        @{key=($key*64);instance='A2006';database='AED_TEST';authorized=$true;bookId=$key}
    })
    $before=@(Get-ChildItem $deviceRoot -File -Recurse | Get-FileHash | ForEach-Object Hash) -join '|'
    foreach ($script:scenario in @('bothReadable','historicalLoginFailure','changing','overprivileged')) {
        $r=Resolve-LocalConnectorBooks $books
        if ($script:scenario -cin @('bothReadable','historicalLoginFailure')) {
            if ($r.books.Count -ne 1 -or $r.books[0].key -cne ('a'*64) -or $r.historical.Count -ne 1 -or $r.failures.Count) { throw "Current identity resolution failed: $script:scenario" }
        } elseif ($r.books.Count -or $r.failures.Count -ne 2) { throw 'An unverifiable identity was selected' }
    }
    $script:scenario='bothReadable'
    $books[0].authorized=$false
    $r=Resolve-LocalConnectorBooks $books
    if ($r.books.Count -ne 1 -or $r.books[0].authorized -or $r.historical.Count -ne 1) { throw 'Metadata observations authorized an unapproved reader' }
    $r=Resolve-LocalConnectorBooks @($books[1])
    if ($r.books.Count -or $r.failures[0].failure.code -cne 'CURRENT_BOOK_AUTHORIZATION_NOT_SAVED') { throw 'Missing current authorization was guessed' }
    $after=@(Get-ChildItem $deviceRoot -File -Recurse | Get-FileHash | ForEach-Object Hash) -join '|'
    if ($before -cne $after) { throw 'Identity resolution modified saved state' }
    Write-Host 'Current/historical identity, stale 4060, changing identity, permissions, missing authorization and state-preservation fixtures passed.'
} finally { Remove-Item -LiteralPath $deviceRoot -Recurse -Force }
