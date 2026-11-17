# Industrial Scrapyard Asset Inventory (ART-01)

**Status:** ART-01 source audit complete; ART-02 is integrated with the measured
four-texture package. The package satisfies its local contract and the main
worktree passes the inherited asset verification. Pages build/release checks
remain a separate environmental gate.

**Scope:** ART-01 source audit and ART-02 derivative evidence. Only the four
approved WebP derivatives and their manifest are runtime assets; raw source PNGs
are not included.

**Consumers:** ART-03 (world-space shell material), ART-04 (visual-only
decoration), ART-06 (visual QA and release readiness).

## Decision summary

- **Approved initial albedo set (exactly four):** floor concrete, wall concrete,
  corrugated metal, and hazard warning. Hazard is approved only as a constrained
  edge/decal derivative, but it is the fourth initial albedo.
- **Deferred:** chain-link fence until a real alpha mask exists; asphalt road
  stripes as an optional small floor decal.
- **Rejected as an arena map:** `ejemplo textura.png`, the top-down composition
  reference. It must not be loaded, tiled, projected over the arena, or used to
  derive UVs.
- **Budget:** target **4 MiB compressed** (4,194,304 bytes); hard stop **6 MiB**
  (6,291,456 bytes) until a measured exception is explicitly approved.
- **ART-02 gate:** redistribution rights are confirmed by the user. ART-02 may
  package only the four approved sources listed below; the deferred candidates
  remain excluded.

## Source inspection

The six candidates and two references were inspected at their user-supplied
locations. They were **not copied into this worktree or repository**. All six
candidate images are 1024 × 1024 RGB PNGs with no alpha channel. The table below
records their source metadata; the hashes identify the exact files reviewed by
this audit.

| Candidate | Dimensions | Source bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `Meshy_AI_ground_concrete_cracked_texture.png` | 1024 × 1024 | 2,913,905 | `606d9c4311fafe4225228e8d5c2798c3ba4114102a7c23e0319bb819a07849be` |
| `Meshy_AI_worn_concrete_graffiti_texture.png` | 1024 × 1024 | 2,965,951 | `73a5d861e6cbe487845c9afab75357cd27ba36833ebb1b81229b1ad567470c4f` |
| `Meshy_AI_rusty_corrugated_metal_texture.png` | 1024 × 1024 | 2,627,262 | `bfcae3c6446a578a683329481a0e4bf1bdc80e34b447f939925a61d81562d03b` |
| `Meshy_AI_hazard_stripes_warning_texture.png` | 1024 × 1024 | 2,471,325 | `edcfa0cb7ff90b40853c795efae9bb050cc19069adfbd6170fd70002ce83e4aa` |
| `Meshy_AI_chainlink_metal_fence_texture.png` | 1024 × 1024 | 1,414,552 | `de2f6a24eadc7dae632b0e45ff7107c540992e6153db10c3b738eb1a283ae025` |
| `Meshy_AI_asphalt_road_stripes_texture.png` | 1024 × 1024 | 2,832,893 | `9db7cc199f77ecc37ac912e838dd30cce4fe6e1242accc6d219cbc077fb3a900` |

The candidate source set is 15,225,888 bytes (14.52 MiB), but the raw PNGs are
**not** the shipping budget. Only approved WebP derivatives count against the
package budget.

## Candidate material table

One row per supplied candidate. “Aprobado” means approved for the initial
ART-02 package; “Aprobado condicionado” means approved but only for the stated
constrained use; “Aplazado” means not packaged in ART-02.

