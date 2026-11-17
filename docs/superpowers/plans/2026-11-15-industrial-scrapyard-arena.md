# Industrial Scrapyard Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace combat-alpha's flat clean shell with a performant, readable industrial-scrapyard presentation while preserving its WASM-authoritative arena exactly.

**Architecture:** The existing RocketSim arena profile remains the single geometry and collision contract. A texture/material adapter decorates the Three.js unified shell with world-space continuous sampling; `arena-decoration.js` adds only visual-only perimeter assets. Assets are local, budgeted and have a clean-material fallback.

**Tech Stack:** Three.js r180, existing ESM modules, `MeshStandardMaterial` shader hooks, local WebP texture assets, Node tests, Cloudflare Pages package verifier.

**Spec:** `docs/superpowers/specs/2026-11-15-industrial-scrapyard-arena-design.md`

## Global Constraints

- Do not modify RocketSim WASM, native bridge, combat-alpha dimensions, collider topology, camera bounds, P2P protocol, authoritative snapshots or match rules.
- Use only local assets with documented provenance; no external runtime fetches or new dependencies.
- Preserve the current material as a valid texture-load and low-quality fallback.
- Add no collider, physics body, network message or dynamic point-light-per-prop.
- Do not deploy Pages unless the user explicitly requests it.
- Run one task at a time. A task is not complete until Codex reviews its diff and the stated checks pass.

## Review Focus

- Texture sampling must not introduce seams, discontinuities or black faces on all floor-to-wall and wall-to-ceiling curves.
- Loaded assets must have an accurate hash, byte count, sRGB declaration and package inclusion; a failed asset load must leave the clean shell usable.
- Visual props must remain outside the playable/camera volume and be marked visual-only.
- High-quality material cost must be measured against the existing fixed combat-alpha camera; low quality must remain materially cheaper.
- Team markers, cars, projectiles, UI and boost meter must remain readable under the new grade.

---

### Task ART-01: Asset contract and source audit

**Files:**
- Create: `docs/superpowers/specs/2026-11-15-industrial-scrapyard-asset-inventory.md`
- Modify: none
- Test: documentation self-review against the design spec

**Interfaces:**
- Consumes: the design spec and the supplied source texture names.
- Produces: a provenance and import table consumed by ART-02; each row contains source filename, proposed role, whether it tiles, alpha suitability, target derivative, sRGB use and byte budget.

- [x] **Step 1: Inventory only the seven supplied candidate textures**

Record width, height, source byte size, repeatability, visual defects and whether the source can be used as an opaque albedo. Mark the top-down reference as non-runtime composition reference.

- [x] **Step 2: Define the approved initial material set**

Approve at most floor, wall, corrugated metal and hazard albedo assets. Mark the chain-link image deferred until a real alpha mask is supplied or generated in a later approved task.

- [x] **Step 3: Define derivative and provenance gates**

Specify WebP derivatives, target sizes and cumulative 4 MiB / 6 MiB limits. Record that assets are user-supplied or have their source/licence recorded before being packaged; do not copy them into the project.

- [x] **Step 4: Review the inventory against the design spec**

Expected: every supplied image has a disposition, no asset is silently approved, and no source image is added to runtime paths.

**Gate result (15/11/2026):** ART-01 is accepted. The completed inventory is
`docs/superpowers/specs/2026-11-15-industrial-scrapyard-asset-inventory.md`.
The user has confirmed ownership and redistribution permission for the four
approved source images (floor, wall, corrugated metal and hazard), so ART-02 is
unblocked. The deferred fence and asphalt candidates remain excluded.

### Task ART-02: Local texture package and manifest

**Files:**
- Create: `src/assets/arena/scrapyard/*.{webp,json}`
- Modify: `assets/integration-manifest.json`, `tools/build-pages-beta.mjs`
- Test: `tests/asset-integration-manifest.test.mjs`, a new focused arena-texture package test

