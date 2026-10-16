param(
  [ValidateSet("init", "update")]
  [string]$Mode = "init"
  ,
  [ValidateSet("economy", "standard")]
  [string]$Profile = "economy"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
  throw "Define GEMINI_API_KEY en esta sesión de PowerShell antes de ejecutar OpenWiki. No guardes la clave en archivos del proyecto."
}

if (-not (Get-Command openwiki -ErrorAction SilentlyContinue)) {
  throw "No se encuentra el comando openwiki. Instala OpenWiki 0.7.2 o añade npm global al PATH."
}

# Mantiene la clave, credenciales y metadatos de proveedor fuera del repositorio.
$env:OPENWIKI_CONFIG_DIR = Join-Path $env:TEMP "openwiki-car-soccer-gemini-state"
$env:OPENWIKI_PROVIDER = "gemini"

# Perfil conservador para la cuota gratuita. Se pueden sobrescribir estas
# variables en la sesión; los valores del perfil solo fijan un punto de partida
# reproducible y no guardan credenciales en el repositorio.
$env:OPENWIKI_PAGE_CONCURRENCY = "1"
$env:OPENWIKI_PROVIDER_RETRY_ATTEMPTS = "1"
$env:OPENWIKI_MAX_OUTPUT_TOKENS = "8192"
if ($Profile -eq "economy") {
  $env:OPENWIKI_MODEL_ID = "gemini-3.5-flash-lite"
  Remove-Item Env:OPENWIKI_REASONING_EFFORT -ErrorAction SilentlyContinue
} else {
  $env:OPENWIKI_MODEL_ID = "gemini-3.6-flash"
  $env:OPENWIKI_REASONING_EFFORT = "low"
}

Write-Host "OpenWiki · Gemini AI Studio · $Mode · perfil=$Profile · $projectRoot"
Write-Host "La wiki solo puede leer las fuentes permitidas por .openwikiignore."

if ($Mode -eq "init") {
  & openwiki code --init --language es
} else {
  & openwiki code --update --language es
}

exit $LASTEXITCODE
