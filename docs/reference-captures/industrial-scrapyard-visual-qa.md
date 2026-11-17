# ART-06 — Industrial scrapyard visual QA

Date: 2026-11-16  
Revision: local worktree after ART-05 and ART-06 integration fix  
Scope: local WASM route and locally served Pages package; no production deploy.

## Acceptance matrix

| Case | Result | Evidence |
|---|---|---|
| High local combat-alpha route | Accepted | `http://localhost:5301/?arena=combat-alpha&quality=high`; loading cover dismissed by user gesture; WebP manifest and four derivatives returned 200; authored vehicle visible; no console errors. |
| Low local combat-alpha route | Accepted | `http://localhost:5301/?arena=combat-alpha&quality=low`; fallback route remained playable, authored vehicle/HUD/nitro visible; 137 FPS / 7.3 ms observed in the active view; no console errors. |
| Pages package entry | Accepted locally | `http://127.0.0.1:5302/index.html?arena=combat-alpha`; canvas rendered, FPS HUD and regenerable-nitro meter visible, WebAssembly loaded, authored vehicle visible. |
| Industrial skin in public P2P renderer | Accepted locally | After the fix, the balanced public tier reports `arenaObstacleMaterialStatus: textured`, `rendererInfo.textures: 5`, `contextState: ready`, `rendered: true`, `vehicleAuthoredVisibleCount: 1`, `pickupCount: 0`, and ~144 FPS. |
| Far-arena readability | Accepted locally | `combat-alpha` disables distance fog (`arenaFog: null`); depth remains in the shell silhouette, material scale and lighting rather than a haze layer. |
| Floor-to-wall material transition | Accepted by focused tests and local browser check | The triplanar shader uses a narrow normal-based floor/wall blend. The climbing quarter-pipe adopts the wall albedo early, without a hard geometry seam or collision change. |
| Performance tier fallback | Accepted by contract/tests | Explicit `low`/`performance` remains opaque and makes no texture requests. |
| Texture-load failure fallback | Accepted by focused tests | `tests/arena-scrapyard-material.test.mjs` verifies incomplete manifests, failed loads, late failures and disposal. |
| Floor, curves, walls, ceiling and native obstacles | Contract accepted | Unified shell and native dimensions remain covered by ART-03/04 geometry tests; no collision or WASM changes in ART-06. |
| Multiplayer car readability | Partially observed | Single-car public package view confirms authored asset visibility. Two-browser visual confirmation remains a manual user gate. |

## Integration defect fixed during ART-06

The public P2P renderer starts in `balanced`, while the material adapter only
accepted `high`. That combination silently kept the fallback material even when
the ART-02 manifest and WebPs were present. The adapter now treats `balanced`
as textured and reserves the opaque fallback for explicit `low`/`performance`;
the P2P renderer maps `performance` to fallback and `high`/`balanced` to the
industrial skin. This is presentation-only and does not change the arena,
RocketSim, snapshots, input, network or nitro contract.

The same visual correction disables distance fog in `combat-alpha`. It also
narrows the normal-based floor/wall blend so the ground albedo no longer looks
dragged up the quarter-pipe. A controlled hemispheric ground fill lifts only
downward-facing shell surfaces (ceiling and upper curve); this removes the
black distant silhouette without adding haze or changing the floor palette.
The local camera far plane is now derived from the named arena bounds (816 for
combat-alpha), so the opposite end of the expanded arena cannot be clipped
into the dark scene background.
No new texture, geometry, collider or renderer pass is required.

## Package and automated evidence

- Focused ART/renderer tests: **70/70 pass** after the integration fix.
- Full `npm test`: **586 pass, 0 fail, 7 skipped**; the post-test WASM
  benchmark also passes 3/3.
- `npm run build:pages-beta`: **exit 0**, 100 reviewed files.
- `npm run verify:pages-beta`: **exit 0**.
- `git diff --check`: clean apart from the repository's normal CRLF conversion
  warnings.
- Browser console on the local WASM high/low routes and the served package:
  no runtime errors after the expected local signal-origin CORS failure was
  isolated to room creation. That failure is environmental: the Worker
  allowlist does not include `127.0.0.1`, and is not a Pages production defect.

## Remaining release gate

ART-06 is **accepted for local/package QA**, not a claim of browser-wide
production parity. Before publishing Pages, perform a manual two-browser
smoke on the canonical HTTPS origin in Chrome, Edge, Firefox, Opera and Brave:

1. enter practice and drive, jump/dodge, boost and fire;
2. create a persistent room, join with a second browser, verify both authored
   cars and team colours in the waiting lobby;
3. start a 1v1 or 2v2 round and verify scoreboard, timer, kills/deaths,
   projectiles, audio and the disappearing lobby panel;
4. leave/reconnect once and confirm the remaining room/host migration path;
5. repeat a short visual check at high-density and narrow desktop viewports.

No Pages deployment was performed by ART-06. The package is ready for a
separate explicit deploy and post-deploy smoke.
