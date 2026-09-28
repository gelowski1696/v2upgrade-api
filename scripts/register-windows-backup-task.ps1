param(
  [string]$Time = '02:00',
  [string]$TaskName = 'POSV2 Owner Platform Backup'
)

$ErrorActionPreference = 'Stop'
$ProjectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$Action = New-ScheduledTaskAction -Execute $Npm -Argument 'run backup:platform' -WorkingDirectory $ProjectDirectory
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description 'Backs up POSV2 PostgreSQL metadata and synchronized store databases together.' -Force | Out-Null
Write-Host "Scheduled '$TaskName' daily at $Time."
