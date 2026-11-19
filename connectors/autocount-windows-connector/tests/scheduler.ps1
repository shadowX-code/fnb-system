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
$connectorTaskDescription='FeedX accounting check-in every 5 minutes'
function Stop-ReadPoc($Code) { throw $Code }
function Get-ConnectorTaskOwnerSid($Value) { if ($Value -ceq 'fixture-user') { return 'S-1-fixture' }; return $Value }
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
function Register-ScheduledTask($TaskName,$TaskPath,$Description,$Action,$Trigger,$Settings,[switch]$Force,$Principal,$User,$Password,$RunLevel) {
    if ($script:scenario -ceq 'approved' -and ($User -cne 'fixture-user' -or -not $Password -or $RunLevel -cne 'Limited' -or $Principal)) { throw 'Wrong signed-out scheduler registration' }
    $script:registered++
}
foreach ($scenario in @('new','oldInteractive','currentInteractive','password','disabled','otherUser','approved','wrongCredential')) {
    $script:registered=0
    $script:existing=if ($scenario -ceq 'new') { $null } else {
        @{Principal=@{UserId=if ($scenario -ceq 'otherUser') { 'S-1-other' } else { 'S-1-fixture' };LogonType=if ($scenario -ceq 'password') { 'Password' } else { 'Interactive' }}
          State=if ($scenario -ceq 'disabled') { 'Disabled' } else { 'Ready' };Description=if ($scenario -ceq 'currentInteractive') { $connectorTaskDescription } else { 'Prior installation' }}
    }
    try {
        if ($scenario -cin @('approved','wrongCredential')) {
            $username=if ($scenario -ceq 'approved') { 'fixture-user' } else { 'S-1-other' }
            $credential=[pscredential]::new($username,(ConvertTo-SecureString 'fixture-only' -AsPlainText -Force))
            try { Register-ConnectorSchedule $credential } finally { $credential.Password.Dispose() }
            if ($scenario -ceq 'wrongCredential') { throw 'Different Windows credential was accepted' }
        } else { Register-ConnectorSchedule }
        if ($scenario -ceq 'otherUser') { throw 'Task ownership was bypassed' }
    } catch {
        $expectedError=@{otherUser='SCHEDULE_OWNED_BY_ANOTHER_USER';wrongCredential='SCHEDULE_REQUIRES_INSTALLING_WINDOWS_USER'}[$scenario]
        if ($_.Exception.Message -cne $expectedError) { throw }
    }
    $expected=if ($scenario -cin @('new','approved')) { 1 } else { 0 }
    if ($script:registered -ne $expected) { throw "Unexpected task mutation: $scenario" }
}
Write-Host 'Task ownership, signed-out credential preservation, disabled-task choice, cadence and recovery fixtures passed.'
