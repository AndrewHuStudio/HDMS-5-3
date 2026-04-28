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
