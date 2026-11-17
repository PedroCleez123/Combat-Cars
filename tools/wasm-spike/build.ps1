param(
  # Derive the default from the current Windows profile rather than embedding a
  # non-ASCII username in a PowerShell file that Windows PowerShell may read as ANSI.
  [string]$RocketSimSource = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex\2026-10-10\s\rocketsim-r1'),
  [string]$BuildDirectory = (Join-Path $PSScriptRoot 'build'),
  [string]$NinjaExecutable = (Join-Path $PSScriptRoot 'ninja\ninja.exe')
)
$ErrorActionPreference = 'Stop'
$sdk = Join-Path $PSScriptRoot 'emsdk'
$emcmakeCandidates = @(
  (Join-Path $sdk 'upstream\emscripten\emcmake.bat'),
  (Join-Path $sdk 'upstream\emscripten\emcmake.exe')
)
$emcmake = $emcmakeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $emcmake) {
  throw "Emscripten compiler wrapper not found under $sdk; run .\bootstrap-emsdk.ps1"
}
if (-not (Test-Path (Join-Path $RocketSimSource 'CMakeLists.txt'))) { throw "RocketSim source not found: $RocketSimSource" }
if (-not (Test-Path $NinjaExecutable)) {
  throw "Ninja was not found at $NinjaExecutable; run .\bootstrap-ninja.ps1"
}

& $emcmake cmake -G Ninja -S $PSScriptRoot -B $BuildDirectory "-DROCKETSIM_SOURCE=$RocketSimSource" "-DCMAKE_MAKE_PROGRAM=$NinjaExecutable" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed' }
cmake --build $BuildDirectory --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'WASM build failed' }
Write-Host "Build output: $BuildDirectory"
