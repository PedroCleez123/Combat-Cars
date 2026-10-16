# LAN protocol

El envoltorio de sesión usa `protocolVersion: 1`, `roomId` y `sessionId` en el
primer `hello`. La sesión es efímera y solo permite recuperar la misma plaza
durante cuatro segundos; no es autenticación. El cliente envía `heartbeat` cada
cinco segundos y el servidor retira una conexión silenciosa después de veinte.
El servidor rechaza mensajes antes de `hello`, salas/versiones desconocidas,
frames sin máscara y payloads mayores de 8192 bytes. Sin configuración,
localhost y 127.0.0.1 del puerto activo se permiten; `LAN_ALLOWED_ORIGINS`
reemplaza esa lista por orígenes exactos. Estos controles preparan la LAN y no
hacen seguro el despliegue público.

The Node process is authoritative: clients send only input and render the
state snapshots it returns. This prevents a browser from assigning itself
damage, score, boost, or respawns.

| Direction | Message | Meaning |
| --- | --- | --- |
| client → server | `hello` | asks for a player slot with protocol version, room and ephemeral session |
| client → server | `input` | held control state |
| client → server | `configure` | In JavaScript, settings restart the local match. In a RocketSim LAN session, it can request only `vehicleLimit` `1…6`; the server rejects bots, invalid values and reductions below connected humans, without accepting client cars or poses. Only the session owner may configure. |
| client → server | `restart` | starts a new local match; only the session owner may request it |
| server → client | `welcome` | player id, assigned team and `owner` flag for the first authenticated session peer |
| server → client | `state` | current authoritative snapshot, including car orientation quaternions, angular velocity, impact serial/spin, surface normals/types, wall-ride state, and `jumpState` (`grounded`, `first-jump`, `double-jump`, `dodge`, `airborne`, or `wall-jump`) with remaining jump, dodge and cancellation state. In CALIBRACIÓN LIMPIA, `cars[].contacts` reports nearby arena planes with `kind`, inward `normal`, world-space `point`, `wheelCount`, `normalVelocity`, and `separation`; a loaded wheel can publish a floor contact even while the chassis is clear. `cars[].wheels` contains each nearby wheel's id, plane, point, extension, compression, normal velocity and suspension force. Grounded requires two meaningfully compressed floor springs or direct chassis support. RocketSim practice adds `settings.practiceArena` (`arsenal-practice`, `arsenal-curved-practice`, `arsenal-expanded-curved-practice`, `arsenal-expanded-cornered-practice`, `arsenal-expanded-block-practice`, `arsenal-expanded-ramp-practice` or `combat-alpha`) so the client can select the matching visual training geometry while `settings.arena` remains `calibration`. RocketSim combat additionally publishes `settings.scoreToWin`, `settings.roundState` (`waiting`, `active` or `complete`) and `winner`; Node/RocketSim derive them authoritatively. | 
| server → client | `event` | fire, hit, pad, elimination, respawn, winner |
| client → server | `heartbeat` | keeps a quiet browser session alive |

La práctica RocketSim mantiene además un canal interno JSONL entre Node y el
bridge nativo. `respawn` reposiciona un coche configurado en su spawn nativo y
`combat-state` lo desactiva o reactiva durante una eliminación. Ninguno acepta
posición, velocidad u orientación desde Node; esos estados siguen siendo
propiedad del solver RocketSim.

El bridge declara `features.staticRaycast=true` cuando ofrece la consulta
`raycast`. Node puede enviar hasta 32 segmentos con `id`, `from` y `to` en las
coordenadas públicas RocketSim y-up. La respuesta `raycast-state` conserva el
`tick` y devuelve un resultado por id con `hit`, `fraction`, `point`, `normal` y
`kind:"static"`; los cuerpos dinámicos se excluyen. Esta capacidad se valida
en COMBAT-GEO-01 y todavía no sustituye las reglas de daño ni el movimiento del
cohete, que se integrarán en COMBAT-GEO-02.

La build nativa R9 se encuentra en `.rocketsim-bridge-build-r9/` y contiene
estos comandos. La build R5 se conserva como referencia histórica, pero no
debe usarse para arrancar el modo combate porque no conoce `respawn` ni
`combat-state`.

`combat-lineup` es un perfil interno de sonda: alinea dos spawns nativos para
probar impacto, eliminación y respawn. No es una arena seleccionable desde la
interfaz ni un mapa de partida.

This is intentionally a LAN prototype. Internet deployment needs TLS, room
authentication, rate limiting and an authoritative hosted process before it is
made public. The browser already selects `wss://` when served over HTTPS, and
the RocketSim sidecar remains server-only. The staged deployment boundary and
the future room/session envelope are documented in
`docs/web-online-compatibility.md`; no room field is added to this LAN
protocol until that story is opened explicitly.
