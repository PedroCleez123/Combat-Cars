import assert from "node:assert/strict";
import test from "node:test";
import {
  WASM_TRACE_FIXED_STEP_HZ,
  WASM_TRACE_FIXTURE,
  WASM_TRACE_FRAME_COUNT,
  WASM_TRACE_SCHEMA_VERSION,
  airVoidTraceInput,
  compareAirVoidTraces,
  forwardFromBridgeOrientation,
  normalizeWasmTraceSnapshot,
} from "../tools/wasm-spike/trace-contract.mjs";
import { summarizeWasmAirVoidTrace } from "../tools/wasm-spike/trace.mjs";

function trace(samples) {
  return { schemaVersion: WASM_TRACE_SCHEMA_VERSION, fixture: WASM_TRACE_FIXTURE, fixedStepHz: WASM_TRACE_FIXED_STEP_HZ, samples };
}

test("WASM air-void fixture converts RocketSim z-up snapshots to the bridge y-up basis", () => {
  const result = normalizeWasmTraceSnapshot(1, [10, 20, 30, 1, 2, 3, 0, 1, 0]);
  assert.deepEqual(result, {
    tick: 1,
    state: {
      position: { x: 10, y: 30, z: 20 },
      velocity: { x: 1, y: 3, z: 2 },
      forward: { x: 0, y: 0, z: 1 },
    },
  });
  assert.deepEqual(airVoidTraceInput(1), { throttle: 0, steer: 0, jump: false, boost: false });
  assert.deepEqual(airVoidTraceInput(61), { throttle: 1, steer: 0, jump: false, boost: true });
  assert.deepEqual(forwardFromBridgeOrientation({ x: 0, y: 0, z: 0, w: 1 }), { x: 1, y: 0, z: 0 });
  assert.throws(() => airVoidTraceInput(WASM_TRACE_FRAME_COUNT + 1), /out of range/);
});

test("WASM/native comparator accepts identical fixed trace and reports meaningful divergence", () => {
  const sample = { tick: 1, state: { position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 }, forward: { x: 0, y: 1, z: 0 } } };
  const samples = Array.from({ length: WASM_TRACE_FRAME_COUNT }, (_, index) => ({ ...sample, tick: index + 1 }));
  const accepted = compareAirVoidTraces(trace(samples), trace(samples));
  assert.equal(accepted.ok, true);
  const diverged = structuredClone(samples);
  diverged.at(-1).state.position.x += .1;
  const rejected = compareAirVoidTraces(trace(samples), trace(diverged), { tolerance: .02 });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.maximum.position >= .1);
  const summary = summarizeWasmAirVoidTrace(trace(samples));
  assert.equal(summary.samples, WASM_TRACE_FRAME_COUNT);
  assert.equal(summary.last.tick, WASM_TRACE_FRAME_COUNT);
});
