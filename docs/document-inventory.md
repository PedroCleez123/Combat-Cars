# Inventario documental del proyecto — índice vigente 16 de octubre de 2026

Este inventario separa las pocas fuentes activas del historial archivado. No se
elimina historia ni se usa un documento archivado para decidir trabajo nuevo.

## Empezar aquí

La entrada única es [`README.md`](README.md). Para continuar una sesión de
desarrollo, lee después:

- `../README.md` y `../PROTOCOL.md`: arranque, arquitectura y contrato de red.
- `physics-mobility-tracker.md`: estado actual, evidencias y puertas.
- `rocketsim-architecture.md`: autoridad y límites de RocketSim.
- `continuation-handoff.md`: relevo operativo y último estado comprobado.
- `web-online-compatibility.md`: límites que conservan el futuro modo online.
- `provenance-baseline-2026-10-17.json`: hashes del runtime, los bridges y el
  portable generado para reproducir y diagnosticar una ejecución local.

La fuente única que ordena el trabajo es
`../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md`.
También siguen como referencias activas `car-soccer-rea-physics-contract.md`,
`car-soccer-rea-integration.md` y `reference-translation-ledger.md`.
La ficha de procedencia activa es
`../_bmad-output/implementation-artifacts/baseline-01-provenance-story.md`.

## Evidencia reproducible

`docs/reference-captures/` contiene JSON versionados de simulación, contactos,
curvas y pruebas del bridge. Son oráculos o comparadores, no documentación
narrativa. No se archivan mientras las pruebas o documentos activos los usen.

Las últimas puertas registradas son:

- `reference-captures/rocketsim-wall-actions-r7-05c.json`
- `reference-captures/rocketsim-multicar-r8-01.json`

## Archivo histórico

`archive/2026-10-12/` contiene documentos cerrados de las primeras calibraciones.
`archive/2026-10-14/` contiene los documentos sustituidos en la limpieza actual,
incluidos:

- `current-development-roadmap.md`, `continuation-handoff.md` y
  `physics-mobility-tracker.md` en sus versiones largas;
- `mobility-fidelity-roadmap.md`, `mobility-rebuild-plan.md`,
  `rocketsim-migration-roadmap.md` y `fis-14c-playtest.md`.

El archivo anterior también conserva:

- calibraciones y contratos ya absorbidos: `cal-03-validation-log.md`,
  `cal-04-mobility-envelope.md`, `m1-ground-yaw-calibration.md`,
  `m2-air-control-calibration.md`, `m3-air-actions-calibration.md` y
  `m4-contact-landing-plan.md`;
- planes o análisis sustituidos: `camera-stability-plan.md`,
  `second-jump-rebuild-plan.md`, `reference-curve-recovery-plan.md` y
  `car-soccer-comparison-2026-10-10.md`;
- informes de hitos previos de RocketSim: `rocketsim-oracle-r1.md`,
  `rocketsim-practice-r7-02.md`, `rocketsim-bridge-r6-01.md`,
  `rocketsim-bridge-r6-02.md` y `rocketsim-integration-2026-10-11.md`;
- registros cerrados: `automated-cal-03.md` y `fis-19-jump-timing-contract.md`.

Las fuentes activas que requieren contexto histórico enlazan directamente al
archivo. Para recuperar un documento, consulta
`archive/2026-10-15/README.md`, muévelo a `docs/` y actualiza sus enlaces e
índice.

La limpieza del 15 de octubre añadió
`archive/2026-10-15/closed-documents/` para informes cerrados que ya no son
fuentes de decisión y `archive/2026-10-15/runtime-diagnostics/` para logs y
scripts temporales de diagnóstico. Se conservan como trazabilidad, pero no se
leen durante el desarrollo normal.

La limpieza del 16 de octubre movió la guía local de Qwen a
`archive/2026-10-16/` porque el flujo MCP de Codex es ahora la ruta activa.
También archivó el workflow de GitHub con credenciales heredadas en
`archive/2026-10-16/openwiki-update-workflow.yml` y las cinco builds RocketSim
históricas en `../../archive/rocketsim-builds/2026-10-16/`. La build R19 queda
en `.rocketsim-bridge-build-r9/` como única build activa.

## OpenWiki

La integración activa es el MCP `openwiki` en modo `--host codex`. La wiki se
genera y reanuda por páginas mediante `openwiki_begin`, `openwiki_next_page` y
`openwiki_submit_page`; no se usa una generación monolítica ni se edita código
del juego durante ese ciclo. `openwiki/INSTRUCTIONS.md` contiene la taxonomía y
las reglas de autoridad. Las páginas generadas actualmente están en
`openwiki/quickstart.md`, `openwiki/architecture/`, `openwiki/simulation/`,
`openwiki/arena/`, `openwiki/combat/`, `openwiki/network/`, `openwiki/client/`,
`openwiki/operations/` y `openwiki/testing/`.

La ruta local Qwen/llama.cpp queda archivada en
`archive/2026-10-16/openwiki-local-qwen.md` como contingencia histórica. No es
la configuración activa y no debe confundirse con el flujo MCP.

El estado de planificación incompleto creado antes del cambio de proveedor se
conserva en `docs/archive/2026-10-16/openwiki-interrupted-pre-openai-run.json`.
No contenía páginas generadas. El siguiente `init` creará un estado nuevo con
las instrucciones y el proveedor activos.

La cuota efectiva observada de la API puede imponer una ventana de enfriamiento
muy superior a un minuto, incluso cuando el error se etiquete como TPM. El
tiempo de reintento devuelto por OpenAI es la referencia operativa; no se debe
relanzar OpenWiki antes de ese momento.

## BMad

`_bmad-output/implementation-artifacts/` contiene las fichas activas:
`roadmap-current-2026-10-14.md`, `baseline-01-provenance-story.md`,
`arena-ceiling-01-story.md`,
`hitbox-01-visual-pivot-story.md` y `mob-air-02-isolated-observation-story.md`.
Las 67 fichas cerradas o sustituidas están en
`_bmad-output/archive/2026-10-15/implementation-artifacts/`; no son código
ejecutable y no deben reabrirse sin una nueva decisión en el roadmap.

## Comprobación reproducible

Desde la raíz del proyecto:

```powershell
rg -n "docs/|_bmad-output/|reference-captures/" README.md PROTOCOL.md docs _bmad-output
Get-ChildItem docs -File
Get-ChildItem docs/archive/2026-10-12 -File
Get-ChildItem docs/archive/2026-10-14 -File
```

El baseline Git se etiqueta como `baseline-2026-10-17`. Para comprobar que los
artefactos locales siguen siendo los que se usaron en esa captura:

```powershell
npm run verify:provenance
```

El portable de Windows es opcional en la verificación porque `dist/` está
ignorado; los bridges R19 y R13 sí deben coincidir cuando se ejecuta RocketSim.
