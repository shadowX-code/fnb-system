#requires -Version 5.1
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '../installer/scheduler.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Register-ConnectorSchedule'},$false)
$source=$definition.Extent.Text.Replace('[Security.Principal.WindowsIdentity]::GetCurrent()',"([pscustomobject]@{Name='fixture-user';User=@{Value='S-1-fixture'}})")
$script:fixtureInstaller=Split-Path $path
$source=$source.Replace('$PSScriptRoot','$script:fixtureInstaller')
. ([scriptblock]::Create($source))
$connectorTaskName='FeedX AutoCount Connector'
$connectorTaskDescription='FeedX accounting check-in every 5 minutes (3.1.1)'
function Stop-ReadPoc($Code) { throw $Code }
function Get-ConnectorTaskOwnerSid($Value) { return $Value }
function Get-ScheduledTask { $script:existing }
function New-ScheduledTaskAction($Execute,$Argument,$WorkingDirectory) {
    if ($Argument -notmatch '-NonInteractive' -or -not $WorkingDirectory) { throw 'Unsafe task action' }
    return @{}
}
function New-ScheduledTaskSettingsSet([switch]$StartWhenAvailable,[switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,$MultipleInstances,$ExecutionTimeLimit,$RestartCount,$RestartInterval) {
    if (-not $StartWhenAvailable -or $MultipleInstances -cne 'IgnoreNew' -or $RestartCount -ne 3 -or $RestartInterval.TotalMinutes -ne 5) { throw 'Task recovery settings missing' }
    return @{}
}
function New-ScheduledTaskTrigger([switch]$AtLogOn,$User,[switch]$Once,$At,$RepetitionInterval) {
    if ($Once -and $RepetitionInterval.TotalMinutes -ne 5) { throw 'Polling cadence changed' }
    return @{}
}
function New-ScheduledTaskPrincipal($UserId,$LogonType,$RunLevel) {
    if ($UserId -cne 'S-1-fixture' -or $LogonType -cne 'Interactive' -or $RunLevel -cne 'Limited') { throw 'Task identity changed' }
    return @{}
}
function Register-ScheduledTask($TaskName,$TaskPath,$Description,$Action,$Trigger,$Settings,[switch]$Force,$Principal,$User,$Password,$RunLevel) { $script:registered++ }
foreach ($scenario in @('new','oldInteractive','currentInteractive','password','disabled','otherUser')) {
    $script:registered=0
    $script:existing=if ($scenario -ceq 'new') { $null } else {
        @{Principal=@{UserId=if ($scenario -ceq 'otherUser') { 'S-1-other' } else { 'S-1-fixture' };LogonType=if ($scenario -ceq 'password') { 'Password' } else { 'Interactive' }}
          State=if ($scenario -ceq 'disabled') { 'Disabled' } else { 'Ready' };Description=if ($scenario -ceq 'currentInteractive') { $connectorTaskDescription } else { 'Prior installation' }}
    }
    try {
        Register-ConnectorSchedule
        if ($scenario -ceq 'otherUser') { throw 'Task ownership was bypassed' }
    } catch { if ($scenario -cne 'otherUser' -or $_.Exception.Message -cne 'SCHEDULE_OWNED_BY_ANOTHER_USER') { throw } }
    $expected=if ($scenario -cin @('new','oldInteractive')) { 1 } else { 0 }
    if ($script:registered -ne $expected) { throw "Unexpected task mutation: $scenario" }
}
Write-Host 'Task ownership, signed-out credential preservation, disabled-task choice, cadence and recovery fixtures passed.'
