# LAN-HARDEN-01 — frontera de recursos estáticos

**Estado:** aceptada en pruebas unitarias; verificación HTTP viva pendiente en
el host del usuario.
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

- `npm test`: 163/163.
- `node --check server.mjs` y `node --check src/http-static-boundary.js`:
  correctos.
- Arranque del servidor JS: se observó el log de escucha en un proceso hijo.
- La petición HTTP desde este sandbox no pudo verificarse porque el entorno
  aísla la red de procesos; queda como comprobación del host PowerShell.

## Siguiente decisión

Cerrar la comprobación viva en el host y, si es correcta, pasar a
`COMBAT-BOUNDS-01` para alinear los límites de cohetes con la arena nativa antes
de retomar nuevas observaciones de movilidad.
