# ART-05 Step 2 — High/Low Quality Contract Test Specification

**Status:** specification only. No test file was added in Step 2 because the
current local route has no tier selector or tier state to exercise. Inventing
that API here would pre-empt ART-05 Step 3 and would violate the Step 2
boundary.

**Scope:** define the focused tests that Step 3 must satisfy when it adds a
high/low visual policy. This document is not a policy implementation, not a
performance measurement and not a claim that ART-05 is complete.

## Why this is a specification, not a test file

The existing surfaces are sufficient for material-level tests but not for a
tier-switch contract:

- `getArenaVisualProfile(mode)` returns one profile and accepts no quality
  argument.
- `COMBAT_ALPHA_PROFILE.surface` describes the current high skin
  (`skin: "industrial-scrapyard"`, local manifest, opaque fallback fields).
- `createScrapyardShellMaterial({ THREE, renderer, quality })` already supports
  `"high"` and a fallback for non-high quality. Existing tests in
  `tests/arena-scrapyard-material.test.mjs` cover that material behavior.
- `src/client.js` hardcodes `quality: "high"` for both the unified shell and
  the native obstacle skin. There is no `qualityTier`, `setQualityTier`,
  low-quality profile, or tier-change event in the local client.
- The client and profile expose no authoritative simulation state for a
  Node-level tier test. Tick, physics, snapshots and network authority live
  outside the visual profile.
- `COMBAT_ALPHA_PICKUPS` is already empty and `COMBAT_ALPHA_MAP.pickups`
  already points to it; this contract must preserve that result.

Adding a fake selector, a new profile variant, or a simulated tier state only
to make tests run would invent the Step 3 API. Per the task, the safe output
is this test specification; Step 3 can add the minimal selector and then the
tests below become executable.

## Proposed test target

When Step 3 introduces the policy, add one focused file:

`tests/art-05-quality-contract.test.mjs`

Reuse, rather than duplicate:

- `tests/arena-scrapyard-material.test.mjs` for high/low material loading,
  fallback opacity, texture count, disposal and the existing `quality`
  argument.
- `tests/arena-visual-profile.test.mjs` for profile selection and combat-alpha
  presentation fields.
- `tests/combat-alpha-map.test.mjs` for native obstacle dimensions, spawn
  reading and the empty pickup contract.

The new file covers only the policy boundary that does not exist today: tier
selection, tier switching and state isolation.

## Required test cases

### 1. High tier enables the approved industrial skin

Given the combat-alpha local route and the high/full tier:

- the selected tier resolves to the combat-alpha profile;
- `profile.surface.skin === "industrial-scrapyard"`;
- `profile.surface.textureManifest` is the local ART-02 manifest URL;
- `profile.surface.textureBudgetBytes` equals the approved budget;
- `createScrapyardShellMaterial(..., quality: "high")` starts with the opaque
  profile fallback and becomes `textured` only after all four approved maps
  load;
- the material remains `transparent === false`, `opacity === 1`,
  `depthWrite === true` and `depthTest === true` in both states;
- no collider, body, pickup, RocketSim state or network object is created.

The existing material tests may remain the primary proof for the loading
details; this test should assert the high-tier selection and the profile
identity.

### 2. Low tier preserves an opaque fallback

Given the same route and a low tier:

- the selected tier is not the high `industrial-scrapyard` skin;
- the material is the existing opaque profile fallback or exactly one local
  repeatable base map;
- if it uses the fallback, no texture request is made and
  `material.userData.scrapyard.enabled === false`;
- if it uses one base map, the sampled texture count is exactly one and it is
  a local approved asset, not the four-map set;
- `transparent === false`, `opacity === 1`, `depthWrite === true` and
  `depthTest === true`;
- no hazard/metal/floor/wall four-way shader sampling is introduced for the
  low tier;
- unsupported renderers, missing manifest roles, load failure and disposal
  still leave a visible opaque material.

The current `quality: "low"` branch already provides the fallback behavior;
Step 3 must connect a tier selection to it without changing that contract.

### 3. Tier switching cannot change arena state

Before and after `high → low → high` (or `low → high → low`), compare deep
snapshots of the existing read-only contracts:

- `getArenaVisualProfile("rocketsim-combat-alpha")` has the same combat-alpha
  identity, arena-facing fields and team/landmark colors;
- `rocketSimArenaProfile("combat-alpha")` is unchanged: name, dimensions,
  half extents, height, curve radius and corner flags;