**Interfaces:**
- Consumes: the approved ART-01 inventory.
- Produces: `SCRAPYARD_TEXTURE_MANIFEST`, a fixed local URL and metadata for every approved derivative.

- [x] **Step 1: Add failing focused asset assertions**

Assert local relative URLs, sRGB albedo classification, no duplicate filename/hash, and cumulative bytes no greater than 4 MiB.

- [x] **Step 2: Prepare only approved WebP derivatives and update the hash manifest**

Use no raw PNG at runtime. Keep texture dimensions power-of-two and record source-to-derivative provenance without shipping non-approved candidates.

- [x] **Step 3: Add the asset package to the Pages allowlist**

The static build must include each approved texture exactly once and reject an out-of-root URL.

- [x] **Step 4: Run focused asset verification**

Run: `node --test tests/asset-integration-manifest.test.mjs` and `npm run verify:assets`.
The focused ART-02 package test, the integration-manifest test and
`verify:assets` pass in the main worktree. The former access problem in the
generated WASM folder was resolved by rebuilding the artifacts in a clean
directory; `build:pages-beta` and `verify:pages-beta` both pass with the
ART-02 package included.

### Task ART-03: Continuous combat-alpha shell material

**Files:**
- Create: `src/arena-scrapyard-material.js`
- Modify: `src/client.js`, `src/arena-visual-profile.js`
- Test: `tests/arena-scrapyard-material.test.mjs`, `tests/arena-visual-profile.test.mjs`, `tests/arena-decoration.test.mjs`

**Interfaces:**
- Consumes: `SCRAPYARD_TEXTURE_MANIFEST`, combat-alpha visual profile and existing `rocketSimArenaVisualSpec()` geometry.
- Produces: `createScrapyardShellMaterial({ THREE, renderer, quality })` returning `{ material, ready, dispose }` and never creating a collider or network object.

- [x] **Step 1: Add failing material-contract tests**

Assert combat-alpha elects the scrapyard skin, the fallback remains opaque and valid, texture URLs remain local, and material disposal frees every loaded texture.

- [x] **Step 2: Implement a world-space continuous material adapter**

Use world coordinates and normal-weighted blending so floor, quarter-pipes, walls, corner fillets and ceiling cannot rely on deleted per-patch UVs. Use stable world scale and no per-frame allocation.

- [x] **Step 3: Wire the adapter into the existing unified shell only**

Do not alter `rocketSimArenaVisualSpec`, `addRocketSimCurveVisual` topology or collision code. On unsupported renderer, failed load or low quality, preserve the existing shared solid shell material.

- [x] **Step 4: Run focused material and geometry tests**

Run: `node --test tests/arena-scrapyard-material.test.mjs tests/arena-visual-profile.test.mjs tests/arena-decoration.test.mjs`.
Expected: pass with no new runtime asset dependency.

**Gate result (15/11/2026):** ART-03 is accepted. The material adapter,
client/profile wiring and HTTP/Pages allowlists are integrated. Focused
ART-03, decoration, HTTP-boundary and Pages-package tests pass; the shell
remains presentation-only and the existing opaque fallback is preserved.

### Task ART-04: Native obstacles and restrained industrial dressing

**Files:**
- Modify: `src/arena-decoration.js`, `src/arena-visual-profile.js`, `src/client.js`
- Modify online parity: `tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs`
- Test: `tests/arena-decoration.test.mjs`, `tests/p2p-wasm-three-presentation-renderer.test.mjs`, a new visual-only perimeter contract test

**Interfaces:**
- Consumes: ART-03 material adapter and current combat-alpha bounds.
- Produces: visual-only obstacle finish plus shared/instanced perimeter modules that expose `userData.visualOnly === true`.

- [x] **Step 1: Add failing placement and ownership tests**

Assert every exterior prop lies outside the authoritative floor volume or in a declared upper-shell band, adds no physics object, and uses shared geometry/materials.

