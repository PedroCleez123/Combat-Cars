---
type: testing
title: Pruebas y evidencia
description: Mapa de pruebas, sondas y evidencias reproducibles del juego.
tags: [testing, evidence, probes, browser, rocketsim]
sources:
  - id: openwiki-source-f46671f2edfa061603329b1a
    resource: repo://_bmad-output/implementation-artifacts/lan-harden-02-session-control-story.md
  - id: openwiki-source-da4bd3de86947a180c88d37d
    resource: repo://_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md
  - id: openwiki-source-9ab1339d1f3de2e0aca1ab42
    resource: repo://desktop/main.cjs
  - id: openwiki-source-852c3396a863fa1ee247a682
    resource: repo://docs/continuation-handoff.md
  - id: openwiki-source-54a6756693f62c6588171ee2
    resource: repo://docs/local-server-browser-bridge.md
  - id: openwiki-source-fc02c3893c209c930cbd4c49
    resource: repo://docs/operational-incident-prevention.md
  - id: openwiki-source-faa18db0998ab6247a813ef3
    resource: repo://docs/physics-mobility-tracker.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4c3989ef3101af67d167f4b8
    resource: repo://src/client.js
  - id: openwiki-source-e4cd14f0628c14ca9b892fd9
    resource: repo://src/hitbox-01-browser-observation.js
  - id: openwiki-source-b6a9dace199270121d821c89
    resource: repo://tests/arena-visual-profile.test.mjs
  - id: openwiki-source-6147aaf47ee7861dcae86c10
    resource: repo://tests/lan-outbound-queue.test.mjs
  - id: openwiki-source-7caae0236f68c8e56ee8efee
    resource: repo://tests/mob-air-01-browser-playback.test.mjs
  - id: openwiki-source-739a4a0b2067873176a3b006
    resource: repo://tests/rocketsim-arena-profile.test.mjs
  - id: openwiki-source-c8a2a7e26d22bc6a03824489
    resource: repo://tests/rocketsim-combat.test.mjs
  - id: openwiki-source-78b434e28c33acc4be56d041
    resource: repo://tools/lan-session-probe.mjs
  - id: openwiki-source-bb33773513aa2717f68a7ca0
    resource: repo://tools/live-session-liveness-probe.mjs
  - id: openwiki-source-1e3c6fb4ec187cacb5117885
    resource: repo://tools/live-session-probe.mjs
  - id: openwiki-source-0caa51ce896827d5c4c99cad
    resource: repo://tools/rocketsim-bridge/probe-hitbox-01.mjs
generated: { by: "codex", at: "2026-10-17T10:18:51.966Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-17T10:50:35.429Z
---

# Pruebas y evidencia

## Capas de verificación

La suite Node se ejecuta con `npm test` y reúne 177 pruebas del solver legado,
controles, gamepad, interpolación, cámara, perfiles visuales, alineación del
vehículo, campañas de navegador, bridge, curvas, sesión RocketSim, combate y
vitalidad LAN. Incluye regresiones de frontera HTTP y del registro nominal de
arenas. Los scripts `probe:*` ejercitan contratos nativos o WebSocket y
generan informes JSON en `docs/reference-captures/`.

La evidencia de una sesión debe conservar el contexto que la produjo: build del
bridge, arena, roster, puerto, timestamp y resultado. Un informe de probe no
demuestra por sí solo que la sensación visual sea equivalente; solo valida las
garantías que sus assertions cubren.

## Movilidad aérea

`tests/mob-air-01-browser-playback.test.mjs` comprueba que la campaña mantiene
el primer salto sostenido, libera el input, usa WASD en el segundo salto,
activa air roll y registra recuperación. También verifica que una sesión
compartida, un reinicio no confirmado o snapshots congelados se marquen como
incompletos en lugar de producir una conclusión física.

La historia MOB-AIR-02 exige tres variantes aisladas (frontal, lateral y
diagonal), un único piloto, ACKs monotónicos, snapshots autoritativos y seriales
J/2/D. Solo una discrepancia reproducible abre una corrección del solver.

`tests/hitbox-01-browser-observation.test.mjs` comprueba que HITBOX-01 deriva
el eje arriba del quaternion autoritativo, exige R19 y un piloto, y reconoce el
contacto de carrocería invertida con normal de suelo y `wheelCount=0`. La
campaña libera todos los controles después de observarlo: no endereza el coche
ni sustituye la recuperación que debe ejecutar el jugador. La sonda R19
`npm run probe:rocketsim-hitbox-01` confirma la traza nativa; la ausencia de
penetración visual sigue requiriendo observación en navegador.

## Arena y combate

Las pruebas de perfil visual comprueban el tema claro de las arenas RocketSim,
la legibilidad del techo y las paredes transparentes, las curvas y los lavados
de combate. Las pruebas de combate cubren objetivo de puntuación, cooldown,
oclusiones por geometría, impacto de vehículo, eliminación y respawn.

La cobertura LAN incluye el contrato de propietario, la allowlist de orígenes
y la cola de salida con backpressure mediante sockets falsos. Las sondas del
host validan propietario, rechazo de control, reasignación y reconexión; la
presión TCP sostenida sigue siendo una frontera separada.

`tests/rocketsim-arena-profile.test.mjs` confirma que `combat-alpha` declara
72 × 54 × 30 unidades y que su modo Three.js resuelve al mismo perfil.
`tests/rocketsim-combat.test.mjs` reproduce el borde que antes desaparecía:
un cohete que rebasa x=62 se mantiene vivo dentro del volumen ampliado.

Los fallos de PowerShell, loopback sandbox/host, assets estáticos y portable
NSIS se clasifican como incidencias operativas y se mantienen en
`docs/operational-incident-prevention.md`; no se convierten en cambios de
física sin una traza autoritativa.

La corrección de foco del canvas está cubierta por sintaxis, suite Node y
comprobación HTTP de que el cliente servido contiene los listeners de
`pointerdown` y `visibilitychange`. La interacción visual dentro del navegador
integrado queda `not verified` cuando el motor CUA no puede iniciar; no debe
presentarse como una prueba de teclado satisfactoria.

Las capturas nativas incluyen geometría de arenas curvas, esquinas, rampas,
raycast estático, visibilidad de proyectiles, campañas LAN de dos o seis pilotos
y el probe WebSocket de combate. Los JSON son evidencia histórica; antes de
usar uno como referencia hay que comprobar que corresponde al bridge y contrato
vigentes.

## Regla de interpretación

`accepted` significa que las assertions del artefacto pasaron. `not verified`
significa que faltan roster, snapshots o captura suficiente. `failed` requiere
un error reproducible y una historia acotada. No se debe convertir una métrica
de una build antigua en una constante del solver actual.

## Fuentes

- `package.json`
- `tests/mob-air-01-browser-playback.test.mjs`
- `tests/arena-visual-profile.test.mjs`
- `tests/rocketsim-combat.test.mjs`
- `tests/rocketsim-arena-profile.test.mjs`
- `tests/http-static-boundary.test.mjs`
- `tests/lan-session-control.test.mjs`
- `tests/lan-session-protocol.test.mjs`
- `tests/lan-outbound-queue.test.mjs`
- `docs/reference-captures/`
- `_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md`