- `COMBAT_ALPHA_MAP.obstacles` still contains exactly the native central block
  and south ramp with the same coordinates and dimensions;
- `COMBAT_ALPHA_MAP.spawnSlots`, `landmarks.teamBeacons`, `landmarks.hazards`
  and `landmarks.centerRing` are unchanged;
- `COMBAT_ALPHA_PICKUPS.length === 0`, `COMBAT_ALPHA_MAP.pickups` is the same
  empty contract, and no pickup mesh or pickup metadata is created by the tier
  path;
- no tier object or tier change exposes colliders, bodies, physics, input,
  snapshot, score or network fields.

If Step 3 adds a runtime tier setter, the test must call it in a deterministic
harness and assert that the same snapshots remain equal. If Step 3 only
supports tier selection at world construction, test both constructed worlds
instead of inventing a setter.

### 4. No simulation or network side effects

The tier path must not:

- advance or reset a match tick, teleport a car, change a spawn, score, input
  acknowledgement or snapshot sequence;
- send a network message, create a WebRTC/WebSocket channel, alter a P2P room
  or change server authority;
- create a pickup, boost pad, physics body, collider or collision offset;
- alter the fixed combat-alpha camera or HUD ownership.

Use a deterministic fake or the existing read-only snapshots where the local
client exposes them. Do not add simulation hooks merely for this test. If the
current structure cannot observe a value, record the limitation in the test
name or skip that assertion until ART-05 has a supported observation surface.

### 5. Legibility of cars, projectiles, teams and HUD

The tier contract must preserve the existing presentation identity:

- combat-alpha retains distinct blue/red team colors, six team beacons
  balanced three per side, two team washes and the center objective color;
- the native central block and south ramp remain present at their native
  dimensions and positions;
- the existing HUD selectors remain available and owned by the HUD:
  `#performance-readout`, `#readout`, `#events`, `.scoreboard` and
  `#combat-loading`;
- the nitro resource remains authoritative and regenerable; no pickup HUD,
  pickup counter, pad mesh or floor pickup is introduced;
- cars, projectiles, team markers and effects are not hidden, recolored to the
  arena background, or made dependent on the industrial texture set;
- low quality may simplify the shell material only; it may not remove the
  cars, projectiles, team markers, scoreboard or nitro feedback.

Node tests can assert profile colors, counts, map contracts and source-level
HUD selectors. Actual rendered contrast, projectile visibility and car
readability remain browser/manual checks for ART-06; do not fake a pixel
comparison here.

### 6. Optional P2P cross-check

If Step 3 changes shared presentation code, record one P2P sample with
`window.__COMBAT_CARS_DIAGNOSTICS__`:

- record the P2P launch/serve command, room URL, `qualityMode`, `qualityAuto`,
  `qualityDowngrades`, `qualityUpgrades`, `qualityAverageFrameMs`,
  `contextLossCount` and `renderer.rendererInfo`;
- reject the sample if automatic quality changes during the window;
- do not enable `diagnosticsReadback`;
- a single local tab has no rival car, so label the sample as a one-tab
  shell/parity check and never present it as a full-match baseline.

This is a manual/runtime check, not a replacement for the local tier tests.

## Failing-first expectation for Step 3

Before Step 3's selector exists, the new policy-level test file should fail
because it cannot obtain two tiers without inventing an API. Step 3 should
make these tests pass by adding the smallest selector needed for the existing
high material and low fallback; it must not add a second renderer, a new
adaptive-resolution policy, new shadows, new HUD elements, pickups or
simulation hooks.

## Acceptance for the Step 2 contract

1. The existing high skin remains the current baseline; no measurement values
   are claimed.
2. The low path is explicitly allowed to be the opaque fallback or one base
   map, never a four-map or transparent whole-arena surface.
3. Tier changes are presentation-only and preserve arena geometry, physics,
   tick, authority, snapshots, network state and the empty pickup contract.
4. Team, car, projectile and HUD legibility constraints are explicit; visual
   contrast remains an ART-06 manual check.
5. Tests are deterministic, local and free of GPU readback or network traffic.
6. The performance baseline gate from
   `2026-11-15-art-05-performance-baseline.md` remains a separate manual gate;
   these tests do not assert FPS, frame time or draw-call budgets.

## Explicit non-goals

- No tier policy, material change, adaptive resolution, shadow change, HUD
  change, P2P change, WASM change, asset change or simulation change.
- No new test file in Step 2; this specification defines the file for Step 3.
- No real performance numbers and no claim that ART-05 is complete.
