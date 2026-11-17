import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateP2PWasmCombatAlphaRaycastBenchmark,
  P2P_WASM_COMBAT_ALPHA_RAYCAST_WORKLOAD,
  runP2PWasmCombatAlphaRaycastBenchmark,
} from "../tools/wasm-spike/combat-alpha-static-raycast-contract.mjs";
import {
  resolveWasmSmokeResource,
} from "../tools/wasm-spike/browser-smoke-server.mjs";

test("P2P-WASM-16 evaluator enforces the 12-ray combat-alpha timing budget", () => {
  const workload = { ...P2P_WASM_COMBAT_ALPHA_RAYCAST_WORKLOAD, sampleFrames: 100 };
  const passing = evaluateP2PWasmCombatAlphaRaycastBenchmark({ samples: Array(100).fill(1), workload });
  assert.equal(passing.accepted, true);
  assert.deepEqual(passing.workload, {
    sampleFrames: 100,
    raysPerFrame: 12,
    totalRaycasts: 1200,
    maxP95Ms: 2,
    maxP99Ms: 4,
  });

  const p95Failure = evaluateP2PWasmCombatAlphaRaycastBenchmark({
    samples: [...Array(94).fill(1), 2.1, ...Array(5).fill(3)],
    workload,
  });
  assert.equal(p95Failure.accepted, false);
  assert.equal(p95Failure.timing.p95Ms, 2.1);

  const p99Failure = evaluateP2PWasmCombatAlphaRaycastBenchmark({
    samples: [...Array(98).fill(1), 4.1, 4.2],
    workload,
  });
  assert.equal(p99Failure.accepted, false);
  assert.equal(p99Failure.timing.p99Ms, 4.1);
});

test("P2P-WASM-16 browser assets are served only through exact allowlisted GET paths", async () => {
  const pagePath = "/browser-combat-alpha-raycast-benchmark.html";
  const contractPath = "/combat-alpha-static-raycast-contract.mjs";
  assert.equal(resolveWasmSmokeResource("GET", pagePath), pagePath.slice(1));
  assert.equal(resolveWasmSmokeResource("GET", contractPath), contractPath.slice(1));
  assert.equal(resolveWasmSmokeResource("POST", pagePath), null);
  for (const deniedPath of [
    `${pagePath}?cache=1`,
    "/../package.json",
    "/%2e%2e/package.json",
    "//localhost/browser-combat-alpha-raycast-benchmark.html",
  ]) assert.equal(resolveWasmSmokeResource("GET", deniedPath), null, `${deniedPath} should be denied`);

  const page = await readFile(new URL("../tools/wasm-spike/browser-combat-alpha-raycast-benchmark.html", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-16/);
  assert.match(page, /runP2PWasmCombatAlphaRaycastBenchmark/);
  assert.match(page, /__arsenalWasmBrowserCombatAlphaRaycastBenchmark/);

});

test("P2P-WASM-16 real combat-alpha WASM benchmark preserves fixture tick and meets its budget", async t => {
  const moduleUrl = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);
  if (!existsSync(moduleUrl)) {
    t.skip("The generated RocketSim WASM module is absent; real benchmark omitted");
    return;
  }

  const { default: createRocketSimWasm } = await import(moduleUrl.href);
  const module = await createRocketSimWasm();
  const report = runP2PWasmCombatAlphaRaycastBenchmark({ module });
  assert.equal(report.story, "P2P-WASM-16");
  assert.equal(report.profile, "combat-alpha");
  assert.equal(report.accepted, true, JSON.stringify(report));
  assert.equal(report.integrity.warmupRaycasts, 240 * 12);
  assert.equal(report.integrity.measuredRaycasts, 600 * 12);
  assert.equal(report.integrity.initialTick, report.integrity.finalTick);
});
