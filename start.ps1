$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimePath = Join-Path $projectRoot 'runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$statePath = Join-Path $runtimePath 'service.json'
if (Test-Path -LiteralPath $statePath) {
    $existing = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.pid)" -ErrorAction SilentlyContinue
    if ($existingProcess -and $existingProcess.Name -eq 'node.exe' -and $existingProcess.CommandLine.Contains((Join-Path $projectRoot 'server.mjs'))) {
        Write-Output "Service already running: $($existing.url)"
        exit 0
    }
}
Get-Command node -ErrorAction Stop | Out-Null
$portValue = 3210
$envFile = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*$') { $portValue = [int]$Matches[1] }
    }
}
if ($env:PORT) { $portValue = [int]$env:PORT }
$serviceUrl = "http://127.0.0.1:$portValue"
$supervisorFile = Join-Path $projectRoot 'run-service.ps1'
$supervisor = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $supervisorFile + '"'),'-ServicePort',"$portValue") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$healthy = $false
$record = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    if (Test-Path -LiteralPath $statePath) {
        try { $candidate = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { continue }
        if ($candidate.supervisorPid -ne $supervisor.Id) { continue }
        $record = $candidate
        if ($record.status -ne 'starting') { break }
        $child = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)" -ErrorAction SilentlyContinue
        if (-not $child) { continue }
        try { $response = Invoke-RestMethod -Uri "$serviceUrl/api/status" -TimeoutSec 2; if ($response.app -eq 'heart-window-demo') { $healthy = $true; break } } catch {}
    }
    $supervisor.Refresh()
    if ($supervisor.HasExited) { break }
}
if (-not $healthy) {
    if ($record -and $record.pid) {
        $child = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)" -ErrorAction SilentlyContinue
        if ($child -and $child.Name -eq 'node.exe' -and $child.CommandLine.Contains((Join-Path $projectRoot 'server.mjs'))) { Stop-Process -Id $record.pid -ErrorAction SilentlyContinue }
    }
    throw 'Startup failed. Check runtime/server-error.log. If the port is occupied, set PORT in .env.'
}
$record.status = 'running'
$record | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Output "Ready: $serviceUrl"
Write-Output "PID: $($record.pid). Detached supervisor: $($supervisor.Id)."
Write-Output 'Check status: powershell -NoProfile -ExecutionPolicy Bypass -File .\monitor.ps1'
Write-Output 'Stop service: powershell -NoProfile -ExecutionPolicy Bypass -File .\stop.ps1'
