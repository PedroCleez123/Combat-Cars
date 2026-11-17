# RocketSim WASM spike

Isolated build experiment. It does not replace or modify the Windows bridge, game code, or network path. Players do not need Emscripten; it is a local development toolchain.

Requirements: Windows, Git, CMake, Node.js, and the RocketSim source checkout with vendored Bullet. The SDK and all generated build files stay under this ignored directory.

The Bullet include directory must be derived from the explicit RocketSim
checkout: `-iquote${ROCKETSIM_SOURCE}/libsrc/bullet3-3.24`. Do not replace it
with a relative path into this repository; that can compile against the wrong
checkout or hide a missing vendored source.

```powershell
.\bootstrap-emsdk.ps1
.\bootstrap-ninja.ps1
.\build.ps1
node .\smoke.mjs
```

`bootstrap-ninja.ps1` downloads the pinned, official Ninja release only into this ignored spike directory; it neither changes PATH nor installs a system package. `build.ps1` accepts `-RocketSimSource`, `-BuildDirectory`, and `-NinjaExecutable` overrides. The wrapper uses `InitFromMem` with no mesh files, creates one car in `THE_VOID` at 120 Hz, maps the compact forward/steer/jump/boost ABI to the bridge-compatible throttle/pitch and steer/yaw controls, advances one simulation tick per call, and writes a compact primitive snapshot to caller-allocated WASM memory. It has no filesystem, stdin/stdout, child process, or thread dependency in its wrapper API.

The build emits an ES module (`rocketsim_wasm.mjs`) deliberately. This project has `"type": "module"`; emitting Emscripten's default CommonJS-shaped `.js` glue would make a dynamic `import()` expose no default factory in Node.

For an isolated browser-only gate (not the game server), run
`npm run serve:rocketsim-wasm-smoke` and open `http://127.0.0.1:5297`. It
serves only the diagnostic page, trace contract, generated ES module and WASM
from an exact allowlist. The page performs the same 240-tick trace and exposes
the result in `window.__arsenalWasmBrowserSmoke` for Playwright; it never loads
the game client or opens a network session.

`npm run smoke:rocketsim-wasm-browser` is the reproducible Chromium/Electron
gate. It launches an exact allowlist host on a random loopback port, records
the 240-tick browser result and console errors in `artifacts/`, then closes
only its own hidden window and host. It is the fallback when an externally
sandboxed Playwright process cannot access a local loopback listener.

`npm run probe:rocketsim-wasm-multicar` and
`npm run smoke:rocketsim-wasm-browser-multicar` run the separate capacity gate:
six isolated `THE_VOID` cars share one fixed tick and expose finite snapshots.
This is a browser-budget gate only; it is not yet the production arena ABI or
the online match.

`npm run test:p2p-wasm-host` and
`npm run smoke:rocketsim-wasm-browser-p2p-host` exercise the isolated
P2P-WASM-07 host adapter. It initializes the WASM fixture before constructing
the synchronous host-channel match, emits four compact two-car snapshots and
checks idempotent cleanup. The browser route is allowlisted only inside this
spike and never through `server.mjs`.

`npm run test:p2p-wasm-snapshot` exercises the P2P-WASM-08 diagnostic envelope.
It is deliberately a separate `wasm-snapshot` message with a provisional
`[-2500,2500]` UU/s component envelope; it rejects overflow rather than
clipping and is not a replacement for the public P2P v1 protocol.

`npm run test:p2p-wasm-combat` exercises the P2P-WASM-10 diagnostic combat
envelope. It is deliberately a separate `wasm-combat-snapshot` message with
strict score, two-car combat state, rocket and event bounds plus a 2048-byte
UTF-8 limit. The fixture overlays a deterministic `fire -> hit -> elimination
-> respawn` lifecycle on four physical two-car snapshots. It accepts snapshots
from `createP2PWasmHostMatch` or its equivalent local fixture, but it does not
claim that the current WASM ABI generates rockets and does not change the C++
wrapper, `src/`, `server.mjs`, WebRTC, or the public P2P v1 protocol.

The P2P-WASM-09 diagnostic fixture `arsenal-curved-practice` is kept isolated
from the game and server. It uses one car on `+X`, scale `56/2300`, radius
`256 UU`, `32` segments, native winding and BVH margin `0.04`; its 480-tick
throttle/boost trace checks the first incline, steep section, continuous
support and jump normal against R20. This curve is a diagnostic gate, not the
final arena or a public online arena. The next gate is combat, respawn and
rocket events on isolated fixtures.

The smoke reports factory initialization and 120-step wall time for the current host. Those are a Node.js WASM measurement, not browser performance data.

