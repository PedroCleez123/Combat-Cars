# Industrial Scrapyard Arena Design

## Intent

Combat-alpha must read as a large, worn industrial scrapyard rather than an
empty coloured volume. It must retain the speed, visibility and unmistakable
boundaries of a competitive car arena: visual detail may strengthen depth and
orientation, but may never make a player mistake a cosmetic prop for a
RocketSim collider.

The supplied reference establishes the mood—weathered concrete, oxidised steel,
hazard paint, harsh lamps and peripheral scrap—not a literal exterior yard or
a photographic texture projected over the whole map. The supplied top-down
image is composition reference only; it is not an arena texture.

## Goals

- Give the floor, quarter-pipes, walls, corner fillets and ceiling a coherent,
  continuous PBR presentation that makes the 264 × 408 × 108 arena legible.
- Use the supplied material candidates as local game assets after provenance,
  byte size, colour space, repeatability and alpha suitability have been
  recorded.
- Add restrained industrial landmarks at the perimeter: light gantries,
  hazard-clad obstacles, corrugated detail, and later optional fence/scrap
  silhouettes beyond playable sight lines.
- Keep the car, opponents, projectiles, target state and team colours readable
  against every surface.
- Preserve the accepted FPS work: texture handling, draw calls and lighting
  must have a stated measurable budget and a quality fallback.

## Non-goals

- No change to RocketSim geometry, broadphase, colliders, spawns, camera
  bounds, P2P messages, room lifecycle, controls or match rules.
- No full repaint based on the top-down reference, no photogrammetry, no Unity,
  Godot, Estella runtime, WebGPU requirement, remote texture host or new game
  engine dependency.
- No loose piles, props or transparent fence cards in driving lanes; no
  darkness, smoke or post-process that conceals opponents.
- No unreviewed third-party asset use. Supplied textures must be marked as
  user-provided or have their source/licence recorded before being packaged.

## Presentation architecture

RocketSim WASM remains the only collision authority. The Three.js renderer
continues to build the combat-alpha visual shell from
`rocketSimArenaVisualSpec()` and `addUnifiedRocketSimArenaShell()` in
`src/client.js`. The new skin attaches only to those already-rendered meshes
and to `createArenaDecoration()` visual-only objects.

The shell currently deletes UVs while welding its floor, quarter-pipes, wall
and ceiling patches. ART-03 therefore must not stretch independent UV islands
over the curved geometry. It will introduce a single world-space material
adapter, using a continuous world-coordinate projection with normal-weighted
blending at the quarter-pipes and corner fillets. The adapter must use stable
world scale, so changing arena size cannot change material density. It will
select a small, fixed material set rather than create a unique material per
surface.

The first shipped skin uses only colour/albedo, roughness and metalness;
normal/displacement maps are explicitly deferred until a measured later task.
This avoids misleading depth, shader cost and loading many heavy maps before a
visual baseline exists.

## Art direction

| Surface | Primary treatment | Accent | Readability rule |
| --- | --- | --- | --- |
| Floor | dark cracked concrete / asphalt, restrained tyre wear | faded lane or maintenance marks in safe visual zones | centre and spawn rings remain cleanly visible |
| Curves and lower walls | same concrete family with grime gradient | subtle rust near joins, no hard seam | continuous mapping through floor-wall transition |
| Upper walls / ceiling | desaturated concrete and corrugated industrial panels | dim structural ribs / warm lamps | never blacken cars or hide ceiling boundary |
| Native block and ramp | worn concrete body, corrugated cap and small hazard bands | yellow-black only at exposed edges | silhouette stays identical to native obstacle |
| Outer dressing | fence, stacked scrap silhouettes, containers and lamps | cool ambient plus sparse warm practicals | outside collision shell and driving/camera lanes |

The current candidate textures are provisional source material:

- `Meshy_AI_ground_concrete_cracked_texture.png`: floor base.
- `Meshy_AI_worn_concrete_graffiti_texture.png`: wall / obstruction base.
- `Meshy_AI_rusty_corrugated_metal_texture.png`: industrial panels and caps.
- `Meshy_AI_hazard_stripes_warning_texture.png`: constrained edge decals only.
- `Meshy_AI_chainlink_metal_fence_texture.png`: deferred until an explicit
  alpha mask exists; the supplied image is not a usable transparent fence.
- `Meshy_AI_asphalt_road_stripes_texture.png`: optional small floor marking;
  never tiled across the full arena.

## Asset and runtime budget

- First-pass package increment: target **≤ 4 MiB compressed** for all new arena
  textures; hard stop at **6 MiB** until a measured exception is approved.
- Max four simultaneously sampled base textures in the full-quality shell;
  quality fallback uses a single repeatable base texture and scalar material
  colours.
- No normal, displacement, video, HDR or transparent full-screen material in
  ART-02–ART-04.
- Shell texture resolution must be decided from a 1024 px source review;
  prepare WebP derivatives with mipmaps rather than shipping six raw PNGs.
- Perimeter props use shared geometry/materials and `InstancedMesh` where a
  module repeats. They must add no point-light-per-prop pattern.
- Preserve the existing single shadow-casting directional light. Practical
  lamps are emissive by default; any extra dynamic light needs an explicit
  measured exception.
- At the fixed combat-alpha lobby camera, full quality must remain within 10%
  of the measured baseline frame time; fallback must remain available if this
  fails.

## Quality tiers and failure behaviour

`high` may use the full world-space skin, four texture maps and sparse
emissive fixtures. `low` uses the existing solid shared material plus one
repeatable base texture, retaining the same silhouette and lighting contract.
Failed or late texture loads must leave the existing clean material visible;
they must not leave black meshes, block rendering, retry forever or affect
authoritative state.

## Acceptance criteria

1. The visual shell still derives from the named combat-alpha arena profile;
   its floor, curves, walls, corner fillets and ceiling align with current
   RocketSim collision coordinates.
2. A player can see a car crossing a floor-to-wall curve without a texture seam,
   black line, reversed face, z-fighting or material-scale jump.
3. All included texture assets are local, hash-manifested, correctly declared
   as sRGB albedo, repeatable where tiled and under the approved package budget.
4. Decorative meshes expose `visualOnly: true`, lie outside the playable
   shell/camera lanes, and are never added to physics or P2P state.
5. The low-quality/failure path preserves an intelligible arena and uses no
   additional network or simulation work.
6. Focused visual/material tests, asset verification, Pages build/verification
   and an A/B performance measurement pass before a deployment request.

## Estella decision

Estella is useful only as an optional disposable lighting/composition
previsualiser: it can compare fog, cool/warm grade and prop density before
implementation. There is no Estella project open and the game is a Three.js
runtime, so Estella is not an authoring or runtime dependency for this work.
The production implementation remains local Three.js code and versioned assets.

## Decisions and dependencies

- This visual work takes precedence over deferred PR3 while it is active; PR3
  is not reopened by this design.
- `ART-01` is an asset/provenance gate. No texture is copied into production
  paths until it passes.
- `ART-03` is the first render-code change and must be independently accepted
  before props or atmosphere begin.
- No publication occurs as part of any ART task without a separate user request.
