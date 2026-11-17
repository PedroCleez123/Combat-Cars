param(
  [switch]$Watch,
  [ValidateSet("rocketsim", "rocketsim-wasm")]
  [string]$Backend = "rocketsim"
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$bridge = Join-Path $projectRoot ".rocketsim-bridge-build-r20\rocketsim_bridge-r20.exe"
$env:MOVEMENT_BACKEND = $Backend
$env:ROCKETSIM_MODE = "combat"
$env:ROCKETSIM_ARENA = "combat-alpha"
$env:ROCKETSIM_REQUEST_TIMEOUT_MS = "500"
$env:PORT = "5300"

if ($Backend -eq "rocketsim") {
  if (-not (Test-Path -LiteralPath $bridge -PathType Leaf)) {
    throw "No se encuentra el bridge R20: $bridge"
  }
  $env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path -LiteralPath $bridge).Path
  Write-Host "Backend: RocketSim R20 nativo"
} else {
  Remove-Item Env:ROCKETSIM_BRIDGE_EXE -ErrorAction SilentlyContinue
  Write-Host "Backend: RocketSim R20 WASM (vertical slice de migración)"
}

$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, [int]$env:PORT)
try {
  $portProbe.Start()
} catch {
  throw "El puerto $env:PORT ya está en uso. Cierra la otra instancia de Combat Cars antes de iniciar una nueva."
} finally {
  $portProbe.Stop()
}

Write-Host "Iniciando Combat Cars · combate RocketSim"
Write-Host "No des por iniciado el servidor hasta ver la línea backend correspondiente en http://localhost:5300"
Write-Host "Mantén esta ventana abierta mientras juegas. Cierra con Ctrl+C."
if ($Watch) {
  Write-Warning "Modo desarrollo: cualquier cambio de archivo reinicia RocketSim y reinicia la ronda. No lo uses para jugar."
  node --watch server.mjs
} else {
  node server.mjs
}
