<#
.SYNOPSIS
  Builds the SketchUp extension .rbz on Windows without needing Ruby.

.DESCRIPTION
  Equivalent to package.rb, for machines with no Ruby toolchain. Produces the
  same layout: the loader and manifest at the archive root, code under su_mcp/.

  Entry names are written with forward slashes via System.IO.Compression rather
  than Compress-Archive, which on PowerShell 5.1 emits backslash separators.
  Those are not valid ZIP path separators and an extractor may create a file
  literally named "su_mcp\main.rb" instead of the expected subfolder.

.PARAMETER InstallToPlugins
  Also copy the files straight into SketchUp's Plugins folder, for a fast
  edit-and-restart loop that skips the Extension Manager.

.EXAMPLE
  ./build-rbz.ps1
  ./build-rbz.ps1 -InstallToPlugins
#>
[CmdletBinding()]
param(
  [switch]$InstallToPlugins,
  [string]$SketchUpVersion = '2026'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = $PSScriptRoot
$version = (Get-Content (Join-Path $src 'extension.json') -Raw | ConvertFrom-Json).version

# Keep the three version strings in step; a mismatch confuses Extension Manager.
$loaderVersion = (Select-String -Path (Join-Path $src 'su_mcp.rb') -Pattern "ext\.version\s*=\s*'([^']+)'").Matches[0].Groups[1].Value
if ($loaderVersion -ne $version) {
  throw "Version mismatch: extension.json=$version but su_mcp.rb=$loaderVersion"
}

$files = @(
  @{ Disk = Join-Path $src 'su_mcp.rb';      Entry = 'su_mcp.rb' },
  @{ Disk = Join-Path $src 'extension.json'; Entry = 'extension.json' },
  @{ Disk = Join-Path $src 'su_mcp\main.rb'; Entry = 'su_mcp/main.rb' }
)
foreach ($f in $files) {
  if (-not (Test-Path $f.Disk)) { throw "Missing source file: $($f.Disk)" }
}

$rbz = Join-Path $src "su_mcp_v$version.rbz"
Remove-Item $rbz -Force -ErrorAction SilentlyContinue

$stream = [System.IO.File]::Open($rbz, [System.IO.FileMode]::CreateNew)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    $entry = $archive.CreateEntry($f.Entry, [System.IO.Compression.CompressionLevel]::Optimal)
    $out = $entry.Open()
    try {
      [byte[]]$bytes = [System.IO.File]::ReadAllBytes($f.Disk)
      $out.Write($bytes, 0, $bytes.Length)
    } finally { $out.Dispose() }
  }
} finally {
  $archive.Dispose()
  $stream.Dispose()
}

Write-Host "Built $rbz ($((Get-Item $rbz).Length) bytes)" -ForegroundColor Green
$verify = [System.IO.Compression.ZipFile]::OpenRead($rbz)
$verify.Entries | ForEach-Object { Write-Host ("  {0}" -f $_.FullName) }
$verify.Dispose()

if ($InstallToPlugins) {
  $plugins = Join-Path $env:APPDATA "SketchUp\SketchUp $SketchUpVersion\SketchUp\Plugins"
  if (-not (Test-Path $plugins)) { throw "Plugins folder not found: $plugins" }

  Copy-Item (Join-Path $src 'su_mcp.rb') $plugins -Force
  $dest = Join-Path $plugins 'su_mcp'
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  Copy-Item (Join-Path $src 'su_mcp\main.rb') $dest -Force

  Write-Host "Installed into $plugins" -ForegroundColor Green
  Write-Host 'Restart SketchUp to load it.' -ForegroundColor Yellow
}
