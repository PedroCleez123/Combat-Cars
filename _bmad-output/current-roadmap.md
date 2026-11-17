# Roadmap vigente — 17/11/2026

## Estado actual

Combat Cars es un juego web multijugador de coches voladores. La ruta de
producto es **Pages → Worker de señalización → WebRTC P2P → RocketSim WASM en
el host**. El host es la autoridad física y de partida; el Worker solo señaliza.
La ruta local con RocketSim nativo está congelada y sirve como referencia y
regresión. No retirarla todavía.

Este archivo indica la prioridad. Trabaja en una tarea cada vez y cierra sus
criterios antes de avanzar. **COV-01–03 están cerrados; COV-04 y COV-06 tienen
su automatización registrada y conservan QA manual pendiente.** REP-01 quedó
completado y REP-02 está cerrado con el checkpoint local `46e9c2a`. `build:pages-beta`
y `verify:pages-beta` terminaron correctamente con 101 archivos. REP-03 ya tiene
matriz y scripts: 13 contratos deterministas se añadieron a `npm test` y cinco
integraciones tienen comandos dedicados nuevos; cinco más ya los tenían. La
validación REP-03 pasó: `npm test` dio 650 pass, 0 fallos y 9 skips; `posttest`,
3/3; los diez comandos dedicados, 31 pass, 0 fallos y 3 skips ambientales. La
tarea activa pasa a **REP-04: CI mínima y control de frescura del WASM**. No se
desplegó nada.

## Prioridad activa — REP: recuperar estado reproducible del repositorio

**Objetivo:** que Git, la suite, los artefactos WASM y la documentación permitan
reconstruir y revisar el producto WASM/P2P sin perder trabajo válido ni tratar
archivos desconocidos como residuos.

### Línea base observada el 17/11/2026

Lectura de `git status --short` en `master`, `HEAD a48e089`, antes del
checkpoint: 415 entradas visibles (155 borrados ya preparados, 2 borrados sin
preparar, 59 modificados y
199 entradas sin seguimiento). `--untracked-files=all` expande el estado a 676
rutas y 460 ficheros sin seguimiento. No consolidar todavía los borrados
preparados: primero se clasifica su impacto. Hay 88 módulos JS `src/` en el
checkout, 32 versionados; 136 archivos de pruebas, 27 versionados; de ellos,
113 aparecen en `pretest`/`test`/`posttest` y 23 no están conectados a esos
comandos. No existe `.github/workflows/`. `emsdk/` y builds de diagnóstico
ocupan espacio dentro del checkout. Estas cifras son una **instantánea de
auditoría**, no un objetivo ni permiso para borrar/mover nada. No se volvió a
ejecutar la suite durante esta revisión; el último informe adjunto declara
589 pass, 7 skips y 0 fallos, además de `verify:pages-beta` correcto.

Desglose de `git status` por carpeta (solo clasifica ubicaciones, aún no decide
qué conservar): borrados preparados en `_bmad-output/` (82), `docs/` (45),
`openwiki/` (27) y `archive/` (1); dos borrados de `tools/` seguían sin preparar.
Ficheros nuevos en `tools/`
(221), `tests/` (109), `src/` (67), `docs/` (27), `assets/` (13), `openwiki/`
(10), `cloudflare/` (3), `_bmad-output/` (2), `deploy/` (2) y seis páginas de
diagnóstico en la raíz. Hay cambios rastreados en código, pruebas, herramientas,
documentación y archivos de entrada/configuración. La lista de rutas debe
revisarse antes de aprobar cualquier limpieza o checkpoint.

### REP-01 · clasificación de rutas

La inspección de rutas confirmó estas decisiones iniciales:

| Rutas / familia | Decisión de inventario |
|---|---|
| 85 archivos sin seguimiento nombrados por `PAGES_BETA_FILES` en `tools/build-pages-beta.mjs` | **Conservar y versionar**: contienen código/activos requeridos por la build Pages actual. El `HEAD` `a48e089` no basta para reconstruir el paquete publicado. Incluye entradas públicas, módulos P2P/WASM, audio, vehículo, texturas y partes de `tools/wasm-spike/`. |
| `cloudflare/arsenal-signal-worker.mjs`, `cloudflare/wrangler.toml`, `cloudflare/README.md` | **Conservar y versionar**: son la señalización Worker de la arquitectura Pages + WebRTC P2P. |
| `src/**`, `tests/**`, `assets/audio/**`, `src/assets/**` | **Conservar primero**; separar después los archivos de runtime WASM, la referencia local congelada y las fixtures. No borrar por antigüedad o por estar sin seguimiento. |
| `tools/wasm-spike/**` fuera de salidas generadas | **Conservar y clasificar** entre runtime WASM de la build pública y utilidades de prueba/build. Varios módulos del host/render aparecen en la lista pública o en scripts/tests. |
| `tools/wasm-spike/build-pages-clean/` | 123 archivos, 4,5 MiB; no aparece como entrada de la build Pages ni tiene referencias de uso encontradas. **Salida generada candidata a regenerarse fuera del checkout**, tras compararla con `dist-pages-beta/`; no borrada. |
| `tools/wasm-spike/emsdk/` | 17.689 archivos, 1,46 GiB, ignorado por Git. **Herramienta de compilación local**; conservar hasta identificar/pinear su versión y documentar un setup reproducible fuera del checkout. |
| `docs/reference-captures/*.json` | 53 ficheros, 45 MiB; herramientas de captura/comparación usan fixtures de esta carpeta. **Conservar los referenciados**; no archivar en bloque antes de resolver referencias por fichero y procedencia. |
| Páginas `p2p-multiplayer.html`, `p2p-room-lobby.html`, `p2p-causal-beta.html` | **Conservar**: están incluidas en el manifiesto público de Pages (la ruta causal queda por compatibilidad). |
| `p2p-loopback.html`, `p2p-host-loopback.html`, `p2p-session-loopback.html` y los otros HTML de diagnóstico raíz | **Conservar como diagnóstico/fixtures**: pruebas de límite estático y smoke los leen. Una futura reubicación requiere actualizar esos consumidores. |
| `deploy/Caddyfile.online.example`, `deploy/online.env.example` | **Candidatos a retirar/archivar**: no forman parte de Pages ni tienen consumidor de runtime hallado; son de la arquitectura hosted/Caddy/JWT descartada. No configurar sus variables. Las pruebas y módulos históricos de esa arquitectura se clasifican aparte, no se borran junto con las plantillas. |
| 155 borrados ya preparados (82 BMad, 45 `docs/`, 27 OpenWiki generado, 1 `archive/README.md`) | No son código de runtime. El barrido de 40 documentos vigentes encontró 0 enlaces locales rotos. **Mantener la intención de retirada y revisar el contenido/selección antes de consolidarla**; OpenWiki se debe regenerar, no editar manualmente. |
| Borrados sin preparar `tools/start-rocketsim-combat-watch.ps1` y `tools/start-rocketsim-practice.mjs` | No se hallaron referencias en el checkout actual. **Mantener la baja propuesta** y revisar si existe uso externo antes del checkpoint; son utilidades de la referencia local, no el runtime Pages. |
| `art06-*.log`, `wrangler-deploy.log`; `experiments/` | Cuatro logs ignorados ocupan la raíz; `experiments/` está vacía. **Artefactos locales**, sin efecto en runtime. Mover los logs solo si su evidencia sigue siendo necesaria; la carpeta vacía no requiere acción. |

