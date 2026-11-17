# ART-05 Step 1 — Combat-Alpha Performance Baseline

**Status:** executed; measurement evidence captured on 15/11/2026. The
protocol remains documentation-only and no runtime code was changed.

**Scope:** capture one reproducible, interaction-free baseline for the
`combat-alpha` arena before any high/low quality policy, atmosphere change or
material-cost optimisation is implemented. This brief does not implement those
later steps and does not change production code.

## Source contract

- ART-05 requirements:
  `docs/superpowers/plans/2026-11-15-industrial-scrapyard-arena.md` and
  `docs/superpowers/specs/2026-11-15-industrial-scrapyard-arena-design.md`.
  Read them read-only from the parent checkout if they are absent in the
  measurement checkout.
- Local FPS HUD and metrics:
  `src/client-performance.js` (`createFrameMetrics`, `readRendererInfo`) and
  `src/client.js` (`#performance-readout`, `window.__arsenalPerformance`).
- Optional P2P cross-check:
  `window.__COMBAT_CARS_DIAGNOSTICS__` in `src/p2p-multiplayer-entry.js` and
  `renderer.metrics()` in
  `tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs`.

The local route is the primary baseline. The P2P route is only a parity
cross-check and never replaces the local numbers.

## Hard constraints

- Do not add instrumentation, alter the HUD, change materials, edit the arena,
  touch physics/WASM/P2P runtime, change assets or change production code.
- Do not change simulation tick rate, authority, snapshots, input
  acknowledgements or network messages to make a number pass.
- Do not invent a value, copy a value from another checkout, or fill a table
  cell from memory. If the required surface is missing, stop and report it.

## Fixed scenario

Use this same scenario for the baseline and for every later tier comparison.

- Record `git rev-parse HEAD`, `git status --porcelain` and, if the working
  tree is dirty, `git diff --stat`. The accepted ART-03/04 changes currently
  live in this worktree without a commit; the baseline belongs to that exact
  working tree, not to an assumed clean build.
- Launch the current local combat route exactly as documented by the
  checkout. In this worktree the supported command is `npm run play:wasm`,
  which sets `MOVEMENT_BACKEND=rocketsim-wasm`, `ROCKETSIM_MODE=combat`,
  `ROCKETSIM_ARENA=combat-alpha` and port 5300. Record the command actually
  used and the printed URL.
- Open the printed URL, normally
  `http://localhost:5300/?arena=combat-alpha`, in one desktop browser. Record
  the full URL.
- One local client only: no bots, no remote peers, no second tab playing the
  match, and no second browser rendering the same canvas.
- Stay at the fixed spawn/lobby camera. Do not drive, steer, aim, jump, fire,
  collect nitro or open the controls panel. Combat-alpha has no pickup
  dependency; nitro is authoritative and regenerable. If an idle reset or
  teleport happens, record it and restart the warmup window.
- Keep browser window size, device pixel ratio, zoom, fullscreen state,
  shadow setting and quality tier identical across runs. Do not switch tabs
  or let the display sleep.
- Close other GPU-heavy applications. Do not record a screen capture during
  the measured window; a screenshot before or after is acceptable.
- For the cold-start observation use a clean browser profile or disabled
  cache. For the stable run use the same profile with a warm cache so HTTP
  startup is not mistaken for render cost.

Record for every run: OS/build, browser and exact version, GPU and driver,
WebGL renderer string, hardware-acceleration state, display refresh rate and
V-Sync, viewport in CSS pixels, DPR, quality mode, shadow state, server
command, port, arena profile id, commit and dirty state. Reject a
software-rendered (`SwiftShader`/`llvmpipe`), remote or VM session; it is not a
comparable GPU baseline.

## Startup observation

This observation is diagnostic only and is excluded from the baseline budget.
Start when navigation begins and end when the stable gate below is met.

Record:

- time from navigation to the existing loading cover (`#combat-loading`)
  becoming hidden;
- initial FPS, `frameTimeMs` and `frameTimeMaxMs`, plus the worst startup
  frame;
