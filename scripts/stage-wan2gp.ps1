param(
    [string]$SourceRoot = '',
    [string]$DestinationRoot = ''
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

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

function Assert-NoReparsePoints([string]$Root) {
    $item = Get-Item -LiteralPath $Root -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "WanGP source contains an unsupported reparse point: $($item.FullName)"
    }
    if (-not $item.PSIsContainer) { return }
    $reparsePoint = Get-ChildItem -LiteralPath $Root -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop | Select-Object -First 1
    if ($reparsePoint) { throw "WanGP source contains an unsupported reparse point: $($reparsePoint.FullName)" }
}

function Get-ContentIdentity([string]$Root) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        [string[]]$files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force |
            ForEach-Object { $_.FullName.Substring($Root.Length).TrimStart('\', '/') -replace '\\', '/' })
        [Array]::Sort($files, [StringComparer]::Ordinal)
        foreach ($relative in $files) {
            $pathBytes = [Text.Encoding]::UTF8.GetBytes("$relative`n")
            [void]$hash.TransformBlock($pathBytes, 0, $pathBytes.Length, $pathBytes, 0)
            $stream = [IO.File]::OpenRead((Join-Path $Root $relative))
            try {
                $buffer = New-Object byte[] 65536
                while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    [void]$hash.TransformBlock($buffer, 0, $count, $buffer, 0)
                }
            } finally {
                $stream.Dispose()
            }
        }
        [void]$hash.TransformFinalBlock([byte[]]::new(0), 0, 0)
        return (([BitConverter]::ToString($hash.Hash) -replace '-', '')).ToLowerInvariant()
    } finally {
        $hash.Dispose()
    }
}

function Copy-SourceItem([string]$Source, [string]$Destination) {
    $item = Get-Item -LiteralPath $Source -Force
    if ($item.PSIsContainer) {
        if ($item.Name -in @('__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv', 'node_modules', 'cache', 'caches', 'logs')) { return }
        New-Item -ItemType Directory -Force -Path $Destination | Out-Null
        foreach ($child in Get-ChildItem -LiteralPath $Source -Force) {
            Copy-SourceItem $child.FullName (Join-Path $Destination $child.Name)
        }
        return
    }
    if ($item.Extension -in @('.safetensors', '.gguf', '.ckpt')) { return }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Test-PathOverlap([string]$Left, [string]$Right) {
    $leftPath = $Left.TrimEnd('\', '/')
    $rightPath = $Right.TrimEnd('\', '/')
    return $leftPath.Equals($rightPath, [StringComparison]::OrdinalIgnoreCase) -or
        $leftPath.StartsWith($rightPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $rightPath.StartsWith($leftPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

if ($SourceRoot) {
    $SourceRoot = Resolve-WanGPRoot $SourceRoot
} elseif ($env:WANGP_ROOT) {
    $SourceRoot = Resolve-WanGPRoot $env:WANGP_ROOT
} elseif ($env:WANGP_WGP_PATH) {
    $SourceRoot = Resolve-WanGPRoot $env:WANGP_WGP_PATH
} else {
    $SourceRoot = Resolve-WanGPRoot 'C:\Wan2GP'
}
if (-not $SourceRoot) { throw 'Set WANGP_ROOT or WANGP_WGP_PATH to a valid Wan2GP source, or place it at C:\Wan2GP.' }

if (-not $DestinationRoot) { $DestinationRoot = Join-Path $ProjectDir 'resources\Wan2GP' }
$DestinationRoot = [IO.Path]::GetFullPath($DestinationRoot)
$ResourcesRoot = [IO.Path]::GetFullPath((Join-Path $ProjectDir 'resources'))
if (-not $DestinationRoot.StartsWith($ResourcesRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage WanGP outside resources: $DestinationRoot"
}
$stagingRoot = "$DestinationRoot.staging"
if ((Test-PathOverlap $SourceRoot $DestinationRoot) -or (Test-PathOverlap $SourceRoot $stagingRoot)) {
    throw "WanGP source and staging destination must not overlap."
}
Assert-NoReparsePoints $ResourcesRoot
if (Test-Path $DestinationRoot) { Assert-NoReparsePoints $DestinationRoot }
if (Test-Path $stagingRoot) { Assert-NoReparsePoints $stagingRoot }
if (Test-Path $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

$directories = @('defaults', 'docs', 'icons', 'LICENSES', 'models', 'plugins', 'postprocessing', 'preprocessing', 'profiles', 'scripts', 'shared', 'wangp-agent')
$files = @('wgp.py', 'requirements.txt', 'setup.py', 'setup_config.json', 'plugins.json', 'favicon.png', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'README.md')
foreach ($name in $directories + $files) {
    $source = Join-Path $SourceRoot $name
    if (Test-Path $source) {
        Assert-NoReparsePoints $source
        Copy-SourceItem $source (Join-Path $stagingRoot $name)
    }
}
New-Item -ItemType Directory -Force -Path (Join-Path $stagingRoot 'finetunes') | Out-Null

$identity = Get-ContentIdentity $stagingRoot
$marker = @{ schemaVersion = 1; contentHash = $identity } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $stagingRoot '.aivs-wangp-source.json'), $marker, [Text.UTF8Encoding]::new($false))

if (Test-Path $DestinationRoot) { Remove-Item -LiteralPath $DestinationRoot -Recurse -Force }
Move-Item -LiteralPath $stagingRoot -Destination $DestinationRoot
Write-Host "Staged WanGP source from $SourceRoot with identity $identity" -ForegroundColor Green