Esta es la lista base de los 23 tests que REP-03 revisó antes de cambiar el
enrutamiento de `pretest`/`test`/`posttest`:
`arena-scrapyard-material`, `art-05-quality-contract`,
`combat-alpha-cover-layout`, `combat-alpha-cover-visual`,
`combat-alpha-perimeter`, `lan-liveness-integration`, `lan-outbound-queue`,
`online-full-presentation-state`, `online-lifecycle-25-smoke`,
`online-qa-24-smoke`, `p2p-aim-targeting`, `p2p-boost-meter`,
`p2p-causal-beta-hud-scoreboard`, `p2p-multiplayer-lobby`,
`p2p-scoreboard`, `p2p-wasm-causal-audio`,
`p2p-wasm-combat-alpha-causal`, `rocketsim-wasm-combat-alpha-contact`,
`rocketsim-wasm-combat-alpha-cover-contact`,
`rocketsim-wasm-combat-alpha-cover`,
`rocketsim-wasm-mobility-parity-contract`,
`rocketsim-wasm-mobility-parity` y `vehicle-asset-loader`.
No añadirlos todos ciegamente a `npm test`: los contratos deterministas de la
ruta pública deben entrar en una suite automática; los smoke/browser y la
integración con bridge deben conservar su comando y requisitos explícitos.

**REP-01 completado como inventario conservador (17/11):** las familias de
rutas tienen una decisión de conservar/versionar, separar como diagnóstico,
regenerar fuera del checkout o mantener como candidata a retirada. Un barrido
estático de 40 documentos vigentes revisó 30 enlaces locales y encontró 0
destinos rotos tras los borrados preparados. No se revisó el uso externo de las
dos utilidades locales eliminadas; su baja queda identificada como riesgo bajo,
no como certeza universal. Este cierre no borra, restaura, prepara ni consolida
ninguna ruta.

**REP-02 completado:** el commit local `46e9c2a` conserva junto en Git el
runtime Pages/P2P, sus fuentes y artefactos WASM, pruebas, configuración y
documentación activa. Se dejaron fuera los 155 borrados históricos, los cambios
generados de OpenWiki y las salidas de build redundantes; siguen pendientes en
el checkout para su revisión/regeneración. No se publicó ni desplegó durante el
checkpoint.

**REP-03 · enrutamiento de pruebas:** la matriz está en
[`docs/test-suite-inventory.md`](../docs/test-suite-inventory.md). Trece
contratos Node deterministas están en la cadena de `npm test`; cinco
integraciones tienen comandos `test:*` propios y cinco conservan sus comandos
previos. Los contratos de ONLINE-QA-24 y ONLINE-LIFECYCLE-25 no sustituyen los
smokes Electron. **Completado:** `npm test` 650 pass/0 fail/9 skip, `posttest`
3/3 y los diez comandos dedicados 31 pass/0 fail/3 skip. Los skips dedicados
fueron el servidor loopback bloqueado por el entorno y dos comparaciones nativas
sin `ROCKETSIM_BRIDGE_EXE`; los smokes Electron siguen siendo puertas aparte.

| Gate | Entrega | Criterio de salida |
|---|---|---|
| **REP-01 · inventario** | Clasificar cambios, archivos sin seguimiento y borrados por producto, pruebas, documentación, fixture, generación y herramienta local | Cada ruta tiene una decisión explícita (conservar/versionar, generar fuera del checkout, archivar o retirar); no hay borrados automáticos ni se descarta trabajo sin procedencia revisada. |
| **REP-02 · checkpoint (completado: `46e9c2a`)** | Crear una línea base revisable del estado que se decida conservar | Runtime Pages/P2P, artefactos WASM, pruebas, configuración y documentación conservada están juntos en Git; build y verificación de Pages correctas (101 archivos). |
| **REP-03 · cobertura de pruebas (completado)** | Clasificar y enrutar los 23 tests de la lista base | Matriz documentada; 13 contratos deterministas en `npm test`; integraciones separadas por comandos dedicados. `npm test`: 650 pass/0 fail/9 skip; `posttest`: 3/3; integraciones: 31 pass/0 fail/3 skip ambiental. |
| **REP-04 · automatización** | Añadir CI mínima y un control de frescura del WASM empaquetado | CI se activa solo después de REP-02/03; el build alerta/falla si fuentes RocketSim cambiaron y el WASM entregado no se regeneró. No introducir runtime nuevo. |
| **REP-05 · una verdad documental** | Corregir métricas históricas y señalar documentos activos/superseded | Roadmap y brief vigente concuerdan; los documentos históricos se etiquetan y el OpenWiki generado se regenera desde el estado consolidado, sin editar sus páginas a mano. |

