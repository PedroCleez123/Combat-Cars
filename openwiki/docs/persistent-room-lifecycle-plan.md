---
type: "Referencia"
title: "Plan de salas persistentes y reconexión"
openwiki_generated: true
sources:
  - id: openwiki-source-c93ff2da560ad1809a70fa1d
    resource: repo://_bmad-output/current-roadmap.md
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-545f909016bc19b88d35ec7e
    resource: repo://cloudflare/arsenal-signal-worker.mjs
  - id: openwiki-source-19b2666a4999cd823e6ce490
    resource: repo://docs/test-suite-inventory.md
  - id: openwiki-source-1dce02795d6da692a9132ab3
    resource: repo://p2p-multiplayer.html
  - id: openwiki-source-35fef6cdcab329adf1b5a17f
    resource: repo://PROTOCOL.md
  - id: openwiki-source-23cc9889e1f740ab16976fdd
    resource: repo://src/p2p-guest-connection-recovery.js
  - id: openwiki-source-1619db1aa301fce77d5dbb15
    resource: repo://src/p2p-multiparty-signaling-client.js
  - id: openwiki-source-8dd0284c4548b6102c2c3ab8
    resource: repo://src/p2p-multiparty-signaling.js
  - id: openwiki-source-26261d4f8c8c4f55f7568e81
    resource: repo://src/p2p-multiplayer-entry.js
  - id: openwiki-source-d226f7827bf071b39c4a21c9
    resource: repo://src/p2p-multiplayer-lobby.js
  - id: openwiki-source-17ff0bf85616107958536319
    resource: repo://src/p2p-multiplayer-webrtc.js
  - id: openwiki-source-75ebd2969415b8a53fa76f1c
    resource: repo://src/p2p-persistent-room-storage.js
  - id: openwiki-source-009110b057f23ce3ca1a5cc6
    resource: repo://tests/cloudflare-signal-room.test.mjs
  - id: openwiki-source-bd8206e61e0836c8e591fdec
    resource: repo://tests/p2p-guest-connection-recovery.test.mjs
  - id: openwiki-source-1de7dd1cd49c57c4d7cf14d4
    resource: repo://tests/p2p-multiplayer-desktop-controls.test.mjs
  - id: openwiki-source-42ac7e21ae064589fa003ef6
    resource: repo://tests/p2p-multiplayer-webrtc.test.mjs
  - id: openwiki-source-252efcf37805c1b399349123
    resource: repo://tools/wasm-spike/p2p-wasm-multiplayer-lobby-channel.mjs
  - id: openwiki-source-5d800ea2c881a8626143d2c7
    resource: repo://tools/wasm-spike/p2p-wasm-multiplayer-lobby-host.mjs
  - id: openwiki-source-518363250e9dd0cf8ead827a
    resource: repo://tools/wasm-spike/wasm-build-provenance.json
