import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import { captureWasmCurvedTrace } from "../tools/wasm-spike/curved-trace.mjs";
import {
  CURVED_TRACE_EXPECTED_FIRST_INCLINED_TICK,
  CURVED_TRACE_EXPECTED_FIRST_STEEP_TICK,
  CURVED_TRACE_FRAME_COUNT,
  analyzeCurvedTrace,
  compareCurvedTraces,
  curvedTraceInput,
} from "../tools/wasm-spike/curved-trace-contract.mjs";
import {
  NativeCurvedBridgeUnavailableError,
  compareCurvedTracesWithBridge,
} from "../tools/wasm-spike/compare-curved-with-bridge.mjs";

let captured;
async function curvedTrace() {
  captured ??= await captureWasmCurvedTrace();
  return structuredClone(captured);
}

test("WASM curved-practice trace has continuous floor-to-wall support", async () => {
  const trace = await curvedTrace();
  const metrics = analyzeCurvedTrace(trace, "WASM");
  assert.equal(trace.samples.length, CURVED_TRACE_FRAME_COUNT);
  assert.equal(trace.samples[0].tick, 1);
  assert.equal(trace.samples.at(-1).tick, CURVED_TRACE_FRAME_COUNT);
  assert.deepEqual(trace.samples.map(sample => sample.input), trace.samples.map((_, index) => curvedTraceInput(index + 1)));
  assert.ok(Math.abs(metrics.firstInclined.tick - CURVED_TRACE_EXPECTED_FIRST_INCLINED_TICK) <= 4);
  assert.ok(Math.abs(metrics.firstSteep.tick - CURVED_TRACE_EXPECTED_FIRST_STEEP_TICK) <= 4);
  assert.equal(metrics.contactGapsBeforeSteep, 0);
  assert.ok(metrics.maxNormalStepDegrees <= 8);
});

test("WASM curved-practice trace is deterministic", async () => {
  const first = await captureWasmCurvedTrace();
  const second = await captureWasmCurvedTrace();
  assert.deepEqual(second, first);
});

test("curved comparator rejects a mutated input tape and support normal", async () => {
  const baseline = await curvedTrace();
  const alteredInput = structuredClone(baseline);
  alteredInput.samples[40].input.boost = !alteredInput.samples[40].input.boost;
  assert.throws(() => compareCurvedTraces(alteredInput, baseline), /input contract differs at tick 41/);

  const alteredNormal = structuredClone(baseline);
  for (const sample of alteredNormal.samples) {
    if (sample.support.hasContact) sample.support.normal.x = 1;
  }
  assert.throws(() => analyzeCurvedTrace(alteredNormal, "altered"), /never observed an inclined wheel support/);
});

test("native curved-practice comparison uses R20 when configured or skips explicitly", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* Optional native gate. */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a file; native R20 integration omitted");
    return;
  }
  try {
    const result = await compareCurvedTracesWithBridge(executable, { wasmTrace: await curvedTrace() });
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
  } catch (error) {
    if (error instanceof NativeCurvedBridgeUnavailableError) {
      t.skip(`Native R20 bridge is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
});

