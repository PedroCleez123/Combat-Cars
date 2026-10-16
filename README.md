# Car Soccer: Arsenal

La hoja de ruta operativa actual está en
[`_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md`](_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md).

A standalone 3v3 vehicle-arena shooter prototype. It keeps the agile, aerial
car fantasy while changing the objective from football to an industrial
scrapyard deathmatch.

## Included vertical slice

- Server-authoritative LAN match for up to six human drivers; the simulation
  uses 120 Hz substeps and exchanges controls and snapshots at 60 Hz. The host
  can set the pilot capacity from one to six and the bot target for empty slots.
- Blue vs Red, first team to 15 eliminations, respawns and score HUD.
- Ground driving with traction and powerslide, a timed double jump, a committed
  aerial dodge, mid-air roll and collectible boost pads. Nitro only refills from
  pads; it does not regenerate passively.
- Vehicle contacts use an oriented chassis footprint. Ramps sample the centre
  and four corners, so the car stays supported while part of its body remains
  over the surface and begins falling after the whole footprint leaves it.
  Ground velocity follows the tangent plane, preserving uphill motion and
  removing only the normal component on landing. Scrapyard covers now use a
  vertical chassis volume: they block side impacts below their height, support
  a landing on their top, and can be cleared while flying above them.
- Arena boundary contacts expose wall normals and a capped ceiling height to
  the authoritative snapshot. An airborne car that drives into a wall now
  aligns its chassis to the wall, keeps tangential speed and uses throttle and
  steering to drive along it under reduced gravity. Jumping from the wall
  pushes the car back into the arena and consumes its remaining jump. The
  client renders the authoritative 3D orientation; detailed vertical
  hitboxes and ceiling driving remain later movement work.
- The CALIBRACIÓN LIMPIA profile uses one quaternion-oriented chassis collider
  for the floor, four walls and ceiling. Contact snapshots include the plane
  normal and point, plus four damped wheel supports with travel, compression
  and applied force. A car only regains ground controls and its two jumps when
  at least two floor springs carry a meaningful load. The calibration solver
  does not enable wall or ceiling driving.
- Non-homing rockets fired from the nose of the car, splash damage, health,
  kill credit and respawn protection. High-speed rams also deal bounded damage.
- A full Three.js 3D scrapyard: elevated third-person camera, physical cover,
  ramps, containers, crane, dynamic lights, shadows, boost flames, rocket
  trails, supersonic streaks and impact bursts.

## Run it locally

1. In this directory run `npm run start:watch:combat` for the current RocketSim
   combat server (R19, port 5300).
2. Open [http://localhost:5300/?arena=combat-alpha](http://localhost:5300/?arena=combat-alpha).
3. Open the same address in other browsers on the same machine or LAN to join
   the same match. RocketSim combat keeps the remaining places empty.

The one-command launcher is the supported development path. Stop an older
instance with `Ctrl+C` before starting another process on port 5300; do not
mix its R13 environment with the R19 renderer. Client edits only need
`Ctrl+F5`; server edits are reloaded by `node --watch`.

By default the server uses the JavaScript authoritative match. The opt-in
The RocketSim practice backend is a separate clean-arena mode with rounded
floor-to-wall corners. It requires the native bridge. Practice mode remains
movement-only; RocketSim combat is an explicit LAN mode configured with
`ROCKETSIM_MODE=combat` and never enables bots implicitly:

```powershell
npm run start:rocketsim
```

Ese comando usa la build activa de desarrollo R19. En esta copia está en
`.rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe`. Si quieres definirla
manualmente en PowerShell:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe)
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "practice"
npm start
```

Para no repetir las variables de entorno, el lanzador persistente prepara la
sesión de combate R19 en un solo comando:

```powershell
.\tools\start-rocketsim-combat-watch.ps1
```

Déjalo abierto durante el desarrollo. Los cambios de servidor se recargan con
`node --watch`; los cambios de cliente solo requieren Ctrl+F5. Si el runtime se
cierra por un error del bridge, hay que volver a ejecutar este lanzador una vez.

Para desarrollo continuo en el PowerShell principal, usa `npm run start:watch`
con las mismas variables. Node reinicia el servidor cuando cambia `server.mjs`
o un módulo que importe. Los cambios de `src/client.js` no requieren reiniciar:
solo usa Ctrl+F5 en el navegador. Mantén una única instancia de este proceso
por puerto.

`ROCKETSIM_MODE=combat` queda reservado para la build nativa recompilada con el
protocolo de respawn y desactivación. Usa `npm start` sin esas variables para
volver al modo JavaScript normal.

Para una sesión LAN de combate RocketSim con capacidad humana configurable
(1–6), el comando anterior es la ruta recomendada. La capacidad se cambia
desde el panel de partida; los bots están desactivados en este modo. La forma
equivalente manual es:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe)
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "combat"
$env:ROCKETSIM_REQUEST_TIMEOUT_MS = "250"
npm start
```

Esta ruta sigue siendo de desarrollo LAN. La validación completa de disparos,
daño, respawn, puntuación y desconexión a seis pilotos es la historia
GAME-02 del plan vigente; no se presenta todavía como despliegue online.

