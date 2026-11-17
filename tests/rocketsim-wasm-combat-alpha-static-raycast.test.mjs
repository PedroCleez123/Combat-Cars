import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import {
  P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS,
  captureWasmStaticRaycast,
  compareStaticRaycastReports,
  compareStaticRaycastWithBridge,
  NativeStaticRayBridgeUnavailableError,
} from "../tools/wasm-spike/compare-static-raycast-with-bridge.mjs";

test("P2P-WASM-15 combat-alpha fixture covers the accepted static volume deterministically", async () => {
  const first = await captureWasmStaticRaycast({ profile: "combat-alpha" });
  const second = await captureWasmStaticRaycast({ profile: "combat-alpha" });
  assert.deepEqual(second, first);
  assert.equal(first.tick, 0, "a static query must not consume a simulation tick");
  assert.deepEqual(first.hits.map(hit => [hit.id, hit.hit]), [
    [1, true], [2, true], [3, true], [4, true], [5, true], [6, true], [7, true], [8, false],
  ]);
  assert.equal(first.hits.length, P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS.length);
});

test("native P2P-WASM-15 comparison uses R20 or skips explicitly", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* optional native gate */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a file; native combat-alpha comparison omitted");
    return;
  }
  try {
    const result = await compareStaticRaycastWithBridge(executable, { profile: "combat-alpha" });
    assert.equal(result.native.tick, 0);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.ok(result.report.comparisons.every(comparison => comparison.fractionError <= 0.001));
  } catch (error) {
    if (error instanceof NativeStaticRayBridgeUnavailableError) {
      t.skip(`Native R20 bridge is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
});

test("P2P-WASM-15 comparator still rejects a changed obstacle normal", async () => {
  const report = await captureWasmStaticRaycast({ profile: "combat-alpha" });
  const changed = structuredClone(report);
  changed.hits.find(hit => hit.id === 6).normal.x *= -1;
  assert.throws(() => compareStaticRaycastReports(report, changed), /exceeds tolerance/);
});
