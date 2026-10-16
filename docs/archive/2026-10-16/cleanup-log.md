# Limpieza documental — 16 de octubre de 2026

## Alcance

Se revisó `docs/`, su inventario y las referencias del repositorio después de
completar la generación paginada de OpenWiki.

## Movimiento realizado

- `docs/openwiki-local-qwen.md` →
  `docs/archive/2026-10-16/openwiki-local-qwen.md`.
- `.github/workflows/openwiki-update.yml` →
  `docs/archive/2026-10-16/openwiki-update-workflow.yml`.
- Cinco directorios de compilación RocketSim heredados desde la raíz →
  `archive/rocketsim-builds/2026-10-16/`.

La guía describe la ruta local Qwen/llama.cpp que se probó como alternativa,
pero el flujo activo ahora es OpenWiki mediante MCP de Codex. Se conserva el
archivo completo para poder restaurarlo si cambia la disponibilidad del MCP.
El workflow heredado requería credenciales y un proveedor que ya no forman
parte del flujo MCP, por lo que no debe poder ejecutarse. Las builds archivadas
son R5, R5-Z7, R8, R11 y una build sin revisión; R19 permanece activa en la
raíz.

## Conservación

- No se borraron documentos.
- No se movieron las referencias activas de física, RocketSim, red, servidor,
  compatibilidad web ni traducción de referencias.
- Los documentos históricos anteriores permanecen en sus archivos fechados.
- `docs/README.md` y `docs/document-inventory.md` apuntan a la wiki activa y al
  archivo Qwen.
- Las guías de arranque y de bridge seleccionan R19 de forma consistente.

## Verificación

- `openwiki/index.md` enumera las nueve páginas generadas.
- No quedan referencias a `docs/openwiki-local-qwen.md`.
- El archivo archivado existe en `docs/archive/2026-10-16/`.
- La raíz conserva solo `.rocketsim-bridge-build-r9/` y
  `rocketsim_bridge-r19.exe` como ruta activa.
- No quedan referencias activas a R5, R8, R10–R18, al workflow retirado ni a la
  guía Qwen en su ubicación previa.
- La limpieza no modificó código del juego.
