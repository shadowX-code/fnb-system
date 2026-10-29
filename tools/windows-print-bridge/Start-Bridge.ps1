param([string]$ConfigPath = "$env:LOCALAPPDATA\FeedXPrintBridge\config.json")
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Import-Module "$PSScriptRoot\Bridge.psm1" -Force
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if($config.ProjectRef -ne 'ujkzdaaadnvcfayuldmh') {throw 'This package supports FeedX Staging only.'}
$root=Split-Path $ConfigPath
$mutex=New-Object Threading.Mutex($false,"Local\FeedXPrintBridge-$($config.DeviceId)")
if(!$mutex.WaitOne(0)) {exit 0}
try {
 Add-Type -Path "$PSScriptRoot\Transport.cs" -ReferencedAssemblies System.Drawing
 $session=Read-BridgeState "$root\session.xml"
 if(!$session) {throw 'Sign in using Install-Bridge.ps1.'}
 $backoff=5
 while($true) {
  try {
   if([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -gt [long]$session.expires_at-120) {
    $session=Invoke-BridgeAuth $config.PublicKey @{refresh_token=$session.refresh_token} 'refresh_token'
    $session | Add-Member -NotePropertyName expires_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$session.expires_in) -Force
    Save-BridgeState "$root\session.xml" $session
   }
   Invoke-BridgeCycle $config $session "$root\journal.xml"
   $backoff=5
  } catch {
   # Do not log HTTP responses: they can contain identity or token material.
   Set-Content -LiteralPath "$root\status.txt" -Value ("{0:u} Connection or print error. Check FeedX history, printer, and sign-in. No automatic resubmission." -f [datetime]::UtcNow)
   $backoff=[Math]::Min(60,$backoff*2)
  }
  Start-Sleep -Seconds $backoff
 }
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
