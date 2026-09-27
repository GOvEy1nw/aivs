$ErrorActionPreference = "Stop"

function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectDir "backend"
$BackendPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "node not found. Install Node.js 18+ from https://nodejs.org/"
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail "pnpm not found. Install it with corepack enable, then corepack prepare pnpm --activate."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Fail "uv not found. Install it with powershell -ExecutionPolicy Bypass -c `"irm https://astral.sh/uv/install.ps1 | iex`"."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail "git not found. Install Git from https://git-scm.com/download/win"
}

Ok "node $(node -v)"
Ok "pnpm $(pnpm --version)"
Ok "uv $(uv --version)"
Ok "git $(git --version)"

Write-Host ""
Write-Host "Validating external WanGP checkout..."
& (Join-Path $ScriptDir "ensure-wan2gp.ps1")
if ($LASTEXITCODE -ne 0) {
Fail "External WanGP checkout validation failed"
}
Ok "External WanGP checkout ready"

Write-Host ""
Write-Host "Installing Node dependencies..."
Set-Location $ProjectDir
pnpm install
if ($LASTEXITCODE -ne 0) {
    Fail "pnpm install failed"
}
Ok "pnpm install complete"

Write-Host ""
Write-Host "Setting up Python backend venv..."
Set-Location $BackendDir
uv sync --inexact --extra dev --extra test
if ($LASTEXITCODE -ne 0) {
    Fail "uv sync failed"
}
Ok "uv sync complete"

Write-Host ""
Write-Host "Installing WanGP GPU stack (auto-detects your NVIDIA GPU)..."
$WanGPRoot = if ($env:WANGP_ROOT) { $env:WANGP_ROOT } elseif ($env:WANGP_WGP_PATH) { $env:WANGP_WGP_PATH } else { 'C:\Wan2GP' }
& (Join-Path $ScriptDir "install-wangp-stack.ps1") -WanGPRoot $WanGPRoot
if ($LASTEXITCODE -ne 0) {
    Fail "WanGP stack install failed"
}
Ok "WanGP GPU stack installed"

Write-Host ""
Write-Host "Verifying PyTorch CUDA support..."
try {
    & $BackendPython -c "import torch; cuda=torch.cuda.is_available(); print(f'CUDA available: {cuda}'); print(f'GPU: {torch.cuda.get_device_name(0)}') if cuda else None"
} catch {
    Write-Host "Could not verify PyTorch. This is acceptable if setup is still downloading." -ForegroundColor DarkYellow
}

Write-Host ""
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    $ffmpegVer = ffmpeg -version 2>&1 | Select-Object -First 1
    Ok "ffmpeg found: $ffmpegVer"
} else {
    Write-Host "[WARN] ffmpeg not found. Install it with: winget install ffmpeg" -ForegroundColor Yellow
    Write-Host "       imageio-ffmpeg bundled binary will be used as fallback" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Setup complete. Run the app with: pnpm dev" -ForegroundColor Cyan
Write-Host "Debug mode: pnpm dev:debug" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
