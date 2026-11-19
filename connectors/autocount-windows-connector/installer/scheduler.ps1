#requires -Version 5.1
$connectorTaskName = 'FeedX AutoCount Connector'
$connectorTaskDescription = 'FeedX accounting check-in every 5 minutes'

function Get-ConnectorTaskOwnerSid([string]$Account) {
    if ($Account -match '^S-1-') { return $Account }
    return ([Security.Principal.NTAccount]::new($Account)).Translate([Security.Principal.SecurityIdentifier]).Value
}

function Get-ConnectorSchedule {
    $task = Get-ScheduledTask -TaskName $connectorTaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $task) { return @{mode='missing';nextPollAt=$null} }
    $owner = Get-ConnectorTaskOwnerSid $task.Principal.UserId
    if ($owner -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
        return @{mode='other_user';nextPollAt=$null}
    }
    $info = Get-ScheduledTaskInfo -TaskName $connectorTaskName -TaskPath '\' -ErrorAction Stop
    $mode = if ($task.State -eq 'Disabled') { 'disabled' }
        elseif ($task.Principal.LogonType -eq 'Password') { 'unattended' }
        elseif ($task.Principal.LogonType -eq 'Interactive') { 'signed_in' }
        else { 'unsupported' }
    return @{
        mode=$mode; state=[string]$task.State; lastResult=$info.LastTaskResult; missedRuns=$info.NumberOfMissedRuns
        lastRunAt=if ($info.LastRunTime.Year -ge 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { $null }
        nextPollAt=if ($mode -in @('unattended','signed_in') -and $info.NextRunTime.Year -ge 2000) {
            $info.NextRunTime.ToUniversalTime().ToString('o')
        } else { $null }
    }
}

function Register-ConnectorSchedule([Management.Automation.PSCredential]$Credential) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $existing = Get-ScheduledTask -TaskName $connectorTaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($existing) {
        if ((Get-ConnectorTaskOwnerSid $existing.Principal.UserId) -cne $identity.User.Value) {
            Stop-ReadPoc 'SCHEDULE_OWNED_BY_ANOTHER_USER'
        }
        # Setup and upgrades leave an existing task intact until the user submits Windows credentials.
        if (-not $Credential) { return }
    }
    if ($Credential -and (Get-ConnectorTaskOwnerSid $Credential.UserName) -cne $identity.User.Value) {
        Stop-ReadPoc 'SCHEDULE_REQUIRES_INSTALLING_WINDOWS_USER'
    }
    $worker = Join-Path $PSScriptRoot 'worker.ps1'
    $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -WorkingDirectory (Split-Path $PSScriptRoot) -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$worker+'"')
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
    # No repetition duration means the time trigger remains active after reboot.
    $triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $identity.Name),
                  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)))
    $parameters = @{TaskName=$connectorTaskName;TaskPath='\';Description=$connectorTaskDescription
        Action=$action;Trigger=$triggers;Settings=$settings;Force=$true;ErrorAction='Stop'}
    if (-not $Credential) {
        $principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
        $null = Register-ScheduledTask @parameters -Principal $principal
        return
    }
    # Only Windows Task Scheduler stores this Windows password. It never enters the connector files or command line.
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Credential.Password)
    try {
        $null = Register-ScheduledTask @parameters -User $identity.Name -Password ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) -RunLevel Limited
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
