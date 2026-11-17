# Combat-alpha industrial cover implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir seis coberturas industriales simétricas que bloqueen cohetes y coches mediante proxies RocketSim compartidos, con revestimiento Three.js local/P2P y sin regresiones de arena, red o nitro.

**Architecture:** `src/combat-alpha-map.js` será el descriptor declarativo de IDs, proxies, simetría y despejes. Los dos puentes C++ reflejarán los mismos valores y crearán cuerpos estáticos simples; el host ya posee el único `raycastStatic` autoritativo para interceptar cohetes. Los renderers construirán únicamente compañeros visuales desde el descriptor, con geometría compartida e `InstancedMesh` para neumáticos.

**Tech Stack:** JavaScript ESM, Three.js, RocketSim C++/WASM, Bullet static shapes, Node `node:test`, builds Pages existentes.

**Spec:** `docs/superpowers/specs/2026-11-16-combat-alpha-cover-design.md`

## Global Constraints

- Mantener `combat-alpha` en 264 × 408 × 108 UU y no cambiar la topología de paredes, curvas, techo, rampas o broadphase.
- Mantener RocketSim WASM del host como autoridad; el cliente sólo presenta snapshots.
- No añadir pickups de nitro, mensajes P2P, estado de snapshot, motor de física ni dependencia nueva.
- Reutilizar los WebP ART-02; no bloquear COV por una textura de neumático.
- Mantener tres batches de cobertura, como máximo 6 draw calls y cero luces
  dinámicas nuevas. COV-06 eleva el presupuesto geométrico de neumáticos a
  49.248 triángulos para obtener anillos redondos y ocho
  niveles; se comprobará con la baseline ART-05.
- No publicar Pages hasta completar COV-04 y su QA manual.

## Review Focus

- **Divergencia de contratos JS/C++:** una cobertura puede verse bien pero no bloquear el mismo volumen en WASM; se fija en COV-02 con comparación de IDs, dimensiones y raycasts.
- **Túnel/penetración a alta velocidad:** un coche o cohete puede saltarse una caja fina; se prueba con trayectorias rápidas y segmentos bajo/alto.
- **Ruling COV-02:** las barricadas de neumáticos se desplazan de `(±68, 0)` a
  `(-68, -30)/(68, 30)`; la posición inicial cortaba el contacto de pared
  autoritativo en `z=0`. El coste es perder cobertura exactamente en el eje
  central; se conserva simetría, bypass y corredor de prueba.
- **Bloqueo injusto:** un prop puede cerrar spawn, carril central o recuperación; se prueban despejes, corredores y simetría en COV-01.
- **Divergencia local/P2P:** el renderer P2P aún mantiene una copia de obstáculos; COV-03 exige un descriptor común y paridad por ID.
- **Coste/legibilidad:** las pilas pueden multiplicar mallas o luces y ocultar coches; COV-03/04 comprueban instancing, draw calls, FPS y fallback.

---

### Task 1: Declarative cover layout contract (COV-01)

**Files:**
- Modify: `src/combat-alpha-map.js`
- Test: `tests/combat-alpha-map.test.mjs`
- Test: `tests/combat-alpha-cover-layout.test.mjs` (new)
- Modify: `_bmad-output/current-roadmap.md`

**Interfaces:**
- Consumes: `rocketSimArenaProfile("combat-alpha")`, existing block/ramp descriptors, spawn slots and `isCombatAlphaSafeFloorPoint()`.
- Produces: `COMBAT_ALPHA_OBSTACLES` with four container cover records and two tire cover records; `combatAlphaObstacleFootprint(obstacle, clearance)` (pure); `combatAlphaMapLayout()` returning the same records and validated corridors.

