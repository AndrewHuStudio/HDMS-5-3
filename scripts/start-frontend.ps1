param(
  [ValidateSet('local', 'external')]
  [string]$Mode = 'local',
  [int]$Port,
  [string]$ReviewBase,
  [string]$QaBase,
  [string]$QaServerBase,
  [string]$ApprovalBase,
  [string]$ApprovalPublicBase,
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
  $ReviewBase = if ($Mode -eq 'external') { 'http://127.0.0.1:8023' } else { 'http://localhost:8003' }
}

if (-not $QaBase) {
  $QaBase = if ($Mode -eq 'external') { 'http://127.0.0.1:8032' } else { 'http://localhost:8002' }
}

if (-not $QaServerBase) {
  $QaServerBase = if ($Mode -eq 'external') { 'http://localhost:8032' } else { $QaBase }
}

if (-not $ApprovalBase) {
  $ApprovalBase = if ($Mode -eq 'external') { 'http://127.0.0.1:8024' } else { 'http://localhost:8004' }
}

if (-not $ApprovalPublicBase) {
  $ApprovalPublicBase = '/api/approval'
}

if (-not $DataProcessBase) {
  $DataProcessBase = if ($Mode -eq 'external') { 'http://127.0.0.1:8125' } else { 'http://localhost:8005' }
}

$env:NEXT_PUBLIC_HDMS_API_BASE = $ReviewBase
$env:NEXT_PUBLIC_HDMS_QA_BASE = $QaBase
$env:HDMS_QA_BASE_URL = $QaServerBase
$env:HDMS_APPROVAL_BASE_URL = $ApprovalBase
$env:NEXT_PUBLIC_APPROVAL_CHECKLIST_BASE = $ApprovalPublicBase
$env:NEXT_PUBLIC_DATA_PROCESS_BASE = $DataProcessBase
$env:NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES = '8023'
$env:NEXT_PUBLIC_HDMS_QA_PORT_CANDIDATES = '8032'

Write-Host "[HDMS] Frontend mode: $Mode"
Write-Host "[HDMS] Port: $Port"
Write-Host "[HDMS] NEXT_PUBLIC_HDMS_API_BASE=$($env:NEXT_PUBLIC_HDMS_API_BASE)"
Write-Host "[HDMS] NEXT_PUBLIC_HDMS_QA_BASE=$($env:NEXT_PUBLIC_HDMS_QA_BASE)"
Write-Host "[HDMS] HDMS_QA_BASE_URL=$($env:HDMS_QA_BASE_URL)"
Write-Host "[HDMS] HDMS_APPROVAL_BASE_URL=$($env:HDMS_APPROVAL_BASE_URL)"
Write-Host "[HDMS] NEXT_PUBLIC_APPROVAL_CHECKLIST_BASE=$($env:NEXT_PUBLIC_APPROVAL_CHECKLIST_BASE)"
Write-Host "[HDMS] NEXT_PUBLIC_DATA_PROCESS_BASE=$($env:NEXT_PUBLIC_DATA_PROCESS_BASE)"
Write-Host "[HDMS] NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES=$($env:NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES)"
Write-Host "[HDMS] NEXT_PUBLIC_HDMS_QA_PORT_CANDIDATES=$($env:NEXT_PUBLIC_HDMS_QA_PORT_CANDIDATES)"

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
