param(
  [string]$EmsdkRoot = (Join-Path $PSScriptRoot 'emsdk'),
  [string]$Version = '6.0.13'
)
$ErrorActionPreference = 'Stop'

if (Test-Path (Join-Path $EmsdkRoot 'emsdk.bat')) {
  Write-Host "Using existing SDK source at $EmsdkRoot"
} else {
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git $EmsdkRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not clone the Emscripten SDK repository into $EmsdkRoot" }
}

Push-Location $EmsdkRoot
try {
  .\emsdk.bat install $Version --embedded
  if ($LASTEXITCODE -ne 0) { throw 'Emscripten SDK installation failed' }
  .\emsdk.bat activate $Version --embedded
  if ($LASTEXITCODE -ne 0) { throw 'Emscripten SDK activation failed' }
} finally {
  Pop-Location
}

Write-Host "Emscripten $Version is local to this spike. Open a new shell and run build.ps1; no user PATH was changed."
