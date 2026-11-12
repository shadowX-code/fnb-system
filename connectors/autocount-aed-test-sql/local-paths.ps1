#requires -Version 5.1
function Get-RunLocalPath([string]$Path,[string]$BaseDirectory,[switch]$AllowRemovable) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'A local filesystem path is required.' }
    if ($Path -match '^[A-Za-z]:(?![\\/])|^[\\/](?![\\/])|^[\\/]{2}|[<>|"*?\x00-\x1f]') {
        throw 'Use an unambiguous drive-qualified or relative local path.'
    }
    # Reject NTFS streams, DOS devices and ambiguous Win32 component normalization.
    $components=($Path -replace '^[A-Za-z]:','') -split '[\\/]'
    foreach ($component in $components) {
        if ($component -match ':|^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)' -or ($component -notin @('.','..') -and $component -match '[ .]$')) {
            throw 'Use a normal local file or directory name.'
        }
    }
    if ($BaseDirectory -and -not [IO.Path]::IsPathRooted($Path)) {
        $Path=[IO.Path]::Combine($BaseDirectory,$Path)
    }
    $provider=$null; $driveInfo=$null
    $resolved=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path,[ref]$provider,[ref]$driveInfo)
    if ($provider.Name -ne 'FileSystem' -or $resolved -notmatch '^[A-Za-z]:[\\/]') { throw 'Use a local filesystem drive.' }
    $full=[IO.Path]::GetFullPath($resolved)
    $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($full))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed -and -not ($AllowRemovable -and $drive.DriveType -eq [IO.DriveType]::Removable)) {
        throw 'Use a supported local drive.'
    }
    $ancestor=$full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor -ErrorAction Stop) {
            if ((Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Paths cannot traverse reparse points.'
            }
        }
        $ancestor=[IO.Path]::GetDirectoryName($ancestor)
    }
    return $full
}

function Write-LocalTextAtomically([string]$Path,[string]$Text,[switch]$CreateNew) {
    $destination=Get-RunLocalPath $Path
    $parent=[IO.Path]::GetDirectoryName($destination)
    $null=[IO.Directory]::CreateDirectory($parent)
    $stem=[IO.Path]::Combine($parent,[Guid]::NewGuid().ToString('N'))
    $temporary=$stem+'.tmp'
    $backup=$stem+'.bak'
    try {
        [IO.File]::WriteAllText($temporary,$Text,[Text.UTF8Encoding]::new($false))
        if (-not $CreateNew -and [IO.File]::Exists($destination)) {
            # Windows PowerShell 5.1 can marshal $null as an empty string for this overload.
            [IO.File]::Replace($temporary,$destination,$backup)
            [IO.File]::Delete($backup)
        } else {
            [IO.File]::Move($temporary,$destination)
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

# Offline native commands can report normal diagnostics on stderr under PowerShell 5.1.
function Invoke-LocalNative([string]$Executable,[string[]]$Arguments) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw 'Native executable is missing.' }
    $previous=$ErrorActionPreference
    $previousExit=$global:LASTEXITCODE
    try {
        $ErrorActionPreference='Continue'
        $global:LASTEXITCODE=$null
        & $Executable @Arguments 2>&1 | ForEach-Object { Write-Host ([string]$_) }
        if ($null -eq $global:LASTEXITCODE) { throw 'Native command failed to launch or returned no process exit code.' }
        return [int]$global:LASTEXITCODE
    } finally {
        $ErrorActionPreference=$previous
        $global:LASTEXITCODE=$previousExit
    }
}
