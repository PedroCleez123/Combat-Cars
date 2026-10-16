# ONLINE-01 — envoltura de sesión LAN local

**Estado:** Implementada; validación integrada del transporte pendiente · 14 de octubre de 2026

## Problema

La sesión LAN actual acepta mensajes antes de identificarlos, asigna una plaza
nueva en cada reconexión y no limita de forma estricta las tramas WebSocket.
Eso es válido para el prototipo local, pero hace frágil la reconexión automática
del navegador y deja una frontera mal definida para el futuro online.

## Alcance

- Saludo inicial versionado con `roomId` y `sessionId` efímero.
- Recuperación de la misma plaza durante una ventana breve de desconexión.
- Heartbeat de aplicación y retirada de sesiones inactivas.
- Límite estricto de tramas de cliente y rechazo de frames sin máscara.
- Allowlist de `Origin` configurable, conservando localhost/127.0.0.1 por defecto.
- Publicar versión, sala y estado de sesión en `welcome` sin cambiar snapshots.

No incluye TLS/WSS, cuentas, autenticación, matchmaking, varias salas,
predicción, cambios de física, bridge nativo ni despliegue público. El
`sessionId` no es una credencial.

## Base / Post / Delta

- **Base:** GAME-04 aceptada, `npm test` 139/139; el `hello` solo tenía nombre.
- **Post:** un cliente desconocido no puede introducir inputs antes del saludo;
  una recarga dentro de la ventana conserva ID/plaza; una trama inválida se
  cierra de forma controlada; los probes LAN siguen funcionando.
- **Delta:** módulo de contrato LAN, `server.mjs`, saludo del cliente/probes,
  pruebas puras y documentación.

## Aceptación

1. Versión o sala incorrecta, `hello` ausente y sesión activa duplicada reciben
   error y cierre; `input`, `restart` y `configure` solo se procesan después de
   un saludo válido.
2. La misma sesión recupera su ID y plaza dentro de 4 s; fuera de la ventana
   el servidor elimina la plaza y la siguiente conexión recibe una nueva.
3. El parser rechaza frames sin máscara, payloads mayores de 8192 bytes y
   longitudes extendidas no soportadas; el heartbeat expira tras 20 s.
4. El origen local funciona por defecto y `LAN_ALLOWED_ORIGINS` restringe los
   orígenes adicionales cuando se configura.
5. La suite y las campañas LAN existentes permanecen verdes; no cambian las
   reglas ni las poses de RocketSim.

## Decisión de salida

Una aceptación verde habilita la envoltura local para preparar ONLINE-02. No
autoriza exponer el proceso a Internet: TLS, autenticación, salas y observabilidad
siguen siendo historias separadas.
