param(
  [Parameter(Mandatory = $true)]
  [string]$RocketSimSource,
  [Parameter(Mandatory = $true)]
  [string]$EmsdkRoot,
  [Parameter(Mandatory = $true)]
  [string]$NinjaExecutable,
  [Parameter(Mandatory = $true)]
  [string]$BuildDirectory,
  [string]$CMakeExecutable = 'cmake'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$manifestPath = Join-Path $PSScriptRoot 'wasm-build-provenance.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

function Assert-GitCommit([string]$Path, [string]$Expected, [string]$Label) {
  if (-not (Test-Path (Join-Path $Path '.git'))) { throw "$Label is not a Git checkout: $Path" }
  $actual = (& git -C $Path rev-parse HEAD 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect $Label commit: $actual" }
  if ($actual -ne $Expected) { throw "$Label commit mismatch: expected $Expected, got $actual" }
  Write-Host "$Label commit: $actual"
}

function Get-CommandOutput([string]$Executable, [string[]]$Arguments, [string]$Label) {
  $output = (& $Executable @Arguments 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "$Label failed: $output" }
  return $output
}

Assert-GitCommit -Path $RocketSimSource -Expected $manifest.source.rocketsim.commit -Label 'RocketSim'
Assert-GitCommit -Path $EmsdkRoot -Expected $manifest.source.emsdk.commit -Label 'emsdk'

$cmakeCommand = Get-Command $CMakeExecutable -ErrorAction Stop
$cmakePath = $cmakeCommand.Source
if (-not $cmakePath) { throw "Could not resolve CMake executable: $CMakeExecutable" }
$env:Path = "$(Split-Path -Parent $cmakePath);$env:Path"
$cmakeOutput = Get-CommandOutput -Executable $cmakePath -Arguments @('--version') -Label 'CMake'
if (($cmakeOutput -split "`r?`n" | Select-Object -First 1) -ne "cmake version $($manifest.tools.cmake)") {
  throw "CMake version mismatch: expected $($manifest.tools.cmake), got $cmakeOutput"
}

if (-not (Test-Path -LiteralPath $NinjaExecutable -PathType Leaf)) { throw "Ninja executable not found: $NinjaExecutable" }
$ninjaOutput = Get-CommandOutput -Executable $NinjaExecutable -Arguments @('--version') -Label 'Ninja'
if ($ninjaOutput -ne $manifest.tools.ninja) { throw "Ninja version mismatch: expected $($manifest.tools.ninja), got $ninjaOutput" }

$emccCandidates = @(
  (Join-Path $EmsdkRoot 'upstream\emscripten\emcc.exe'),
  (Join-Path $EmsdkRoot 'upstream\emscripten\emcc.bat')
)
$emcc = $emccCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $emcc) { throw "Emscripten compiler not found under $EmsdkRoot" }
$emccOutput = Get-CommandOutput -Executable $emcc -Arguments @('--version') -Label 'Emscripten'
if ($emccOutput -notmatch [regex]::Escape($manifest.source.emsdk.emscriptenVersion)) {
  throw "Emscripten version mismatch: expected $($manifest.source.emsdk.emscriptenVersion), got $emccOutput"
}
if ($emccOutput -notmatch [regex]::Escape($manifest.source.emsdk.compilerCommit)) {
  throw "Emscripten compiler commit mismatch: expected $($manifest.source.emsdk.compilerCommit), got $emccOutput"
}
Write-Host "Emscripten: $emccOutput"

if (Test-Path -LiteralPath $BuildDirectory) {
  throw "Freshness build directory must not exist before this check: $BuildDirectory"
}
New-Item -ItemType Directory -Path $BuildDirectory -Force | Out-Null

foreach ($artifact in $manifest.artifacts) {
  $checkedInPath = Join-Path $repoRoot ($artifact.path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $checkedInPath -PathType Leaf)) { throw "Committed WASM artifact missing: $checkedInPath" }
  $checkedInHash = (Get-FileHash -LiteralPath $checkedInPath -Algorithm SHA256).Hash
  if ($checkedInHash -ne $artifact.sha256) {
    throw "Committed artifact hash differs from provenance manifest: $($artifact.path); expected $($artifact.sha256), got $checkedInHash"
  }
}

$buildScript = Join-Path $PSScriptRoot 'build.ps1'
& $buildScript `
  -RocketSimSource $RocketSimSource `
  -BuildDirectory $BuildDirectory `
  -NinjaExecutable $NinjaExecutable `
  -EmsdkRoot $EmsdkRoot
if ($LASTEXITCODE -ne 0) { throw "Fresh RocketSim WASM build failed with exit code $LASTEXITCODE" }

foreach ($artifact in $manifest.artifacts) {
  $name = Split-Path -Leaf ($artifact.path -replace '/', '\')
  $builtPath = Join-Path $BuildDirectory $name
  if (-not (Test-Path -LiteralPath $builtPath -PathType Leaf)) { throw "Fresh build did not produce $builtPath" }
  $builtHash = (Get-FileHash -LiteralPath $builtPath -Algorithm SHA256).Hash
  if ($builtHash -ne $artifact.sha256) {
    throw "WASM artifact is stale: $($artifact.path); expected $($artifact.sha256), got $builtHash. Rebuild with the pinned inputs and review the resulting artifacts before updating the manifest."
  }
  Write-Host "Freshness verified: $($artifact.path) SHA256 $builtHash"
}

Write-Host 'RocketSim WASM provenance and clean-build hashes match.'
