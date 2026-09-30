param(
    [switch]$CheckOnly,
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectDir 'backend'
$Python = Join-Path $BackendDir '.venv\Scripts\python.exe'
$RuntimeRoot = if ($env:WANGP_ROOT) { $env:WANGP_ROOT } elseif ($env:WANGP_WGP_PATH) { $env:WANGP_WGP_PATH } else { 'C:\Wan2GP' }
if (Test-Path -LiteralPath $RuntimeRoot -PathType Leaf) { $RuntimeRoot = Split-Path -Parent $RuntimeRoot }

& (Join-Path $ScriptDir 'ensure-wan2gp.ps1')
if ($LASTEXITCODE -ne 0) { throw 'WanGP source validation failed.' }
if ($CheckOnly) { exit 0 }

if (-not (Test-Path -LiteralPath $Python)) { throw "Missing managed backend interpreter: $Python" }
& $Python (Join-Path $BackendDir 'tools\check_wangp_contracts.py') --project-root $ProjectDir --runtime-root $RuntimeRoot
if ($LASTEXITCODE -ne 0) { throw 'Static WanGP contract check failed.' }

Push-Location $BackendDir
try {
    & $Python -m pytest -q tests/test_wangp_root.py tests/test_wangp_source.py --tb=short
} finally {
    Pop-Location
}
if ($LASTEXITCODE -ne 0) { throw 'Focused WanGP source checks failed.' }

if ($Full) {
    pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
    pnpm build:frontend
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}

Write-Host 'WanGP source validated without modification.' -ForegroundColor Green
