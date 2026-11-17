param(
  [string]$NinjaRoot = (Join-Path $PSScriptRoot 'ninja'),
  [string]$Version = '1.13.2'
)
$ErrorActionPreference = 'Stop'

$ninja = Join-Path $NinjaRoot 'ninja.exe'
if (Test-Path $ninja) {
  Write-Host "Using existing Ninja at $ninja"
  exit 0
}

$downloads = Join-Path $PSScriptRoot 'downloads'
New-Item -ItemType Directory -Force -Path $downloads, $NinjaRoot | Out-Null
$archive = Join-Path $downloads "ninja-win-v$Version.zip"
$url = "https://github.com/ninja-build/ninja/releases/download/v$Version/ninja-win.zip"

Write-Host "Downloading Ninja v$Version into this isolated spike..."
Invoke-WebRequest -Uri $url -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $NinjaRoot -Force
if (-not (Test-Path $ninja)) { throw "Ninja archive did not contain $ninja" }
Write-Host "Ninja is local to this spike: $ninja"
