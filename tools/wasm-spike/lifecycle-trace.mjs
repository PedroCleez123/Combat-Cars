// Test-only capture of physical vehicle state through the bounded WASM ABI.
import {
  createLifecycleTrace,
  LIFECYCLE_TRACE_PHASES,
  normalizeWasmLifecycleCar,
} from "./lifecycle-trace-contract.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export async function captureWasmLifecycleTrace() {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(modulePath.href);
  const Module = await createRocketSimWasm();
  let tickPtr = 0;
  let statePtr = 0;

  const snapshot = phase => {
    let tick;
    const cars = [];
    for (let index = 0; index < 2; index += 1) {
      requireCondition(Module._rs_snapshot_car(index, tickPtr, statePtr) === 1, `WASM lifecycle snapshot failed for car ${index + 1}`);
      const observedTick = Module.HEAPU32[tickPtr >>> 2];
      if (tick === undefined) tick = observedTick;
      requireCondition(observedTick === tick, `${phase} car snapshots have different ticks`);
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      cars.push(normalizeWasmLifecycleCar(index, values, Module._rs_is_grounded_car(index)));
    }
    return { phase, tick, cars };
  };

  try {
    requireCondition(Module._rs_init_trace_combat_lineup() === 1, "WASM combat-lineup lifecycle fixture should initialize");
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(9 * Float32Array.BYTES_PER_ELEMENT);
    requireCondition(tickPtr && statePtr, "WASM lifecycle snapshot buffers should allocate");

    const samples = [];
    samples.push(snapshot(LIFECYCLE_TRACE_PHASES[0]));

    requireCondition(Module._rs_set_combat_active_car(1, 0) === 1, "WASM should deactivate combat-lineup car index 1");
    samples.push(snapshot(LIFECYCLE_TRACE_PHASES[1]));

    for (let index = 0; index < 2; index += 1) {
      requireCondition(Module._rs_set_controls_for_car(index, 0, 0, 0, 0) === 1, `WASM neutral controls failed for car ${index + 1}`);
    }
    requireCondition(Module._rs_step() === 1, "WASM lifecycle inactive step failed");
    samples.push(snapshot(LIFECYCLE_TRACE_PHASES[2]));

    requireCondition(Module._rs_respawn_car(1) === 1, "WASM should respawn combat-lineup car index 1");
    samples.push(snapshot(LIFECYCLE_TRACE_PHASES[3]));

    for (let index = 0; index < 2; index += 1) {
      requireCondition(Module._rs_set_controls_for_car(index, 0, 0, 0, 0) === 1, `WASM neutral controls failed for car ${index + 1}`);
    }
    requireCondition(Module._rs_step() === 1, "WASM lifecycle respawn step failed");
    samples.push(snapshot(LIFECYCLE_TRACE_PHASES[4]));

    return createLifecycleTrace("RocketSim WASM combat-lineup", samples);
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
}