| Candidate | Visual role | Intended surface | Defect / constraint | Repeatable? | Alpha / transparency | Colour space | Recommended derivative | Cost / budget | Disposición |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Meshy_AI_ground_concrete_cracked_texture.png` | Primary floor albedo: cracked concrete, oil stains, tyre wear, embedded scrap silhouettes | Floor and the lower quarter-pipe band; not ceiling | Strong unique debris and oil marks break at tile edges; not seam-free. High contrast can hide lane markings if repeated too small | Conditional: world projection with Repeat or Mirrored wrapping at a large, stable world scale; validate repetition in ART-03 | None; RGB opaque | sRGB albedo | 1024 × 1024 WebP, quality 82, mipmaps; no normal map; low-frequency world projection | 2.78 MiB source; 381,584 B derivative; cap 512 KiB | Aprobado |
| `Meshy_AI_worn_concrete_graffiti_texture.png` | Wall and obstruction base: worn concrete panels, rust streaks, graffiti | Vertical walls, corner fillets, native block and ramp bodies; not floor | Prominent graffiti, rust and panel joints make small-repeat tiling obvious; busy detail can compete with cars | Conditional: low-frequency world projection; the panel grid repeats, but keep graffiti away from eye-level focal bands | None; RGB opaque | sRGB albedo | 1024 × 1024 WebP, quality 82, mipmaps; no normal map; larger world scale than the floor | 2.83 MiB source; 384,662 B derivative; cap 512 KiB | Aprobado |
| `Meshy_AI_rusty_corrugated_metal_texture.png` | Corrugated metal albedo: painted blue steel with heavy rust | Upper wall/ceiling panels, native obstacle caps, light-gantry panels; not floor | Heavy rust mottling can read noisy at distance; the rib scale must stay constant across surfaces | Yes: periodic horizontal corrugation; repeat horizontally and keep vertical edges continuous | None; RGB opaque | sRGB albedo | 1024 × 1024 WebP, quality 82, mipmaps; no normal map; repeatable rib scale | 2.51 MiB source; 351,806 B derivative; cap 512 KiB | Aprobado |
| `Meshy_AI_hazard_stripes_warning_texture.png` | Warning accent and edge decal: yellow/black diagonal stripes | Exposed obstacle edges, ramp lip and small perimeter bands; never a large wall or floor field | Riveted frame on all four borders makes full-surface tiling look like a billboard; diagonal stripes can overpower team colours | No as a full surface: crop the interior stripe field for a single strip or decal; no frame in the derivative | None; RGB opaque; use geometry/clipping for shape, not alpha | sRGB albedo | 512 × 512 WebP crop of the stripe field, quality 82; no frame; one decal or constrained strip | 2.36 MiB source; 83,482 B derivative; cap 256 KiB | Aprobado condicionado: edge/decal use only |
| `Meshy_AI_chainlink_metal_fence_texture.png` | Fence cutout for distant perimeter dressing (future) | Perimeter fence outside the playable shell; never a driving lane | Opaque grey background; no alpha; using it as-is would render a solid card, not a fence | Pattern repeats, but only usable after a real alpha mask is supplied or generated in a later approved task | **None in the source**; requires a real alpha mask. Do not auto-key the grey background in ART-02 | sRGB albedo; linear alpha only if a separate mask is later approved | Deferred; if later approved: 1024 WebP albedo plus a real alpha mask, not part of ART-02 | 1.35 MiB source; ~82 KiB opaque-base estimate; cap 512 KiB only if later approved; **excluded from the current 4 MiB package** | Aplazado until a real alpha mask exists |
| `Meshy_AI_asphalt_road_stripes_texture.png` | Optional floor marking/decal: asphalt with yellow and white road lines | Small service/lane marking or floor accent; never the full arena floor | Fixed road cross and line layout are not tileable; markings compete with the centre ring and spawn readability | No: a single crop or decal only; never repeat across the arena | None; RGB opaque | sRGB albedo | Deferred; if later approved: 512 × 512 WebP crop for one decal, not a shell texture | 2.70 MiB source; ~87 KiB derivative estimate; cap 128 KiB only if later approved; **excluded from the current 4 MiB package** | Aplazado: optional decal, not in the initial set |

### Approved set boundary

The initial set is exactly these four albedos:

1. `Meshy_AI_ground_concrete_cracked_texture.png` — floor.
2. `Meshy_AI_worn_concrete_graffiti_texture.png` — wall/obstruction.
3. `Meshy_AI_rusty_corrugated_metal_texture.png` — metal/panels.
4. `Meshy_AI_hazard_stripes_warning_texture.png` — hazard edge/decal.

No fifth texture may be sampled by the full-quality shell. The low-quality
fallback uses the existing solid material and, at most, the same floor
derivative or the solid colour; it does not add a new source. The deferred
fence and asphalt candidates are outside this set.

## Reference-only files

These are composition/mood references. They are not runtime assets, are not
part of the package budget, and must not be copied into `src/`, `public/`, or
any Pages allowlist.

| Reference | Dimensions | Bytes | Use | Disposición |
| --- | ---: | ---: | --- | --- |
| `Ejemplo2.jpg` | 1344 × 576 | 221,726 | Perspective mood: arena scale, warm practicals, perimeter scrap density, car readability | Reference only; not runtime |
| `ejemplo textura.png` | 1024 × 667 | 1,179,025 | **Top-down composition reference**; RGBA container but the alpha channel is fully opaque | Reference only; **rejected as an arena map** |

`ejemplo textura.png` is the top-down texture referred to by the design. It is
**rejected as an arena map**: it must not be projected over the floor, tiled as
a shell material, used as a UV atlas, or packed into the runtime. It may only
inform perimeter composition and colour mood. This rejection does not apply to
the ground-concrete candidate, which is a material for the floor surface, not a
whole-arena layout map.

## Derivative rules

- Convert only approved sources to **WebP** with mipmaps. Do not ship the raw
  PNGs.
- The approved set is **albedo-only** for the first skin. Do not ship normal,
  displacement, roughness, metalness, HDR, video, or transparent full-screen
  maps in ART-02 through ART-04.
- Declare every albedo as sRGB (`THREE.SRGBColorSpace`). If a future alpha mask
  is approved, declare the alpha data as linear/non-colour, not sRGB.
- No texture may be fetched from a remote host. All derivatives must be local,
  relative, hash-manifested, and included exactly once by the Pages allowlist.
- The derivative bytes and SHA-256 values are measured from the actual ART-02
  WebP files; estimates do not replace measured package data.
- The hazard derivative must remove the riveted frame and remain a constrained
  decal/strip. Do not use the full hazard image as a wall or floor material.
- The chain-link candidate must not be chroma-keyed or alpha-keyed in ART-02.
  It stays deferred until a real alpha mask is supplied or generated by a later
  approved task.
- The asphalt candidate stays deferred; if later approved, use a single crop as
  a small decal, never as a repeatable shell texture.

## Package budget

| Item | Cap | Measured |
| --- | ---: | ---: |
| Floor concrete derivative | 512 KiB | 381,584 B (373 KiB) |
| Wall concrete derivative | 512 KiB | 384,662 B (376 KiB) |
| Corrugated metal derivative | 512 KiB | 351,806 B (344 KiB) |
| Hazard decal derivative | 256 KiB | 83,482 B (82 KiB) |
| **Approved four, cumulative** | **1,792 KiB (1.75 MiB)** | **1,201,534 B (1.15 MiB)** |
| Package target | 4 MiB = 4,194,304 bytes | 1,201,534 B |
| Hard stop | 6 MiB = 6,291,456 bytes | 1,201,534 B |

The measured package leaves about 2.85 MiB under the 4 MiB target and about
4.85 MiB under the 6 MiB hard stop. If a future package exceeds 4 MiB, stop and re-scope; do not
exceed the 6 MiB hard stop without an explicit, measured exception approved by
the user. Deferred fence/asphalt files, if later approved, require a new budget
re-baseline and remain subject to the same hard stop.

## Provenance and licence gate

- **Declared source:** all six candidates and both references are
  **user-supplied** files. On 2026-11-15 the user confirmed ownership and
  redistribution rights for the four approved sources; this confirmation is
  recorded in `src/assets/arena/scrapyard/manifest.json`.
- The `Meshy_AI_` filename prefix is a **declared generation hint**, not proof of
  ownership, licence, or permission to redistribute. Do not treat the prefix as
  a licence.
- ART-02 records the origin, derivation settings, source SHA-256, derivative
  SHA-256, bytes, dimensions, and permissions reference for every approved
  source in the derivative manifest.
- If provenance or redistribution rights cannot be confirmed, do not package
  that source. Keep the existing solid `COMBAT_ALPHA_PROFILE.surface` material
  as the fallback; a missing texture must never produce a black or broken shell.
- This document records a gate, not a licence grant. The references are not
  packaged and are outside the runtime licence review, but they must still not
  be copied into production paths.

## ART-02 integrated package

The four approved derivatives are local, opaque sRGB WebP albedos. Their source
and derivative hashes, derivation recipe, permissions record, intended surfaces,
and byte caps are in `src/assets/arena/scrapyard/manifest.json`.

| ID | Runtime path | Dimensions | Bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `ground-concrete` | `src/assets/arena/scrapyard/ground-concrete.webp` | 1024 × 1024 | 381,584 | `cafe928357fa8ea16050e91c6bad83fb81ca6b4537ccbdaca0c6be6350da3e85` |
| `wall-concrete` | `src/assets/arena/scrapyard/wall-concrete.webp` | 1024 × 1024 | 384,662 | `33ad19b51fe2b8065ead0563def6a83675ff2e255fee792f5f522ff582c2b104` |
| `corrugated-metal` | `src/assets/arena/scrapyard/corrugated-metal.webp` | 1024 × 1024 | 351,806 | `adb8d4349dca1c1f9c079b38eec892fecd2bcfe12e1ccd516db6a43bfc597cef` |
| `hazard-stripes` | `src/assets/arena/scrapyard/hazard-stripes.webp` | 512 × 512 | 83,482 | `70b53b3d484ce85de88c63b1e76dcc283ce97c0dd8fb92c13ef9af7a5af486de` |

**Total:** 1,201,534 bytes (1.15 MiB), below the 4 MiB target and 6 MiB hard
stop. The integration manifest and explicit Pages allowlist include each
derivative exactly once; Pages also includes the texture manifest. No raw PNG,
fence, or asphalt image is packaged.

**Integration state:** ART-02 is integrated and `verify:assets` passes in the
main worktree with 19 assets, including `src/assets/vehicle/model.gltf` at the
manifested 24,134 bytes. An isolated DeepAI worktree contained an unrelated
25,382-byte copy of that model; it was not copied into the main project and is
not part of ART-02. The former Pages build/verify access issue was resolved by
regenerating readable RocketSim WASM artifacts; both Pages commands now pass.
pre-existing WASM/vendor artifacts are unavailable or locked in the output
directory.

## ART-03 handoff

Use this measured package through the bounded implementation brief at
`docs/superpowers/briefs/2026-11-15-art-03-continuous-shell-material.md`.

## Implementation constraints confirmed by code review

- The combat-alpha shell is one opaque shared `MeshStandardMaterial` and the
  unified shell deletes UVs before welding (`src/client.js`,
  `addUnifiedRocketSimArenaShell`). ART-03 must therefore use world-space
  projection; this inventory does not approve per-patch UV islands.
- The solid fallback is defined by `COMBAT_ALPHA_PROFILE.surface`
  (`materialColor`, roughness, metalness, emissive) in
  `src/arena-visual-profile.js`. A failed texture load or low-quality tier must
  retain that material.
- Decoration is presentation-only and exposes `visualOnly: true` through
  `createArenaDecoration` (`src/arena-decoration.js`). No inventory item may add
  a collider, physics body, P2P message, or dynamic point light per prop.
- Texture derivatives are local assets; the Pages build uses an explicit
  allowlist (`tools/build-pages-beta.mjs`). ART-02 must add each approved file
  exactly once and must not broaden the allowlist to a directory copy.

## ART-01 self-review

- [x] All six supplied candidates are inventoried; both references are recorded
  and marked non-runtime.
- [x] Every candidate row includes role, surface, repeatability, alpha/colour
  space, recommended derivative, cost/budget, and disposition.
- [x] Exactly four initial albedos are approved: floor, wall, metal, hazard.
- [x] Chain-link is deferred until a real alpha mask exists.
- [x] The top-down reference is explicitly rejected as an arena map.
- [x] The 4 MiB target and 6 MiB hard stop are recorded with byte values.
- [x] Assets are recorded as user-supplied, with a licence/provenance gate
  before packaging.
- [x] No source image was copied into the worktree; no code, test, runtime
  asset, WASM, physics, network, build, or production file was changed.

## Decision recorded for ART-02

The user confirms that the four approved images were created with another AI
and may be used and redistributed in Combat Cars without restriction. No other
question blocks ART-02: fence alpha, asphalt decal use, repetition tuning, and
final visual validation belong to later tasks.
