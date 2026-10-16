# R8-02 — Combate sobre poses RocketSim

**Estado:** R8-02a/b/c/d aceptadas el 12 de octubre de 2026.

## Objetivo

Conservar RocketSim como autoridad única de pose, velocidad, orientación y
colisiones de vehículos mientras Node mantiene rockets, daño, puntuación y
respawn.

## Criterios de aceptación

1. El bridge nativo acepta `respawn` y `combat-state` sin recibir una pose o
   velocidad calculada por Node.
2. Dos clientes WebSocket reciben plazas azul/roja, snapshots con poses
   RocketSim y ACK de sus inputs.
3. El disparo se procesa una vez por flanco y no se reenvía como input físico
   al bridge; el cooldown se comprueba en una sesión real.
4. La suite Node y las sondas nativas siguen verdes.

## Evidencia

- `npm run probe:rocketsim-combat-state`
- `npm run probe:rocketsim-combat-websocket` con
  `ROCKETSIM_BRIDGE_EXE=.rocketsim-bridge-build-r9/rocketsim_bridge.exe`
- `docs/reference-captures/rocketsim-combat-bridge-r8-02.json`
- `docs/reference-captures/rocketsim-combat-websocket-r8-02.json`
- `npm test`: 118/118

La sonda WebSocket usa el perfil interno `combat-lineup`, que solo alinea
spawns nativos para que un cohete pueda impactar; no es una arena jugable.
Verifica dos impactos, cooldown, eliminación, desactivación nativa y respawn.

## Pendiente explícito

La validación visual de la experiencia de combate y la integración del perfil
de arena jugable quedan fuera de esta puerta. No se sustituirá por inyectar
una pose desde Node.
