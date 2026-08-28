param(
  [ValidateSet('infra', 'data-process', 'review', 'qa', 'approval', 'frontend', 'tunnel')]
  [string]$Target,
  [string]$PythonExe = 'E:\my_envs\HIZ\python.exe',
  [string]$CloudflaredExe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe',
  [string]$TunnelConfig = 'C:\Users\82064\.cloudflared\config.yml',
  [string]$TunnelName = 'hdms-external-new',
  [switch]$DryRun
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env.external'
$frontendScript = Join-Path $PSScriptRoot 'start-frontend.ps1'

function Write-Step {
  param(
    [string]$Title,
    [string]$WorkingDirectory,
    [string]$CommandLine
  )

  Write-Host "[HDMS] Target: $Title"
  Write-Host "[HDMS] WorkingDirectory: $WorkingDirectory"
  Write-Host "[HDMS] Command: $CommandLine"
}

function Assert-PathExists {
  param(
    [string]$PathValue,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $PathValue)) {
    throw "$Label not found: $PathValue"
  }
}

function Show-Usage {
  Write-Host '[HDMS] start-external.ps1 starts exactly ONE service and stays in the foreground.'
  Write-Host '[HDMS] Run it once per service, each in its own terminal.'
  Write-Host ''
  Write-Host '  -Target infra          docker compose (Mongo / Milvus / Neo4j / Postgres / MinIO)'
  Write-Host '  -Target data-process   http://127.0.0.1:8125'
  Write-Host '  -Target review         http://127.0.0.1:8023'
  Write-Host '  -Target qa             http://127.0.0.1:8032   <- serves /rag/documents/{id}/pdf and /image'
  Write-Host '  -Target approval       http://127.0.0.1:8024'
  Write-Host '  -Target frontend       http://127.0.0.1:8021'
  Write-Host '  -Target tunnel         Cloudflare Tunnel public entry'
  Write-Host ''
  Write-Host '[HDMS] Example:'
  Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\start-external.ps1 -Target qa'
  Write-Host ''
  Write-Host '[HDMS] These are the EXTERNAL ports, matching the hdms-external-* containers'
  Write-Host '[HDMS] and .env.external. The 3000/8002/8003/8004/8005 set belongs to local mode'
  Write-Host '[HDMS] (scripts\start-frontend.ps1 -Mode local). Do not mix the two: the two'
  Write-Host '[HDMS] port sets map to different database containers and env files.'
  Write-Host ''
  Write-Host '[HDMS] The localhost:8002 in frontend/app/api/rag/.../route.ts is only a fallback'
  Write-Host '[HDMS] default; the real port comes from HDMS_QA_BASE_URL injected at startup.'
  Write-Host ''
  Write-Host '[HDMS] To verify PDF/image after -Target qa is up (both share one proxy):'
  Write-Host '[HDMS]   curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8032/health'
  Write-Host '[HDMS]   curl -s http://127.0.0.1:8032/openapi.json    # authoritative route list'
  Write-Host '[HDMS] There is NO /rag/search endpoint; calling it returns 404. Real routes are'
  Write-Host '[HDMS] /qa/chat/stream, /rag/documents/{id}/pdf, /rag/documents/{id}/image,'
  Write-Host '[HDMS] /rag/sources/{chunk_id} (each also under an /api prefix).'
}

# Without -Target the switch below matches nothing and the script would exit
# silently, looking like a successful start while nothing is listening. Fail loudly.
if (-not $Target) {
  Show-Usage
  throw 'No -Target specified. This script starts one service per invocation; pick a target from the list above.'
}

Assert-PathExists -PathValue $repoRoot -Label 'repo root'
Assert-PathExists -PathValue $envFile -Label '.env.external'

