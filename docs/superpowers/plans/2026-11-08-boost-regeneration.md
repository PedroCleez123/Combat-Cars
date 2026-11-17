# Boost regeneration implementation plan

## Hito B-REGEN-01 — native contract and red tests

1. Add a small shared contract module for fixed-step constants and use it from
   the match/presentation tests.
2. Add failing tests for delay, gradual refill, interruption, full-tank clamp,
   lobby infinite boost and empty combat pads.
3. Add a WASM fixture test that exercises the same native ABI after rebuilding
   the wrapper.

## Hito B-REGEN-02 — RocketSim/WASM authority

1. Remove combat-alpha pickup initialization and the per-tick pickup mutator.
2. Add one fixed-tick regen counter per native car in `wrapper.cpp`.
3. Apply regen after RocketSim's step and before snapshots, preserving the
   existing refill ABI for lobby warm-up only.
4. Expose a feature flag/contract in `rocketsim-wasm-backend.js` so an old
   generated module fails closed instead of silently running pickup combat.
5. Rebuild the generated WASM from the checked-out RocketSim source and run
   its smoke/fixture tests.

## Hito B-REGEN-03 — game and presentation integration

1. Keep `RocketSimPracticeMatch`'s infinite refill path for lobby/practice;
   remove pickup event assumptions from combat.
2. Publish empty pads and `rules.pads: false` for active combat.
3. Remove combat-alpha pickup decoration/feedback paths without deleting
   unrelated legacy practice assets.
4. Keep the existing authoritative boost meter and ensure regen never causes a
   client-side-only change.

## Hito B-REGEN-04 — regression and release gate

1. Run focused red/green tests, then the full `npm test` suite.
2. Run `npm run build:pages-beta` and `npm run verify:pages-beta`; do not deploy
   unless explicitly requested later.
3. Record the final constants, test evidence, remaining browser/manual checks,
   and update the roadmap/OpenWiki entry.

## Risk controls

- If a generated WASM artifact cannot be rebuilt from the checked-out RocketSim
  source, stop before changing the public game path and report the blocker.
- Never compensate for an ABI limitation with a JS HUD-only refill.
- Preserve lobby behavior and old diagnostic fixtures until their tests prove
  they are no longer referenced.
