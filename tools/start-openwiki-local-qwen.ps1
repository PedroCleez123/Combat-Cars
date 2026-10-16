param(
  [ValidateSet("init", "update")]
  [string]$Mode = "init",
  [int]$MaxOutputTokens = 2048
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Get-Command openwiki -ErrorAction SilentlyContinue)) {
  throw "No se encuentra el comando openwiki en PATH."
}

$modelsUri = "http://127.0.0.1:8080/v1/models"
try {
  $modelInfo = Invoke-RestMethod -Uri $modelsUri -Method Get
} catch {
  throw "No se puede contactar con llama.cpp en $modelsUri. Ejecuta primero tools\start-qwen-openwiki.cmd."
}

$modelId = $modelInfo.data[0].id
if ([string]::IsNullOrWhiteSpace($modelId)) {
  throw "llama.cpp no ha devuelto ningún identificador de modelo en /v1/models."
}

# Fuerza el adaptador local y evita heredar claves o ajustes de OpenAI de otra sesión.
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
$env:OPENWIKI_PROVIDER = "openai-compatible"
$env:OPENAI_COMPATIBLE_BASE_URL = "http://127.0.0.1:8080/v1"
$env:OPENAI_COMPATIBLE_API_KEY = "local"
$env:OPENWIKI_MODEL_ID = $modelId
$env:OPENWIKI_OPENAI_COMPATIBLE_USE_RESPONSES_API = "false"
Remove-Item Env:OPENWIKI_REASONING_EFFORT -ErrorAction SilentlyContinue
Remove-Item Env:OPENWIKI_OPENAI_COMPATIBLE_REASONING_EFFORT_SUPPORTED -ErrorAction SilentlyContinue
$env:OPENWIKI_PAGE_CONCURRENCY = "1"
$env:OPENWIKI_PROVIDER_RETRY_ATTEMPTS = "1"
$env:OPENWIKI_MAX_OUTPUT_TOKENS = [string]$MaxOutputTokens
$env:OPENWIKI_CONFIG_DIR = Join-Path $env:TEMP "openwiki-car-soccer-local-qwen-state"

Write-Host "OpenWiki | llama.cpp local | model=$modelId | mode=$Mode"
Write-Host "Endpoint: $env:OPENAI_COMPATIBLE_BASE_URL"
Write-Host "Output tokens: $env:OPENWIKI_MAX_OUTPUT_TOKENS | concurrency: 1"
Write-Host "No se usa ninguna clave de OpenAI."

if ($Mode -eq "init") {
  & openwiki code --init --language es
} else {
  & openwiki code --update --language es
}

exit $LASTEXITCODE