La práctica usa por defecto `arsenal-expanded-cornered-practice`, la arena
ampliada con cuatro transiciones suelo-pared y sus esquinas curvas. Para abrir
la variante ampliada sin esquinas, define explícitamente el perfil antes de
iniciar:

```powershell
$env:ROCKETSIM_ARENA = "arsenal-expanded-curved-practice"
npm run start:rocketsim
```

Para seleccionar explícitamente las cuatro esquinas suelo-pared curvadas:

```powershell
$env:ROCKETSIM_ARENA = "arsenal-expanded-cornered-practice"
npm run start:rocketsim
```

Para probar el perfil de bloque físico ARENA-05, usa la build R19 activa:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe)
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "practice"
$env:ROCKETSIM_ARENA = "arsenal-expanded-block-practice"
$env:PORT = "5190"
npm start
```

Para la rampa aislada ARENA-06 y la oclusión de cohetes, usa la build R19,
que incluye `staticRaycast`:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe)
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "practice"
$env:ROCKETSIM_ARENA = "arsenal-expanded-ramp-practice"
$env:PORT = "5191"
npm start
```

La rampa tiene 20 × 18 × 4,5 unidades Arsenal. Sus sondas nativas y la prueba
de combate se ejecutan con `npm run probe:rocketsim-ramp-arena` y
`npm run probe:rocketsim-ramp-combat`.

Para la composición de combate (bloque, rampa, corredor central, seis spawns y
curvas suelo-pared-techo con esquinas completas), usa el bridge R19:

```powershell
$env:ROCKETSIM_BRIDGE_EXE = (Resolve-Path .rocketsim-bridge-build-r9\rocketsim_bridge-r19.exe)
$env:MOVEMENT_BACKEND = "rocketsim"
$env:ROCKETSIM_MODE = "combat"
$env:ROCKETSIM_ARENA = "combat-alpha"
$env:PORT = "5298"
npm start
```

La campaña reproducible es `npm run probe:rocketsim-combat-alpha-lan`; la
geometría se comprueba con `npm run probe:rocketsim-combat-alpha-geometry`.

La arena plana `arsenal-practice` sigue disponible como control de regresión:

```powershell
$env:ROCKETSIM_ARENA = "arsenal-practice"
npm run start:rocketsim
```
The practice mode maps RocketSim's 2300 UU/s cap to the existing 56 world
units/s scale and uses the same clean floor, walls and ceiling shown by the
Three.js client.

## Controls

| Action | Keyboard |
| --- | --- |
| Drive / reverse | `W` / `S` |
| Steer / air yaw | `A` / `D` |
| Drift on ground / free air roll | Left `Shift` |
| Directional air roll left | Left `Ctrl` |
| Directional air roll right | `Space` |
| Jump / double jump | Right mouse button |
| Nitro | Left mouse button |
| Fire rocket | `F` |
| Restart local match | `R` |

The `⚙ PARTIDA Y CONTROLES` panel sets the pilot capacity and bot target, then
applies them with a round restart. It also lets you rebind every action. Bindings
are saved in the browser's local storage. Right-click is captured by the arena and never
opens the browser context menu while the game is active.

### XInput controller

A standard-mapped XInput controller follows the common Rocket League layout:
left stick to steer and air yaw, `RT` to accelerate or pitch down in the air,
`LT` to brake/reverse or pitch up, `A` to jump, `RB` for nitro, `LB` for
powerslide/free air roll, and `X`/`B` for direct left/right air roll. D-pad up
fires a rocket. `Y` is reserved for a future objective camera, since this
shooter does not have a ball to track yet. Keyboard and controller actions
combine, which also lets the local calibration runner hold a controller state
for an exact duration without generating keyboard events.

## Aerial movement

The movement layer follows the control relationships in Car Soccer: in flight
`W` lowers the nose, `S` raises it, and `A`/`D` yaw. `Shift izquierdo`
is powerslide on the ground and enables free air roll in the air; while it is
held, `A`/`D` roll instead of yaw. `Ctrl izquierdo` and `Space` are directional
air roll left and right and can coexist with yaw. A first jump can be held very briefly for extra
lift. The second press is available for 1.25 seconds after takeoff: it is a
vertical double jump with no direction held, or a directional aerial dodge
when combined with `WASD`. On an analogue controller, a directional input
below the `0.20` dodge deadzone also remains a vertical double jump. The dodge
keeps a short committed momentum and rotation burst. Releasing the controls
does not stop that rotation; for a forward or backward dodge, holding the
opposite drive direction cancels its pitch rotation while preserving momentum.
Boost pushes along the actual direction of the nose, so pitch up first to
climb and boost through the air. It has the same chassis-axis acceleration on
ground, ramps and in flight, with one total-speed limit applied after each
simulation substep.

The car keeps a local 3D orientation while airborne, so pitch, yaw and roll
compose as one local angular velocity around the current chassis instead of
around world axes or in a fixed axis order. Each axis has an explicit
angular-rate target, limit and release damping, so the response is consistent
across input packet cadence. Core movement values are grouped in `TUNING` in
`src/simulation.js` for focused playtest calibration.

