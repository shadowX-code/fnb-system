param([Parameter(Mandatory)][string]$Package)
$ErrorActionPreference='Stop'
$dest=Join-Path $env:TEMP ('FeedX-setup-qa-'+[guid]::NewGuid())
$root=Join-Path $env:LOCALAPPDATA 'FeedXPrintBridge'
if(Test-Path $root){throw 'Run installer verification in a clean disposable Windows user profile.'}
function Install-TestPackage {
    $process=Start-Process -FilePath (Resolve-Path $Package) -ArgumentList "/S /D=$dest" -PassThru -Wait
    if($process.ExitCode){throw "Installer exited with $($process.ExitCode)"}
}
Install-TestPackage
foreach($name in @('Bridge.psm1','Transport.cs','D520Bluetooth.cs','Setup-Bridge.ps1','Start-Bridge.ps1')) {
    $installed=Join-Path $dest $name
    if(!(Test-Path $installed)){throw "Missing installed component: $name"}
    $source=(Get-Content -LiteralPath (Join-Path $PSScriptRoot $name) -Raw) -replace "`r`n","`n"
    $payload=(Get-Content -LiteralPath $installed -Raw) -replace "`r`n","`n"
    if($source -cne $payload){throw "Hosted installer has a stale component: $name"}
}
$handler=(Get-Item 'HKCU:\Software\Classes\feedx-printer-staging\shell\open\command').GetValue('')
if(!$handler.Contains($dest) -or $handler.Contains('%1')){throw 'Setup launcher must open the installed app without passing URI arguments.'}
Import-Module (Join-Path $dest 'Bridge.psm1') -Force
New-Item -ItemType Directory $root | Out-Null
$config=[pscustomobject]@{ProjectRef='ujkzdaaadnvcfayuldmh';DeviceId=[guid]::NewGuid().ToString();Printer='Fixture only';Calibrated=$true;GuidedSetup=$true}
$config|ConvertTo-Json|Set-Content (Join-Path $root 'config.json')
Save-BridgeState (Join-Path $root 'session.xml') @{refresh_token='fixture-only';expires_at=0}
Save-BridgeState (Join-Path $root 'journal.xml') @{stage='submitting';claim='existing-claim';job='existing-job'}
Save-BridgeState (Join-Path $root 'calibration.xml') @{stage='unknown';quantity=1}
Save-BridgeState (Join-Path $root 'setup-diagnostics.xml') @{Version='fixture';Failures=@(@{Stage='Register Windows background task'})}
$before=@(Get-ChildItem $root | Get-FileHash | ForEach-Object Hash)
Install-TestPackage
$after=@(Get-ChildItem $root | Get-FileHash | ForEach-Object Hash)
if(Compare-Object $before $after){throw 'Installer changed existing bridge recovery data.'}
if((Get-BridgeRecovery (Read-BridgeState (Join-Path $root 'journal.xml'))) -ne 'Unknown'){throw 'Interrupted state could resend after upgrade.'}
if((Get-BridgeCalibration $config $root) -ne 'Needs review'){throw 'Existing calibration review was lost.'}
$pause=Join-Path $root 'setup.pause'
New-Item -ItemType File $pause | Out-Null
if(Test-BridgePaused $root){throw 'Stale setup pause would block restart.'}
Write-Output 'PASS: Native Windows installer clean install, local launcher, reinstall state preservation, interrupted recovery and stale-pause restart.'