- [x] **Step 2: Finish existing block/ramp visuals**

Apply the approved concrete, corrugated-metal and limited hazard treatment without altering their vertices, silhouettes or collision-aligned dimensions.

- [x] **Step 3: Add sparse perimeter modules**

Add only low-occlusion industrial fixtures, fence-ready frames or scrap silhouettes. Use instancing for repeated modules, emissive lamps before dynamic lights, and no object in a driving lane.

- [x] **Step 4: Run decoration tests**

Run: `node --test tests/arena-decoration.test.mjs tests/combat-alpha-map.test.mjs`.
Expected: all props remain presentation-only and all map safety contracts remain unchanged.

**Gate result (15/11/2026):** ART-04 is accepted. Local and P2P renderers
share the ART-03 scrapyard obstacle material with an opaque fallback, retain
the native block/ramp dimensions and positions, and limit hazard to the 0.38
base band. Perimeter fixtures are instanced, emissive and `visualOnly`; no
physics, P2P state or nitro pickups are created. Legacy pad metadata is ignored
in combat-alpha because nitro regenerates authoritatively. Focused ART and P2P
renderer tests pass 69/69; asset verification, Pages build and Pages verify
pass. Browser visual QA remains an ART-06 gate.

### Task ART-05: Atmosphere, tiering and performance gate

**Files:**
- Modify: `src/arena-visual-profile.js`, `src/client-performance.js`, `src/client.js`
- Test: `tests/client-performance.test.mjs`, `tests/art-05-quality-contract.test.mjs`

**Interfaces:**
- Consumes: ART-03/04 draw-call and texture metrics.
- Produces: high/low visual quality selection with the same simulation state and a diagnostic material-cost report.

- [x] **Step 1: Capture a fixed baseline before changing quality policy**

Use the combat-alpha lobby camera and existing FPS diagnostics. Record frame time, draw calls, texture count and renderer memory, excluding browser/network startup.

**Step 1 result (15/11/2026):** the reproducible protocol and two stable local
GPU runs are recorded in
`docs/superpowers/briefs/2026-11-15-art-05-performance-baseline.md`. After a
10 s settling discard, each run sampled 60 s at the fixed spawn view. The
current high/full skin measured 140.36 and 143.52 average FPS respectively,
with stable 60 draw calls, 17,422 triangles, 210 geometries, 9 textures and 45
programs. One isolated 47.3 ms worst-window sample occurred in run 1; no
context loss, console error or asset failure was observed. This is the gate
for implementing a restrained quality policy; it is not a low-tier result.

- [x] **Step 1a: Document the capture protocol**

- [ ] **Step 2: Add failing high/low quality tests**

Assert low quality uses the fallback or one base map, high quality enables the approved skin, and no quality switch changes arena geometry or network state.

**Step 2 result (15/11/2026):** the contract is documented in
`docs/superpowers/briefs/2026-11-15-art-05-quality-contract.md`. No executable
tests or tier API were added because the current client has no quality-tier
selector; inventing one would be part of Step 3. The baseline capture remains
a prerequisite for implementing the policy.

- [x] **Step 2a: Document the high/low contract and its non-goals**

- [x] **Step 3: Implement restrained grade and fallback**

Tune fog, exposure and existing directional/hemisphere lighting only after the materials are visible. Preserve current readable team markers and avoid a new post-processing chain.

**Step 3 result (15/11/2026):** implemented a minimal presentation-only tier
policy in the existing local route. `getArenaVisualProfile(mode, { quality })`
defaults to `high`; `?quality=low` selects an opaque combat-alpha fallback
that keeps the existing palette, lighting, team markers, HUD and regenerable
nitro contract. The client passes the selected tier to the existing ART-03
adapter and to `readRendererInfo` diagnostics; low-tier obstacles use the
existing opaque fallback. No fog, exposure, lighting, topology, collider,
spawn, physics, tick, authority, snapshot, input ACK or network behavior was
changed, and no pickup was added. Focused quality, profile, material, map and
decoration tests passed before accepting this integration. Step 4 then measured
the low tier against the high baseline and closed the performance gate below.

