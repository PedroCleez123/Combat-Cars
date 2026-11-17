# Diseño: observabilidad y rendimiento de Combat Cars online

**Fecha:** 05/11/2026  
**Estado:** PERF-01.1–PERF-01.4 implementados y verificados  
**Ruta afectada:** `Pages → Worker de señalización → WebRTC P2P → RocketSim WASM host`

**Verificación pública (07/11/2026):** la primera comprobación de
`https://combat-cars.pages.dev/` estaba sirviendo una publicación anterior sin
FPS ni batching. Tras volver a desplegar los 94 archivos, el lobby publicado
midió aproximadamente 144 FPS (6,9 ms por frame, p95 7,1 ms), mostró `FPS 144`,
expuso diagnósticos con `qualityMode: high` y no produjo errores de consola.

## Objetivo

Hacer visible la cadencia real de render sin cubrir la arena y reducir el coste
gráfico de la sala/partida online sin alterar RocketSim, la autoridad del host,
la física, el contrato WebRTC ni el modelo GLTF final de los coches.

El único elemento nuevo visible será un contador compacto `FPS NN` en la
esquina superior izquierda. No es un panel de depuración ni muestra ticks,
ping, draw calls o datos de red.

## Hallazgos de la auditoría

1. La raíz publicada (`index.html`) carga `p2p-multiplayer.html` y
   `src/p2p-multiplayer-entry.js`; la antigua ruta `p2p-causal-beta.html` no
   es el flujo normal del jugador. Cualquier HUD de FPS nuevo debe integrarse
   en la primera ruta.
2. La ruta pública mantiene un único bucle de presentación por sesión. La
   práctica offline usa un `requestAnimationFrame` propio, que se detiene antes
   de ceder el canvas al renderer online. No hay evidencia de dos renderizadores
   Three.js activos a la vez.
3. El renderer parte con calidad automática en `high`: DPR hasta `2`, sombras
   suaves de `2048²` y una frustum de sombras ampliada para la arena
   `264 × 408 × 108`. La degradación automática actual mide el tiempo de
   entrega de `renderer.render()`, no la cadencia completa de `requestAnimationFrame`;
   por ello no diagnostica bien una espera GPU/vsync.
4. La ampliación de pickups a 88 convirtió la decoración en el coste gráfico
   principal. La ruta procedural contiene **264 submallas de pad** (disco,
   aro y haz por pad) y **88 PointLight** locales; con beacons y lavados hay
   **295 mallas y 96 luces** en la decoración, antes de arena, obstáculos,
   coches y efectos.
5. El asset `boost-pads.glb` tampoco es hoy una alternativa económica:
   `large-active` y `small-active` tienen dos mallas cada uno. Clonadas para
   24 pads grandes y 64 pequeños producirían aproximadamente **176 draw calls**
   y **85.056 triángulos**. Supera el presupuesto configurado (`5.000`
   triángulos / `80` draw calls), por lo que el navegador conserva el fallback
   procedural caro. El skybowl, en contraste, son 9.164 triángulos y 60
   primitivas y no es el primer objetivo.
6. Los audios se descargan y decodifican después de un gesto de usuario, de
   forma desacoplada. Pueden afectar al primer sonido, pero no explican un FPS
   bajo persistente.
7. El smoke Electron actual se inicia deliberadamente con `--disable-gpu` y
   además se queda bloqueado en la inicialización WASM dentro de este sandbox,
   sin errores de consola. No puede utilizarse como cifra de FPS de Chrome,
   Firefox, Edge, Opera o Brave reales; sí sigue siendo un gate estructural
   cuando se repare por separado.

## Presupuesto y medición

La meta de producto es 60 FPS estables en escritorio, equivalente a
`≤ 16,7 ms` por frame en una muestra sostenida. El contador usará una ventana
de un segundo suavizada y se actualizará como máximo cada 500 ms. No leerá
pixels ni forzará sincronización GPU.

Se capturarán de forma no visible, para pruebas y profiling: FPS/frame time,
draw calls, triángulos, geometrías, texturas, programas, DPR, modo de calidad,
luces y mallas de decoración. Las cifras se compararán con el escenario de
mayor carga: 6 coches, 88 pickups activos, arena ampliada, nitro y cohetes.

## Diseño de la intervención

### FPS HUD (PERF-01.1)

- Reutilizar `createFrameMetrics` de `src/client-performance.js`; no crear un
  segundo algoritmo de cronometraje.
