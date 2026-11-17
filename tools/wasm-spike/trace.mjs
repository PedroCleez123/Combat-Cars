import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  WASM_TRACE_FIXED_STEP_HZ,
  WASM_TRACE_FIXTURE,
  WASM_TRACE_FRAME_COUNT,
  WASM_TRACE_SCHEMA_VERSION,
  airVoidTraceInput,
  normalizeWasmTraceSnapshot,
} from "./trace-contract.mjs";

const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);

export async function captureWasmAirVoidTrace() {
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?trace=${Date.now()}`);
  const Module = await createRocketSimWasm();
  assert.equal(Module._rs_init_trace_air_void(), 1, "WASM air-void fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  assert.ok(tickPtr && statePtr, "WASM trace buffers should allocate");
  try {
    const samples = [];
    for (let tick = 1; tick <= WASM_TRACE_FRAME_COUNT; tick += 1) {
      const input = airVoidTraceInput(tick);
      assert.equal(Module._rs_set_controls(input.throttle, input.steer, Number(input.jump), Number(input.boost)), 1);
      assert.equal(Module._rs_step(), 1);
      assert.equal(Module._rs_snapshot(tickPtr, statePtr), 1, "WASM trace snapshot should be finite");
      const observedTick = Module.HEAPU32[tickPtr >>> 2];
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      samples.push({ input, ...normalizeWasmTraceSnapshot(observedTick, values) });
    }
    return {
      schemaVersion: WASM_TRACE_SCHEMA_VERSION,
      fixture: WASM_TRACE_FIXTURE,
      fixedStepHz: WASM_TRACE_FIXED_STEP_HZ,
      source: "RocketSim WASM isolated trace",
      samples,
    };
  } finally {
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}

export function summarizeWasmAirVoidTrace(trace) {
  if (!trace || !Array.isArray(trace.samples) || trace.samples.length !== WASM_TRACE_FRAME_COUNT) {
    throw new Error("WASM trace cannot be summarized");
  }
  return {
    schemaVersion: trace.schemaVersion,
    fixture: trace.fixture,
    fixedStepHz: trace.fixedStepHz,
    samples: trace.samples.length,
    first: trace.samples[0],
    last: trace.samples.at(-1),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const trace = await captureWasmAirVoidTrace();
  const report = process.argv.includes("--json") ? trace : summarizeWasmAirVoidTrace(trace);
  console.log(JSON.stringify(report, null, 2));
}
