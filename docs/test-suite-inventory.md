# Mapa de suites de pruebas

Este mapa cierra la clasificación REP-03 de los 23 archivos que estaban fuera
de `pretest`/`test`/`posttest`. «Fuera de la cadena principal» no significaba
que ninguno tuviera un comando propio: cinco ya lo tenían. Se amplió `npm test`
con los contratos deterministas de bajo coste y se asignó un comando dedicado a
cada integración restante.

## Cadena principal

`npm test` ejecuta los hooks npm `pretest`, `test` y `posttest`. Los 13
contratos deterministas que REP-03 seleccionó de la matriz histórica forman
parte del script `test`. REP-06/07 añadieron además dos contratos pequeños de
generación y consumo de geometría compartida:

- `arena-scrapyard-material.test.mjs`
- `art-05-quality-contract.test.mjs`
- `combat-alpha-cover-layout.test.mjs`
- `combat-alpha-cover-visual.test.mjs`
- `combat-alpha-perimeter.test.mjs`
- `lan-outbound-queue.test.mjs`
- `p2p-aim-targeting.test.mjs`
- `p2p-boost-meter.test.mjs`
- `p2p-causal-beta-hud-scoreboard.test.mjs`
- `p2p-multiplayer-lobby.test.mjs`
- `p2p-scoreboard.test.mjs`
- `rocketsim-native-arena-contract.test.mjs`
- `arena-contract-generation.test.mjs`
- `rocketsim-wasm-mobility-parity-contract.test.mjs`
- `vehicle-asset-loader.test.mjs`

## Matriz de las 23 pruebas

| Archivo | Tipo | Ejecución y alcance |
|---|---|---|
| `arena-scrapyard-material.test.mjs` | Contrato Node determinista | `npm test` |
| `art-05-quality-contract.test.mjs` | Contrato de perfil/recursos | `npm test` |
| `combat-alpha-cover-layout.test.mjs` | Layout y simetría deterministas | `npm test` |
| `combat-alpha-cover-visual.test.mjs` | Geometría Three.js en CPU | `npm test` |
| `combat-alpha-perimeter.test.mjs` | Geometría/decoración Three.js en CPU | `npm test` |
| `lan-liveness-integration.test.mjs` | Integración HTTP/WebSocket en loopback | `npm run test:liveness-integration`; puede depender de que el entorno permita abrir sockets locales |
| `lan-outbound-queue.test.mjs` | Cola determinista con socket falso | `npm test` |
| `online-full-presentation-state.test.mjs` | Integración Node del host WASM y snapshots | `npm run test:online-full-presentation-state` |
| `online-lifecycle-25-smoke.test.mjs` | Contrato Node del fixture/allowlist; no abre navegador | `npm run test:online-lifecycle-25-contract` |
| `online-qa-24-smoke.test.mjs` | Contrato Node del fixture/allowlist; no abre navegador | `npm run test:online-qa-24-contract` |
| `p2p-aim-targeting.test.mjs` | Selección de objetivo determinista | `npm test` |
| `p2p-boost-meter.test.mjs` | Modelo determinista del medidor | `npm test` |
| `p2p-causal-beta-hud-scoreboard.test.mjs` | Render/modelo HUD en DOM simulado | `npm test` |
| `p2p-multiplayer-lobby.test.mjs` | Protocolo y estado de lobby | `npm test` |
| `p2p-scoreboard.test.mjs` | Proyección determinista del marcador | `npm test` |
| `p2p-wasm-causal-audio.test.mjs` | Presenter de audio a partir de estado autoritativo | `npm run test:online-audio` |
| `p2p-wasm-combat-alpha-causal.test.mjs` | Captura/contrato de traza causal WASM | `npm run test:p2p-wasm-combat-alpha-causal` |
| `rocketsim-wasm-combat-alpha-contact.test.mjs` | Movimiento y contacto de arena en WASM | `npm run test:rocketsim-wasm-combat-alpha-contact` |
| `rocketsim-wasm-combat-alpha-cover-contact.test.mjs` | Contacto WASM de alta velocidad con cobertura | `npm run test:rocketsim-wasm-combat-alpha-cover-contact` |
| `rocketsim-wasm-combat-alpha-cover.test.mjs` | Proxies/raycast WASM; comparación nativa opcional | `npm run test:rocketsim-wasm-combat-alpha-cover`; la parte nativa requiere `ROCKETSIM_BRIDGE_EXE` |
| `rocketsim-wasm-mobility-parity-contract.test.mjs` | Contrato de cintas de entrada/salida | `npm test` |
| `rocketsim-wasm-mobility-parity.test.mjs` | Paridad de cinta WASM; comparación R20 nativa opcional | `npm run test:rocketsim-wasm-mobility-parity`; la parte nativa requiere `ROCKETSIM_BRIDGE_EXE` |
| `vehicle-asset-loader.test.mjs` | Carga/asignación de assets Three.js en CPU | `npm test` |

## Geometría canónica y puertas de CI (REP-06/07)

| Archivo / gate | Tipo | Ejecución y alcance |
|---|---|---|
| `arena-contract-generation.test.mjs` | Generación determinista | `npm test`; detecta artefactos JS/C++ ausentes o desactualizados |
| `rocketsim-native-arena-contract.test.mjs` | Contrato de consumidores nativos/WASM y perfil/mapa JS | `npm test`; comprueba que los puentes consumen el header generado |
| `npm run verify:arena-contract` | Frescura del descriptor y artefactos generados | CI y `prebuild:pages-beta` |
| `npm run verify:assets` | Integridad del manifiesto de assets | CI |
| `test:online-full-presentation-state`, gates WASM de contacto/raycast y movilidad | Regresiones online y físicas enfocadas | CI y comandos dedicados; no sustituyen QA humana |
| `build:pages-beta` / `verify:pages-beta` | Empaquetado y allowlist pública de Pages | CI; el build verifica antes el contrato geométrico |

Además de la cadena principal, CI ejecuta explícitamente las cinco pruebas con
comando propio que cubren loopback, fixtures ONLINE-QA/LIFECYCLE, audio causal
y trazas de combate: `test:liveness-integration`,
`test:online-qa-24-contract`, `test:online-lifecycle-25-contract`,
`test:online-audio` y `test:p2p-wasm-combat-alpha-causal`. Los dos contratos de
fixtures no sustituyen sus recorridos Electron reales.

## Puertas que no deben confundirse

- `test:online-qa-24-contract` y `test:online-lifecycle-25-contract` solo
  comprueban contratos/fixtures. El recorrido Electron real usa
  `npm run smoke:online-qa-24` y `npm run smoke:online-lifecycle-25`.
- Las comparaciones nativas de RocketSim no se consideran ejecutadas cuando
  `ROCKETSIM_BRIDGE_EXE` no está configurado; un `skip` no equivale a paridad
  verificada.
- Esta actualización clasifica y enruta pruebas existentes; no añade casos de
  prueba nuevos. Las cifras 650/9 citadas en reportes anteriores no tienen un
  identificador durable de ejecución asociado y se retiran como métrica vigente.
  Ejecuta los comandos listados para obtener evidencia nueva. Los skips de
  comparaciones nativas sin `ROCKETSIM_BRIDGE_EXE` no acreditan paridad nativa;
  los smokes Electron reales y la QA entre navegadores siguen siendo puertas
  distintas.
