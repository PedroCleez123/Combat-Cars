@echo off
setlocal
rem PowerShell resuelve correctamente rutas con caracteres Unicode del usuario.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-qwen-openwiki.ps1"
exit /b %ERRORLEVEL%
