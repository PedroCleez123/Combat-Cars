---
type: operations
title: Operaciones y diagnóstico
description: Arranque R19, variables de entorno y diagnóstico del servidor RocketSim.
tags: [operations, rocketsim, diagnostics, localhost]
sources:
  - id: openwiki-source-23eaf40314eb744a1a2d94e0
    resource: repo://_bmad-output/implementation-artifacts/combat-bounds-01-story.md
  - id: openwiki-source-f46671f2edfa061603329b1a
    resource: repo://_bmad-output/implementation-artifacts/lan-harden-02-session-control-story.md
  - id: openwiki-source-852c3396a863fa1ee247a682
    resource: repo://docs/continuation-handoff.md
  - id: openwiki-source-54a6756693f62c6588171ee2
    resource: repo://docs/local-server-browser-bridge.md
  - id: openwiki-source-fc02c3893c209c930cbd4c49
    resource: repo://docs/operational-incident-prevention.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-24082af6d1c2f2f04bbe5750
    resource: repo://server.mjs
  - id: openwiki-source-4c3989ef3101af67d167f4b8
    resource: repo://src/client.js
  - id: openwiki-source-e4cd14f0628c14ca9b892fd9
    resource: repo://src/hitbox-01-browser-observation.js
  - id: openwiki-source-bfe26ac32051893068e960ee
    resource: repo://src/rocketsim-backend.js
  - id: openwiki-source-6147aaf47ee7861dcae86c10
    resource: repo://tests/lan-outbound-queue.test.mjs
  - id: openwiki-source-fdc5f25ce4a9ae86bd46d47c
    resource: repo://tests/lan-session-control.test.mjs
  - id: openwiki-source-3424d8f45c206352f1e8ad4f
    resource: repo://tests/lan-session-protocol.test.mjs
  - id: openwiki-source-b8683c98010c7eb67003515b
    resource: repo://tools/lan-http-probe.mjs
  - id: openwiki-source-78b434e28c33acc4be56d041
    resource: repo://tools/lan-session-probe.mjs
  - id: openwiki-source-a4d6da0f7e78863b3c2f4ee9
    resource: repo://tools/lan-websocket-probe.mjs
  - id: openwiki-source-bb33773513aa2717f68a7ca0
    resource: repo://tools/live-session-liveness-probe.mjs
  - id: openwiki-source-1e3c6fb4ec187cacb5117885
    resource: repo://tools/live-session-probe.mjs
  - id: openwiki-source-0caa51ce896827d5c4c99cad
    resource: repo://tools/rocketsim-bridge/probe-hitbox-01.mjs
  - id: openwiki-source-d96abcae97f0c3a3e4d264c8
    resource: repo://tools/start-rocketsim-combat-watch.ps1
  - id: openwiki-source-18c57645744fd6a6b846587c
    resource: repo://tools/verify-desktop-package.mjs
