---
type: "Referencia"
title: "Contrato de escala de arena y presentación"
openwiki_generated: true
verified:
  - by: openwiki/0.7.2
    at: 2026-11-17T23:26:08.247Z
sources:
  - id: openwiki-source-c93ff2da560ad1809a70fa1d
    resource: repo://_bmad-output/current-roadmap.md
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-ad326df634714e2f4a18d409
    resource: repo://data/combat-alpha-geometry.json
  - id: openwiki-source-19b2666a4999cd823e6ce490
    resource: repo://docs/test-suite-inventory.md
  - id: openwiki-source-8fdb57287b7f6314116dd42f
    resource: repo://src/arena-decoration.js
  - id: openwiki-source-9ecd64a96b69b6eefe12e66c
    resource: repo://src/arena-scrapyard-material.js
  - id: openwiki-source-1fc39b7b6c4d1ccb919bc68b
    resource: repo://src/assets/arena/scrapyard/manifest.json
  - id: openwiki-source-4c3989ef3101af67d167f4b8
    resource: repo://src/client.js
  - id: openwiki-source-cc30a766581af8f8f4d3dfd7
    resource: repo://src/combat-alpha-map.js
  - id: openwiki-source-e8234c4d5cfb74d2788b408a
    resource: repo://src/rocketsim-arena-profile.js
  - id: openwiki-source-e9e1cd2581219b343a9bfde2
    resource: repo://tests/arena-contract-generation.test.mjs
  - id: openwiki-source-69de56bec155971efe940395
    resource: repo://tests/arena-scrapyard-material.test.mjs
  - id: openwiki-source-542d446a67fa9082efd4e1c5
    resource: repo://tests/art-05-quality-contract.test.mjs
  - id: openwiki-source-645882723df28f22085710fc
    resource: repo://tests/combat-alpha-cover-visual.test.mjs
  - id: openwiki-source-dff64fb7e09a51f7e6161242
    resource: repo://tests/combat-alpha-map.test.mjs
  - id: openwiki-source-1f3d05872b0a07bc540b2565
    resource: repo://tests/p2p-wasm-three-presentation-renderer.test.mjs
  - id: openwiki-source-739a4a0b2067873176a3b006
    resource: repo://tests/rocketsim-arena-profile.test.mjs
  - id: openwiki-source-4395f182a4ac3385a9f3b7a6
    resource: repo://tests/rocketsim-wasm-combat-alpha-cover-contact.test.mjs
  - id: openwiki-source-87bf15531a2ed13b5f9d4df1
    resource: repo://tests/rocketsim-wasm-combat-alpha-cover.test.mjs
  - id: openwiki-source-486066d857be5c17000297da
    resource: repo://tools/generate-arena-contract.mjs
  - id: openwiki-source-f38e87ffd2cc89e14cb53e86
    resource: repo://tools/rocketsim-bridge/main.cpp
  - id: openwiki-source-57358d78b5ba84f0fda50481
    resource: repo://tools/shared/combat_alpha_geometry.generated.hpp
  - id: openwiki-source-4f2df8323725ba870ef0b903
    resource: repo://tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs
  - id: openwiki-source-518363250e9dd0cf8ead827a
    resource: repo://tools/wasm-spike/wasm-build-provenance.json
  - id: openwiki-source-4054247b34f75e84088542b8
    resource: repo://tools/wasm-spike/wrapper.cpp
generated: { by: "codex", at: "2026-11-17T23:22:26.244Z" }
---
# Contrato de escala de arena y presentación

## Fuente geométrica canónica

El descriptor authored de `combat-alpha` es `data/combat-alpha-geometry.json`.
`tools/generate-arena-contract.mjs` valida IDs, tipos, posiciones y dimensiones
positivas de los dos obstáculos centrales y las seis coberturas, y rechaza
descriptores incompletos antes de generar artefactos. Genera dos ficheros de
runtime: el módulo
`src/generated/combat-alpha-geometry.js` para mapa/perfil Three.js y el header
`tools/shared/combat_alpha_geometry.generated.hpp` para los puentes RocketSim
nativo y WASM. `npm run verify:arena-contract` detecta artefactos que divergen;
`npm run build:pages-beta` ejecuta ese gate antes de empaquetar el módulo JS.
No editar los archivos generados a mano: cambiar el JSON y volver a generarlos.

El volumen declarado mide **264 × 408 × 108 UU**, con radios de transición de
30 UU. `src/rocketsim-arena-profile.js` deriva `halfWidth`, `halfDepth`, altura y
radio del módulo generado. La presentación pública y los puentes de colisión
comparten ese perfil, mientras RocketSim mantiene la autoridad física.

El descriptor contiene el bloque central de 14 × 18 × 3,25 UU, la rampa de
20 × 18 × 3,5 UU, cuatro contenedores de 10 × 24 × 6 UU y dos cubiertas de
neumáticos de 8 × 8 × **4,8 UU**. Las posiciones, IDs y grupos de simetría se
definen en el JSON. La propuesta inicial de 2,4 UU se conserva como historia,
pero está supersedida por el diseño COV-06 y no describe el runtime actual.