generated: { by: "codex", at: "2026-11-17T23:22:26.244Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-11-17T23:26:08.247Z
---

# Plan de salas persistentes y reconexión

> **Combat Cars** tiene como producto principal la ruta online WASM
> `Pages → Worker → WebRTC P2P → RocketSim WASM en el host`. La ruta Node con
> RocketSim nativo se mantiene solo como referencia y diagnóstico.
>
> El contrato descrito aquí refleja el código actual. Cada navegador recibe
> una sala personal con retención limitada al entrar; esa sala sirve como arena
> compartida de espera sin PvP antes de que el host inicie una ronda. PR3a está
> implementado; quedan pendientes su validación manual durante `playing` y
> PR3b (pruebas adversariales de epoch). El plan de diseño PR0–PR3 en `docs/`
> es histórico y no define por sí solo el estado vigente.

## Contrato de producto

La clave corta identifica una sala, no una cuenta ni un secreto. El propietario
guarda una credencial opaca por origen y cada invitado persistente usa su propio
ticket para recuperar su plaza. El registro dura siete días y la gracia de un
ticket es diez minutos. Al borrar el almacenamiento local no se promete
recuperación entre dispositivos.

```text
room-open (arena compartida, sin PvP) -> team-selection -> starting -> playing
```

En `room-open` los coches del host y de los invitados ya existen en el mismo
lobby RocketSim: hay nitro infinito, colisiones y límites físicos, pero no
combat, kills, respawn ni marcador. El host puede configurar `1v1`, `2v2`,
`3v3` o `ffa` varias veces antes de iniciar; los jugadores pueden cambiar o
quitar su equipo. El flujo personal mantiene sus seis plazas señalizables y la
configuración no cambia la clave.

## Flujo de cliente

La entrada crea o restaura automáticamente la sala personal y muestra su clave;
no hay acción normal de **Crear sala**. Introducir otra clave suspende la sala
propia sin borrar su credencial. El menú y el lobby permiten volver a ella con
la misma clave, incluso después de una partida ajena. Una invitación profunda
sigue el mismo orden: primero asegura la identidad personal y después entra a
la sala invitada.

El Durable Object conserva slots, tickets, `joinOrder` y `hostEpoch`. Si el
host se desconecta, asciende al invitado conectado más antiguo, rota su hash de
guest y conserva la misma clave. El cliente reconstruye una autoridad de lobby
RocketSim sin combate; no se presenta como reanudada ninguna ronda cuya física
se perdió con el host.

## Hitos

- **PR1/PR1b — persistencia y rejoin:** completado; registro de siete días,
  tickets por participante, gracia de diez minutos, slots estables y migración
  determinista de host.
- **PR2 — fases y comienzo:** completado; `room-open`, configuración autorizada
  y transición controlada a la ronda.
- **PR2b — sala personal física:** completado; clave automática, espera
  jugable sin PvP, cambio repetible de modo/equipo y retorno a la propia sala.
- **PR2d — recuperación de invitado:** completado; reintentos acotados de la
  misma plaza, ventana de elección de host y protección ante callbacks de una
  conexión anterior.
- **PR2e — promoción limpia y reentrada:** completado; promoción a una sala
  `room-open` sin modo/equipos y sesiones dinámicas para pilotos posteriores.
- **PR2g — entrada canónica y bootstrap visible:** completado; el hostname con
  punto final se redirige antes de iniciar P2P, la sala personal aparece desde
  el arranque y la UI ofrece reintento si falla la creación/restauración.
- **PR3a — recuperación durante `playing`:** implementada; el host neutraliza y
  reserva el slot que perdió transporte, y el invitado puede reintentar su
  plaza con el ticket persistente. La validación manual de esta ruta queda
  pendiente.
- **PR3b — tolerancia adversarial:** pendiente; ampliar las pruebas de epochs,
  eventos tardíos y recuperación bajo interrupciones repetidas.

La simulación continúa siendo autoritativa en el host WASM; el Worker solo
señaliza y conserva metadatos de sala. La ruta local nativa no sustituye esa
autoridad. El estado aceptado es **P2P online funcional**. El último run remoto
registrado, `44176984795` sobre `ea7c772`, pasó suite, Pages y reconstrucción
WASM; certifica ese commit y el workflow de entonces. El workflow local actual
añade liveness por loopback, contratos ONLINE-QA/LIFECYCLE, audio causal y traza
causal de combate; sus cinco comandos pasaron localmente el 18/11/2026, pero
requieren un nuevo run remoto. Los conteos 589/7 y el paquete de 101 archivos
son instantáneas históricas, no el estado vigente. La compilación limpia actual
reproduce por SHA-256 los artefactos WASM fijados en provenance; la fecha del
directorio incremental no basta para clasificarlos como obsoletos. La QA humana
de modos/navegadores/redes y la conectividad universal entre NAT/firewalls
siguen pendientes; COV-04/06 también conserva comprobaciones humanas de cohetes,
contactos y rendimiento antes de publicar esas mejoras.

PR3a sí existe en el código: durante `playing`, el host marca neutral y
reemplaza la plaza desconectada, y el invitado reintenta usando su identidad y
ticket, conservando localmente el roster para reconstruir su estado de cliente.
Esto no es una garantía de reconexión bajo toda interrupción: la observación
manual y las pruebas adversariales PR3b siguen abiertas. Si se pierde el host,
la promoción conserva la sala pero reinicia la fase a `room-open`; no se reanuda
la simulación de la partida anterior.

## Recuperación de unión y promoción

Un error o cierre de WebRTC durante `room-open` o `team-selection` no devuelve
al invitado a la práctica local. El cliente conserva `roomCode`,
`participantId` y `reconnectToken`, cierra el transporte parcial sin anunciar
una salida voluntaria y solicita de nuevo su misma plaza. La política tiene tres
intentos, con retardos de 500 ms, 1,5 s y 3 s; cuando se pierde el canal del
host, espera primero 1,5 s para recibir el resultado de la elección de host.

El contador `guestConnectionEpoch` invalida eventos tardíos de sockets, canales
o estrellas WebRTC ya reemplazados. Si la elección asciende a ese invitado, su
cliente conserva el código de sala, pasa a `host`, libera su antiguo
`guestSlot` y persiste esa sala compartida como su sala personal. Por ello la
interfaz no ofrece **Volver a mi sala personal** tras la promoción: ya está en
ella. Si los tres intentos no conectan, la sala y el ticket siguen guardados y
la interfaz propone pulsar **Unirse** de nuevo.

La recuperación de una partida ya iniciada no forma parte de PR2d: una ronda
cuya autoridad física se ha perdido conserva el comportamiento de terminar y
volver a práctica; PR3 definirá ese protocolo por separado. Las pruebas de
recuperación cubren la secuencia acotada de reintentos, la cancelación al
recibir promoción y el contrato de UI/persistencia del host promovido. Firefox
y dos redes físicas son validación manual externa pendiente.

## Entrada canónica y bootstrap visible (PR2g)

`https://combat-cars.pages.dev.` es un origen distinto de
`https://combat-cars.pages.dev`. La preflight del Worker de señalización solo
permite el origen canónico, por lo que el juego podía abrir la práctica local
sin crear la sala personal ni mostrar su clave. La página detecta el hostname
con punto final y redirige a la URL canónica antes de cargar el módulo P2P; no
se amplía la allowlist CORS.

La entrada también muestra el panel de sala desde el primer frame con
`Preparando tu sala personal`. Mientras responde el Worker, oculta los
controles que dependen de una sala válida; si falla, muestra `Sin conexión a
salas` y `Reintentar mi sala personal`. Al completar el bootstrap aparecen la
clave persistente, el selector de modo sin selección inicial y los equipos.

Los contratos de entrada, frontera estática, Pages y fallback visual quedaron
verificados **21/21** en PR2g; esa cifra es histórica. El producto P2P está
publicado en `https://combat-cars.pages.dev/` (sin punto final). El número de
archivos del paquete depende del checkout; consulta el roadmap para la última
evidencia fechada y repite la build/verificación después de cada cambio:

```text
npm run build:pages-beta
npm run verify:pages-beta
npm run deploy:pages-beta
```

La redirección desde el hostname con punto final y el reintento frente a una
caída temporal del Worker siguen siendo comprobaciones manuales específicas
en Firefox.

## Promoción limpia y nuevas plazas

La promoción no conserva la configuración de la ronda perdida. Con la misma
clave y el host sucesor ya autenticado, el Durable Object vuelve la sala a
`room-open`, `mode: null` y seis plazas. El cliente limpia los equipos de los
pilotos supervivientes, restablece el selector a **Sin modo seleccionado** y
reconstruye un lobby RocketSim sin combate. El selector conserva una nueva
elección local hasta que el host la confirma; no se resetea durante los
snapshots del lobby.

La estrella WebRTC del sucesor ya no conoce solamente las plazas que existían
en el instante de la promoción. Al recibir un `peer-ready` de una plaza nueva,
crea su sesión, inicia la oferta y la añade a la estrella. Esto permite que un
tercer navegador se una por la misma clave después de que se haya marchado el
host original.

La evidencia histórica de PR2e incluyó contratos de Worker, cliente y WebRTC. En
Chromium se observó entonces el cierre del host de una partida, la promoción sin
modo/equipos, la recarga del sucesor y una nueva unión a la misma clave hasta
`2/6 pilotos`, sin errores de consola. Esa ejecución no valida la build actual ni
sustituye la comprobación manual en Firefox, otros navegadores y redes físicas.

## Recuperación de la sala personal al perder el ownership (PR2i)

El navegador que era host no debe quedarse unido a la sala transferida cuando
otro participante asciende a host. El cliente clasifica las respuestas del
Worker `403` como `room-not-owner` y las `410` como `room-expired`; `hostRoom()`
borra la credencial de esa sala compartida, vuelve a práctica offline y crea una
nueva sala personal persistente. La nueva clave se guarda antes de abrir el
lobby, por lo que el navegador vuelve al mismo estado inicial y puede recibir
invitados sin intervención adicional.

La recuperación también se engancha a `error` y `closed` de la conexión de
host. Un guard de identidad ignora callbacks de clientes sustituidos, la
recuperación es idempotente mientras está en curso y `beforeunload` la desactiva
durante recargas o navegación. Así, cerrar la pestaña no rota una sala válida
ni permite que una conexión antigua cree una segunda sala accidental.

PR2i tiene contratos automatizados para descartar una credencial de propietario obsoleta, crear otra sala personal y conservar la sala compartida bajo el host promocionado. El roadmap retiró los conteos agregados antiguos porque no correspondían a una ejecución durable del checkout actual. P2P online es el estado funcional aceptado; el estado de publicación de un cambio concreto debe comprobarse mediante evidencia de deploy, no inferirse de este árbol de trabajo. Esta revisión no despliega Pages. La QA humana en varios navegadores, modos y redes —en especial NAT/firewalls restrictivos— sigue pendiente, al igual que la validación manual COV local/P2P.

El roadmap registra además que, en la revisión local del working tree del
17/11/2026, pasaron la suite y las verificaciones/build de contrato, assets,
WASM y Pages. En esta revisión, los cinco comandos dedicados añadidos al
workflow también pasaron individualmente el 18/11; eso no acredita el workflow
remoto actualizado, que aún necesita un run de GitHub Actions.
