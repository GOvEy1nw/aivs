param(
    [string]$RootDir = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-WanGPRoot([string]$Value) {
    if (-not $Value) { return $null }
    $candidate = $Value.Trim()
    if (Test-Path $candidate -PathType Leaf) { $candidate = Split-Path -Parent $candidate }
    if (-not (Test-Path $candidate -PathType Container)) { return $null }
    $resolved = (Resolve-Path -LiteralPath $candidate).Path
    foreach ($relative in @('wgp.py', 'shared\api.py', 'requirements.txt')) {
        if (-not (Test-Path (Join-Path $resolved $relative) -PathType Leaf)) { return $null }
    }
    return $resolved
}

foreach ($candidate in @($RootDir, $env:WANGP_ROOT, $env:WANGP_WGP_PATH, 'C:\Wan2GP')) {
    $resolved = Resolve-WanGPRoot $candidate
    if ($resolved) {
        Write-Host "WanGP source: $resolved" -ForegroundColor Green
        exit 0
    }
}

throw 'Set WANGP_ROOT or WANGP_WGP_PATH to a valid Wan2GP source, or place it at C:\Wan2GP.'
