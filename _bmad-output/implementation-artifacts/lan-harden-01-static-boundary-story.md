# LAN-HARDEN-01 — frontera de recursos estáticos

**Estado:** aceptada; verificación HTTP viva completada el 17 de octubre de
2026.
**Fecha:** 16 de octubre de 2026

## Resultado observable

El servidor entrega la aplicación y sus módulos de cliente necesarios, pero no
expone por HTTP el código del servidor, documentación interna, herramientas,
configuración ni artefactos de desarrollo.

## Autoridad e invariantes

- El servidor HTTP es la autoridad de la frontera de recursos.
- No cambia la autoridad de movimiento, combate, snapshots ni WebSocket.
- `/`, los módulos importados por `src/client.js` y el bundle de Three.js siguen
  disponibles.
- `server.mjs`, `.git`, `docs`, `_bmad-output`, `tools` y rutas de traversal
  devuelven 404.

## Implementación

- `src/http-static-boundary.js` contiene la allowlist y la resolución segura.
- `server.mjs` usa esa resolución y añade `X-Content-Type-Options: nosniff`.
- `tests/http-static-boundary.test.mjs` cubre entrypoint, módulos públicos,
  internals y traversal.

## Verificación

- `npm test`: 173/173.
- `node --check server.mjs` y `node --check src/http-static-boundary.js`:
  correctos.
- `npm run probe:lan-http` en el entorno anfitrión: entrypoint, módulo del
  cliente y `three.core.js` devuelven 200 con `nosniff`; servidor, `.git`,
  documentación, herramientas y traversal devuelven 404.
- La sonda usa una arena JS de una plaza y un puerto efímero; no toca la
  instancia RocketSim del juego.

## Siguiente decisión

`LAN-HARDEN-01` queda cerrada. La siguiente puerta es `HITBOX-01`: observar un
vuelco aislado con R19 antes de cambiar física o presentación.
