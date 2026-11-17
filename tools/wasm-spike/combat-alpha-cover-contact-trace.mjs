import { normalizeWasmTraceSnapshot } from "./trace-contract.mjs";

export const COMBAT_ALPHA_COVER_CONTACT_TICKS = 240;
export const COMBAT_ALPHA_COVER_CONTACT_SCALE = 56 / 2300;

export async function captureWasmCombatAlphaCoverContactTrace({
  ticks = COMBAT_ALPHA_COVER_CONTACT_TICKS,
} = {}) {
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 1200) {
    throw new Error("combat-alpha cover contact tick count is invalid");
  }
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(
    `${modulePath.href}?combat-alpha-cover-contact-trace=${Date.now()}`,
  );
  const Module = await createRocketSimWasm();
  if (Module._rs_init_trace_combat_alpha_cover_contact() !== 1) {
    throw new Error("combat-alpha cover contact fixture should initialize");
  }

  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  if (!tickPtr || !statePtr) throw new Error("combat-alpha cover trace buffers should allocate");

  try {
    const samples = [];
    for (let iteration = 0; iteration < ticks; iteration += 1) {
      if (Module._rs_set_controls(0, 0, 0, 0) !== 1) {
        throw new Error(`combat-alpha cover controls rejected at tick ${iteration + 1}`);
      }
      if (Module._rs_step() !== 1 || Module._rs_snapshot(tickPtr, statePtr) !== 1) {
        throw new Error(`combat-alpha cover step failed at tick ${iteration + 1}`);
      }
      const tick = Module.HEAPU32[tickPtr >>> 2];
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      samples.push({ tick, state: normalizeWasmTraceSnapshot(tick, values).state });
    }
    return {
      schemaVersion: 1,
      fixture: "combat-alpha-cover-contact-r1",
      fixedStepHz: 120,
      scale: COMBAT_ALPHA_COVER_CONTACT_SCALE,
      source: "RocketSim WASM combat-alpha cover proxy",
      samples,
    };
  } finally {
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}
