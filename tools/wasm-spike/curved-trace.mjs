import {
  CURVED_TRACE_FIXED_STEP_HZ,
  CURVED_TRACE_FIXTURE,
  CURVED_TRACE_FRAME_COUNT,
  CURVED_TRACE_GEOMETRY,
  CURVED_TRACE_SCHEMA_VERSION,
  curvedTraceInput,
  normalizeCurvedWasmSnapshot,
} from "./curved-trace-contract.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export async function captureWasmCurvedTrace() {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?curved=${Date.now()}`);
  const Module = await createRocketSimWasm();
  requireCondition(typeof Module._rs_init_trace_curved_practice === "function", "WASM curved initializer export is missing");
  requireCondition(typeof Module._rs_wheel_contact_car === "function", "WASM wheel-contact export is missing");
  requireCondition(Module._rs_init_trace_curved_practice() === 1, "WASM curved-practice fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  const contactPtr = Module._malloc(4);
  const wheelCountPtr = Module._malloc(4);
  const normalPtr = Module._malloc(3 * 4);
  requireCondition(tickPtr && statePtr && contactPtr && wheelCountPtr && normalPtr, "WASM curved buffers should allocate");
  try {
    const samples = [];
    for (let tick = 1; tick <= CURVED_TRACE_FRAME_COUNT; tick += 1) {
      const input = curvedTraceInput(tick);
      requireCondition(Module._rs_set_controls(input.throttle, input.steer, Number(input.jump), Number(input.boost)) === 1, "WASM curved controls were rejected");
      requireCondition(Module._rs_step() === 1, "WASM curved step failed");
      requireCondition(Module._rs_snapshot(tickPtr, statePtr) === 1, "WASM curved snapshot failed");
      requireCondition(Module._rs_wheel_contact_car(0, contactPtr, wheelCountPtr, normalPtr) === 1, "WASM curved wheel telemetry failed");
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      const nativeNormal = Array.from(Module.HEAPF32.subarray(normalPtr >>> 2, (normalPtr >>> 2) + 3));
      samples.push({
        input,
        ...normalizeCurvedWasmSnapshot(
          Module.HEAPU32[tickPtr >>> 2],
          values,
          Module._rs_is_grounded_car(0) === 1,
          Module.HEAPU32[wheelCountPtr >>> 2],
          Module.HEAPU32[contactPtr >>> 2] === 1,
          nativeNormal,
        ),
      });
    }
    return {
      schemaVersion: CURVED_TRACE_SCHEMA_VERSION,
      fixture: CURVED_TRACE_FIXTURE,
      fixedStepHz: CURVED_TRACE_FIXED_STEP_HZ,
      geometry: CURVED_TRACE_GEOMETRY,
      source: "RocketSim WASM arsenal-curved-practice +X quarter-pipe",
      samples,
    };
  } finally {
    Module._free(normalPtr);
    Module._free(wheelCountPtr);
    Module._free(contactPtr);
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}