switch ($Target) {
  'infra' {
    $workingDirectory = $repoRoot
    $commandLine = 'docker compose -f docker-compose.external.yml -p hdms_external up -d'
    Write-Step -Title $Target -WorkingDirectory $workingDirectory -CommandLine $commandLine
    if ($DryRun) { return }

    Push-Location $workingDirectory
    try {
      docker compose -f docker-compose.external.yml -p hdms_external up -d
    }
    finally {
      Pop-Location
    }
  }

  'data-process' {
    Assert-PathExists -PathValue $PythonExe -Label 'Python executable'
    $workingDirectory = $repoRoot
    $commandLine = "$PythonExe -m uvicorn data_process.main:app --host 127.0.0.1 --port 8125 --env-file $envFile --reload"
    Write-Step -Title $Target -WorkingDirectory $workingDirectory -CommandLine $commandLine
    if ($DryRun) { return }

    Push-Location $workingDirectory
    try {
      & $PythonExe -m uvicorn data_process.main:app --host 127.0.0.1 --port 8125 --env-file $envFile --reload
    }
    finally {
      Pop-Location
    }
  }

  'review' {
    Assert-PathExists -PathValue $PythonExe -Label 'Python executable'
    $workingDirectory = Join-Path $repoRoot 'backend\review_system'
    Assert-PathExists -PathValue $workingDirectory -Label 'review_system directory'
    $commandLine = "$PythonExe -m uvicorn app:app --host 127.0.0.1 --port 8023 --env-file $envFile --reload"
    Write-Step -Title $Target -WorkingDirectory $workingDirectory -CommandLine $commandLine
    if ($DryRun) { return }

    Push-Location $workingDirectory
    try {
      & $PythonExe -m uvicorn app:app --host 127.0.0.1 --port 8023 --env-file $envFile --reload
    }
    finally {
      Pop-Location
    }
  }

  'qa' {
    Assert-PathExists -PathValue $PythonExe -Label 'Python executable'
    $workingDirectory = Join-Path $repoRoot 'backend\qa_assistant'
    Assert-PathExists -PathValue $workingDirectory -Label 'qa_assistant directory'
    $commandLine = "PYTHONPATH=$repoRoot; $PythonExe -m uvicorn app:app --host 127.0.0.1 --port 8032 --env-file $envFile --reload"
    Write-Step -Title $Target -WorkingDirectory $workingDirectory -CommandLine $commandLine
    if ($DryRun) { return }

    $env:PYTHONPATH = $repoRoot
    Push-Location $workingDirectory
    try {
      & $PythonExe -m uvicorn app:app --host 127.0.0.1 --port 8032 --env-file $envFile --reload
    }
    finally {
      Pop-Location
    }
  }

  'approval' {
    Assert-PathExists -PathValue $PythonExe -Label 'Python executable'
    $workingDirectory = Join-Path $repoRoot 'backend\approval_checklist'
    Assert-PathExists -PathValue $workingDirectory -Label 'approval_checklist directory'
    $commandLine = "$PythonExe -m uvicorn app:app --host 127.0.0.1 --port 8024 --env-file $envFile --reload"
    Write-Step -Title $Target -WorkingDirectory $workingDirectory -CommandLine $commandLine
    if ($DryRun) { return }

    Push-Location $workingDirectory
    try {
      & $PythonExe -m uvicorn app:app --host 127.0.0.1 --port 8024 --env-file $envFile --reload
    }
    finally {
      Pop-Location
    }
  }

  'frontend' {
    Assert-PathExists -PathValue $frontendScript -Label 'start-frontend.ps1'
    $workingDirectory = Join-Path $repoRoot 'frontend'
    $commandLine = "$frontendScript -Mode external -Port 8021 -ReviewBase http://127.0.0.1:8023 -QaBase http://127.0.0.1:8032 -QaServerBase http://127.0.0.1:8032 -ApprovalBase http://127.0.0.1:8024 -ApprovalPublicBase /api/approval -DataProcessBase http://127.0.0.1:8125"
    Write-Step -Title $Target -WorkingDirectory $workingDirectory -CommandLine $commandLine
    & $frontendScript `
      -Mode external `
      -Port 8021 `
      -ReviewBase 'http://127.0.0.1:8023' `
      -QaBase 'http://127.0.0.1:8032' `
      -QaServerBase 'http://127.0.0.1:8032' `
      -ApprovalBase 'http://127.0.0.1:8024' `
      -ApprovalPublicBase '/api/approval' `
      -DataProcessBase 'http://127.0.0.1:8125' `
      -DryRun:$DryRun
  }

  'tunnel' {
    Assert-PathExists -PathValue $CloudflaredExe -Label 'cloudflared executable'
    Assert-PathExists -PathValue $TunnelConfig -Label 'cloudflared config'
    $workingDirectory = $repoRoot
    $commandLine = "$CloudflaredExe tunnel --protocol http2 --edge-ip-version 4 --config $TunnelConfig run $TunnelName"
    Write-Step -Title $Target -WorkingDirectory $workingDirectory -CommandLine $commandLine
    if ($DryRun) { return }

    & $CloudflaredExe tunnel --protocol http2 --edge-ip-version 4 --config $TunnelConfig run $TunnelName
  }
}
