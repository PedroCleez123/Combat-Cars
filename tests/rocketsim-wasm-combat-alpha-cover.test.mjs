import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RocketSimBridge } from "../src/rocketsim-backend.js";
import { COMBAT_ALPHA_COVER_RAYS, captureWasmCombatAlphaCoverRaycast } from "../tools/wasm-spike/combat-alpha-cover-raycast.mjs";

const nativeBridge = await readFile(new URL("../tools/rocketsim-bridge/main.cpp", import.meta.url), "utf8");
const wasmWrapper = await readFile(new URL("../tools/wasm-spike/wrapper.cpp", import.meta.url), "utf8");
const generatedGeometry = await readFile(new URL("../tools/shared/combat_alpha_geometry.generated.hpp", import.meta.url), "utf8");

test("generated geometry enumerates the six COV-01 cover proxies used by both bridges", () => {
  for (const id of [
    "container-cover-northwest",
    "container-cover-southwest",
    "container-cover-northeast",
    "container-cover-southeast",
    "tire-cover-blue",
    "tire-cover-red",
  ]) assert.match(generatedGeometry, new RegExp(id));
  for (const source of [nativeBridge, wasmWrapper]) {
    assert.match(source, /CombatCarsArenaGeometry::kCombatAlphaCovers/);
    assert.match(source, /btBoxShape/);
  }
  assert.match(nativeBridge, /createCombatAlphaArena[\s\S]*addCombatAlphaCover/);
  assert.match(wasmWrapper, /addCombatAlphaArena[\s\S]*addCombatAlphaCover/);
  assert.match(nativeBridge, /combatAlphaSafeFloorPoint[\s\S]*kCombatAlphaCovers/);
  assert.match(wasmWrapper, /combatAlphaSafeFloorPoint[\s\S]*kCombatAlphaCovers/);
});

test("WASM COV-02 rays intercept low shots but preserve high and lateral bypasses", async () => {
  const report = await captureWasmCombatAlphaCoverRaycast();
  assert.equal(report.fixture, "combat-alpha-cover-raycast-r1");
  assert.deepEqual(report.hits.map(hit => [hit.label, hit.hit]), [
    ["container-low-north", true],
    ["container-low-south", true],
    ["tires-low", true],
    ["container-high-north", false],
    ["tires-mid-height", true],
    ["tires-overflight", false],
    ["tires-top", true],
    ["container-lateral-bypass", false],
  ]);
  for (const hit of report.hits.filter(item => item.hit)) {
    assert.ok(hit.fraction > 0 && hit.fraction < 1, `${hit.label} did not return a segment hit fraction`);
    assert.ok(Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z) > 0.5, `${hit.label} did not return a contact normal`);
  }
  const tireTop = report.hits.find(hit => hit.label === "tires-top");
  assert.ok(Math.abs(tireTop.fraction - .52) < .02,
    `tire top must remain near authored 4.8 UU, got ray fraction ${tireTop.fraction}`);
  assert.ok(tireTop.normal.y > .9, "tire top must expose an upward collision normal");
});

test("native COV-02 cover rays match WASM when the local bridge is available", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  if (!executable || !existsSync(executable)) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or unavailable; native COV-02 gate omitted");
    return;
  }
  const wasm = await captureWasmCombatAlphaCoverRaycast();
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    const ready = await bridge.start({ arena: "combat-alpha", cars: [{ id: 1, team: "blue" }] });
    assert.equal(ready.features?.staticRaycast, true);
    const native = await bridge.raycast(COMBAT_ALPHA_COVER_RAYS.map(({ id, from, to }) => ({ id, from, to })));
    assert.deepEqual(native.hits.map(hit => hit.hit), wasm.hits.map(hit => hit.hit));
    for (const [index, hit] of native.hits.entries()) {
      assert.ok(Math.abs(hit.fraction - wasm.hits[index].fraction) <= .001,
        `${COMBAT_ALPHA_COVER_RAYS[index].label} differs between native and WASM`);
    }
  } finally {
    await bridge.shutdown();
  }
});