- `window.__arsenalPerformance.getRocketWarmup()` phase, `settled`, `warmed`
  and any `failure`;
- the first `render.calls`, `memory.geometries`, `memory.textures` and
  `programs` after the arena is visible;
- console errors, failed local asset/texture requests and WebGL context loss.

Startup includes shader compilation, texture upload, first-frame allocation
and loading-cover release. Never merge these samples into the stable average.

## Stable-session gate

Begin the stable window only when all of the following are true:

- `#combat-loading` is hidden and the arena is visibly stable;
- `getRocketWarmup()` reports `phase === "warmed"`, or equivalently
  `settled === true`, `warmed === true` and `failure === null`; a `failed`
  phase invalidates the run;
- the FPS HUD has published at least two consecutive 500 ms updates with
  `fps > 0`, and `getSnapshot()` shows a populated one-second window
  (`sampleCount` and `windowMs`);
- no texture or asset request has completed for at least 5 s;
- there is no console error, WebGL context loss or reconnect;
- the view is still the fixed spawn view and no input has been applied.

After the gate, discard the first 10 s to avoid residual shader/JIT and camera
settling, then sample the next 60 s without interaction. Invalidate and
restart from the gate if the tab loses visibility, focus or the display
sleeps, a match event occurs, a texture/asset loads, a context loss appears,
or the view changes.

## Stable sample

Read the existing diagnostics at approximately 500 ms intervals. The local
snapshot has this shape:

```js
(() => {
  const snapshot = window.__arsenalPerformance?.getSnapshot?.();
  if (!snapshot) throw new Error("__arsenalPerformance is unavailable");
  return {
    capturedAt: new Date().toISOString(),
    hud: document.querySelector("#performance-readout")?.textContent ?? null,
    ...snapshot,
  };
})()
```

For a 60 s capture, repeat the same read-only snapshot on a 500 ms timer. Do
not create a render loop, a second canvas or a GPU readback. Report the
`frameTimeMs` central value and the worst `frameTimeMaxMs` observed across
samples. For draw calls, geometries, textures and programs, report the median
and maximum across samples; these are per-last-frame counts and one frame is
not a baseline. Do not invent a percentile that the diagnostics do not expose.
Run the stable capture at least twice and report both runs and their spread;
never silently keep only the fastest run.

## Metrics

| Metric | Existing source | Baseline | Notes |
| --- | --- | --- | --- |
| FPS HUD text | `#performance-readout` | High: `133–144` / `136–144`; Low: `144` / `144 FPS` | Integer FPS and ms as displayed; two runs per tier. |
| FPS | `snapshot.fps` | High: avg `140.36` / `143.52`; Low: avg `143.91` / `143.98` | Smoothed one-second window. |
| Frame time | `snapshot.frameTimeMs` | High: avg `7.14` / `6.94 ms`; Low: `6.92` / `6.92 ms` | Mean/smoothed frame time in ms. |
| Worst frame | `snapshot.frameTimeMaxMs` | High max `47.3` / `22.4 ms`; Low max `25.6` / `10.2 ms` | Largest raw frame in each 60 s window. |
| Sample count / window | `snapshot.sampleCount`, `snapshot.windowMs` | `61` readouts per run over `60 s`; `windowMs=1000` | One readout per second; startup excluded. |
| Draw calls | `snapshot.render.calls` | High `60`; Low `56` (stable) | Low does not exceed high. |
| Triangles | `snapshot.render.triangles` | High `17,422`; Low `17,624` (stable) | Context only; not a substitute for frame time. |
| Geometries | `snapshot.memory.geometries` | High `210`; Low `212` (stable) | Live renderer count, not bytes. |
| Textures | `snapshot.memory.textures` | High `9`; Low `1` (stable) | Low does not exceed high. |
| Programs | `snapshot.programs` | High `45`; Low `37` (stable) | Low does not exceed high. |
| Renderer memory | `snapshot.memory` | High `210/9`; Low `212/1` geometries/textures; no MB claim | Report counts; do not label them MB. |
| JS heap (optional) | `performance.memory.usedJSHeapSize` | `22,927,546` bytes at final readback (Chrome-only) | Kept separate from renderer memory. |
| Quality mode | local profile / P2P `qualityMode` | Local high/full and low fallback both measured | Low uses the opaque fallback only. |
| Context losses | P2P `contextLossCount` | Not applicable (local baseline; no context loss observed) | Report if the P2P cross-check is used. |
| Readback | P2P `diagnosticsReadback` | Not applicable | Must remain false. |

