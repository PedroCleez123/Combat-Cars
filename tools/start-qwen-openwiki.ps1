param(
  [ValidateSet(10240, 12288, 16384, 20480, 40000)]
  [int]$ContextSize = 40000
)

$ErrorActionPreference = "Stop"
# USERPROFILE evita que Windows PowerShell 5.1 corrompa la "é" del nombre
# de usuario al leer este archivo como texto heredado.
$aiRoot = Join-Path $env:USERPROFILE "Documents\Codex\local-ai\Qwen35-9B-Uncensored"
$server = Join-Path $aiRoot "llama.cpp-cuda13\llama-server.exe"
$model = Join-Path $aiRoot "Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf"

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
  throw "No se encuentra llama-server.exe en: $server"
}
if (-not (Test-Path -LiteralPath $model -PathType Leaf)) {
  throw "No se encuentra el modelo GGUF en: $model"
}

Set-Location -LiteralPath $aiRoot
Write-Host "Iniciando Qwen para OpenWiki"
Write-Host "Modelo: $model"
Write-Host "Contexto: $ContextSize | slots: 1 | puerto: 8080"

& $server `
  -m $model `
  -ngl 99 `
  -c $ContextSize `
  -np 1 `
  -b 128 `
  -ub 128 `
  --jinja `
  --reasoning off `
  --host 127.0.0.1 `
  --port 8080 `
  --alias "Qwen3.5-9B-Uncensored"

exit $LASTEXITCODE