- [ ] **Step 1: Write failing descriptor tests** asserting six new `role: "cover"` records with IDs `container-cover-northwest`, `container-cover-southwest`, `container-cover-northeast`, `container-cover-southeast`, `tire-cover-blue`, `tire-cover-red`; expected nominal dimensions/positions from the spec; unique IDs; no pickups.
- [ ] **Step 2: Add failing geometry invariants** for 180° symmetry, arena bounds, no overlap with spawns/central block/south ramp/curve inset, and free central/outer probe corridors.
- [ ] **Step 3: Implement the descriptor and pure footprint helpers** in `src/combat-alpha-map.js`; preserve existing block/ramp shapes and empty pickup array. Allow only bounded coordinate adjustments if the tests reveal a safe-clearance conflict.
- [ ] **Step 4: Extend `combatAlphaMapLayout()` validation** so every obstacle has a valid kind/role, remains inside the flat floor envelope, and is not a spawn or corridor blocker.
- [ ] **Step 5: Run the focused map tests**: `node --test tests/combat-alpha-map.test.mjs tests/combat-alpha-cover-layout.test.mjs`; expected: all pass and existing block/ramp/pickup assertions remain green.
- [ ] **Step 6: Update the roadmap** from “pending approval” to “COV-01 design approved; implementation pending COV-02” with the spec and plan paths.

### Task 2: Authoritative native/WASM cover proxies (COV-02)

**Files:**
- Modify: `tools/rocketsim-bridge/main.cpp`
- Modify: `tools/wasm-spike/wrapper.cpp`
- Modify: `tests/rocketsim-native-arena-contract.test.mjs`
- Modify: `tests/rocketsim-wasm-combat-alpha-static-raycast.test.mjs`
- Test: `tests/rocketsim-wasm-combat-alpha-cover.test.mjs` (new)
- Test: `tests/rocketsim-native-combat-alpha-cover.test.mjs` (new or extend existing native trace)

**Interfaces:**
- Consumes: COV-01 obstacle descriptor values, `createCombatAlphaArena()`, `addCombatAlphaArena()`, existing `raycastStatic` ABI and `ROCKETSIM_BRIDGE_EXE` optional gate.
- Produces: identical static box proxies in native and WASM; deterministic static-ray fixtures; unchanged ABI for existing profiles.

- [x] **Step 1: Add failing contract assertions** that both bridges enumerate the six cover IDs/values, preserve `useCustomBroadphase=false`, and do not instantiate pickups or dynamic bodies.
- [x] **Step 2: Add deterministic ray fixtures** for a low straight shot through each container/tire proxy, a high shot above each, and a lateral bypass. Keep rays in Arsenal/world basis used by `rs_raycast_static`.
- [x] **Step 3: Implement shared-shaped static proxies** using `btBoxShape`/RocketSim static collision shapes with explicit friction/restitution; use one helper per descriptor kind and keep the existing block/ramp helpers intact.
- [x] **Step 4: Mirror the same proxy list in `wrapper.cpp`** and add fixture initializers or segment contracts without changing the public snapshot/input ABI.
- [x] **Step 5: Add movement/contact probes** showing a high-speed car cannot tunnel through a proxy, can route around it, and can fly above the low tire bank; assert no change to wall/curve/ramp containment.
- [x] **Step 6: Run focused native/WASM tests** with the bridge when available; otherwise require explicit skips only for native executable absence. Expected: deterministic fractions/normals and no broadphase regressions.

### Task 3: Rocket combat interception and lobby safety (COV-02 integration)

**Files:**
- Modify: `tools/wasm-spike/p2p-wasm-combat-host.mjs` only if the existing static-hit path needs no semantic change; otherwise leave it untouched.
- Modify: `tests/p2p-wasm-combat-host.test.mjs`
- Modify: `tests/p2p-wasm-combat-alpha-causal.test.mjs`
- Modify: `tests/rocketsim-combat.test.mjs` only for shared interception assertions if needed.

**Interfaces:**
- Consumes: `raycastStatic()` from COV-02 and existing `staticHits` map consumed by `src/rocketsim-combat.js`.
- Produces: cover hit = `COHETE INTERCEPTADO`/miss with no damage or score; bypass/high shot retains existing behavior; lobby contact never becomes a kill.

