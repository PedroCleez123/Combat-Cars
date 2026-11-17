# ART-03 Delegation Brief — Continuous Scrapyard Shell Material

**Status:** Ready for a future bounded delegation. ART-03 is explicitly **not
executed in this task**.

## Source of truth

- Plan: `docs/superpowers/plans/2026-11-15-industrial-scrapyard-arena.md`
- Design/spec: `docs/superpowers/specs/2026-11-15-industrial-scrapyard-arena-design.md`
- ART-01 inventory and ART-02 measured package:
  `docs/superpowers/specs/2026-11-15-industrial-scrapyard-asset-inventory.md`
  and `src/assets/arena/scrapyard/manifest.json`
- Existing shell/profile code: `src/client.js` and
  `src/arena-visual-profile.js`

## Allowed files

The delegated change may touch only:

- `src/arena-scrapyard-material.js` (new)
- `src/client.js`
- `src/arena-visual-profile.js`
- Focused tests for the material/profile/decorations contract, especially
  `tests/arena-scrapyard-material.test.mjs`,
  `tests/arena-visual-profile.test.mjs`, and
  `tests/arena-decoration.test.mjs`

Do not edit assets, manifests, Pages allowlists, package scripts, physics/WASM,
network, gameplay rules, arena geometry/topology, colliders, or unrelated tests.

## Contract

Implement `createScrapyardShellMaterial({ THREE, renderer, quality })` returning
`{ material, ready, dispose }`. The material must use the local ART-02 URLs
asynchronously, set loaded albedo textures to sRGB, and dispose every loaded
texture and material resource. Keep allocation out of the render loop.

The shell is one continuous world-space material. Projection must work across
floor, quarter-pipes, walls, corner fillets, and ceiling without relying on
per-patch UVs or adding UV-dependent geometry. Use stable world scale and
normal-aware blending where needed. Do not add colliders, dynamic lights,
props, physics bodies, WASM changes, P2P messages, or network objects.

On low quality, unsupported renderer, failed local load, or any missing asset,
fall back cleanly to the existing opaque `COMBAT_ALPHA_PROFILE.surface`
material. The fallback must remain valid and visible; never expose a black,
transparent, remote, or partially broken shell.

## Validation expected from ART-03

Run the focused material/profile/decorations tests from the plan. Confirm local
URLs, sRGB assignment, no UV-dependent shell assumptions, clean fallback, and
that `dispose()` releases all loaded textures. Do not claim ART-03 completion
until those checks pass. This brief only prepares the delegation; no ART-03 code
or runtime wiring is included in ART-02 integration.
