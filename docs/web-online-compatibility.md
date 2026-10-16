# Compatibilidad web y ruta online

## Decisión actual

El juego seguirá siendo una aplicación web Three.js con un servidor Node
autoritativo. No se migra de motor ni se introduce todavía una plataforma
online pública. La prioridad continúa siendo estabilizar vuelo, saltos,
aterrizaje y hitboxes.

La arquitectura actual ya permite jugar desde un navegador:

- `server.mjs` sirve el cliente estático y acepta conexiones WebSocket.
- `src/client.js` usa `ws://` en HTTP y `wss://` automáticamente cuando la
  página se sirve por HTTPS.
- El cliente solo envía controles; el servidor conserva física, daño,
  puntuación, respawn y estado de los coches.
- El proceso RocketSim es un sidecar exclusivo del servidor. Nunca se envía
  un binario nativo al navegador.
- `PORT` es configurable y el servidor escucha en `0.0.0.0`, por lo que la
  partida LAN actual funciona sin cambiar el cliente.

## Qué queda deliberadamente fuera ahora

El protocolo actual representa una única partida por proceso y no tiene aún
identidad de cuenta, salas, autenticación, autorización, persistencia,
reconexión ni límites públicos. Es correcto para localhost y LAN, pero no debe
exponerse directamente a Internet.

No se añade ahora un campo de sala ni se cambia el formato de snapshots: hacerlo
durante la reconstrucción de movilidad mezclaría una decisión de despliegue con
la física y aumentaría el riesgo de regresión.

## Ruta mínima cuando online pase a ser prioridad

1. **Frontera segura:** colocar Node detrás de un proxy TLS que termine HTTPS y
   WSS; conservar el cliente sin cambios porque ya deriva el esquema seguro.
2. **Sesiones:** añadir una envoltura versionada de protocolo con `roomId`,
   `sessionId` y versión, manteniendo el snapshot de movimiento como payload
   interno. Rechazar mensajes de otra sala y entradas con secuencia repetida.
3. **Servidor de salas:** separar el proceso HTTP de la instancia
   `ArenaMatch`/`RocketSimPracticeMatch`, con una sala autoritativa por partida
   y un límite explícito de coches.
4. **Operación:** autenticación, allowlist de `Origin`, rate limiting,
   heartbeat/ping, límite de tamaño de frame, logs y cierre limpio del sidecar.
5. **Red real:** medir RTT, pérdida, reconexión y carga con seis coches antes
   de activar predicción cliente o interpolación más agresiva.
6. **Despliegue:** mantener RocketSim en el servidor anfitrión y verificar que
   el binario, Bullet y su licencia se distribuyen solo donde corresponda.

## Criterios de compatibilidad futura

- La URL local y el cliente actual siguen funcionando sin cambios.
- HTTP local continúa usando `ws://`; HTTPS de producción usa `wss://`.
- El cliente nunca decide daño, puntuación, respawn o autoridad física.
- El backend JavaScript sigue siendo un fallback explícito de desarrollo;
  RocketSim no se activa por accidente en producción.
- La transición online se valida en una historia independiente, después de
  cerrar R7-03 y la integración de contactos.

## ONLINE-01 local

La envoltura LAN quedó implementada en `src/lan-session-protocol.js` y
`server.mjs`: `hello` versionado, sala `local`, identidad efímera en
`sessionStorage`, recuperación durante cuatro segundos, heartbeat, timeout,
límite de 8192 bytes y allowlist configurable con `LAN_ALLOWED_ORIGINS` (esa variable reemplaza la lista local por defecto).
Las sondas existentes envían el nuevo saludo; `npm test` cubre la validación
de contrato. La sesión no es una cuenta ni una credencial y el proceso sigue
sin estar preparado para Internet.

## Estado

La compatibilidad web local/LAN está **disponible y comprobada**. ONLINE-01
está limitada a guardas locales y reconexión efímera; la compatibilidad online
pública sigue **planificada, no implementada**. TLS/WSS, autenticación, salas,
rate limiting operativo y despliegue son historias posteriores y no se deben
inferir de estos controles.
