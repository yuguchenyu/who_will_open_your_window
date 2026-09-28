param([switch]$Watch)
$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot 'runtime\service.json'
do {
    if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'NOT STARTED: run start.ps1'; exit 1 }
    $serviceState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $runningProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($serviceState.pid)" -ErrorAction SilentlyContinue
    $alive = $runningProcess -and $runningProcess.Name -eq 'node.exe' -and $runningProcess.CommandLine.Contains((Join-Path $PSScriptRoot 'server.mjs'))
    $health = $null
    if ($alive) { try { $health = Invoke-RestMethod -Uri "$($serviceState.url)/api/status" -TimeoutSec 3 } catch {} }
    [PSCustomObject]@{
        Time=(Get-Date).ToString('s'); State=$(if ($alive -and $health.app -eq 'heart-window-demo') {'RUNNING'} elseif ($alive) {'UNHEALTHY'} else {'STOPPED'})
        PID=$serviceState.pid; URL=$serviceState.url; AIConfigured=[bool]$health.configured
        SavedState=$serviceState.status; ExitCode=$serviceState.exitCode
        Logs=(Join-Path $PSScriptRoot 'runtime'); Progress='Local web service; no batch job'; SpeedETA='Not applicable'
    } | Format-List
    if ($Watch) { Start-Sleep -Seconds 3 }
} while ($Watch)
