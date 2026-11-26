param([string]$ConfigPath = "$env:LOCALAPPDATA\FeedXPrintBridgeProduction\config.json")
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Import-Module "$PSScriptRoot\Bridge.psm1" -Force
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if($config.ProjectRef -ne 'oyfobxdoyfuzsodogpgs') {throw 'This package supports FeedX Production only.'}
$config | Add-Member -NotePropertyName CoordinateBluetooth -NotePropertyValue $true -Force
$root=Split-Path $ConfigPath
$mutex=New-Object Threading.Mutex($false,"Local\FeedXPrintBridge-$($config.DeviceId)")
try { if(!$mutex.WaitOne(0)) {exit 0} } catch [Threading.AbandonedMutexException] { # Prior worker exited while holding the lock. The journal owns recovery.
}
try {
 Add-Type -Path "$PSScriptRoot\Transport.cs" -ReferencedAssemblies System.Drawing
 Set-Content -LiteralPath (Join-Path $root 'worker-version.txt') -Value '1.3.0' -Encoding ASCII
 Invoke-BridgeWorker $config $root
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