- [x] **Step 4: Measure and enforce the budget**

Run the same scenario in both tiers. High must remain within 10% of baseline frame time; otherwise reduce texture sampling/props rather than change physics or lower simulation tick rate.

**Step 4 result (15/11/2026):** two valid foreground Chromium low-tier runs
were captured with the same 10 s settling + 60 s fixed-spawn protocol. Low
measured `143.91` and `143.98` average FPS at `6.92 ms` in both runs, versus
high `140.36`/`143.52` FPS at `7.14`/`6.94 ms`. Low stayed below high in draw
calls (`56` vs `60`), textures (`1` vs `9`) and programs (`37` vs `45`), with
no console warnings or context loss. The measured high/low budget is accepted
for this Chromium/AMD environment. Cross-browser and manual visual QA remain
ART-06 work.

### Task ART-06: Visual QA and release readiness

**Files:**
- Modify: `_bmad-output/current-roadmap.md`
- Create: `docs/reference-captures/industrial-scrapyard-visual-qa.md`
- Test: relevant focused tests, `npm run build:pages-beta`, `npm run verify:pages-beta`

**Interfaces:**
- Consumes: ART-01–ART-05 evidence.
- Produces: a documented acceptance state; no deployment command.

- [x] **Step 1: Capture required visual cases**

Document floor, all four curves, wall-to-ceiling curve, native ramp/block, each quality tier, texture-load failure fallback and multiplayer car readability.

**Step 1 result (16/11/2026):** local WASM high/low routes and a locally served
Pages package were exercised with the fixed combat-alpha view. The authored
vehicle, HUD and regenerable-nitro meter rendered; the package loaded the
manifest and four WebPs with HTTP 200 responses; no runtime renderer errors or
context loss occurred. The public P2P renderer now reports `textured` for its
`balanced` default and `pickupCount: 0`. Multiplayer readability is confirmed
for the single-car package view; the two-browser online check remains a manual
release gate on the canonical HTTPS origin.

- [x] **Step 2: Run package checks**

Run: focused ART tests, then `npm run build:pages-beta` and `npm run verify:pages-beta`.
Expected: assets are packaged locally and the output verifies.

**Step 2 result (16/11/2026):** focused ART/renderer tests pass 70/70;
`npm test` passes 586/586 with 7 documented skips; `npm run build:pages-beta`
and `npm run verify:pages-beta` both exit 0. The package contains 100 reviewed
files. The only local signal error observed in the package server is the
expected Worker origin allowlist rejection for `127.0.0.1`, not a Pages
runtime failure.

- [x] **Step 3: Update the roadmap with measured evidence and remaining browser checks**

Do not claim visual parity or browser-wide performance without screenshots and human verification in Chrome, Edge, Firefox, Opera and Brave.

**Step 3 result (16/11/2026):** evidence is recorded in
`docs/reference-captures/industrial-scrapyard-visual-qa.md` and this roadmap.
ART-06 is accepted for local/package QA; it deliberately does not claim
browser-wide parity or production deployment. A manual two-browser smoke on
the canonical HTTPS origin remains required before publishing Pages.

## Self-review

- The plan maps every design goal to ART-01 through ART-06; no task changes
  simulation, authority or collision.
- ART-02 cannot start without the provenance gate, ART-03 cannot start without
  budgeted local derivatives, and each later task has a focused test gate.
- The most likely visual regressions—curve seam, texture load failure, prop
  placement, performance cost and car readability—are explicitly owned by
  ART-03 through ART-06.
- The plan deliberately defers generated normals, true fence alpha and a large
  prop set until their source material and measured budget justify them.