generated: { by: "codex", at: "2026-10-17T10:18:51.966Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-17T10:18:51.966Z
---

# Operaciones y diagnóstico

## Arranque recomendado

El lanzador `tools/start-rocketsim-combat-watch.ps1` fija la build R19, activa
el backend `rocketsim`, el modo `combat`, la arena `combat-alpha`, el timeout de
petición de 500 ms y el puerto 5300. Después delega en `npm run start:watch`,
que reinicia `server.mjs` cuando cambian módulos Node. Los cambios de cliente
requieren recargar la pestaña con Ctrl+F5.

Para una ejecución manual, hay que establecer `ROCKETSIM_BRIDGE_EXE` a un
ejecutable existente y mantener coherentes `MOVEMENT_BACKEND`, `ROCKETSIM_MODE`,
`ROCKETSIM_ARENA`, `ROCKETSIM_REQUEST_TIMEOUT_MS` y `PORT`. El servidor valida
el backend, modo y ruta antes de crear la partida.

## Verificación de la unidad actual

`npm test` incluye las regresiones de combate, LAN y HITBOX-01 y termina con
177 pruebas correctas. Las sondas de integración se ejecutan en el host PowerShell; el
sandbox no comparte esa red de procesos.

La unidad `LAN-HARDEN-02` está cubierta por pruebas de propietario, origen y
cola de salida. La sonda host-only también acepta el handshake de dos peers,
transferencia de owner y reconexión/expiración en una arena JS aislada.

`npm run probe:lan-session`, ejecutado en el PowerShell del host, arranca un
servidor JavaScript aislado y comprueba rechazo antes de `hello`, propietario
inicial, rechazo de `restart` de un invitado, reasignación del propietario y
reconexión dentro/fuera del periodo de gracia. La ejecución host-only evita la
frontera loopback del sandbox y no toca la instancia RocketSim del puerto 5300.

`npm run probe:lan-http` arranca una instancia JS aislada, verifica 200 para el
entrypoint, el cliente y `three.core.js`, comprueba `nosniff` y exige 404 para
internals y traversal. Así `LAN-HARDEN-01` queda comprobada en host.

`npm run probe:lan-websocket` prueba el servidor que ya está escuchando en
5300 y devuelve JSON con `ok`, `timeout`, `connection-error` o `server-error`.
Es preferible a pegar `node -e` con comillas anidadas en PowerShell, porque el
shell puede eliminar esas comillas antes de que Node reciba el programa.

Después de generar el portable, `npm run verify:desktop-package` calcula su
SHA-256, inspecciona los módulos críticos de `app.asar` y valida la integridad
NSIS con `7za.exe`. El portable no debe modificarse manualmente.

## Incidencias conocidas y agencia del jugador

Los diagnósticos de PowerShell usan sondas versionadas para evitar que las
comillas de `node -e` se pierdan. La diferencia entre el loopback del sandbox y
el del host está documentada en la guía local; un timeout de esa frontera no es
un fallo de física. Una salida incompleta de electron-builder (`EBUSY`, asar
ausente o `.nsis.7z` vacío) se descarta y se reconstruye en una carpeta limpia,
validando portable y asar de la misma salida antes de publicar el hash.

Si el navegador externo acepta WASD pero el navegador integrado solo muestra la
partida, clasificar primero el incidente como foco del host: hacer `Ctrl+F5` y
clic en el área 3D. `client.js` vuelve a enfocar el canvas en ese clic y al
recuperar visibilidad. Si el externo sigue funcionando y el integrado no
entrega eventos después de ese paso, la limitación está en el contenedor de
navegación, no en RocketSim, WebSocket ni en el solver.

En `?hitbox01=1`, R19 puede publicar contacto de carrocería invertida con
`wheelCount=0` y `grounded=false`. La campaña libera los controles al detectarlo:
no aplica auto-upright ni una recuperación asistida. Enderezar, saltar o hacer
air-roll después de quedar boca abajo corresponde al jugador.

## Diagnóstico del bridge

`RocketSimBridge` inicia el proceso nativo con stdin/stdout por líneas y espera
un frame `ready` que coincida con el esquema, frecuencia fija, arena y conjunto
de IDs solicitado. Si el ejecutable no existe, el backend no puede iniciarse.

Cada petición tiene timeout; al vencer, el backend incluye el stderr reciente,
rechaza las peticiones pendientes y termina el proceso nativo. Un mensaje de
salida prematura o un frame que no coincide con la alineación solicitada produce
un error explícito. Esto permite distinguir ruta inválida, bridge que no arranca,
timeout y contrato de roster incorrecto.

## Errores frecuentes

- `MOVEMENT_BACKEND=rocketsim requiere ROCKETSIM_BRIDGE_EXE válido`: comprobar
  que la ruta apunta a `rocketsim_bridge-r19.exe` y que se ejecuta desde la raíz.
- `RocketSim bridge request timed out`: revisar que la build nativa esté lista,
  aumentar temporalmente `ROCKETSIM_REQUEST_TIMEOUT_MS` y conservar el stderr
  para diagnosticar; no mezclar una build antigua con el renderer R19.
- `ready frame does not expose the requested car IDs`: la configuración de
  jugadores no coincide con la alineación que el bridge anunció; corregir la
  arena o el límite de vehículos antes de continuar.
- Puerto ocupado: cerrar la instancia anterior o elegir otro `PORT`; no arrancar
  varios watchers sobre el mismo puerto.

## Fuentes

- `tools/start-rocketsim-combat-watch.ps1`
- `server.mjs`
- `src/rocketsim-backend.js`
- `package.json`
