---
type: client
title: Cliente, cámara y controles
description: Presentación Three.js de snapshots autoritativos, controles unificados, cámara de persecución y HUD.
tags: [client, camera, controls, threejs]
sources:
  - id: openwiki-source-8dd35fdff2b3211f8978962f
    resource: repo://_bmad-output/implementation-artifacts/hitbox-01-visual-pivot-story.md
  - id: openwiki-source-54a6756693f62c6588171ee2
    resource: repo://docs/local-server-browser-bridge.md
  - id: openwiki-source-4c3989ef3101af67d167f4b8
    resource: repo://src/client.js
  - id: openwiki-source-4917001f2b43a164ea0117c9
    resource: repo://src/control-mapping.js
  - id: openwiki-source-5af9f27f776567d7d3b05a59
    resource: repo://src/gamepad-input.js
  - id: openwiki-source-e4cd14f0628c14ca9b892fd9
    resource: repo://src/hitbox-01-browser-observation.js
  - id: openwiki-source-aedc96b9dd22a156c5a1349e
    resource: repo://src/lan-client-liveness.js
  - id: openwiki-source-e8234c4d5cfb74d2788b408a
    resource: repo://src/rocketsim-arena-profile.js
  - id: openwiki-source-ea70ee0e8d5788455e7409e5
    resource: repo://src/snapshot-interpolation.js
  - id: openwiki-source-b9cdd59cb60c42d053ca0423
    resource: repo://src/vehicle-visual-alignment.js
  - id: openwiki-source-66effc9b45839f69daeeccc3
    resource: repo://tests/hitbox-01-browser-observation.test.mjs
generated: { by: "codex", at: "2026-10-17T10:18:51.966Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-17T10:50:35.429Z
---

# Cliente, cámara y controles

El cliente Three.js presenta snapshots del servidor; no integra física local ni
envía poses. Mantiene un buffer corto de estados y renderiza una muestra
interpolada para reducir el salto entre snapshots sin extrapolar un vehículo
cuando la red se detiene.

## Controles

Teclado, ratón y mando estándar se convierten al mismo contrato semántico. El
teclado se puede reasignar y se guarda en `localStorage`. En mando, el stick
izquierdo dirige, RT/LT controlan aceleración y freno, A salta, RB usa nitro,
LB activa derrape o free air roll, X/B son air rolls direccionales y el D-pad
arriba dispara. Las fuentes se combinan antes de generar el frame de entrada.

El canvas reclama foco explícitamente al recibir `pointerdown` y al volver la
pestaña a primer plano, siempre que el foco actual no sea un control editable.
Esto evita que el navegador integrado conserve el teclado en su contenedor; tras
un `Ctrl+F5`, hay que hacer clic una vez en el área 3D antes de conducir.

En la campaña `?hitbox01=1`, el guion solo automatiza la observación inicial.
Después del contacto de carrocería invertida, o si la sesión es compartida,
terminal o no soportada por la build, se devuelve la entrada manual del jugador.
La campaña nunca aplica auto-upright.

## Cámara

La cámara conserva el horizonte: el chasis puede tener pitch y roll completos,
pero el seguimiento usa un rumbo horizontal amortiguado. Reinicia su estado al
cambiar de vehículo o reaparecer, limita la posición dentro de la arena activa,
evita coberturas y otros coches y amplía suavemente el FOV con la velocidad.

## Arena visual

Al cambiar `settings.practiceArena`, `client.js` resuelve el modo visual en
`src/rocketsim-arena-profile.js`. Así, ancho, profundidad, altura, radio de
curva y esquinas de la piel Three.js siguen el perfil nominal de Node. Esta
tabla de presentación no sustituye al bridge: las colisiones y el raycast
estático continúan siendo autoritativos en RocketSim.

La raíz visual del vehículo se coloca en el pivote publicado por RocketSim y la
malla provisional recibe una alineación y escala separadas. Esto conserva el
plano de ruedas en reposo y el plano de contacto superior al invertir el coche;
la observación visual boca abajo de `HITBOX-01` sigue pendiente y no se infiere
como aceptación a partir de la prueba geométrica.

## Red y HUD

El cliente abre un WebSocket al mismo host, envía `hello`, heartbeats y entradas
hasta 60 Hz. Cada snapshot actualiza el ACK de input, el modo visual de arena,
la interpolación y los paneles. El HUD presenta integridad, nitro, velocidad,
saltos, estados aéreos de calibración, ACK y eventos autoritativos.

## Fuentes

- `src/client.js`: ciclo de render, WebSocket, cámara, HUD y bindings.
- `src/control-mapping.js`: contrato unificado de entrada.
- `src/gamepad-input.js`: adaptador XInput/Gamepad API.
- `src/snapshot-interpolation.js`: interpolación exclusivamente visual.