## Execution record — 15/11/2026

- **Route:** local `combat-alpha`, one client, fixed spawn/lobby camera, no
  input. Nitro remained authoritative/regenerable; no pickups were involved.
- **Server:** `MOVEMENT_BACKEND=rocketsim-wasm`, `ROCKETSIM_MODE=combat`,
  `ROCKETSIM_ARENA=combat-alpha`, `node server.mjs`, `PORT=5301`. Port 5300
  was already occupied by an unrelated exploratory session, so that session
  was not used for the baseline.
- **URL:** `http://localhost:5301/?arena=combat-alpha`.
- **Browser/GPU:** Playwright Chromium, WebGL 2, `ANGLE (AMD, AMD Radeon(TM)
  840M Graphics (0x00001114) Direct3D11 vs_5_0 ps_5_0)`, vendor `Google Inc.
  (AMD)`. Viewport `1044×567` CSS px, DPR `1.4015624523`, canvas
  `1463×794`.
- **Warmup gate:** loading cover hidden; `getRocketWarmup()` reported
  `phase=warmed`, `settled=true`, `warmed=true`, `failure=null`; no console
  errors and no failed dynamic asset requests. The approved four WebP assets,
  vehicle and audio requests returned HTTP 200.
- **Run shape:** each run discarded 10 s after the gate, then measured 60 s as
  contiguous 25 s + 25 s + 10 s in-page `requestAnimationFrame` windows. The
  split is only a tooling limit; no page reload, input or quality change
  occurred between segments. Each run yielded 63 one-second diagnostics
  readouts. Run 1 contained one transient 116.3 FPS/47.3 ms worst-window
  sample; counters and the next samples recovered without a context loss.
- **Stability:** after the warmup, FPS settled in the expected 140–144 range;
  draw calls, triangles, geometries, textures and programs remained constant.
  The earlier out-of-focus Playwright observation showing ~1 FPS was discarded
  as an invalid background-tab sample and is not part of this baseline.
- **Step 4 low-tier capture:** after the earlier throttled attempts were
  discarded, a dedicated foreground Playwright Chromium page was brought to
  front with `page.bringToFront()` and captured in two uninterrupted 60 s
  windows after 10 s of settling. Low run 1 averaged `143.91 FPS / 6.92 ms`
  (worst `25.6 ms`); run 2 averaged `143.98 FPS / 6.92 ms` (worst `10.2 ms`).
  Both stayed at `56` draw calls, `17,624` triangles, `212` geometries, `1`
  texture and `37` programs. No console warnings or context loss occurred.
- **Step 4 gate:** high remains within the baseline definition, and low is
  `1.7 %` below the high two-run mean frame time (`6.92 ms` vs `7.04 ms`). Low
  does not exceed high in draw calls, textures or programs, and keeps all
  simulation/network/HUD/nitro invariants. The high/low performance budget is
  therefore accepted for this measured Chromium/AMD environment.
- **Source state:** `HEAD=a48e089deccc1f775132f38fdf764002220ca2dc`; the worktree
  was dirty (`409` status entries) with pre-existing user/ART changes. No
  source, asset, HUD, physics, WASM, P2P or production files were modified by
  this measurement.

If the local diagnostics do not expose camera pose, do not invent one. The
fixed spawn view, identical viewport/DPR and zero input are the visual
comparability evidence.

## High/low acceptance

