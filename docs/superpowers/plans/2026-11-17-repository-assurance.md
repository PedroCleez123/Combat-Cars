# Repository assurance and arena contract plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove factual drift in active project memory, make combat-alpha geometry a single generated contract for JS and both RocketSim bridges, and make CI exercise the highest-value deterministic gates.

**Architecture:** `data/combat-alpha-geometry.json` is the authored contract. A deterministic Node generator emits an ESM runtime module and a C++ header consumed by the local native and WASM bridges. A `--check` mode detects stale generated files. CI runs this check, asset verification, the normal suite, focused online/COV integration tests, Pages verification, and the existing clean-WASM reproducibility gate.

**Tech Stack:** Node.js ESM, Node test runner, JSON, C++20, CMake, GitHub Actions.

**Spec:** `_bmad-output/current-roadmap.md`; COV acceptance and dimensions in `docs/superpowers/specs/2026-11-17-combat-alpha-tire-cover-alignment-design.md` and `docs/superpowers/plans/2026-11-16-combat-alpha-cover.md`.

## Global Constraints

- Preserve combat-alpha dimensions 264 × 408 × 108 UU and curve radius 30 UU.
- Preserve all six cover IDs, positions, dimensions, symmetry groups, clearances, and rendering metadata.
- RocketSim WASM on the host remains authoritative; generated geometry only shares static configuration.
- Do not deploy Pages, rewrite physics, alter network messages, or remove the frozen local reference runtime.
- Do not report test counts without a fresh command and a clear commit/working-tree identity.
- Preserve all existing staged and untracked user work; do not commit a mixed checkpoint.

## Review Focus

- Generator output can drift: `verify:arena-contract` must fail after changing either generated artifact by one byte.
- C++ coordinate naming differs (`z` in authored arena, `y` in RocketSim wrapper): the shared header must define world-space X/Z and both bridges must map it consistently.
- Existing native contract tests match source text: update them to assert shared generated-header use and data values, not duplicate literals.
- CI runtime can exceed its 45-minute limit: keep only deterministic integration gates that run against checked-in WASM and avoid browser/manual/network-room tests.
- Metrics can become stale immediately: remove counts from active status summaries and preserve historical run references as historical evidence only.

---

### Task 1: Canonical combat-alpha geometry

**Files:**
- Create: `data/combat-alpha-geometry.json`
- Create: `tools/generate-arena-contract.mjs`
- Create: `src/generated/combat-alpha-geometry.js`
- Create: `tools/shared/combat_alpha_geometry.generated.hpp`
- Create: `tests/arena-contract-generation.test.mjs`
- Modify: `src/rocketsim-arena-profile.js`, `src/combat-alpha-map.js`, both bridge CMake files, `tools/rocketsim-bridge/main.cpp`, `tools/wasm-spike/wrapper.cpp`, `package.json`

- [x] Write a test for deterministic generation, `--check` success, stale-output rejection, and the exact arena/cover records.
- [x] Run the test and observe failure before implementation.
- [x] Add the authored JSON descriptor and generator; generated outputs contain arena width/depth/height/curve radius and all six covers.
- [x] Replace duplicated combat-alpha arena and cover values in JS/native/WASM code with generated exports/header constants.
- [x] Add `generate:arena-contract` and `verify:arena-contract` package commands; include verification in `npm test` and the deterministic CI preflight.
- [x] Run the focused and existing arena/COV tests; record the native SDK limitation.

### Task 2: CI coverage and asset gate

**Files:**
- Modify: `.github/workflows/ci.yml`, `docs/test-suite-inventory.md`

- [x] Add the arena-contract freshness and `verify:assets` checks to CI.
- [x] Add focused deterministic integration gates for online presentation state and COV contact/raycast plus mobility parity, using existing scripts.
- [x] Keep Electron/browser, external P2P, native-bridge optional comparisons, and human QA explicitly separate from CI claims.
- [x] Update the inventory to distinguish test catalog from dated validation evidence; remove undated pass/skip totals.
- [x] Run every newly wired command locally and `npm test`.

### Task 3: Reconcile roadmap and generated OpenWiki evidence

**Files:**
- Modify: `_bmad-output/current-roadmap.md`, `docs/README.md`, `docs/superpowers/specs/2026-11-16-combat-alpha-cover-design.md`
- Update through OpenWiki lifecycle: arena, boost-regeneration and persistent-room pages and their Claims

- [x] Mark the original 2.4 UU tire-cover design superseded by the approved 4.8 UU COV-06 contract while retaining its history.
- [x] Correct current roadmap status to avoid stale suite counts and distinguish the successful historical CI run from this dirty working-tree validation.
- [x] Link the test-suite inventory from `docs/README.md`.
- [x] Correct OpenWiki prose and Claims to state 4.8 UU and accurately identify the JSON descriptor/generation pipeline as the shared source.
- [x] Finish both OpenWiki reconciliation cycles successfully and verify all three generated page/Claim sets.

### Task 4: Classify residual artifacts

**Files:**
- Modify: `_bmad-output/current-roadmap.md`, `.gitignore` only if generated build output is proven reproducible
- Inspect only: `deploy/`, `tools/wasm-spike/build-pages-clean/`, `tools/wasm-spike/emsdk-install-failure.txt`

- [x] Check runtime references and generated-input provenance before changing any residual artifact.
- [x] Ignore the reproducible, non-runtime `build-pages-clean/` output without deleting its local files; retain the old Caddy examples and diagnostic text file.
- [x] Record artifact classification and deferred manual QA separately from implementation completion in the roadmap.
