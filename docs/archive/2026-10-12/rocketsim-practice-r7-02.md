# R7-02 — Sonda reproducible de práctica RocketSim

Esta historia valida el camino completo del navegador sin tocar el solver
JavaScript ni integrar RocketSim en combate. La sonda arranca el servidor con
`MOVEMENT_BACKEND=rocketsim`, conecta un único piloto por WebSocket y envía
cuatro fases: primer salto, doble salto vertical, dodge dirigido y vuelo con
pitch/yaw/air roll/nitro.

## Uso

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r5-z7/rocketsim_bridge.exe)
npm run probe:rocketsim-practice
```

La evidencia se guarda en
`docs/reference-captures/rocketsim-practice-r7-02.json`. El proceso usa un
puerto temporal (5204 por defecto), termina el servidor al finalizar y no
modifica el estado persistente del juego.

## Puertas

- El snapshot anuncia `movementBackend=rocketsim` y solo contiene un piloto.
- La separación temporal publicada es `2/120 s = 0,0167 s` (redondeada a
  `0,02` en el snapshot), que demuestra los
  dos ticks nativos por snapshot de 60 Hz.
- Los seriales autoritativos observan salto, doble salto y dodge dirigido.
- La fase aérea produce velocidad angular observable y conserva el contrato de
  pose, velocidad y seriales del cliente.

La sonda mide la experiencia que recibe el cliente, pero no sustituye una
revisión visual humana de la cámara ni demuestra todavía equivalencia con
Rocket League. Si todas las puertas pasan, R7-02 queda **medida** y el
siguiente cambio debe ser una decisión de integración de contactos, no un
ajuste arbitrario de constantes.

## Resultado observado

La última ejecución del 12 de octubre de 2026 produjo 94 snapshots y confirmó los
siete criterios: backend RocketSim, un piloto, cadencia media `0,01667 s`, ACK
18/18, primer salto, doble salto vertical, dodge dirigido y movimiento angular
en vuelo. La captura reproducible está en
`docs/reference-captures/rocketsim-practice-r7-02.json`.

Además, una carga real en `http://localhost:5206/` mostró el HUD de
`PRÁCTICA ROCKETSIM`, `SALTOS 2/2`, estado `grounded`, ACK activo y el evento de
entrada del piloto. Esta comprobación fue de carga y estado DOM; no se presenta
como una evaluación visual completa de maniobras.

El resultado es **medido, no aceptación visual**. La siguiente unidad R7-03
debe abrir la aplicación en navegador, comprobar cámara y aterrizaje y guardar
una secuencia comparable antes de considerar RocketSim para combate.

El puente también publica `worldContact.normal` cuando RocketSim detecta un
contacto de carrocería con un plano. El cliente lo clasifica como `ground`,
`wall` o `ceiling`; el apoyo de ruedas sigue representado por `wheelCount` y
`grounded`, porque RocketSim no expone una normal individual por rueda en este
contrato.