`npm run test:p2p-wasm-combat-host` exercises the P2P-WASM-12 causal host
spike. It composes real WASM physical snapshots with the existing authoritative
combat state, converts native units once, consumes one external 60 Hz tick per
pilot command, and requires the P2P-WASM-11 lifecycle ABI. Elimination moves
the physical slot to the inactive sentinel and respawn restores the native
spawn; inactive slots receive neutral controls. The test is diagnostic only:
it does not connect the renderer, public WebRTC path, arena raycasts or an
online deployment.

`npm run test:rocketsim-wasm-static-raycast` and
`npm run compare:rocketsim-wasm-static-raycast` exercises P2P-WASM-13. The
WASM wrapper exposes a pure static segment query in public Y-up coordinates;
it returns hit, fraction, point and normal, filters dynamic bodies and does not
advance the simulation. The R20 comparison currently covers the isolated
`combat-lineup` planes only; it is not yet the public arena or projectile path.

`npm run test:p2p-wasm-combat-host` also covers P2P-WASM-14 static interception
in the causal combat host. The host resolves the WASM static raycast before
car-vs-car combat, so floor/wall hits stop a projectile without introducing a
second simulation clock. This remains an isolated diagnostic gate until the
same query is compared against the final `combat-alpha` geometry.

`npm run test:rocketsim-wasm-combat-alpha` and
`npm run compare:rocketsim-wasm-combat-alpha` exercise P2P-WASM-15. The
fixture composes the full diagnostic `combat-alpha` static volume (curves,
corners, panels, block and ramp) and compares eight deterministic segments
against R20. It keeps one neutral car only and must not be described as the
production online host; the next gate is cost measurement and host integration.

`npm run benchmark:rocketsim-wasm-combat-alpha-raycast` and
`npm run test:rocketsim-wasm-combat-alpha-raycast` exercise P2P-WASM-16. They
measure twelve pure static raycasts per 60 Hz frame against the full
`combat-alpha` fixture after warmup, enforce P95 `<= 2 ms` / P99 `<= 4 ms`, and
require that the fixture tick remains unchanged. The shared contract is
browser-safe; the Electron gate is
`npm run smoke:rocketsim-wasm-browser-combat-alpha-raycast`. In this workspace
the Electron process may need elevated execution to access its temporary
127.0.0.1 listener; an `ERR_NETWORK_ACCESS_DENIED` from an unprivileged run is
a sandbox limitation, not proof that the module or game failed. This is still
a performance gate for an isolated diagnostic fixture, not a public online
match or a renderer integration.

`npm run test:rocketsim-wasm-combat-alpha-pair` and
`npm run compare:rocketsim-wasm-combat-alpha-pair` exercise P2P-WASM-17. The
separate `rs_init_trace_combat_alpha_pair()` fixture preserves the single-car
combat-alpha fixture used by P2P-WASM-15/16, creates the two canonical R20 BLUE
spawns, and permits lifecycle only on its explicit two-car identity or the
older combat-lineup fixture. The trace aligns a neutral first tick, drives a
60-tick no-boost tape, then verifies deactivate/respawn phases against R20.
It remains diagnostic: it does not expose boost in its compact snapshot, does
not model pads, and does not connect a public network or renderer.

P2P-WASM-18 lets `createP2PWasmHostMatch({ fixture: "combat-alpha-pair" })`
and `createP2PWasmCombatHost({ fixture: "combat-alpha-pair" })` opt into that
validated pair; omitting `fixture` keeps the `combat-lineup` control fixture.
The host translates the raw Z-up WASM snapshot `[x, lateralY, heightZ]` once to
its public diagnostic representation `{x, z: lateralY, h: heightZ}`. Invalid
fixture names are rejected before the module factory runs. The causal combat
host alone defaults to the diagnostic `±2500` UU/s component bound so real
acceleration and impact samples remain observable; the compact P2P host stays
at `±200`, and neither setting changes a public P2P protocol.

`npm run smoke:rocketsim-wasm-browser-p2p-combat-alpha-host` exercises
P2P-WASM-19 in Electron/Chromium. The opt-in page selects the pair fixture,
advances two external 60 Hz ticks, verifies the two non-centred combat-alpha
spawns, runs deactivate/respawn without advancing the lifecycle tick, and
closes the host idempotently. Its server allowlist exposes only the page,
adapter and WASM files; it never starts `server.mjs`, WebRTC, or the published
renderer. In this workspace the command may require elevated execution because
the sandbox can deny the temporary loopback listener; treat that as an
environment limitation and retain the JSON artifact rather than marking an
unverified run as pass.

Las suites `tests/p2p-wasm-combat-alpha-pair.test.mjs` y
`tests/rocketsim-wasm-combat-alpha-raycast-benchmark.test.mjs` forman parte de
`npm test`; no dependen sólo de que alguien recuerde ejecutar los scripts
focales. Con el bridge R20 configurado, la regresión completa reciente fue
`435 total / 433 pass / 2 skipped por loopback / 0 fail`.

