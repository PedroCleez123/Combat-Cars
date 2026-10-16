# BRIDGE-01 — ciclo de vida del sidecar tras reinicio

**Estado:** Implementada; aceptación del reinicio persistente pendiente · 14 de octubre de 2026

## Problema observable

Un reinicio de `node --watch` dejó el runtime en `RocketSim bridge request timed
out after 100ms` durante el primer tick, aunque el sidecar había arrancado.

## Cambio mínimo

- El timeout de peticiones de desarrollo pasa de 100 a 250 ms.
- `ROCKETSIM_REQUEST_TIMEOUT_MS` permite usar 500 ms durante un arranque lento.
- Un valor inválido se rechaza al crear la sesión, antes de aceptar clientes.
- El error conserva stderr reciente del sidecar.
- No se reintenta un tick: repetirlo podría duplicar un paso autoritativo.

## Invariantes

RocketSim sigue siendo dueño de todos los ticks y poses; el timeout sigue
deteniendo el runtime si el bridge no responde. No cambian física, cámara,
protocolo de snapshots, arena ni reglas de combate.

## Evidencia

- `npm test`: 143 pruebas verdes después de la corrección y de la campaña
  MOB-AIR-01; conserva el contrato del timeout.
- `npm run probe:rocketsim-bridge` con R13: smoke verde y hash reproducible.
- Falta confirmar en el PowerShell anfitrión un reinicio de `start:watch` sin
  `runtime stopped`; el sandbox no comparte el listener ni el proceso del host.

## Salida

Cuando el usuario confirme ese reinicio, BRIDGE-01 queda aceptada y se abre
MOB-AIR-01: campaña visual y autoritativa de salto, segundo salto dirigido,
dodge, air roll, boost y recuperación.
