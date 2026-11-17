// Deterministic COV-02 ray probes. Coordinates use the public y-up Arsenal
// basis consumed by rs_raycast_static; they do not advance simulation.
import { readFile } from "node:fs/promises";

const WASM_MODULE_URL = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
// RocketSim's public ray ABI uses its simulation units (the same basis as the
// existing static-ray segments), while COV-01 is authored in Arsenal units.
const U = 2300 / 56;
const uu = value => value * U;

export const COMBAT_ALPHA_COVER_RAYS = Object.freeze([
  Object.freeze({ id: 1, label: "container-low-north", from: Object.freeze({ x: -3500, y: uu(2), z: uu(-58) }), to: Object.freeze({ x: 3500, y: uu(2), z: uu(-58) }), expected: true }),
  Object.freeze({ id: 2, label: "container-low-south", from: Object.freeze({ x: -3500, y: uu(2), z: uu(58) }), to: Object.freeze({ x: 3500, y: uu(2), z: uu(58) }), expected: true }),
  Object.freeze({ id: 3, label: "tires-low", from: Object.freeze({ x: -3500, y: uu(1), z: uu(-30) }), to: Object.freeze({ x: 3500, y: uu(1), z: uu(-30) }), expected: true }),
  Object.freeze({ id: 4, label: "container-high-north", from: Object.freeze({ x: -3500, y: uu(8), z: uu(-58) }), to: Object.freeze({ x: 3500, y: uu(8), z: uu(-58) }), expected: false }),
  Object.freeze({ id: 5, label: "tires-mid-height", from: Object.freeze({ x: -3500, y: uu(4), z: uu(-30) }), to: Object.freeze({ x: 3500, y: uu(4), z: uu(-30) }), expected: true }),
  Object.freeze({ id: 6, label: "tires-overflight", from: Object.freeze({ x: -3500, y: uu(6), z: uu(-30) }), to: Object.freeze({ x: 3500, y: uu(6), z: uu(-30) }), expected: false }),
  Object.freeze({ id: 7, label: "tires-top", from: Object.freeze({ x: uu(-68), y: uu(10), z: uu(-30) }), to: Object.freeze({ x: uu(-68), y: uu(0), z: uu(-30) }), expected: true }),
  Object.freeze({ id: 8, label: "container-lateral-bypass", from: Object.freeze({ x: -3500, y: uu(2), z: uu(-42) }), to: Object.freeze({ x: 3500, y: uu(2), z: uu(-42) }), expected: false }),
]);

export async function captureWasmCombatAlphaCoverRaycast() {
  const { default: createRocketSimWasm } = await import(WASM_MODULE_URL.href);
  const module = await createRocketSimWasm();
  let outputPointer = 0;
  let initialized = false;
  try {
    const required = ["_malloc", "_free", "_rs_destroy", "_rs_init_trace_combat_alpha", "_rs_raycast_static"];
    if (required.some(name => typeof module[name] !== "function") || !(module.HEAPF32 instanceof Float32Array)) {
      throw new TypeError("COV-02 WASM raycast ABI is incomplete");
    }
    if (module._rs_init_trace_combat_alpha() !== 1) throw new Error("COV-02 combat-alpha fixture failed to initialize");
    initialized = true;
    outputPointer = module._malloc(8 * Float32Array.BYTES_PER_ELEMENT);
    if (!outputPointer) throw new Error("COV-02 could not allocate raycast output");
    const hits = COMBAT_ALPHA_COVER_RAYS.map(ray => {
      const accepted = module._rs_raycast_static(ray.from.x, ray.from.y, ray.from.z, ray.to.x, ray.to.y, ray.to.z, outputPointer);
      if (accepted !== 1) throw new Error(`COV-02 raycast failed for ${ray.label}`);
      const values = [...module.HEAPF32.subarray(outputPointer >>> 2, (outputPointer >>> 2) + 8)];
      if (!values.every(Number.isFinite)) throw new Error(`COV-02 raycast returned non-finite values for ${ray.label}`);
      return { ...ray, hit: values[0] === 1, fraction: values[1], normal: { x: values[5], y: values[6], z: values[7] } };
    });
    return { fixture: "combat-alpha-cover-raycast-r1", hits };
  } finally {
    if (outputPointer) module._free(outputPointer);
    if (initialized) module._rs_destroy();
  }
}