## Mapa, espacio libre y nitro

`src/combat-alpha-map.js` construye obstáculos de mapa desde el artefacto JS
generado. La verificación del mapa mantiene los seis slots de salida en
`x=±2/3` del semiancho y `z=-90, 90, 0`; los beacons están en `x=±5/6` y
`z=-120, 0, 120`. Los límites de suelo seguro dejan libre la curva y los
corredores de prueba, y comprueban que obstáculos no cubran spawns ni pickups.

El modo combate no publica pickups de suelo: `COMBAT_ALPHA_PICKUPS` está
vacío. RocketSim WASM autoritativo gestiona la regeneración de nitro; lobby y
práctica usan nitro infinito. Los registros históricos de pads que aún puedan
aparecer comentados en el mapa no se instancian ni se envían como pickups.

## Presentación y autoridad de colisión

El renderer Three.js dibuja el shell interior continuo y la decoración de
cobertura a partir de descriptores visuales. Esas mallas son solo presentación;
no crean colisión ni escriben el estado del coche. El header generado alimenta
las cajas de cobertura de ambos puentes, que RocketSim usa para contactos y
raycasts. Así se evita mantener posiciones o alturas de collider duplicadas en
JavaScript, nativo y WASM.

La transición de suelo, pared, techo y esquinas se dibuja como una superficie
continua de presentación. Sus límites siguen el perfil compartido, pero la
colisión no se calcula desde la malla Three.js. La cámara y la distancia de
render deben cubrir la arena ampliada sin alterar topología ni autoridad física.

Las pruebas de raycast COV comprueban intercepción de tiros bajos y permiten
los pasos altos y laterales diseñados; las pruebas de contacto verifican el
choque contra coberturas. La prueba de material visual valida lotes y presupuesto
de presentación. Ninguna de estas pruebas sustituye la observación humana del
juego en dos navegadores.

## Estado de verificación

El roadmap retira como métricas actuales los conteos antiguos 650/9 y 589/7,
porque no están asociados a una ejecución reproducible del checkout actual.
Cada ejecución debe informarse con su commit o run. La CI verifica contrato y
assets, presentación online, contactos/raycast COV y paridad de movilidad; ahora
también incluye liveness por loopback, contratos ONLINE-QA/LIFECYCLE, audio
causal y la traza causal de combate. La publicación de Pages es una acción
separada.

La revisión local registrada el 17/11 pasó `npm test`, las verificaciones de
contrato/assets y Pages, y las puertas WASM de presentación, contacto, raycast y
movilidad. El 18/11 también pasaron individualmente los cinco comandos dedicados
añadidos a CI. La compilación limpia de WASM en
`tools/wasm-spike/build-pages-clean/` reproduce por SHA-256 los artefactos fijados
en provenance; la fecha antigua del directorio incremental `build/` no indica
por sí sola que el binario sea obsoleto. El comparador nativo se omitió porque
`ROCKETSIM_BRIDGE_EXE` no está configurado; la compilación nativa de este
entorno tampoco quedó validada al faltar el SDK de Windows (`stdint.h`). La QA
humana COV-04/COV-06 en local/P2P y entre navegadores sigue pendiente. La
actualización local del workflow aún no tiene un nuevo run remoto y no se ha
desplegado esta revisión.

## Nitro regenerable

RocketSim WASM espera 240 ticks (2 s a 120 Hz) después de consumir nitro y luego
lo regenera con aceleración hasta 100. Un nuevo consumo reinicia la espera.
Lobby y práctica conservan nitro infinito. El contrato del recurso se describe
en `docs/superpowers/specs/2026-11-08-boost-regeneration-design.md` y el estado
de las tareas COV/REP está en `_bmad-output/current-roadmap.md`.

## Evidencia de implementación

- Fuente y generación: `data/combat-alpha-geometry.json`,
  `tools/generate-arena-contract.mjs`,
  `src/generated/combat-alpha-geometry.js` y
  `tools/shared/combat_alpha_geometry.generated.hpp`.
- Consumidores: `src/combat-alpha-map.js`, `src/rocketsim-arena-profile.js`,
  `tools/rocketsim-bridge/main.cpp` y `tools/wasm-spike/wrapper.cpp`.
- Verificación: `tests/arena-contract-generation.test.mjs`,
  `tests/rocketsim-native-arena-contract.test.mjs`,
  `tests/rocketsim-wasm-combat-alpha-cover.test.mjs`,
  `tests/rocketsim-wasm-combat-alpha-cover-contact.test.mjs`,
  `tests/rocketsim-wasm-mobility-parity.test.mjs` y
  `docs/test-suite-inventory.md`.
- Diseño inicial histórico: `docs/superpowers/specs/2026-11-16-combat-alpha-cover-design.md`.