**No es parte de REP:** reescribir el juego, borrar la ruta Three.js local,
reorganizar capturas en bloque, mover el toolchain Emscripten o eliminar
`deploy/`/diagnósticos antes de verificar la reproducibilidad y los consumidores
externos. Mantener intacto el trabajo actual mientras se decide cada ruta.

### Siguiente paso

REP-04: preparar CI mínima para la build/verificación Pages y el control de
frescura del WASM empaquetado. Mantener los smokes reales de Electron y la QA
de navegador como puertas separadas. COV-04/06 queda en espera de QA manual; no
se considera un fallo de la ruta online.

## Hito pendiente — COV: cobertura industrial autoritativa

**Objetivo:** añadir cobertura real contra cohetes y coches, conservando rutas
de paso, simetría entre equipos y seguridad de RocketSim.

- Diseño aprobado: [spec COV](../docs/superpowers/specs/2026-11-16-combat-alpha-cover-design.md).
- Tareas y pruebas: [plan COV](../docs/superpowers/plans/2026-11-16-combat-alpha-cover.md).
- Estado: **COV-03 cerrado; COV-04 automático cerrado y QA manual pendiente**.
  El contrato declarativo y los seis proxies
  estáticos están integrados en la arena nativa y WASM; raycasts bajo/alto,
  bypass, contacto a alta velocidad y regresiones de pared/curva/rampa pasan.
  Los cuatro contenedores y dos barricadas de neumáticos se presentan desde el
  mismo descriptor en las rutas local y P2P, con fallback opaco, tres batches,
  256 neumáticos instanciados, cero luces dinámicas y sin tocar snapshots,
  física o protocolo.
  El último informe adjunto registra 589 pass, 7 skips explícitos por bridge
  nativo no configurado y 0 fallos; el post-test de raycast WASM pasa 3/3. La build y
  verificación Pages beta pasan con 101 archivos. Falta la evidencia humana
  local/P2P y la captura de rendimiento para cerrar COV-04.
- Layout inicial: cuatro barreras de contenedor y dos barricadas bajas de
  neumáticos, simétricas. Las coordenadas podrán ajustarse dentro de los
  despejes seguros definidos en la spec.

### COV-06 · barricadas altas, tangentes y redondas

**Objetivo:** que cada barricada se perciba como un bloque compacto de ocho
capas y que su silueta exterior explique exactamente el único collider
autoritativo `8 × 8 × 4,8` UU.

