import {
  normalizeWasmTraceSnapshot,
} from "./trace-contract.mjs";

export const WASM_MULTICAR_COUNT = 6;
export const WASM_MULTICAR_FRAME_COUNT = 240;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function multiCarInput(index, tick) {
  const phase = tick <= 60 ? 0 : tick <= 120 ? 1 : tick <= 180 ? 2 : 3;
  const direction = index % 2 === 0 ? 1 : -1;
  return {
    throttle: phase === 0 ? 0 : phase === 3 ? 0.25 * direction : direction,
    steer: phase < 2 ? 0.08 * (index - 2.5) : -0.12 * direction,
    jump: false,
    boost: phase > 0,
  };
}

export async function captureWasmAirVoidMultiCarTrace({
  count = WASM_MULTICAR_COUNT,
  frames = WASM_MULTICAR_FRAME_COUNT,
} = {}) {
  requireCondition(Number.isSafeInteger(count) && count >= 1 && count <= WASM_MULTICAR_COUNT, "WASM multicar count is out of range");
  requireCondition(Number.isSafeInteger(frames) && frames >= 1 && frames <= 1200, "WASM multicar frame count is out of range");
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?multicar=${Date.now()}`);
  const Module = await createRocketSimWasm();
  requireCondition(Module._rs_init_trace_air_void_cars(count) === 1, "WASM multicar fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  requireCondition(tickPtr && statePtr, "WASM multicar buffers should allocate");
  const startedAt = globalThis.performance.now();
  let last = [];
  try {
    for (let tick = 1; tick <= frames; tick += 1) {
      for (let index = 0; index < count; index += 1) {
        const input = multiCarInput(index, tick);
        requireCondition(Module._rs_set_controls_for_car(index, input.throttle, input.steer, Number(input.jump), Number(input.boost)) === 1, `WASM rejected controls for car ${index}`);
      }
      requireCondition(Module._rs_step() === 1, "WASM multicar step failed");
      const frame = [];
      for (let index = 0; index < count; index += 1) {
        requireCondition(Module._rs_snapshot_car(index, tickPtr, statePtr) === 1, `WASM multicar snapshot failed for car ${index}`);
        const observedTick = Module.HEAPU32[tickPtr >>> 2];
        requireCondition(observedTick === tick, `WASM multicar tick mismatch for car ${index}`);
        const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
        frame.push({ input: multiCarInput(index, tick), ...normalizeWasmTraceSnapshot(observedTick, values) });
      }
      last = frame;
    }
    const elapsedMs = globalThis.performance.now() - startedAt;
    return {
      ok: true,
      count,
      ticks: frames,
      elapsedMs,
      msPerTick: elapsedMs / frames,
      last,
    };
  } finally {
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}
