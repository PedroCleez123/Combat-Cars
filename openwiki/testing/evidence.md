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
  - id: openwiki-source-54a6756693f62c6588171ee2
    resource: repo://docs/local-server-browser-bridge.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-b6a9dace199270121d821c89
    resource: repo://tests/arena-visual-profile.test.mjs
  - id: openwiki-source-6147aaf47ee7861dcae86c10
    resource: repo://tests/lan-outbound-queue.test.mjs
  - id: openwiki-source-fdc5f25ce4a9ae86bd46d47c
    resource: repo://tests/lan-session-control.test.mjs
  - id: openwiki-source-3424d8f45c206352f1e8ad4f
    resource: repo://tests/lan-session-protocol.test.mjs
  - id: openwiki-source-7caae0236f68c8e56ee8efee
    resource: repo://tests/mob-air-01-browser-playback.test.mjs
  - id: openwiki-source-739a4a0b2067873176a3b006
    resource: repo://tests/rocketsim-arena-profile.test.mjs
  - id: openwiki-source-c8a2a7e26d22bc6a03824489
    resource: repo://tests/rocketsim-combat.test.mjs
  - id: openwiki-source-78b434e28c33acc4be56d041
    resource: repo://tools/lan-session-probe.mjs
generated: { by: "codex", at: "2026-10-16T20:52:30.790Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T21:36:10.526Z
---

# Pruebas y evidencia

## Capas de verificación

La suite Node se ejecuta con `npm test` y reúne 172 pruebas del solver legado,
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

## Arena y combate

Las pruebas de perfil visual comprueban el tema claro de las arenas RocketSim,
la legibilidad del techo y las paredes transparentes, las curvas y los lavados
de combate. Las pruebas de combate cubren objetivo de puntuación, cooldown,
oclusiones por geometría, impacto de vehículo, eliminación y respawn.

La cobertura LAN incluye el contrato de propietario, la allowlist de orígenes
y la cola de salida con backpressure mediante sockets falsos; no sustituye la
prueba viva de dos navegadores, reconexión o presión TCP en el host.

`tests/rocketsim-arena-profile.test.mjs` confirma que `combat-alpha` declara
72 × 54 × 30 unidades y que su modo Three.js resuelve al mismo perfil.
`tests/rocketsim-combat.test.mjs` reproduce el borde que antes desaparecía:
un cohete que rebasa x=62 se mantiene vivo dentro del volumen ampliado.

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
