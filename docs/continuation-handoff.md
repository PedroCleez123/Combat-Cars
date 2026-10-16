# Relevo de continuidad — 16 de octubre de 2026

Este es el relevo corto y operativo. El historial completo se conserva en
[`archive/2026-10-14/continuation-handoff.md`](archive/2026-10-14/continuation-handoff.md).
La fuente de orden es el [plan canónico](../_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md).

## Estado aceptado

- `BASELINE-01`: baseline Git etiquetado como `baseline-2026-10-17`; el
  manifiesto `docs/provenance-baseline-2026-10-17.json` verifica R19, R13 y el
  portable 0.1.1.
- `COMBAT-PLAY-01`: pruebas WebSocket 1v1 y 6v6 aceptadas en `combat-alpha`.
- `BRIDGE-01`: arranque normal con bridge R13 aceptado; timeout configurable.
- `LIVENESS-01`: watchdog de snapshots implementado y cubierto por pruebas
  unitarias; la observación de integración en host sigue pendiente.
- `HITBOX-01`: la raíz visual RocketSim gira alrededor del pivote físico y el
  prototipo usa una envolvente vertical derivada de la hitbox Octane; la suite
  queda en 160/160. Falta observar una postura invertida con contacto de suelo
  antes de cerrar la historia.
- `ARENA-CEILING-01`: bridge R19 aceptado. La sonda de 720 ticks recorre suelo,
  pared, esquinas y techo con apoyo continuo y salto máximo de normal de
  3,124 grados. Three.js comparte la geometría. Falta una observación visual
  arrancando un host con R19. El lanzador `npm run start:watch:combat` fija R19
  para evitar que la malla nueva se use contra la física anterior.
- La presentación de límites usa ahora paredes/curvas translúcidas y un techo
  emisivo con retícula. Es una capa Three.js; si una transición se ve pero no
  colisiona, hay que comprobar que `ROCKETSIM_BRIDGE_EXE` apunte a R19.
- Suite después de la última edición de código: `npm test` 163/163.
- `LAN-HARDEN-01`: frontera HTTP allowlist implementada. La prueba viva contra
  el host PowerShell sigue pendiente por el aislamiento de red del sandbox.
- `LAN-HARDEN-02`: propietario de sesión, timeout de `hello`, cola de salida
  acotada (extraída a `src/lan-outbound-queue.js`) y origen LAN del mismo
  `Host` implementados; handshake de dos peers y reconexión siguen pendientes
  en el host. `tools/lan-session-probe.mjs` ya comprueba owner, rechazo de
  `restart` del invitado, reasignación y reconexión cuando se ejecuta en el
  PowerShell del host.
- Suite después de extraer y probar la cola: `npm test` 172/172.

## Historia activa

`LAN-HARDEN-02` es la unidad operativa actual. Después de cerrar su prueba viva,
la auditoría prioriza la observación de `HITBOX-01`; `COMBAT-BOUNDS-01` ya está
implementada y cubierta por regresión para que los límites de cohete compartan
la arena nativa; luego la observación de cierre de `HITBOX-01`. Después,
`MOB-AIR-02-OBS-ISOLATED` está preparada, pero todavía no iniciada en una
sesión limpia. Front tiene evidencia aceptada; side y diagonal quedaron **no
verificadas** en intentos anteriores por roster compartido o snapshots
congelados. La ficha completa está en
[`mob-air-02-isolated-observation-story.md`](../_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md).

## Reglas de trabajo

1. Usar un solo piloto autoritativo por variante y cerrar cada campaña antes de
   abrir la siguiente.
2. No modificar constantes, adaptador ni cámara sin una traza reproducible.
3. Separar los fallos de host/bridge, protocolo, física y presentación.
4. Clasificar cada resultado como aceptado, fallido, revertido, aplazado o no
   verificado. Un estado congelado no prueba un defecto de física.
5. Ejecutar `npm test` después de cualquier cambio de código; para cambios solo
   documentales, comprobar enlaces y `git diff --check`.

## Secuencia siguiente

`LAN-HARDEN-01` → `COMBAT-BOUNDS-01` → `LAN-HARDEN-02` → `HITBOX-01` invertida → observación web de `ARENA-CEILING-01` con R19 →
`MOB-AIR-02-OBS-ISOLATED` → `LIVENESS-01-INTEGRATION` → `MOB-AIR-03` para
comparar curvas web y nativas → cámara aérea/pared si procede → arena visual →
regresión de combate → online.

## Entorno

El host del usuario ejecuta el servidor en `http://localhost:5300` con
`ROCKETSIM_BRIDGE_EXE`, `MOVEMENT_BACKEND=rocketsim`,
`ROCKETSIM_MODE=combat`, `ROCKETSIM_ARENA=combat-alpha` y timeout de 500 ms.
No reiniciar esa instancia durante una observación compartida.
