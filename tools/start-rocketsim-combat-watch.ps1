$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$bridge = Join-Path $projectRoot ".rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe"
if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) {
  throw "No se encuentra el bridge R19: $bridge. Compila ARENA-CEILING-01 antes de arrancar combate."
}

$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path -LiteralPath $bridge).Path
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "combat"
$env:ROCKETSIM_ARENA = "combat-alpha"
$env:ROCKETSIM_REQUEST_TIMEOUT_MS = "500"
$env:PORT = "5300"

Write-Host "Car Soccer: Arsenal · RocketSim R19 combat · http://localhost:$env:PORT"
Write-Host "R19 incluye las colisiones originales de las curvas pared-techo y sus esquinas."
Write-Host "El watcher reinicia el servidor al cambiar módulos Node; para client.js usa Ctrl+F5."
npm run start:watch
