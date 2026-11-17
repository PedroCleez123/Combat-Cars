import {
  WALL_TRACE_FIXED_STEP_HZ,
  WALL_TRACE_FIXTURE,
  WALL_TRACE_FRAME_COUNT,
  WALL_TRACE_SCHEMA_VERSION,
  normalizeWallWasmSnapshot,
  wallTraceInput,
} from "./wall-trace-contract.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export async function captureWasmWallTrace() {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?wall=${Date.now()}`);
  const Module = await createRocketSimWasm();
  requireCondition(Module._rs_init_trace_clean_wall_contact() === 1, "WASM clean wall-contact fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  const contactPtr = Module._malloc(4);
  const normalPtr = Module._malloc(3 * 4);
  requireCondition(tickPtr && statePtr && contactPtr && normalPtr, "WASM wall-contact buffers should allocate");
  try {
    const samples = [];
    for (let tick = 1; tick <= WALL_TRACE_FRAME_COUNT; tick += 1) {
      const input = wallTraceInput(tick);
      requireCondition(Module._rs_set_controls(input.throttle, input.steer, Number(input.jump), Number(input.boost)) === 1, "WASM wall-contact controls were rejected");
      requireCondition(Module._rs_step() === 1, "WASM wall-contact step failed");
      requireCondition(Module._rs_snapshot(tickPtr, statePtr) === 1, "WASM wall-contact snapshot failed");
      requireCondition(Module._rs_body_contact_car(0, contactPtr, normalPtr) === 1, "WASM wall-contact telemetry failed");
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      const nativeNormal = Array.from(Module.HEAPF32.subarray(normalPtr >>> 2, (normalPtr >>> 2) + 3));
      samples.push({
        input,
        ...normalizeWallWasmSnapshot(
          Module.HEAPU32[tickPtr >>> 2], values,
          Module._rs_is_grounded_car(0) === 1,
          Module.HEAPU32[contactPtr >>> 2] === 1,
          nativeNormal,
        ),
      });
    }
    return { schemaVersion: WALL_TRACE_SCHEMA_VERSION, fixture: WALL_TRACE_FIXTURE, fixedStepHz: WALL_TRACE_FIXED_STEP_HZ, source: "RocketSim WASM clean six planes", samples };
  } finally {
    Module._free(normalPtr);
    Module._free(contactPtr);
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}
