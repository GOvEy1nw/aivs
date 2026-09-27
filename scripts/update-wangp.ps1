param(
    [switch]$CheckOnly,
    [switch]$Full
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectDir 'backend'

& (Join-Path $ScriptDir 'ensure-wan2gp.ps1')
if ($LASTEXITCODE -ne 0) { throw 'WanGP source validation failed.' }
if ($CheckOnly) { exit 0 }

uv run --project $BackendDir pytest -q backend/tests/test_wangp_root.py backend/tests/test_wangp_source.py --tb=short
if ($LASTEXITCODE -ne 0) { throw 'Focused WanGP source checks failed.' }

if ($Full) {
    pnpm typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
    pnpm build:frontend
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}

Write-Host 'WanGP source validated without modification.' -ForegroundColor Green