- Conectar una única llamada por `requestAnimationFrame`, tanto en práctica
  como después del handoff online. Reiniciar/ignorar la muestra tras volver de
  una pestaña oculta para no publicar un falso `1 FPS`.
- Añadir solo un `<output>` no interactivo a `p2p-multiplayer.html`, fijado en
  la esquina superior izquierda, `pointer-events: none` y contención de
  layout/pintura. El resultado será `FPS 60`, no un bloque diagnóstico.

**Entrega realizada (06/11/2026):** `src/p2p-fps-counter.js` reutiliza
`createFrameMetrics`; `p2p-multiplayer-entry.js` lo alimenta desde el único rAF
online y desde el callback opcional del rAF de práctica; la visibilidad reinicia
la ventana; `p2p-multiplayer.html` sólo añade el `output#fps-counter`. La prueba
focal vive en `tests/p2p-fps-counter.test.mjs` y está incluida en `npm test`.
No se creó un segundo bucle de render ni se alteraron snapshots, autoridad,
física, red o audio.

**Instrumentación y optimización entregadas (07/11/2026):**

- El renderer expone métricas no visibles mediante `metrics()` y la ruta pública
  las hace consultables desde `window.__COMBAT_CARS_DIAGNOSTICS__`; incluye
  llamadas, triángulos, geometrías, texturas, programas, DPR, calidad y coste
  de decoración. El readback GPU sigue desactivado salvo diagnóstico explícito.
- Los 88 pads procedurales se agrupan en seis `InstancedMesh` (disco, aro y haz
  para cada tamaño), con cero luces puntuales por pad. La metadata sigue
  actualizando por id y el estado de disponibilidad sólo modifica matrices de
  esas instancias. La medición determinista de decoración queda en 37 draw
  calls, 3.832 triángulos, 8 luces totales y 0 luces de pad.
- La calidad automática consume timestamps de rAF mediante `recordFrame()`,
  descarta saltos de pestaña, degrada sólo tras ventanas sostenidas y recupera
  de forma gradual con histéresis. No cambia snapshots, autoridad, física ni
  controles.

### Instrumentación sin coste de juego (PERF-01.2)

- Extender `metrics()` del renderer con los contadores ya disponibles en
  `renderer.info` y los recuentos exactos de decoración. No activar
  `diagnosticsReadback` en producción: renderiza la escena una segunda vez y
  hace una lectura síncrona de GPU.
- Publicar estos datos sólo a la superficie de prueba/documentación, no al HUD
  ni al protocolo P2P.

### Pickups escalables (PERF-01.3)

- Sustituir pads procedurales individuales por lotes `InstancedMesh` de
  geometrías compartidas para grande/pequeño y sus estados activo/inactivo.
  El brillo se logrará con materiales emisivos/unlit, no con un `PointLight`
  por pickup.
- Mantener la metadata autoritativa: cada id conserva posición, actividad y
  temporizador; sólo cambia su representación. No se mueve ningún trigger,
  pickup, spawn o colisionador.
- Conservar el asset final GLTF de vehículos; esta tarea no reactiva modelos
  procedurales de coche ni cambia sus paletas por equipo.

### Calidad adaptativa con evidencia (PERF-01.4)

- Después de una comparación antes/después de pickups, alimentar el selector
  de calidad con la cadencia rAF medida, con histéresis. Bajará de forma
  gradual `high → balanced → performance` bajo presión sostenida y nunca
  oscilará cada segundo.
- Sólo entonces se considerarán DPR, sombras y mapa de sombras. No se rebaja
  la calidad global por intuición ni se desactiva la iluminación de todos los
  jugadores sin la métrica que lo justifique.

## No objetivos

- No cambiar RocketSim, su tick, choques, dodges, spawns, pickups físicos,
  armas, cámara, duración de ronda ni autoridad del host.
- No introducir un servidor dedicado, Caddy, JWT o la ruta hosted.
- No añadir un menú de calidad visible en este hito; el usuario ha solicitado
  un contador ligero, no una capa de diagnóstico.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Instancing pierde el estado visual de un pickup | Tests de cambio activo/inactivo por id y captura comparativa de 88 pads. |
| La reducción de luces vuelve la arena plana | Mantener hemisférica, direccional, luces de equipo y emisión de cada pad; comparar capturas antes/después. |
| Cambiar la calidad afecta a cámara/jugabilidad | El controlador sólo cambia propiedades de renderer; snapshots y autoridad no se tocan. |
| Una cifra FPS engaña tras alt-tab | Resetear la ventana de muestreo al recuperar visibilidad. |

