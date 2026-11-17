# Implementation Plan: Rocket Arena camera, controls and boost adaptation

> This plan adapts observable contracts from the audited Rocket Arena Web repository. It does not import its backend, account system, assets, physics constants or server authority.

**Goal:** improve Combat Cars' presentation and input quality using the external reference's proven data contracts while preserving Pages + Worker signaling + WebRTC P2P + host-authoritative RocketSim WASM.

**Global constraints**

- Keep `src/client.js`, `src/camera-follow.js`, `src/aim-lock.js`, `src/audio-mixer.js`, `src/vehicle-visual-model.js` and `src/rocketsim-combat.js` as parity references.
- Do not change RocketSim authority, hitboxes, room protocol, Worker signaling, or the final GLTF vehicle asset.
- Preserve the current desktop-first flow and the completed PERF-01 baseline; any performance change must be bounded and measurable.
- The working tree already contains user-owned, uncommitted changes. Work in place, touch only files named by this plan, and do not reset, clean, publish, or commit unrelated changes.

## Task 1 — Surface-aware chase camera contract (P0 presentation)

**Files:** `src/camera-follow.js`, `src/client.js`, `tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs`, `tests/camera-follow.test.mjs`.

1. Add a failing deterministic test that feeds the camera the authoritative `surfaceNormal`/`worldContact.normal` already present in local and P2P presentation states. Assert ground keeps a stable world-up horizon, wall/curved support returns a finite support-aware `up`, and a ground→wall transition changes `up` monotonically without a one-frame flip.
2. Extend the camera input/state contract with `surfaceNormal`, `lookX`, and `lookY` (the same semantic inputs exposed by Rocket Arena's camera wrapper). Keep the values presentation-only.
3. Implement the smallest surface-up solver: normalize a valid support normal, choose the hemisphere closest to the previous up, smooth it with a mode-specific rate, and blend back to world-up in air/invalid contact. Reproject the look direction against the solved up so `lookAt` does not roll or lose the vehicle near walls. Keep current boom/bounds and FOV behavior.
4. Pass `surfaceNormal` from local `me.surfaceNormal`/contact and online `focusCar.surfaceNormal`; pass look axes only when a verified desktop/gamepad source provides them. Do not write them into network commands.
5. Run focused camera tests and the full suite. Record that the change is presentation-only and that Rocket Arena's WASM `stepView` constants were not copied.

## Task 2 — Desktop/gamepad input parity (P1 controls)

**Files:** `src/gamepad-input.js`, `src/p2p-causal-input.js`, `tests/p2p-multiplayer-desktop-controls.test.mjs`, `tests/p2p-causal-input.test.mjs`.

1. Add failing tests for standard gamepad dead-zone normalization, trigger threshold, keyboard/gamepad action merging, blur/visibility release, and right-mouse jump preservation.
2. Extract the reference's semantic action contract into a small shared helper without changing the existing keyboard bindings or P2P command schema.
3. Improve dead-zone handling from a hard cutoff to scaled response, keep trigger threshold explicit, and ensure disconnected/changed gamepads reset held actions. Preserve edge-triggered fire/lock semantics and right-click jump.
4. Run focused input tests and the full suite.

## Task 3 — Rocket Arena-style boost meter (P1 HUD)

**Files:** `src/p2p-boost-meter.js`, `p2p-multiplayer.html`, `src/p2p-multiplayer-entry.js`, `tests/p2p-boost-meter.test.mjs`, `tests/p2p-multiplayer-desktop-controls.test.mjs`.

1. Add a failing unit test for a DOM-light `createP2PBoostMeter` adapter: clamp 0–100, show `∞` in infinite practice/lobby, expose ARIA meter values, toggle firing only when spending with fuel, and avoid redundant DOM writes.
2. Implement the adapter using the audited Rocket Arena behavior (dial, fill, numeric value, unlimited/firing states) with Combat Cars' own CSS geometry and colors; no external artwork or asset copy.
3. Add one fixed lower-right HUD element to the active multiplayer page. It must not block pointer input, avoid the scoreboard/status zones, and remain readable with long names and fullscreen.
4. Wire exactly one update per presentation state/frame from the local car (`boost`, `boosting`) and derive `unlimited` from practice/lobby state. Keep the simulation and audio untouched.
5. Run focused HUD tests, HTML contract tests, and the full suite.

## Task 4 — Measured integration and documentation

**Files:** `_bmad-output/current-roadmap.md`, `docs/README.md` (only if needed), this plan's verification notes.

1. Run `npm test`, `npm run build:pages-beta`, and `npm run verify:pages-beta`.
2. Inspect diagnostics for draw calls, triangles, quality mode, and FPS; do not reopen PERF-01 or add a second render loop without a measured regression.
3. Update the roadmap with the new camera/input/HUD status, explicit evidence, and remaining PR3/manual-browser validation. Do not claim cross-browser parity without running it.

### Acceptance

- Camera follows support normals smoothly near floor-wall transitions while remaining readable in air and retaining existing bounds.
- Keyboard/mouse behavior remains unchanged; standard gamepads produce the same semantic actions with dead-zone/trigger handling and no stuck input.
- The lower-right boost meter is visible in practice/lobby/match, updates from authoritative state, shows numeric or `∞`, and has accessible meter semantics.
- Existing P2P, RocketSim, vehicle asset and PERF-01 tests remain green.