- [x] **Step 1: Add failing host tests** for a low rocket intercepted by each cover family, a high/bypass rocket that remains eligible for its target, and an empty static-hit map preserving direct damage.
- [x] **Step 2: Verify no protocol changes are needed**; reject any implementation that adds cover IDs to snapshots, commands, lobby messages or score state.
- [x] **Step 3: Run causal host tests**: `node --test tests/p2p-wasm-combat-host.test.mjs tests/p2p-wasm-combat-alpha-causal.test.mjs tests/rocketsim-combat.test.mjs`.

### Task 4: Shared visual cover companions (COV-03)

**Files:**
- Modify: `src/arena-decoration.js`
- Modify: `src/client.js`
- Modify: `tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs`
- Modify: `tests/arena-decoration.test.mjs`
- Modify: `tests/combat-alpha-perimeter.test.mjs`
- Modify: `tests/p2p-wasm-three-presentation-renderer.test.mjs`
- Test: `tests/combat-alpha-cover-visual.test.mjs` (new)

**Interfaces:**
- Consumes: `combatAlphaMapLayout()` obstacle descriptors, ART-03 material factory/fallback, existing obstacle disposal path.
- Produces: `combatAlphaCoverVisualSpec()` or equivalent descriptor-driven output; visual nodes marked `visualOnly: true` with `nativeColliderId`; same transforms in local and P2P.

- [x] **Step 1: Add failing visual contract tests** for six IDs, native dimensions/positions, visual-only markers, no collider/body/P2P fields, and no pickup meshes.
- [x] **Step 2: Replace hard-coded block/ramp-only presentation for cover records** while preserving existing block/ramp silhouettes and materials.
- [x] **Step 3: Build shared container geometry/material groups** with ART-03 and opaque fallback; apply hazard only as a narrow edge/band, not a full yellow surface.
- [x] **Step 4: Build tire visuals with shared geometry and `InstancedMesh`**; ensure disposal handles geometry/materials and late material failures.
- [x] **Step 5: Make the P2P renderer consume the same descriptor** instead of maintaining a second numeric list; keep `nativeColliderId` metadata presentation-only.
- [x] **Step 6: Run visual/renderer tests**: `node --test tests/arena-decoration.test.mjs tests/combat-alpha-perimeter.test.mjs tests/combat-alpha-cover-visual.test.mjs tests/p2p-wasm-three-presentation-renderer.test.mjs` — **82/82 pass** across the focused COV/ART/P2P/boundary regression set; the individual visual/P2P set passed **56/56**.

### Task 5: Balance, performance and manual QA (COV-04)

**Files:**
- Modify: `docs/reference-captures/industrial-scrapyard-visual-qa.md`
- Modify: `_bmad-output/current-roadmap.md`
- Test/record: `docs/superpowers/briefs/2026-11-16-combat-alpha-cover-qa.md` (new)

**Interfaces:**
- Consumes: COV-01–03 descriptors, focused tests, FPS HUD and renderer diagnostics.
- Produces: evidence-backed acceptance or a bounded follow-up adjustment; no unmeasured publish.

- [x] **Step 1: Run the full relevant regression set**: `npm test`; 588 pass, 7 skips explícitos por bridge nativo ausente, 0 fallos; post-test WASM 3/3.
- [x] **Step 2: Run `npm run build:pages-beta` and `npm run verify:pages-beta`**; 101 archivos, incluidos módulos/activos COV, allow-listed.
- [ ] **Step 3: Capture local gameplay evidence** for spawn, central lane, each cover face, low/high/bypass rockets, car impact, overflight and edge recovery.
- [ ] **Step 4: Capture two-browser P2P evidence** with one host and one guest; confirm the same obstacle silhouettes, rocket interception and no lobby kill/respawn.
- [ ] **Step 5: Record FPS, frame time, draw calls, geometries, textures and programs** against ART-05 high baseline; reject if the incremental budget or 10% frame-time gate fails.
- [ ] **Step 6: Update roadmap to COV accepted only when all tests and manual gates are green; otherwise mark the exact gate pending. Do not deploy Pages automatically.**

