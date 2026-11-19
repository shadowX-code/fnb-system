#requires -Version 5.1
# Update an existing installation using its Windows identity, credentials and task.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'device.ps1')
. (Join-Path $PSScriptRoot 'scheduler.ps1')
$report=@{state='Not paired';finishedAt=$null}
try {
    if (Test-Path -LiteralPath $deviceCredentialPath) {
        Register-ConnectorSchedule
        $schedule=Get-ConnectorSchedule
        $report.mode=$schedule.mode
        if ($schedule.mode -in @('signed_in','unattended')) {
            Start-ScheduledTask -TaskName $connectorTaskName -TaskPath '\' -ErrorAction Stop
            $report.state='Background task started'
        } else { $report.state='Background task requires review' }
    }
} catch {
    $report.state='Failed'
    $report.failure=Get-ConnectorFailure $_
} finally {
    $report.finishedAt=[datetime]::UtcNow.ToString('o')
    Write-LocalTextAtomically (Join-Path $deviceRoot 'installed-update.json') ($report | ConvertTo-Json -Depth 5)
}
if ($report.state -eq 'Failed') { exit 1 }