`npm run smoke:rocketsim-wasm-browser-p2p-causal-combat` exercises
P2P-WASM-20. It is an opt-in Chromium gate for the causal host, not the game:
on the controlled `combat-lineup` fixture it first proves that a real static
WASM ray intercepts a rocket, then requires the combat overlay to emit
`fire → hit → fire → hit → elimination → respawn` while the physical slot
enters its inactive sentinel and returns through native respawn. The page
imports only an exact allowlist of the causal host and five direct production
source dependencies; it does not start `server.mjs`, renderer, WebRTC or a
public room. The shared allowlist MIME contract serves `.js` and `.mjs` as
JavaScript modules—serving `.js` as octet-stream makes Chromium reject the
causal imports before the gate runs.

This still does not prove P2P v1 can carry the causal snapshot: v1 has compact
two-car fields and `±200` velocity, while causal combat has score, rockets,
events, lifecycle and diagnostic `±2500` physical values. Version an explicit
adapter/envelope before connecting this spike to a DataChannel or renderer.

P2P-WASM-21 supplies that isolated pre-transport envelope in
`p2p-wasm-causal-combat-protocol.mjs`. The type
`wasm-causal-combat-snapshot` converts an actual causal host snapshot without
mutating it, validates exact fields and lifecycle semantics, and retains the
2 KiB frame limit. `npm run test:p2p-wasm-causal-combat-protocol` covers a
real WASM fire snapshot plus malformed/unsafe/overflow cases. It is still not
a P2P v1 message and not WebRTC transport: the following gate must integrate
the new type through an explicit host/pilot channel adapter.

`npm run test:p2p-wasm-causal-combat-channel` exercises P2P-WASM-22. Its
browser-safe, transport-agnostic adapter keeps causal combat separate from P2P
v1 and requires the ordered exchange `hello -> welcome -> command -> snapshot`.
The host is the only simulation authority; the pilot can send only canonical
controls plus `null` or the remote host as guidance target. Context mismatch,
out-of-order messages, malformed frames and a pilot self-target fail closed;
cleanup is idempotent. The focal test uses an actual causal WASM fire snapshot
and proves P2P v1 rejects it. This is a local callback boundary only: it does
not create a peer connection, start signaling, expose a public room, alter the
renderer, or modify `server.mjs`. The next gate is this exact contract over a
local Chromium DataChannel with timeout and cleanup evidence.

`npm run smoke:rocketsim-wasm-browser-p2p-causal-combat-webrtc` is that
P2P-WASM-23 Chromium gate. It creates two local `P2PWebRTCSession` peers with
the production STUN endpoint `stun:stun.cloudflare.com:3478`, uses only in-page local signaling and waits until both
ordered `arsenal-controls` channels are open. It then carries exactly one
causal `hello -> welcome -> command(fire) -> snapshot` exchange driven by the
real WASM host, verifies the guided target and fire event, bounds the received
frame to 2 KiB and closes all resources idempotently. It does not start
`server.mjs`, use TURN, expose a public room, or prove connectivity between two
networks; it may contact the configured public STUN endpoint to gather ICE
candidates. The Electron listener is temporary and local; run it
with elevated permission in environments that block loopback browser tests.

`npm run smoke:rocketsim-wasm-browser-p2p-causal-combat-webrtc-pair` is
P2P-WASM-24. It opens the same opt-in diagnostic in two separate Chromium
renderers (`#host`, `#pilot`). A same-origin `BroadcastChannel` is used only
for ephemeral local signaling; the host waits until the pilot advertises
presence before issuing its deferred offer. It uses the same production STUN
endpoint because separate BrowserWindows can remain in ICE `checking` when
they only receive host candidates. The runner waits for both contexts
to observe the real WASM `fire` snapshot, then triggers both idempotent cleanup
hooks. This proves neither a public signaling service nor Internet/NAT: it has
no TURN server, Worker, `server.mjs` process, public room, or published
renderer integration. The runner's aggregate outcome is explicitly
`{ ok: true, host, pilot, cleanup }`; do not interpret a missing aggregate `ok`
as a WebRTC or physics failure.

`npm run test:p2p-wasm-combat-alpha-causal` exercises P2P-WASM-47. The new
diagnostic tape opts into `combat-alpha-pair`, sends only host/pilot controls,
and records a real launch at tick 1 followed by the static-geometry event
`COHETE INTERCEPTADO`. Its contract requires consecutive ticks and rejects a
generic `miss` so an out-of-bounds detonation cannot masquerade as occlusion.
It deliberately does not change the default `combat-lineup`, publish the alpha
fixture, or claim native parity for projectile events; that belongs to a later
R20 comparison and full combat campaign.
