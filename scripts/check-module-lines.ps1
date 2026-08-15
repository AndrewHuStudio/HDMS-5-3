param(
    [int]$MaxLines = 600,
    [string[]]$Path
)

$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    $repoRoot = (Get-Location).Path
}
$repoRoot = (Resolve-Path $repoRoot).Path

$sourceExtensions = @(
    ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".css", ".scss", ".html", ".md"
)

$excludedSegments = @(
    "\node_modules\", "\.git\", "\.next\", "\dist\", "\build\",
    "\coverage\", "\__pycache__\", "\.pytest_cache\", "\tmp\",
    "\data\cache\", "\data\uploads\"
)

function Test-IsIncludedSourceFile {
    param([string]$FilePath)

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        return $false
    }

    $fullPath = (Resolve-Path -LiteralPath $FilePath).Path
    $lowerPath = $fullPath.ToLowerInvariant()
    foreach ($segment in $excludedSegments) {
        if ($lowerPath.Contains($segment.ToLowerInvariant())) {
            return $false
        }
    }

    $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
    return $sourceExtensions -contains $extension
}

function Get-ChangedFiles {
    $files = @()
    $files += git diff --name-only --diff-filter=ACMRTUXB
    $files += git diff --cached --name-only --diff-filter=ACMRTUXB
    return $files | Where-Object { $_ } | Sort-Object -Unique
}

if ($Path -and $Path.Count -gt 0) {
    $candidateFiles = $Path
} else {
    $candidateFiles = Get-ChangedFiles
}

$violations = @()

foreach ($candidate in $candidateFiles) {
    $fullPath = if ([System.IO.Path]::IsPathRooted($candidate)) {
        $candidate
    } else {
        Join-Path $repoRoot $candidate
    }

    if (-not (Test-IsIncludedSourceFile -FilePath $fullPath)) {
        continue
    }

    $lineCount = (Get-Content -LiteralPath $fullPath | Measure-Object -Line).Lines
    if ($lineCount -gt $MaxLines) {
        $relativePath = [System.IO.Path]::GetRelativePath($repoRoot, (Resolve-Path -LiteralPath $fullPath).Path)
        $violations += [PSCustomObject]@{
            Lines = $lineCount
            Path = $relativePath
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Host "Module line limit exceeded (max $MaxLines lines):" -ForegroundColor Red
    $violations | Sort-Object Lines -Descending | Format-Table -AutoSize
    exit 1
}

Write-Host "Module line check passed for changed source files (max $MaxLines lines)." -ForegroundColor Green
