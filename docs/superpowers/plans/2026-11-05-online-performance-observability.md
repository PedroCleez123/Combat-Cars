# Plan de implementación: rendimiento online y FPS ligero

> **Implementador:** ejecutar cada tarea en orden, con pruebas focales antes de
> continuar. No modificar física, WASM, señalización ni WebRTC.

## Contexto

El diseño aprobado está en
`docs/superpowers/specs/2026-11-05-online-performance-observability.md`.
La raíz pública real es `p2p-multiplayer.html` / `p2p-multiplayer-entry.js`.

## Hito PERF-01.1 — contador FPS ligero (P0) — completado 06/11/2026

**Archivos:**

- Modificar `p2p-multiplayer.html`.
- Modificar `src/p2p-multiplayer-entry.js`.
- Modificar `src/p2p-offline-practice.js` sólo si hace falta un callback de
  frame opcional y sin cambiar su cadencia ni su autoridad.
- Añadir o ampliar la prueba focal de entrada multijugador y
  `tests/client-performance.test.mjs`.

**Pasos:**

1. Extraer/reutilizar el contador de `createFrameMetrics` y alimentar una vez
   por frame, nunca desde intervalos de input o snapshots.
2. Añadir un `output#fps-counter` no interactivo, top-left, con CSS contenido.
3. Actualizar su texto cada 500 ms (`FPS NN`) y resetear la muestra tras
   `visibilitychange` al volver a visible.
4. Cubrir práctica offline y renderer online sin registrar dos listeners ni
   dos rAF para el mismo canvas.

**Aceptación:** el contador no tapa menú/lobby/marcador, no toma foco, no se
actualiza más de dos veces por segundo y refleja FPS real tanto antes como
después de entrar en una sala.

**Evidencia:** `tests/p2p-fps-counter.test.mjs` y el contrato de
`tests/p2p-multiplayer-desktop-controls.test.mjs` pasan. La suite completa
queda en 545 tests (536 pass, 9 skip, 0 fail); `npm run build:pages-beta` y
`npm run verify:pages-beta` generan/verifican 94 archivos, incluidos
`src/p2p-fps-counter.js` y `src/client-performance.js`.

## Hito PERF-01.2 — línea base reproducible (P0) — completado 07/11/2026

**Archivos:**

- Modificar `tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs`.
- Ampliar `tests/p2p-wasm-three-presentation-renderer.test.mjs`.
- Modificar `docs/superpowers/specs/2026-11-05-online-performance-observability.md`
  con la medición obtenida.

**Pasos:**

1. Añadir a `metrics()` draw calls, triángulos, geometrías, texturas, programas
   y métricas de decoración, sin habilitar `diagnosticsReadback`.
2. Añadir una fixture determinista de 6 coches/88 pickups que conserve el
   estado del juego y compruebe la forma de las métricas.
3. Reparar o aislar el runner Electron que se queda en `Inicializando módulo…`;
   no informar sus cifras software como rendimiento de GPU real.

**Aceptación:** una medición puede diferenciar coste de presentación de estado
P2P/WASM y no realiza un segundo render por frame en producción.

**Evidencia:** `metrics()` y `window.__COMBAT_CARS_DIAGNOSTICS__` exponen la
forma de datos; la prueba `ONLINE-PERF-BASELINE-01` confirma que no se activa
readback por defecto.

## Hito PERF-01.3 — decoración de pickups escalable (P1) — completado 07/11/2026

**Archivos:**

- Modificar `src/arena-decoration.js`.
- Ampliar `tests/arena-decoration.test.mjs`.
- Ampliar `tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs` y su test
  sólo para conectar la metadata existente con los lotes.

**Pasos:**

1. Construir lotes instanciados, con geometrías y materiales compartidos,
   conservando 88 ids y los dos tamaños de pad.
2. Sustituir PointLights por emisión/materiales de pad; conservar las luces de
   equipo y la dirección visual de la arena.
3. Actualizar sólo las instancias cuyos estados cambien en metadata.
4. Registrar el antes/después de draws, luces y triángulos.

**Aceptación:** 88 pads activos/inactivos siguen visibles y correctos, no hay
PointLight por pad, los coches continúan usando su GLTF final, y la escena
reduce sustancialmente sus draw calls respecto a las 264 submallas actuales.

**Evidencia:** `tests/arena-decoration.test.mjs` verifica 88 pads, seis lotes,
cero luces por pad y actualización activa/inactiva por id.

## Hito PERF-01.4 — calidad adaptativa basada en rAF (P1) — completado 07/11/2026

**Archivos:**

- Modificar `src/p2p-causal-beta-renderer.js`.
- Modificar `tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs`.
- Añadir pruebas deterministas de transición e histéresis.

**Pasos:**

1. Entregar al renderer una señal de cadencia real sin hacer readback GPU.
2. Aplicar degradación gradual tras varios segundos sostenidos bajo presupuesto;
   permitir recuperación lenta y estable.
3. Validar DPR/sombras/mapa de sombras por modo, con el mismo canvas y sin
   reinstanciar vehículos ni arena.

**Aceptación:** ningún parpadeo de calidad, ningún cambio de estado P2P, y la
calidad `high` se conserva donde el equipo sostiene la meta de FPS.

**Evidencia:** `ONLINE-RENDER-ADAPTIVE-02` verifica degradación tras cadencia
lenta sostenida y `ONLINE-RENDER-ADAPTIVE-03` verifica recuperación gradual a
`high`; ambos usan timestamps rAF deterministas.

## Verificación de cada hito

1. Pruebas focales de los módulos modificados.
2. `npm run build:pages-beta` y `npm run verify:pages-beta`.
3. Prueba humana de 6 jugadores/pads en Chrome, Firefox, Edge, Opera y Brave:
   registrar FPS, resolución de pantalla, GPU aproximada y modo de calidad.
4. Confirmar visualmente que arena, curvas, vehículo final, sonido y P2P no
   han cambiado fuera de la optimización prevista.

