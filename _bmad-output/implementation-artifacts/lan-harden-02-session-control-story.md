# LAN-HARDEN-02 — control de sesión y presión WebSocket

**Estado:** implementada en código y pruebas unitarias; verificación LAN viva
pendiente en el host del usuario.
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

- `npm test`: 172/172.
- `node --check server.mjs` y `src/lan-session-control.js`: correctos.
- Pruebas unitarias de propietario, timeout, origen LAN y allowlist: correctas.
- Handshake y reconexión desde dos navegadores LAN: no verificados desde este
  sandbox.

## Siguiente unidad pequeña

`tools/lan-session-probe.mjs` queda preparada para comprobar en el PowerShell
del host el propietario inicial, el rechazo de control de un segundo peer, la
reasignación tras la salida del host y la reconexión dentro/fuera de la gracia.
La sonda no se puede ejecutar desde este sandbox porque las conexiones locales
devuelven `EACCES`; su resultado sigue siendo no verificado. Después volver a la
observación física pendiente de `HITBOX-01`.
