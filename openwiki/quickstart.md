---
type: guide
title: Inicio rápido
description: Arranque del servidor de combate RocketSim R19 y acceso al cliente web.
tags: [quickstart, localhost, rocketsim, lan]
sources:
  - id: openwiki-source-54a6756693f62c6588171ee2
    resource: repo://docs/local-server-browser-bridge.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-24082af6d1c2f2f04bbe5750
    resource: repo://server.mjs
  - id: openwiki-source-23eea40248129ac5dd5a8cfb
    resource: repo://src/http-static-boundary.js
  - id: openwiki-source-be334f6b30aff19bd6f46112
    resource: repo://src/lan-session-control.js
  - id: openwiki-source-5cb866d9e982c8f503df52d2
    resource: repo://src/lan-session-protocol.js
  - id: openwiki-source-ed91f65a5e7a3852eeb9fc5e
    resource: repo://src/rocketsim-practice-match.js
  - id: openwiki-source-d96abcae97f0c3a3e4d264c8
    resource: repo://tools/start-rocketsim-combat-watch.ps1
generated: { by: "codex", at: "2026-10-16T20:52:30.790Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-16T21:36:10.526Z
---

# Inicio rápido

## Ruta recomendada

Desde la raíz del repositorio, ejecutar `npm run start:watch:combat`. El
lanzador prepara el bridge R19, activa `MOVEMENT_BACKEND=rocketsim`, fija el
modo `combat`, la arena `combat-alpha`, el timeout y el puerto 5300. Después
abrir `http://localhost:5300/?arena=combat-alpha`.

El watcher mantiene el servidor durante el desarrollo: los cambios de módulos
Node reinician `server.mjs`; los cambios de `src/client.js` solo requieren
Ctrl+F5. Hay que mantener una única instancia por puerto y detener con Ctrl+C
la instancia anterior antes de arrancar otra.

El servidor HTTP limita los recursos publicados a la aplicación y sus módulos
de cliente; el código del servidor, la documentación interna, las herramientas
y las rutas de traversal no forman parte de la superficie pública.

## Sesión LAN

Se puede abrir la misma URL en otros navegadores de la máquina o de la LAN para
unirse a la sala. El panel permite elegir la capacidad humana entre uno y seis;
el modo RocketSim de combate no añade bots implícitamente. La sesión sigue
siendo LAN de desarrollo y no debe presentarse como despliegue online. El
primer peer autenticado es el `owner` y controla `restart`/`configure`; una
allowlist de orígenes puede fijarse con `LAN_ALLOWED_ORIGINS`. La cobertura
unitaria de este flujo está verde, pero el handshake de dos navegadores y la
reconexión todavía deben comprobarse en el host.

## Ruta manual

Si se necesita configurar el entorno a mano, `ROCKETSIM_BRIDGE_EXE` debe
resolver a `.rocketsim-bridge-build-r9/rocketsim_bridge-r19.exe`, junto con
`MOVEMENT_BACKEND=rocketsim`, `ROCKETSIM_MODE=combat` y `PORT` disponible.
`npm start` o `npm run start:watch` usan esas variables. Sin ellas, el servidor
arranca el backend JavaScript normal.

## Fuentes activas

- `README.md`
- `tools/start-rocketsim-combat-watch.ps1`
- `server.mjs`
- `docs/README.md`
- `openwiki/INSTRUCTIONS.md`
