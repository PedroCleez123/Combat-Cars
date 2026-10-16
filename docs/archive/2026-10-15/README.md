# Archivo de limpieza — 15 de octubre de 2026

Esta carpeta contiene material que ya no participa en la decisión diaria del
proyecto. Se archivó de forma reversible para reducir la confusión sin perder
trazabilidad.

- `closed-documents/`: informes y planes cerrados que no son fuentes activas.
- `runtime-diagnostics/`: logs y scripts temporales usados para diagnosticar
  servidores o WebSocket locales.
- `openwiki-update.yml`: primer workflow opcional de actualización con API;
  queda sustituido por el flujo MCP y se conserva como antecedente.
- `openwiki-chatgpt-interrupted-*`: estado de la primera inicialización
  incompleta con ChatGPT; se sustituye por Gemini AI Studio sin mezclar
  credenciales ni proveedores.

Los JSON de `docs/reference-captures/` y la build RocketSim R19 se mantienen en
sus ubicaciones porque las sondas y el arranque activo los necesitan. Las builds
históricas se archivaron en `../../archive/rocketsim-builds/2026-10-16/`; R19
es el único ejecutable que debe seleccionarse para el desarrollo normal. Para
restaurar un archivo, muévelo de vuelta a su ubicación original y actualiza
`docs/README.md` y `docs/document-inventory.md`.