## Mobility calibration notes

The reproducible flight trace, the high-level reference translation and the
next decision flow live in [docs/reference-translation-ledger.md](docs/reference-translation-ledger.md).
The static Car Soccer extraction and the original snapshot-presentation
integration are documented in [docs/car-soccer-rea-integration.md](docs/car-soccer-rea-integration.md).
Run `npm run probe` before and after one focused adjustment, then run
`npm test`. La observación aérea vigente está definida en
[`_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md`](_bmad-output/implementation-artifacts/mob-air-02-isolated-observation-story.md)
y el registro actual está en [docs/physics-mobility-tracker.md](docs/physics-mobility-tracker.md).
`npm run probe:envelope` measures the complete ground, jump, dodge and aerial
response envelope used for focused tuning; the current rationale and results
are in [docs/archive/2026-10-12/cal-04-mobility-envelope.md](docs/archive/2026-10-12/cal-04-mobility-envelope.md).
`npm run probe:contacts` captures the M4-01 landing transitions at 120 Hz,
including body contact, loaded wheel support and grouped-packet final states;
it writes `docs/reference-captures/arsenal-m4-01-contact-transitions.json`.
`npm run compare:contacts` aligns that capture with the development-only R4
RocketSim oracle and writes `docs/reference-captures/arsenal-r4-contact-comparison.json`.
`npm run normalize:contacts` writes the dimensionless fall-time and support
metric to `docs/reference-captures/arsenal-r4-contact-normalized.json`; it is
a measurement gate and does not alter the production physics.
`npm run calibrate:network` runs the six calibrated controller traces through
the real local WebSocket protocol and saves its authoritative report in
`docs/archive/2026-10-15/closed-documents/automated-cal-03-last-run.json`.
CALIBRACIÓN LIMPIA también incluye la tarjeta **FIS-14D.1 · CALIBRACIÓN**:
guía las seis maniobras, conserva un agregado de snapshots autoritativos y
copia un informe que identifica un único grupo candidato o bloquea el ajuste
cuando el defecto es de cámara, red o contactos. No modifica la física.
Tras completar una sesión, la tarjeta guarda una copia local; después de dos
pasadas, **Comparar 2 sesiones** solo habilita investigar un grupo cuando el
mismo candidato se repite. Se pueden borrar las sesiones locales desde la
tarjeta.

Para ejecutar la campaña reproducible de movilidad aérea sin cambiar la física,
abre el servidor RocketSim y carga `?mobair01=1`. La consola registra las fases
de primer salto, liberación, segundo salto dirigido con WASD, air roll/boost y
recuperación, además de los `actionSerials` autoritativos:

```text
http://127.0.0.1:5298/?arena=combat-alpha&mobair01=1
```

Para comparar la segunda acción, añade `&dodge=front`, `&dodge=side` o
`&dodge=diagonal`.

La campaña es una herramienta de observación; una ausencia de `doubleJump` o
`dodge` abre una corrección del adaptador/protocolo antes de tocar constantes.
In CALIBRACIÓN LIMPIA, `RED · ACK` reports the time from the last sent input
to a snapshot confirming it. It includes transport and the server tick, so it
is a responsiveness measure rather than a raw network ping.
The RocketSim bridge is built from the pinned public RocketSim source as a
development sidecar; it is not bundled into the web client. The project does
not use Rocket League proprietary code, binary data, WebAssembly, constants, or
game assets. Car Soccer and Rocket League observations remain behavioral
evidence only.
For a complete resume point, see [docs/continuation-handoff.md](docs/continuation-handoff.md).
The local reproducibility record is [docs/provenance-baseline-2026-10-17.json](docs/provenance-baseline-2026-10-17.json); run `npm run verify:provenance` before diagnosing a host or bridge mismatch.
The future online deployment boundary is recorded in
[docs/web-online-compatibility.md](docs/web-online-compatibility.md); the current
server remains a localhost/LAN process and is not an Internet-facing service.

`F` fires straight from the car's nose: lining up a chase before firing is
stronger than spraying rockets. Boosting sideways through a jump is the
reliable way to evade incoming missiles.

## Combat movement

An opposing car struck head-on at high speed takes bounded ram damage; a short
cooldown prevents a single collision from draining its health every simulation
step. An off-centre ram redirects the grounded chassis according to its local
contact point, while an oblique blast adds bounded local spin in flight. Rocket
explosions still damage by range and push surviving opponents away and upward.
This gives rockets a positional purpose: they can clear cover, interrupt a
chase, or set up an aerial follow-up.

## Scope and next integration step

This is an original, playable technical vertical slice, not a Rocket League
mod and not a Melty package. It uses no Rocket League client files and does
not interact with the game or its anti-cheat.

The supplied Car Soccer authorization is recorded in [NOTICE.md](NOTICE.md).
For production integration of original models, sounds, or source modules, use
the unminified Car Soccer project provided by its owner rather than modifying
the minified browser deployment bundle.