Before the quality policy exists, capture only the current high/full ART-03
skin. Do not fabricate a low-tier number.

After ART-05 Steps 3–4, compare tiers with the same fixed scenario, arena,
spawn/view, viewport/DPR, cache state and idle input:

1. Run `high`, then `low`, then reverse the order (`low`, `high`) to expose
   thermal/cache drift. Keep every run; report medians and spread.
2. If a runtime switch exists, switch `high → low → high` without reloading.
   Confirm the match is not reset and that tick, car position, score, input
   acknowledgements, snapshot sequence and network state do not change.
3. Prove simulation identity with the focused ART-05 tests and, where
   available, before/after observations. A quality change may replace
   materials, texture sampling and visual-only lights; it may not change
   arena geometry, colliders, spawns, physics, tick rate, authority,
   snapshots, score or network messages.
4. `high` must stay within 10 % of the baseline stable frame time. `low` must
   use the preserved fallback or one base map, must not exceed `high` frame
   time, and must not exceed `high` in sampled draw calls, textures or
   programs. If a gate fails, reduce material sampling or props; never change
   physics, simulation tick rate or authority to make it pass.

## P2P cross-check

If the shared presentation code is touched, repeat one stable capture on the
P2P route with `window.__COMBAT_CARS_DIAGNOSTICS__`. Record the P2P
launch/serve command and room URL, `qualityMode`, `qualityAuto`,
`qualityDowngrades`, `qualityUpgrades`, `qualityAverageFrameMs`,
`contextLossCount` and `renderer.rendererInfo`. Reject the sample if automatic
quality changes during the window. A single local tab has no rival car; label
the sample as a one-tab shell/parity check, not a full-match baseline. Do not
enable `diagnosticsReadback` to obtain any of this.

## Acceptance criteria

1. **Reproducible record:** commit, dirty state, launch command, URL, browser,
   GPU, WebGL renderer, viewport, DPR, quality mode and server mode are
   recorded; another operator can repeat the run.
2. **Startup separated:** startup/loading/shader-compilation observations are
   reported separately and excluded from the stable baseline.
3. **Stable sample:** at least 60 s of interaction-free sampling after the
   gate and 10 s settling period, with two runs and their spread reported.
4. **Required metrics present:** FPS HUD text, FPS, frame time, worst frame,
   draw calls, geometries, textures, programs and renderer memory are recorded
   from the same renderer instance and run; JS heap is optional and clearly
   separated.
5. **Tier comparison is state-preserving:** both tiers use the same arena,
   spawn/view, viewport/DPR, cache state and idle input; no tick, physics,
   score, input acknowledgement, snapshot or network state changes.
6. **P2P labeling:** a one-tab P2P sample is explicitly marked as having no
   rival and is not substituted for the local baseline.
7. **No measurement side effects:** reading diagnostics creates no second
   render, no GPU readback, no extra animation loop and no network/state
   change.
8. **Invalid-run handling:** missing instrumentation, console errors, failed
   texture loads, context loss, tab/focus/visibility changes, match resets or
   unexpected asset loads invalidate the run and are reported, not averaged
   into a partial result.

## Reporting format

Return or attach:

1. Environment and exact commands.
2. Startup observation table.
3. Stable run table using the metrics above, with raw snapshots or CSV kept
   external to this brief.
4. Tier comparison when applicable, including run order, medians, spread and
   state-preservation evidence.
5. Invalidated runs and the reason.
6. The result against acceptance criteria 1–8, without filling values that
   were not observed.

## Explicit non-goals

- No edits to code, tests, HUD, HTML/CSS, assets, materials or quality policy.
- No changes to RocketSim/WASM, native bridge, arena topology, colliders,
  camera, controls, combat rules, snapshots, P2P runtime/protocol or
  authority.
- No new dependency, benchmark harness, production instrumentation, Pages
  deployment or external asset.
- No browser/machine comparison in this step; that belongs to ART-06.
- No claim that ART-05, ART-06 or the industrial-scrapyard milestone is
  accepted from this brief alone.
