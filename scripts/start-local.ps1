$projectDir = Split-Path -Parent $PSScriptRoot
$nodeBin = 'C:\Program Files\nodejs\node.exe'
$vinext = Join-Path $projectDir 'node_modules\vinext\dist\cli.js'
$logFile = Join-Path $projectDir 'local-server.log'
$errorLogFile = Join-Path $projectDir 'local-server.error.log'

if (-not (Test-Path -LiteralPath $vinext)) {
  Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format s)] Missing node_modules/vinext. Run npm install first."
  exit 1
}

$existing = Get-NetTCPConnection -LocalPort 8004 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format s)] Port 8004 is already in use; keeping the existing service."
  exit 0
}

# Avoid proxy interference with the local Vinext/Cloudflare worker bridge.
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null
$env:ALL_PROXY = $null
$env:http_proxy = $null
$env:https_proxy = $null
$env:all_proxy = $null
$env:NO_PROXY = 'localhost,127.0.0.1'
$env:no_proxy = 'localhost,127.0.0.1'

Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format s)] Starting Nasdaq QDII dashboard on http://localhost:8004"
Start-Process -FilePath $nodeBin -ArgumentList @($vinext, 'dev', '--port', '8004', '--host', '127.0.0.1') -WorkingDirectory $projectDir -RedirectStandardOutput $logFile -RedirectStandardError $errorLogFile -WindowStyle Hidden | Out-Null
