# LAN-HARDEN-02 — control de sesión y presión WebSocket

**Estado:** aceptada; verificación LAN viva completada el 17 de octubre de 2026.
**Fecha:** 16 de octubre de 2026

## Resultado observable

Una conexión LAN debe identificarse con `hello` en cinco segundos. El primer
peer autenticado es el propietario de la sesión y es el único que puede pedir
`restart` o `configure`. Si abandona definitivamente, se reasigna el control a
un peer autenticado restante. Los mensajes de salida se encolan con límite y
una conexión lenta no puede hacer crecer la memoria indefinidamente.

## Autoridad e invariantes

- El servidor sigue siendo autoridad de sesión, red, combate y snapshots.
- No cambia el formato de entradas ni la simulación de movimiento.
- La reconexión conserva la plaza y el propietario durante la ventana de 4 s.
- Los orígenes configurados siguen siendo una allowlist explícita; sin ella,
  se acepta también el origen HTTP del mismo `Host` para que una URL LAN pueda
  abrir su WebSocket.
- La cola de salida se limita por `LAN_MAX_BUFFER_BYTES` y destruye la conexión
  si el cliente no drena.

## Implementación

- `src/lan-session-control.js` contiene el contrato de propietario y timeout.
- `server.mjs` aplica timeout de `hello`, control de propietario, reasignación,
  backpressure y el flag `owner` en `welcome`.
- `src/lan-outbound-queue.js` encapsula el framing y la cola de salida para
  que el límite y el drenaje puedan probarse sin abrir un socket real.
- `src/lan-session-protocol.js` acepta el origen del mismo host cuando no hay
  allowlist configurada.
- `PROTOCOL.md` documenta que `restart` y `configure` son operaciones del host.

## Verificación

- `npm test`: 173/173.
- `node --check server.mjs` y `src/lan-session-control.js`: correctos.
- Pruebas unitarias de propietario, timeout, origen LAN y allowlist: correctas.
- `npm run probe:lan-session` en el entorno anfitrión: rechazo antes de
  `hello`, asignación del primer owner, rechazo de `restart` del invitado,
  reasignación de owner, reconexión dentro de cuatro segundos y expiración de
  sesión después de esa ventana.
- La sonda usa una arena JS mínima de dos plazas (`VEHICLE_LIMIT=2`,
  `ARENA_PROFILE=scrapyard`) para aislar transporte y sesión de CAL-01.

## Siguiente unidad pequeña

La siguiente unidad vuelve a la observación física pendiente de `HITBOX-01`.
