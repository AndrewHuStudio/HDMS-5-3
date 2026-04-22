param(
  [ValidateSet('local', 'external')]
  [string]$Mode = 'local',
  [int]$Port,
  [string]$ReviewBase,
  [string]$QaBase,
  [string]$QaServerBase,
  [string]$DataProcessBase,
  [switch]$DryRun
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot 'frontend'

if (-not (Test-Path $frontendDir)) {
  throw "frontend directory not found: $frontendDir"
}

if (-not $Port) {
  $Port = if ($Mode -eq 'external') { 8021 } else { 3000 }
}

if (-not $ReviewBase) {
  $ReviewBase = if ($Mode -eq 'external') { '' } else { 'http://localhost:8003' }
}

if (-not $QaBase) {
  $QaBase = if ($Mode -eq 'external') { '' } else { 'http://localhost:8002' }
}

if (-not $QaServerBase) {
  $QaServerBase = if ($Mode -eq 'external') { 'http://localhost:8032' } else { $QaBase }
}

if (-not $DataProcessBase) {
  $DataProcessBase = if ($Mode -eq 'external') { '' } else { 'http://localhost:8005' }
}

$env:NEXT_PUBLIC_HDMS_API_BASE = $ReviewBase
$env:NEXT_PUBLIC_HDMS_QA_BASE = $QaBase
$env:HDMS_QA_BASE_URL = $QaServerBase
$env:NEXT_PUBLIC_DATA_PROCESS_BASE = $DataProcessBase

Write-Host "[HDMS] Frontend mode: $Mode"
Write-Host "[HDMS] Port: $Port"
Write-Host "[HDMS] NEXT_PUBLIC_HDMS_API_BASE=$($env:NEXT_PUBLIC_HDMS_API_BASE)"
Write-Host "[HDMS] NEXT_PUBLIC_HDMS_QA_BASE=$($env:NEXT_PUBLIC_HDMS_QA_BASE)"
Write-Host "[HDMS] HDMS_QA_BASE_URL=$($env:HDMS_QA_BASE_URL)"
Write-Host "[HDMS] NEXT_PUBLIC_DATA_PROCESS_BASE=$($env:NEXT_PUBLIC_DATA_PROCESS_BASE)"

if ($DryRun) {
  Write-Host '[HDMS] DryRun enabled, skip npm dev launch.'
  return
}

Push-Location $frontendDir
try {
  npm run dev -- -p $Port
}
finally {
  Pop-Location
}
