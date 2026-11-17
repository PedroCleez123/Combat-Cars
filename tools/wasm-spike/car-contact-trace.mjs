import {
  CAR_CONTACT_TRACE_FIXED_STEP_HZ,
  CAR_CONTACT_TRACE_FIXTURE,
  CAR_CONTACT_TRACE_FRAME_COUNT,
  CAR_CONTACT_TRACE_SCHEMA_VERSION,
  carContactTraceInputs,
  normalizeCarContactWasmSnapshot,
} from "./car-contact-trace-contract.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export async function captureWasmCarContactTrace() {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  // The browser smoke server intentionally rejects query strings; invoking
  // the factory creates a fresh isolated module without a cache-busting URL.
  const { default: createRocketSimWasm } = await import(modulePath.href);
  const Module = await createRocketSimWasm();
  requireCondition(Module._rs_init_trace_combat_lineup() === 1, "WASM combat-lineup fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  requireCondition(tickPtr && statePtr, "WASM car-contact buffers should allocate");
  try {
    const samples = [];
    for (let tick = 1; tick <= CAR_CONTACT_TRACE_FRAME_COUNT; tick += 1) {
      const inputs = carContactTraceInputs(tick);
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        requireCondition(Module._rs_set_controls_for_car(
          index,
          input.throttle,
          input.steer,
          Number(input.jump),
          Number(input.boost),
        ) === 1, `WASM rejected car-contact controls for car ${input.id}`);
      }
      requireCondition(Module._rs_step() === 1, "WASM car-contact step failed");

      const cars = [];
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        requireCondition(Module._rs_snapshot_car(index, tickPtr, statePtr) === 1, `WASM car-contact snapshot failed for car ${input.id}`);
        const observedTick = Module.HEAPU32[tickPtr >>> 2];
        requireCondition(observedTick === tick, `WASM car-contact tick mismatch for car ${input.id}`);
        const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
        cars.push({
          id: input.id,
          input,
          ...normalizeCarContactWasmSnapshot(observedTick, values, Module._rs_is_grounded_car(index) === 1),
        });
      }
      samples.push({ tick, cars });
    }
    return {
      schemaVersion: CAR_CONTACT_TRACE_SCHEMA_VERSION,
      fixture: CAR_CONTACT_TRACE_FIXTURE,
      fixedStepHz: CAR_CONTACT_TRACE_FIXED_STEP_HZ,
      source: "RocketSim WASM combat-lineup clean six planes",
      samples,
    };
  } finally {
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}
