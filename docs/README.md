# Documentación del proyecto

Lee estos archivos en este orden:

1. [`../README.md`](../README.md) — arranque y arquitectura.
2. [`../PROTOCOL.md`](../PROTOCOL.md) — contrato de red y snapshots.
3. [`../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md`](../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md)
   — orden canónico de historias, puertas de decisión y trabajo aplazado.
4. [`physics-mobility-tracker.md`](physics-mobility-tracker.md) — estado actual
   de física, evidencias y puertas aceptadas.
5. [`rocketsim-architecture.md`](rocketsim-architecture.md) — autoridad y
   límites de la integración RocketSim.
6. [`continuation-handoff.md`](continuation-handoff.md) — relevo operativo para
   la siguiente sesión.
7. [`web-online-compatibility.md`](web-online-compatibility.md) — compatibilidad
   web/LAN y futura ruta online.
8. [`local-server-browser-bridge.md`](local-server-browser-bridge.md) — frontera
   sandbox/host, comprobación del servidor y solución del timeout del navegador.
9. [`openwiki-codex-mcp.md`](openwiki-codex-mcp.md) — flujo recomendado para
    que Codex coordine OpenWiki por páginas sin una petición monolítica.
10. [`../openwiki/quickstart.md`](../openwiki/quickstart.md) — wiki generada
    por páginas y fuentes de arquitectura, movilidad, red y pruebas.

El plan operativo vigente es
[`../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md`](../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md).
La planificación anterior está archivada en
[`../_bmad-output/archive/2026-10-15/implementation-artifacts/roadmap-next-phase-2026-10-13.md`](../_bmad-output/archive/2026-10-15/implementation-artifacts/roadmap-next-phase-2026-10-13.md)
y no decide trabajo nuevo.
Las únicas fichas BMad activas son
[`arena-ceiling-01-story.md`](../_bmad-output/implementation-artifacts/arena-ceiling-01-story.md),
[`hitbox-01-visual-pivot-story.md`](../_bmad-output/implementation-artifacts/hitbox-01-visual-pivot-story.md)
y
[`mob-air-02-isolated-observation-story.md`](../_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md);
el resto está en el archivo BMad.
El orden activo es P0 cierre de `HITBOX-01` → P1 `ARENA-CEILING-01` → P2
`MOB-AIR-02-OBS-ISOLATED` → P3 `LIVENESS-01-INTEGRATION` → P4 `MOB-AIR-03`
→ P5 `CAMERA-AIR-WALL-01` → P6 `ARENA-VIS-01` → P7 regresión de combate →
P8 `ONLINE-02`. Las hojas antiguas conservan evidencia histórica y no reabren
historias cerradas.

## Referencias activas de diseño

- [`car-soccer-rea-physics-contract.md`](car-soccer-rea-physics-contract.md)
- [`reference-translation-ledger.md`](reference-translation-ledger.md)

Los planes cerrados, calibraciones y el relevo largo están en
[`archive/2026-10-14/`](archive/2026-10-14/) y no deciden el trabajo actual.

## Evidencia reproducible

Las capturas JSON viven en [`reference-captures/`](reference-captures/). Las
últimas puertas son `rocketsim-cornered-practice-arena-02.json`,
`rocketsim-configurable-combat-game-01.json` y
`rocketsim-six-pilot-lan-r9-01.json`.
COMBAT-GEO-01 añade `rocketsim-static-raycast-combat-geo-01.json` como
evidencia de consulta nativa contra geometría estática.
No son documentación narrativa: se regeneran con las sondas de `package.json`.

## Archivo

Los documentos cerrados se guardan en
[`archive/2026-10-12/`](archive/2026-10-12/) y
[`archive/2026-10-14/`](archive/2026-10-14/), con la limpieza más reciente en
[`archive/2026-10-15/`](archive/2026-10-15/) y
[`archive/2026-10-16/`](archive/2026-10-16/). Las referencias activas que aún
necesitan contexto histórico enlazan directamente allí. No se elimina historia.
Para restaurar uno, muévelo de vuelta a `docs/` y actualiza este índice solo si
vuelve a ser una fuente activa. El inventario actual está en
[`document-inventory.md`](document-inventory.md).

La última limpieza está registrada en
[`archive/2026-10-16/cleanup-log.md`](archive/2026-10-16/cleanup-log.md).