- Diseño aprobado: [alineación de neumáticos](../docs/superpowers/specs/2026-11-17-combat-alpha-tire-cover-alignment-design.md).
- Plan ejecutable: [COV-06](../docs/superpowers/plans/2026-11-16-combat-alpha-cover.md#task-7-taller-tangent-and-rounder-tire-block-cov-06).
- Actualiza la altura del proxy RocketSim/WASM en lockstep; mantiene posiciones,
  raycasts, snapshots, nitro, P2P y layout. No se desea colisión por neumático.
- Entrega prevista: `4 × 4 × 8` neumáticos tangentes por barricada (256
  totales), tres batches, 49.248 triángulos y validación de que el AABB visual
  coincide con la caja autoritativa.

| Gate | Entrega | Criterio de salida |
|---|---|---|
| **COV-01 · mapa** | IDs, dimensiones, posiciones y reglas de despeje en `src/combat-alpha-map.js` | **Cerrado:** simetría, bounds, spawns/carriles despejados y cero pickups validados por tests. |
| **COV-02 · autoridad** | Proxies estáticos equivalentes en RocketSim nativo y WASM | **Cerrado:** contacto a velocidad, raycast bajo/alto y bypass; sin regresión en paredes, curvas, techo o rampas. |
| **COV-03 · presentación** | Contenedores y neumáticos en renderer local y P2P desde el mismo descriptor | **Cerrado:** seis IDs con `nativeColliderId`, fallback legible; COV-06 mantiene 3 batches/256 neumáticos, ≤6 draw calls y 49.248 triángulos, sin luces dinámicas nuevas. |
| **COV-04 · aceptación** | Balance, rendimiento y QA local/P2P | **Automático cerrado:** 589 pass, 7 skips explícitos, 0 fallos; build/verify Pages beta correctos. **Pendiente:** cohete bloqueado no daña, tiro libre conserva su resultado, dos navegadores muestran la misma arena y evidencia humana registrada. |
| **COV-06 · neumáticos** | Barricada más alta, tangente y redonda con caja única | **Automático cerrado:** WASM recompilado; pila `4 × 4 × 8` por bloque (256 neumáticos), AABB visual/autoridad `8 × 8 × 4,8`, rayos medios bloqueados, tapa vertical en 4,8 y sobrevuelo alto libre; 589 pass/7 skips/0 fallos y Pages build/verify correctos. **Pendiente:** QA humana local/P2P y recompilación nativa cuando el SDK esté disponible. |

### Invariantes

- `combat-alpha` conserva su volumen 264 × 408 × 108 UU y la geometría aceptada
  de curvas, paredes, techo y rampa.
- RocketSim WASM del host sigue siendo la autoridad; el renderer no simula ni
  escribe estado de coches o cohetes.
- Coches y raycasts de cohetes usan los mismos proxies simples. Las mallas
  Three.js solo los representan.
- Nitro regenerable; no añadir pickups, mensajes de red ni campos de snapshot.
- Spawns, carril central y corredores de recuperación permanecen despejados.
- No desplegar Pages como parte de COV sin cerrar COV-04 y solicitar publicación.

## Estado aceptado y contexto

- **Online/WASM:** migración de producto aceptada. Sala persistente, lobby
  compartido y combate operan sobre la arena autoritativa del host. El detalle
  de protocolos está en [PROTOCOL.md](../PROTOCOL.md).
- **Nitro:** regeneración autoritativa con retardo y recarga acelerada; arena sin
  pickups. Contrato en `src/rocketsim-boost-regeneration.js`.
- **PERF-01:** HUD ligero, mediciones Chromium/AMD y protecciones de WebGL/TDR
  completados. La validación manual de Firefox/AMD y otros navegadores queda
  pendiente junto con la QA externa; las baselines y evidencia se enlazan desde
  la documentación ART.
- **ART-01–06:** skin industrial, texturas locales, material suelo/pared,
  decoración y QA del paquete local aceptados. La validación online manual en
  dos navegadores y la publicación de los cambios ART siguen pendientes.
- **Colisiones de arena:** se corrigió el broadphase para las dimensiones
  ampliadas. Mantener sus pruebas de pared/curva como regresión al añadir
  proxies.

## Aplazado

- **PR3:** no prioritario. PR3a está implementado; quedan validación manual de
  reconexión durante `playing` y PR3b (epoch/pruebas adversariales).
- **ART release:** completar QA HTTPS en dos navegadores antes de publicar las
  mejoras ART.
- **Ruta local:** no eliminar hasta inventariar sus consumidores y conservar
  una copia recuperable.

## Referencias

- [Diseño y plan de cobertura COV](../docs/superpowers/specs/2026-11-16-combat-alpha-cover-design.md) · [tareas ejecutables](../docs/superpowers/plans/2026-11-16-combat-alpha-cover.md)
- [Diseño de arena industrial](../docs/superpowers/specs/2026-11-15-industrial-scrapyard-arena-design.md) · [plan ART](../docs/superpowers/plans/2026-11-15-industrial-scrapyard-arena.md)
- [Inventario y procedencia de texturas](../docs/superpowers/specs/2026-11-15-industrial-scrapyard-asset-inventory.md) · [QA visual/package](../docs/reference-captures/industrial-scrapyard-visual-qa.md)
- [README](../README.md) · [contrato de ejecución/red](../PROTOCOL.md)
- Los cambios históricos y sus pruebas quedan en Git; este roadmap conserva
  solo el resumen que afecta al trabajo actual.
