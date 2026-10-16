# COMBAT-GEO-02 — oclusión estática de cohetes

Estado: **Aceptada** · 13 de octubre de 2026

## Problema observable

El bridge ya puede detectar geometría estática, pero `stepRocketSimCombat` solo
comprueba la posición final del cohete contra vehículos y límites. Un bloque o
pared puede quedar detrás de un coche y el cohete no tiene todavía un impacto
nativo que lo detenga.

## Alcance

- Consultar desde `RocketSimPracticeMatch` el segmento que recorre cada cohete
  existente durante un subpaso de 120 Hz.
- Comparar el primer impacto estático con la primera intersección de vehículo.
- Consumir el cohete con un evento de oclusión si la geometría llega antes.
- Rechazar un bridge de combate que no exponga `raycast`.
- Cubrir orden estático/vehículo y conservar los casos de impacto directo,
  cooldown, eliminación y respawn.

## Fuera de alcance

No cambiar velocidad, vida, radio, impulso, solver RocketSim, cámara, arena,
render, bots ni red WebSocket.

## Criterios de aceptación

1. Un rayo estático anterior al vehículo consume el cohete sin dañar.
2. Un vehículo anterior al obstáculo recibe el daño habitual.
3. El caso de impacto directo existente sigue pasando.
4. La consulta se expresa en RocketSim y-up y solo el bridge convierte unidades.
5. `npm test` queda verde y el smoke de combate R11 conserva cooldown,
   eliminación, respawn y autoridad Node.

## Evidencia de cierre

- `npm test`: **135/135**.
- `npm run probe:rocketsim-combat-websocket` con R11: primer impacto, cooldown,
  segunda ráfaga, eliminación, desactivación y respawn; sin errores.
- `npm run probe:rocketsim-combat-six` con R11: seis pilotos, seis disparos,
  seis cohetes publicados, roster tras desconexión, movimiento y cadencia
  nativa; todas las aserciones verdes.
- Pruebas unitarias nuevas cubren estático antes de vehículo y vehículo antes
  de estático. La autoridad de daño y respawn sigue en Node; RocketSim conserva
  la pose y la autoridad de movimiento.
