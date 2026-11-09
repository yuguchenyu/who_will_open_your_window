$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot 'runtime\service.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No service state found.'; exit 0 }
$serviceState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$runningProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($serviceState.pid)" -ErrorAction SilentlyContinue
if ($runningProcess) {
    $expectedServer = Join-Path $PSScriptRoot 'server.mjs'
    if ($runningProcess.Name -ne 'node.exe' -or -not $runningProcess.CommandLine.Contains($expectedServer)) { throw 'PID belongs to another program; refusing to stop it.' }
    Stop-Process -Id $serviceState.pid
}
if ($serviceState.supervisorPid) {
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 150
        try { $updated = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { continue }
        if ($updated.pid -eq $serviceState.pid -and $null -ne $updated.exitCode) { $serviceState = $updated; break }
    }
}
$serviceState.status = 'stopped'
$serviceState | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Output 'Demo service stopped. Your local browser data and .env are retained.'