**Current gate note:** el fixture de choque de lobby se ha aislado en una pose
diagnóstica del corredor central (`rs_init_trace_combat_alpha_lobby_bump`) para
que COV-04 no confunda una cobertura intencionada con un fallo de contacto
entre coches. WASM ya fue regenerado y el lifecycle pasa; COV-04 sigue
pendiente únicamente de la QA manual local/P2P y de registrar su evidencia.

### Task 6: Dense tire-pile / authoritative-box alignment (COV-05, superseded)

**Files:**
- Modify: `src/arena-decoration.js`
- Modify: `tests/combat-alpha-cover-visual.test.mjs`
- Modify: `_bmad-output/current-roadmap.md`
- Spec: `docs/superpowers/specs/2026-11-17-combat-alpha-tire-cover-alignment-design.md`

**Interfaces:**
- Consumes: tire records from `combatAlphaCoverVisualSpec()` with authoritative
  `width`, `depth` and `height`.
- Produces: a pure, descriptor-derived `combatAlphaTirePileLayout(cover)` and
  a `3 × 4 × 4` instanced pile per tire cover. This specification was
  superseded by COV-06 after human review found the barricade too low and
  polygonal. The renderer remains
  presentation-only and keeps its single solid native box as `nativeColliderId`.

- [x] **Step 1: Write failing envelope tests** for both tire covers: 48 tires
  per cover, 96 total, a `3 × 4 × 4` layout, instance bounds touching the
  `8 × 8 × 2,4` proxy envelope within epsilon, and unchanged map descriptors.
- [x] **Step 2: Run the focused visual test**
  `node --test tests/combat-alpha-cover-visual.test.mjs`; expected: failure
  because the current `3 × 3 × 3` layout exposes only 54 thin, separated tires.
- [x] **Step 3: Implement the minimal pure layout helper and use it in the
  shared instanced renderer.** Use thicker torus cross-sections, four layers,
  and offsets computed from each cover's dimensions rather than hard-coded
  world coordinates. Keep three batches, no lights and no collider fields.
- [x] **Step 4: Re-run the visual and P2P presentation regression set**
  `node --test tests/combat-alpha-cover-visual.test.mjs tests/arena-decoration.test.mjs tests/p2p-wasm-three-presentation-renderer.test.mjs`;
  expected: all pass, `drawCalls === 3`, triangles `<= 6000` and 96 tire
  instances.
- [x] **Step 5: Run the map/authority guard set**
  `node --test tests/combat-alpha-cover-layout.test.mjs tests/rocketsim-wasm-combat-alpha-cover.test.mjs tests/rocketsim-wasm-combat-alpha-cover-contact.test.mjs`;
  expected: all pass without rebuilding WASM because the native proxy is
  intentionally unchanged.
- [x] **Step 6: Run automated integration validation.** `npm test` completed
  with 588 pass, 7 explicit native-bridge skips and 0 failures; the post-test
  raycast benchmark passed 3/3. `build:pages-beta` and `verify:pages-beta`
  both passed with 101 files.
- [ ] **Step 7: Record manual QA.** Inspect a near-side collision and
  overflight locally and in P2P; reject if the visible silhouette no longer
  explains the solid collision volume.

### Task 7: Taller, tangent and rounder tire block (COV-06)

**Objective:** double each tire-cover height while keeping one authoritative
box and making the visual rings tangent, denser and visibly rounder.

- [x] Update both tire descriptors and both RocketSim bridges to `8 × 8 × 4.8`.
- [x] Replace the visual grid with `4 × 4 × 8` tangent rings (128 per cover,
  256 total), with 12 ring and 8 cross-section segments.
- [x] Update low/mid/overflight ray contracts so the band `2.4 < h < 4.8`
  is blocked and `h > 4.8` remains free.
- [x] Keep one static `btBoxShape` per cover, three instanced batches, and no
  pickup, network, or per-tire collider changes.
- [ ] Run WASM rebuild, focused authority/visual/P2P tests, full regression and
  manual local/P2P QA before marking COV-06 accepted.

## Rollback

If any proxy changes wall/ramp containment, spawn safety, rocket damage or P2P
parity, revert only the COV files and leave ART-03/04 assets/materials intact.
No database, Worker, room state or public protocol migration is involved.
