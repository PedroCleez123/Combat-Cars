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
- `LIVE-SESSION-PROBE`: la sonda versionada `npm run probe:live-session` se
  ejecutó el 17/10/2026 contra 5298 y 5300. Ambos devolvieron `welcome`, un
  snapshot autoritativo, R19, el backend RocketSim y el perfil de arena
  esperado. Esta comprobación valida conectividad/configuración, pero no
  sustituye la inspección visual ni una campaña de liveness prolongada.
- `LIVE-LIVENESS-PROBE`: `npm run probe:live-liveness` observó 1,8 s en ambos
  hosts el 17/10/2026. 5298 entregó 52 snapshots y 5300 entregó 40; en ambos
  el reloj autoritativo avanzó, no retrocedió y las poses finales fueron finitas.
- `HITBOX-01`: la raíz visual RocketSim gira alrededor del pivote físico y el
  prototipo usa una envolvente vertical derivada de la hitbox Octane. La sonda
  R19 confirma `upY=-1` y contacto de carrocería invertida (normal de suelo,
  `wheelCount=0`) en un solo piloto; la suite queda en 177/177. Falta solo la
  inspección visual de píxeles en una sesión web limpia.
- `ARENA-CEILING-01`: bridge R19 aceptado. La sonda de 720 ticks recorre suelo,
  pared, esquinas y techo con apoyo continuo y salto máximo de normal de
  3,124 grados. Three.js comparte la geometría. Falta una observación visual
  arrancando un host con R19. El lanzador `npm run start:watch:combat` fija R19
  para evitar que la malla nueva se use contra la física anterior.
- La presentación de límites usa ahora paredes/curvas translúcidas y un techo
  emisivo con retícula. Es una capa Three.js; si una transición se ve pero no
  colisiona, hay que comprobar que `ROCKETSIM_BRIDGE_EXE` apunte a R19.
- Suite después de la última edición de código: `npm test` 177/177.
- `LAN-HARDEN-01`: aceptada en el host el 17/10/2026. `probe:lan-http` entrega
  los assets públicos con `nosniff` y devuelve 404 para internals y traversal.
- `LAN-HARDEN-02`: aceptada en el host el 17/10/2026. La sonda valida
  propietario de sesión, rechazo de `restart` del invitado, transferencia de
  owner, reconexión dentro de cuatro segundos y expiración posterior, además
  del timeout de `hello` y la cola de salida acotada.
- Suite después de extraer y probar la cola: `npm test` 172/172.

## Historia activa

`LAN-HARDEN-02` queda aceptada tras la prueba viva del 17/10/2026. La auditoría
prioriza ahora la observación de `HITBOX-01`; `COMBAT-BOUNDS-01` ya está
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

`LAN-HARDEN-01` (aceptada) → `COMBAT-BOUNDS-01` → `LAN-HARDEN-02` (aceptada) → `HITBOX-01` visual → observación web de `ARENA-CEILING-01` con R19 →
`MOB-AIR-02-OBS-ISOLATED` → `LIVENESS-01-INTEGRATION` → `MOB-AIR-03` para
comparar curvas web y nativas → cámara aérea/pared si procede → arena visual →
regresión de combate → online.

## Entorno

El host del usuario ejecuta el servidor en `http://localhost:5300` con
`ROCKETSIM_BRIDGE_EXE`, `MOVEMENT_BACKEND=rocketsim`,
`ROCKETSIM_MODE=combat`, `ROCKETSIM_ARENA=combat-alpha` y timeout de 500 ms.
No reiniciar esa instancia durante una observación compartida.
