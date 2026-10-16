---
type: architecture
title: Arquitectura y autoridad
description: Flujo autoritativo entre servidor Node, simulación JavaScript o RocketSim y cliente Three.js.
tags: [architecture, authority, runtime, rocketsim]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T21:36:10.526Z
sources:
  - id: openwiki-source-24082af6d1c2f2f04bbe5750
    resource: repo://server.mjs
  - id: openwiki-source-e7b33f5367b97aad22fe9a03
    resource: repo://src/lan-outbound-queue.js
  - id: openwiki-source-be334f6b30aff19bd6f46112
    resource: repo://src/lan-session-control.js
  - id: openwiki-source-bfe26ac32051893068e960ee
    resource: repo://src/rocketsim-backend.js
  - id: openwiki-source-26f56283d037418651d142bb
    resource: repo://src/rocketsim-protocol.js
generated: { by: "codex", at: "2026-10-16T20:52:30.790Z" }
---

# Arquitectura y autoridad

El servidor Node es el punto de entrada del runtime. Selecciona el backend a
partir de `MOVEMENT_BACKEND`: por defecto crea `ArenaMatch` con el perfil de
calibración; con `rocketsim` valida el ejecutable nativo, el perfil de arena y
el modo `practice` o `combat`, crea `RocketSimPracticeMatch` y espera a que el
bridge esté listo antes de abrir el servidor HTTP/WebSocket.

## Flujo de una partida

El cliente solo envía `hello`, entradas, reinicio, configuración y heartbeat.
El servidor asigna la plaza humana, conserva la identidad de sesión y pasa las
entradas aceptadas a la partida. Un temporizador de 60 Hz llama a `match.tick`,
publica el snapshot autoritativo a cada peer y devuelve el último número de
entrada aceptado para que el cliente pueda medir ACK.

En el backend RocketSim, `RocketSimPracticeMatch` convierte las entradas a la
forma del protocolo, mantiene el roster humano y ejecuta dos pasos fijos de
120 Hz por snapshot. `RocketSimBridge` es el único proceso que cruza la frontera
con el ejecutable nativo: envía JSONL por stdin, valida el frame `ready` y
normaliza estados, poses, contactos, saltos y velocidades que vuelven por
stdout.

## Autoridad y presentación

La posición, velocidad, orientación, contactos, saltos, boost, daño, respawn y
puntuación no llegan desde el navegador como estado confiable. El cliente
Three.js interpola snapshots y presenta la escena, cámara, HUD, cohetes y
efectos. Una corrección visual no puede sustituir una decisión del solver ni
autorizar una posición o un daño.

La autoridad de sesión también permanece en el servidor: el primer peer
autenticado recibe el rol `owner`, que es necesario para `restart` y
`configure`; si abandona definitivamente, el servidor puede reasignarlo a un
peer autenticado restante. La salida WebSocket usa una cola acotada con
backpressure y cierra el socket si el cliente no drena, evitando crecimiento
indefinido de memoria.

## Fallos y recuperación

El servidor evita ticks solapados. Si un `match.tick` falla, marca el runtime,
avisa a los peers e intenta reiniciar la partida hasta tres veces con una pausa
creciente. Si las recuperaciones fallan, comunica que hay que reiniciar el
servidor. Al cerrar, detiene los temporizadores y solicita el apagado limpio del
bridge.

## Fuentes

- `server.mjs`: selección de backend, WebSocket, tick y recuperación.
- `src/simulation.js`: contrato de `ArenaMatch` y solver JavaScript.
- `src/rocketsim-practice-match.js`: adaptación de roster, escala y snapshots.
- `src/rocketsim-backend.js`: ciclo de vida y frontera JSONL del bridge.
- `src/rocketsim-protocol.js`: validación de frames y límites de IDs.
