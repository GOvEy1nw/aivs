# local-build.ps1
# All-in-one local build script for creating the AiVS installer.
# Prepares the Python environment, installs pnpm deps, builds the frontend,
# then packages with electron-builder via create-installer.ps1.

param(
    [switch]$SkipPython,
    [switch]$Clean,
    [switch]$Unpack,
    [string]$Publish = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$PythonBootstrapDir = Join-Path $ProjectDir "python-bootstrap"
$GitBootstrapDir = Join-Path $ProjectDir "git-bootstrap"
$ReleaseDir = Join-Path $ProjectDir "release"

Write-Host @"

  _   _______  __  ____            _    _
 | | |_   _\ \/ / |  _ \  ___  ___| | _| |_ ___  _ __
 | |   | |  \  /  | | | |/ _ \/ __| |/ / __/ _ \| '_ \
 | |___| |  /  \  | |_| |  __/\__ \   <| || (_) | |_) |
 |_____|_| /_/\_\ |____/ \___||___/_|\_\\__\___/| .__/
                                                 |_|
  Local Build Script

"@ -ForegroundColor Cyan

Set-Location $ProjectDir

# ============================================================
# Step 0: Clean if requested
# ============================================================
if ($Clean) {
    Write-Host "Cleaning previous build artifacts..." -ForegroundColor Yellow

    if (Test-Path $PythonBootstrapDir) {
        Remove-Item -Recurse -Force $PythonBootstrapDir
    }
    if (Test-Path $GitBootstrapDir) {
        Remove-Item -Recurse -Force $GitBootstrapDir
    }
    if (Test-Path $ReleaseDir) {
        Remove-Item -Recurse -Force $ReleaseDir
    }
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
    }
    if (Test-Path "dist-electron") {
        Remove-Item -Recurse -Force "dist-electron"
    }

    Write-Host "Clean complete." -ForegroundColor Green
}

# ============================================================
# Step 1: Prepare Python environment
# ============================================================
if (-not $SkipPython) {
    Write-Host "`n[1/3] Preparing Python bootstrap..." -ForegroundColor Yellow

    if (Test-Path $PythonBootstrapDir) {
        Write-Host "Python bootstrap already exists. Use -Clean to rebuild." -ForegroundColor DarkYellow
    } else {
        & "$ScriptDir\prepare-python-bootstrap.ps1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to prepare Python bootstrap!" -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "`n[1/3] Skipping Python bootstrap (using existing)..." -ForegroundColor DarkYellow
}

if (-not (Test-Path $PythonBootstrapDir)) {
    Write-Host "ERROR: Python bootstrap not found at $PythonBootstrapDir" -ForegroundColor Red
    Write-Host "Run without -SkipPython to create it." -ForegroundColor Red
    exit 1
}

Write-Host "Preparing Git bootstrap..." -ForegroundColor Yellow
if (Test-Path $GitBootstrapDir) {
    Write-Host "Git bootstrap already exists. Use -Clean to rebuild." -ForegroundColor DarkYellow
} else {
    & "$ScriptDir\prepare-git.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to prepare Git bootstrap!" -ForegroundColor Red
        exit 1
    }
}

# ============================================================
# Step 2: Install pnpm dependencies
# ============================================================
Write-Host "`n[2/3] Installing pnpm dependencies..." -ForegroundColor Yellow
corepack pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install pnpm dependencies!" -ForegroundColor Red
    exit 1
}

# ============================================================
# Step 3: Build frontend
# ============================================================
Write-Host "`n[3/3] Building frontend and Electron app..." -ForegroundColor Yellow

corepack pnpm run build:frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build frontend!" -ForegroundColor Red
    exit 1
}

# ============================================================
# Step 4: Create installer
# ============================================================
& "$ScriptDir\stage-wan2gp.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to stage WanGP source!" -ForegroundColor Red
    exit 1
}

$pkgParams = @{}
if ($Unpack)         { $pkgParams["Unpack"] = $true }
if ($Publish -ne "") { $pkgParams["Publish"] = $Publish }

& "$ScriptDir\create-installer.ps1" @pkgParams
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
