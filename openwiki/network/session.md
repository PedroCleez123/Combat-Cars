---
type: network
title: Sesión LAN y protocolo
description: Contrato WebSocket para hello, inputs, snapshots, ACK, heartbeat y reconexión.
tags: [network, websocket, lan, protocol]
sources:
  - id: openwiki-source-24082af6d1c2f2f04bbe5750
    resource: repo://server.mjs
  - id: openwiki-source-4c3989ef3101af67d167f4b8
    resource: repo://src/client.js
  - id: openwiki-source-e7b33f5367b97aad22fe9a03
    resource: repo://src/lan-outbound-queue.js
  - id: openwiki-source-be334f6b30aff19bd6f46112
    resource: repo://src/lan-session-control.js
  - id: openwiki-source-5cb866d9e982c8f503df52d2
    resource: repo://src/lan-session-protocol.js
  - id: openwiki-source-ed91f65a5e7a3852eeb9fc5e
    resource: repo://src/rocketsim-practice-match.js
  - id: openwiki-source-78b434e28c33acc4be56d041
    resource: repo://tools/lan-session-probe.mjs
generated: { by: "codex", at: "2026-10-17T08:09:04.647Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-17T10:50:35.429Z
---

# Sesión LAN y protocolo

El protocolo usa `protocolVersion: 1`, una sala y una sesión efímera. El saludo
`hello` debe ser el primer mensaje; valida versión, sala, identificador de
sesión y nombre antes de asignar un coche y devolver `welcome`. El servidor
cierra una conexión que no completa el saludo dentro de cinco segundos.

## Entrada y estado

Los clientes envían frames WebSocket enmascarados de hasta 8192 bytes. Cada
`input` lleva un número de secuencia; el servidor descarta secuencias inválidas,
repetidas o excesivas y solo pasa la última válida a la partida. El tick
autoritativo devuelve un `state` a cada peer e incluye el último número de
entrada aceptado para ACK.

## Vida de la sesión

El cliente manda heartbeat cada cinco segundos. El servidor retira sockets sin
actividad después de veinte segundos. Una reconexión con la misma sesión puede
recuperar la plaza durante cuatro segundos; este mecanismo no es autenticación.
El cliente también vigila la llegada de estados, que tiene un timeout de ocho
segundos independiente del heartbeat, y vuelve a conectar si la simulación se
ha detenido.

## Configuración

`restart` reinicia la partida y `configure` delega en el backend, pero ambas
operaciones requieren que el peer sea el `owner` de la sesión. El primer peer
autenticado recibe ese rol; si se desconecta definitivamente, se reasigna a un
peer autenticado restante. RocketSim permite cambiar la capacidad humana entre
una y seis plazas, no permite bots y rechaza reducir la capacidad por debajo de
los pilotos conectados.

## Origen y salida

Sin una allowlist explícita, el servidor acepta `localhost`, loopback y el
origen HTTP del mismo `Host`, lo que permite abrir el juego desde otra máquina
de la LAN sin convertir cualquier origen en válido. Una allowlist configurada
sustituye esas excepciones. Las respuestas WebSocket se enmarcan en
`src/lan-outbound-queue.js`, se encolan mientras el socket aplica backpressure
y se destruye la conexión al superar `LAN_MAX_BUFFER_BYTES`.

La sonda host-only `tools/lan-session-probe.mjs` valida el contrato completo con
dos peers en una arena JS aislada: rechazo antes de `hello`, owner inicial,
rechazo de control del invitado, transferencia de owner, reconexión dentro de
cuatro segundos y expiración posterior. No depende del bridge RocketSim ni de
la instancia de juego del puerto 5300.

## Fuentes

- `src/lan-session-protocol.js`: constantes, validación y hello.
- `src/lan-session-control.js`: propietario, timeout y reasignación.
- `src/lan-outbound-queue.js`: framing, drenaje y límite de salida.
- `src/lan-client-liveness.js`: vigilancia del estado autoritativo.
- `server.mjs`: recepción WebSocket, sesiones, ACK y heartbeat.
- `PROTOCOL.md`: tabla de mensajes y límites públicos.
