function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
import {
  GROUND_TRACE_FIXED_STEP_HZ,
  GROUND_TRACE_FIXTURE,
  GROUND_TRACE_FRAME_COUNT,
  GROUND_TRACE_SCHEMA_VERSION,
  groundTraceInput,
  normalizeGroundWasmSnapshot,
} from "./ground-trace-contract.mjs";

export async function captureWasmCleanGroundTrace() {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?ground=${Date.now()}`);
  const Module = await createRocketSimWasm();
  requireCondition(Module._rs_init_trace_clean_ground() === 1, "WASM clean-ground fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  requireCondition(tickPtr && statePtr, "WASM clean-ground buffers should allocate");
  try {
    const samples = [];
    for (let tick = 1; tick <= GROUND_TRACE_FRAME_COUNT; tick += 1) {
      const input = groundTraceInput(tick);
      requireCondition(Module._rs_set_controls(input.throttle, input.steer, Number(input.jump), Number(input.boost)) === 1, "WASM clean-ground controls were rejected");
      requireCondition(Module._rs_step() === 1, "WASM clean-ground step failed");
      requireCondition(Module._rs_snapshot(tickPtr, statePtr) === 1, "WASM clean-ground snapshot failed");
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      samples.push({ input, ...normalizeGroundWasmSnapshot(Module.HEAPU32[tickPtr >>> 2], values, Module._rs_is_grounded_car(0) === 1) });
    }
    return { schemaVersion: GROUND_TRACE_SCHEMA_VERSION, fixture: GROUND_TRACE_FIXTURE, fixedStepHz: GROUND_TRACE_FIXED_STEP_HZ, source: "RocketSim WASM clean six planes", samples };
  } finally {
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}

