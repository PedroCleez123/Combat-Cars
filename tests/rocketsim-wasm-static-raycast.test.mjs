import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import {
  captureWasmStaticRaycast,
  compareStaticRaycastReports,
  compareStaticRaycastWithBridge,
  NativeStaticRayBridgeUnavailableError,
} from "../tools/wasm-spike/compare-static-raycast-with-bridge.mjs";

test("P2P-WASM-13 static raycast fixture is deterministic and keeps its three semantic paths", async () => {
  const first = await captureWasmStaticRaycast();
  const second = await captureWasmStaticRaycast();
  assert.deepEqual(second, first);
  assert.deepEqual(first.hits.map(hit => [hit.id, hit.hit]), [[1, true], [2, true], [3, false]]);
  assert.ok(first.hits[0].normal.y > 0.9);
  assert.ok(first.hits[1].normal.x < -0.9);
  assert.equal(first.hits[2].fraction, 1);
});

test("P2P-WASM-13 comparator rejects a changed normal, point, fraction or hit", async () => {
  const report = await captureWasmStaticRaycast();
  assert.equal(compareStaticRaycastReports(report, report).ok, true);
  const changed = structuredClone(report);
  changed.hits[1].normal.x = 1;
  assert.throws(() => compareStaticRaycastReports(report, changed), /exceeds tolerance/);
  changed.hits[1].normal.x = report.hits[1].normal.x;
  changed.hits[1].hit = false;
  assert.throws(() => compareStaticRaycastReports(report, changed), /differs/);
});

test("native P2P-WASM-13 static raycast comparison uses R20 or skips explicitly", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* Native R20 is optional in ordinary test runs. */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a file; native R20 static-ray comparison omitted");
    return;
  }
  try {
    const result = await compareStaticRaycastWithBridge(executable);
    assert.equal(result.native.tick, 0);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
  } catch (error) {
    if (error instanceof NativeStaticRayBridgeUnavailableError) {
      t.skip(`Native R20 bridge is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
});
