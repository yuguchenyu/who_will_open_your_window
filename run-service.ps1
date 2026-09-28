param([Parameter(Mandatory=$true)][int]$ServicePort)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimePath = Join-Path $projectRoot 'runtime'
$statePath = Join-Path $runtimePath 'service.json'
$serverFile = Join-Path $projectRoot 'server.mjs'
$record = [ordered]@{pid=0;supervisorPid=$PID;url="http://127.0.0.1:$ServicePort";started=(Get-Date).ToString('o');status='starting';exitCode=$null;server=$serverFile}
try {
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    $childProcess = Start-Process -FilePath $nodeExe -ArgumentList @(('"' + $serverFile + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'server.log') -RedirectStandardError (Join-Path $runtimePath 'server-error.log') -PassThru
    $record.pid = $childProcess.Id
    $null = $childProcess.Handle
    $record | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    $childProcess.WaitForExit()
    $record.exitCode = $childProcess.ExitCode
    $record.status = if ($childProcess.ExitCode -eq 0) { 'exited' } else { 'failed-or-stopped' }
} catch {
    $record.status = 'supervisor-failed'
    Add-Content -LiteralPath (Join-Path $runtimePath 'server-error.log') -Value 'Supervisor could not start or track the service.'
} finally {
    $record | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}
