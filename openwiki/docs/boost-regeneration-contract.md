---
type: "Referencia"
title: "Contrato de regeneración de nitro"
openwiki_generated: true
sources:
  - id: openwiki-source-c93ff2da560ad1809a70fa1d
    resource: repo://_bmad-output/current-roadmap.md
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-19b2666a4999cd823e6ce490
    resource: repo://docs/test-suite-inventory.md
  - id: openwiki-source-cc30a766581af8f8f4d3dfd7
    resource: repo://src/combat-alpha-map.js
  - id: openwiki-source-d92188a599e0f7a8009604f6
    resource: repo://src/online-full-presentation-state.js
  - id: openwiki-source-b1ad534c751c1538123c1f8f
    resource: repo://src/p2p-multiplayer-presentation-state.js
  - id: openwiki-source-76815b11dc1cf4e174fab6aa
    resource: repo://src/rocketsim-boost-regeneration.js
  - id: openwiki-source-ed91f65a5e7a3852eeb9fc5e
    resource: repo://src/rocketsim-practice-match.js
  - id: openwiki-source-b04459ad10d4a78a45828571
    resource: repo://tests/online-full-presentation-state.test.mjs
  - id: openwiki-source-245054a3250acab0b538c0eb
    resource: repo://tests/rocketsim-boost-regeneration.test.mjs
  - id: openwiki-source-4f2df8323725ba870ef0b903
    resource: repo://tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs
  - id: openwiki-source-4054247b34f75e84088542b8
    resource: repo://tools/wasm-spike/wrapper.cpp
generated: { by: "codex", at: "2026-11-18T08:37:57.448Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-11-18T08:37:57.448Z
---
# Contrato de regeneración de nitro

## Alcance

Combat Cars mantiene `Pages → Worker de señalización → WebRTC P2P` y ejecuta
RocketSim WASM autoritativo en el host. El valor del nitro de combate procede
de esa autoridad. El lobby y la práctica offline conservan nitro infinito.

## Regla de regeneración

La simulación de combate trabaja a 120 Hz:

```text
retardo tras el último consumo real: 240 ticks = 2,0 s
grado de llenado acelerado: 50 → 150 unidades/s en 120 ticks
```

Después de cada paso de RocketSim se compara el nitro antes y después. Solo una
disminución real activa o reinicia el retardo. Al terminar, la tasa crece
linealmente desde 50 hasta 150 unidades/s durante un segundo, lo que regenera
hasta 100 unidades en ese segundo si se parte de cero. Si el jugador vuelve a
consumir nitro durante la regeneración, el retraso empieza de nuevo. El valor
se limita a 100 y el tanque lleno no mantiene un contador pendiente.

El HUD presenta el valor autoritativo; la predicción visual o el estado del
cliente no modifica el recurso. La implementación compartida de referencia
está en `src/rocketsim-boost-regeneration.js`, sus pruebas en
`tests/rocketsim-boost-regeneration.test.mjs` y la integración de combate WASM
en `tools/wasm-spike/wrapper.cpp`.

## Pickups

El mapa público `combat-alpha` publica `pickups: []`; el combate mantiene
`pads: []` y `rules.pads: false`. No hay pickups de suelo activos. La tabla
histórica de 88 ubicaciones permanece comentada y no crea objetos runtime. El
lobby y la práctica conservan `unlimitedBoost: true`. Las coberturas COV son
obstáculos separados del recurso de nitro.

## Verificación y estado

La prueba determinista valida el retardo, el llenado acelerado, la reanudación
del consumo, el límite de 100 y el nitro infinito del lobby. La verificación de
presentación confirma que el combate no depende de pads para mostrar el HUD.

No se publican aquí conteos de ejecución que cambian con el checkout. Los
conteos históricos 650/9 y 589/7 fueron retirados del roadmap por no contar con
una ejecución durable asociada. La CI contiene gates de contrato, assets,
presentación online, contacto/raycast y movilidad; además ejecuta liveness por
loopback, contratos ONLINE-QA/LIFECYCLE, audio causal y la traza causal de
combate. La versión actual del workflow pasó en la ejecución remota
[44203023348](https://github.com/PedroCleez123/Combat-Cars/actions/runs/44203023348)
del commit `2c6a505`. La aceptación humana COV en local/P2P sigue siendo una
puerta separada. Esa ejecución valida el workflow y la reconstrucción de WASM;
no desplegó Pages. La publicación de Pages es una acción independiente.

## Referencias

- `src/rocketsim-boost-regeneration.js`
- `src/combat-alpha-map.js`
- `tools/wasm-spike/wrapper.cpp`
- `tests/rocketsim-boost-regeneration.test.mjs`
- `tests/online-full-presentation-state.test.mjs`
- `docs/test-suite-inventory.md`
- `_bmad-output/current-roadmap.md`
