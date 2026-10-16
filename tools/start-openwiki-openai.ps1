param(
  [ValidateSet("init", "update")]
  [string]$Mode = "init",
  [ValidateSet("none", "low", "medium", "high", "xhigh", "max")]
  [string]$ReasoningEffort = "xhigh",
  [string]$ModelId = "gpt-6-luna"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY) -and
    [string]::IsNullOrWhiteSpace($env:OPENAI_COMPATIBLE_API_KEY)) {
  throw "Define OPENAI_API_KEY en esta sesión de PowerShell. No guardes la clave en el repositorio."
}

if (-not (Get-Command openwiki -ErrorAction SilentlyContinue)) {
  throw "No se encuentra el comando openwiki. Instala OpenWiki 0.7.2 o añade npm global al PATH."
}

# OpenWiki 0.7.2 valida el razonamiento de los modelos OpenAI conocidos de
# forma cerrada. El adaptador compatible permite usar gpt-6-luna y declarar
# explícitamente que el endpoint admite Responses API y reasoning_effort.
$env:OPENWIKI_CONFIG_DIR = Join-Path $env:TEMP "openwiki-car-soccer-openai-state"
$env:OPENWIKI_PROVIDER = "openai-compatible"
$env:OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1"
if ([string]::IsNullOrWhiteSpace($env:OPENAI_COMPATIBLE_API_KEY)) {
  $env:OPENAI_COMPATIBLE_API_KEY = $env:OPENAI_API_KEY
}
$env:OPENWIKI_MODEL_ID = $ModelId
$env:OPENWIKI_OPENAI_COMPATIBLE_USE_RESPONSES_API = "true"
$env:OPENWIKI_OPENAI_COMPATIBLE_REASONING_EFFORT_SUPPORTED = "true"
$env:OPENWIKI_REASONING_EFFORT = $ReasoningEffort
$env:OPENWIKI_PAGE_CONCURRENCY = "1"
# Las cuotas gratuitas pueden tener una ventana de enfriamiento larga. Un solo
# intento deja que la respuesta del proveedor determine cuándo reanudar y evita
# que reintentos inmediatos acumulen más presión en la misma ventana.
$env:OPENWIKI_PROVIDER_RETRY_ATTEMPTS = "1"
# xhigh reserva tokens de razonamiento además de la salida visible. Un límite
# de 8192 deja margen bajo la cuota observada de 60 000 TPM y sigue siendo
# suficiente para las páginas compactas definidas en INSTRUCTIONS.md.
$env:OPENWIKI_MAX_OUTPUT_TOKENS = "8192"

Write-Host "OpenWiki | OpenAI API | model=$ModelId | reasoning=$ReasoningEffort | mode=$Mode"
Write-Host "Run limits | outputTokens=$env:OPENWIKI_MAX_OUTPUT_TOKENS | pageConcurrency=$env:OPENWIKI_PAGE_CONCURRENCY | retries=$env:OPENWIKI_PROVIDER_RETRY_ATTEMPTS"
Write-Host "The key only comes from this PowerShell session and is not written to the project."
Write-Host "The wiki can only read sources allowed by .openwikiignore."

if ($Mode -eq "init") {
  & openwiki code --init --language es
} else {
  & openwiki code --update --language es
}

exit $LASTEXITCODE
