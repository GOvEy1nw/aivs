# create-installer.ps1
# Runs electron-builder to produce the installer (exe).
# This is the ONLY build stage that needs code-signing secrets.
#
# Expects the frontend to be built and python-embed to be ready.
# See local-build.ps1 for the convenience wrapper that runs all stages.

param(
    [switch]$Unpack,
    [string]$Publish = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$ReleaseDir = Join-Path $ProjectDir "release"
$VcRedistPath = Join-Path $ProjectDir "resources\vc_redist.x64.exe"
$VcRedistUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
$ElectronBuilder = Join-Path $ProjectDir "node_modules\.bin\electron-builder.cmd"
$WindowsSecurityModule = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"

Set-Location $ProjectDir

# Verify prerequisites
if (-not (Test-Path "dist") -or -not (Test-Path "dist-electron")) {
    Write-Host "ERROR: Frontend not built. Run local-build.ps1 or 'npm run build:frontend' first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "python-bootstrap\python.exe")) {
    Write-Host "ERROR: Python bootstrap not found. Run prepare-python-bootstrap.ps1 first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "git-bootstrap\cmd\git.exe")) {
    Write-Host "ERROR: Git bootstrap not found. Run prepare-git.ps1 first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ElectronBuilder)) {
    Write-Host "ERROR: electron-builder is not installed. Run pnpm install first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $VcRedistPath)) {
    Write-Host "Downloading Visual C++ Redistributable..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $VcRedistUrl -OutFile $VcRedistPath
}

Import-Module $WindowsSecurityModule -Force
$VcRedistSignature = Get-AuthenticodeSignature $VcRedistPath
if (
    $VcRedistSignature.Status -ne "Valid" -or
    $VcRedistSignature.SignerCertificate.Subject -notmatch "Microsoft Corporation"
) {
    throw "Visual C++ Redistributable signature verification failed: $($VcRedistSignature.Status)"
}

# Build with electron-builder
# Let electron-builder's pnpm collector honor packageManager instead of inheriting the outer Corepack version.
Remove-Item Env:COREPACK_ROOT -ErrorAction SilentlyContinue
if ($Unpack) {
    Write-Host "Packaging unpacked app (fast mode)..." -ForegroundColor Yellow
    # Reuse the installed runtime instead of downloading and extracting Electron again.
    $ElectronDist = Join-Path $ProjectDir "node_modules\electron\dist"
    & $ElectronBuilder --win --dir "--config.electronDist=$ElectronDist"
} else {
    Write-Host "Packaging installer..." -ForegroundColor Yellow
    $PublishArgs = @()
    if ($Publish -ne "") {
        $PublishArgs = @("--publish", $Publish)
    }
    & $ElectronBuilder --win @PublishArgs
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build!" -ForegroundColor Red
    exit 1
}

# Summary
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

if ($Unpack) {
    $UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
    $ExePath = Join-Path $UnpackedDir "AiVS.exe"
    Write-Host "`nUnpacked app ready!" -ForegroundColor Cyan
    Write-Host "Run: $ExePath" -ForegroundColor Cyan
    Write-Host "`nTip: Just restart the app after code changes - no rebuild needed!" -ForegroundColor Green
} else {
    $Installer = Get-ChildItem -Path $ReleaseDir -Filter "*.exe" | Where-Object { $_.Name -like "*Setup*" } | Select-Object -First 1
    if ($Installer) {
        $InstallerSize = [math]::Round($Installer.Length / 1MB, 2)
        Write-Host "`nInstaller: $($Installer.Name)" -ForegroundColor Cyan
        Write-Host "Size: $InstallerSize MB" -ForegroundColor Cyan
        Write-Host "Location: $($Installer.FullName)" -ForegroundColor Cyan
    }
}

Write-Host "`nNote: AI models (~150GB) will be downloaded on first run." -ForegroundColor Yellow
