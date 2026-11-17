// P2P-WASM-13: isolated static-ray ABI comparison against the native R20 bridge.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { createP2PWasmHostMatch } from "./p2p-wasm-host-match.mjs";
import { P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS } from "./combat-alpha-static-raycast-contract.mjs";

const WASM_MODULE_URL = new URL("./build/rocketsim_wasm.mjs", import.meta.url);

export const P2P_WASM_STATIC_RAY_SEGMENTS = Object.freeze([
  Object.freeze({ id: 1, from: Object.freeze({ x: 0, y: 100, z: 0 }), to: Object.freeze({ x: 0, y: -100, z: 0 }) }),
  Object.freeze({ id: 2, from: Object.freeze({ x: -1200, y: 50, z: 0 }), to: Object.freeze({ x: 1200, y: 50, z: 0 }) }),
  Object.freeze({ id: 3, from: Object.freeze({ x: 0, y: 50, z: -500 }), to: Object.freeze({ x: 0, y: 50, z: 500 }) }),
]);

export { P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS } from "./combat-alpha-static-raycast-contract.mjs";

export class NativeStaticRayBridgeUnavailableError extends Error {
  constructor(message, options) { super(message, options); this.name = "NativeStaticRayBridgeUnavailableError"; }
}

function hasErrorCode(error, code) {
  const seen = new Set();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current.code === code) return true;
    current = current.cause;
  }
  return false;
}

function hasBridgeFile(executable) {
  try { return Boolean(executable && existsSync(executable) && statSync(executable).isFile()); }
  catch { return false; }
}

function cloneSegment(segment) { return { id: segment.id, from: { ...segment.from }, to: { ...segment.to } }; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function assertCombatAlphaWasmModule(module) {
  const required = ["_malloc", "_free", "_rs_destroy", "_rs_init_trace_combat_alpha", "_rs_raycast_static", "_rs_snapshot_car"];
  if (!module || required.some(name => typeof module[name] !== "function")
    || !(module.HEAPF32 instanceof Float32Array) || !(module.HEAPU32 instanceof Uint32Array)) {
    throw new TypeError("RocketSim WASM module does not expose the P2P-WASM-15 combat-alpha ABI.");
  }
}

async function captureCombatAlphaWasmStaticRaycast() {
  const { default: createRocketSimWasm } = await import(WASM_MODULE_URL.href);
  const module = await createRocketSimWasm();
  let tickPointer = 0;
  let statePointer = 0;
  let initialized = false;
  try {
    assertCombatAlphaWasmModule(module);
    if (module._rs_init_trace_combat_alpha() !== 1) throw new Error("P2P-WASM-15 combat-alpha fixture failed to initialize.");
    initialized = true;
    tickPointer = module._malloc(Uint32Array.BYTES_PER_ELEMENT);
    statePointer = module._malloc(9 * Float32Array.BYTES_PER_ELEMENT);
    if (!tickPointer || !statePointer) throw new Error("P2P-WASM-15 could not allocate query buffers.");
    if (module._rs_snapshot_car(0, tickPointer, statePointer) !== 1) throw new Error("P2P-WASM-15 could not read its initial tick.");
    const tick = module.HEAPU32[tickPointer >>> 2];
    const hits = P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS.map(segment => {
      const accepted = module._rs_raycast_static(
        segment.from.x, segment.from.y, segment.from.z,
        segment.to.x, segment.to.y, segment.to.z,
        statePointer,
      );
      if (accepted !== 1) throw new Error(`P2P-WASM-15 raycast failed for segment ${segment.id}.`);
      const values = module.HEAPF32.subarray(statePointer >>> 2, (statePointer >>> 2) + 8);
      if (![...values].every(Number.isFinite) || ![0, 1].includes(values[0]) || values[1] < 0 || values[1] > 1) {
        throw new Error(`P2P-WASM-15 raycast returned invalid values for segment ${segment.id}.`);
      }
      return {
        id: segment.id,
        hit: values[0] === 1,
        fraction: values[1],
        point: { x: values[2], y: values[3], z: values[4] },
        normal: { x: values[5], y: values[6], z: values[7] },
        kind: "static",
      };
    });
    if (module._rs_snapshot_car(0, tickPointer, statePointer) !== 1 || module.HEAPU32[tickPointer >>> 2] !== tick) {
      throw new Error("P2P-WASM-15 static queries must not advance the fixture tick.");
    }
    return { source: "RocketSim WASM combat-alpha", tick, hits };
  } finally {
    for (const pointer of [statePointer, tickPointer]) if (pointer) module._free(pointer);
    if (initialized) module._rs_destroy();
  }
}

export function compareStaticRaycastReports(wasm, native, tolerance = 0.001) {
  if (!Array.isArray(wasm?.hits) || !Array.isArray(native?.hits) || wasm.hits.length !== native.hits.length) {
    throw new Error("P2P-WASM static raycast reports have incompatible hit counts.");
  }
  const comparisons = wasm.hits.map((wasmHit, index) => {
    const nativeHit = native.hits[index];
    if (wasmHit.id !== nativeHit.id || wasmHit.hit !== nativeHit.hit) throw new Error(`P2P-WASM static raycast differs at segment ${wasmHit.id}.`);
    const fractionError = Math.abs(wasmHit.fraction - nativeHit.fraction);
    const pointError = distance(wasmHit.point, nativeHit.point);
    const normalError = distance(wasmHit.normal, nativeHit.normal);
    if (fractionError > tolerance || pointError > tolerance || normalError > tolerance) throw new Error(`P2P-WASM static raycast exceeds tolerance at segment ${wasmHit.id}.`);
    return { id: wasmHit.id, hit: wasmHit.hit, fractionError, pointError, normalError };
  });
  return { ok: true, tolerance, comparisons };
}

export async function captureWasmStaticRaycast({ profile = "combat-lineup" } = {}) {
  if (profile === "combat-alpha") return captureCombatAlphaWasmStaticRaycast();
  if (profile !== "combat-lineup") throw new TypeError("P2P-WASM static raycast profile is unsupported.");
  const match = await createP2PWasmHostMatch({ ticksPerInput: 1 });
  try { return { source: "RocketSim WASM combat-lineup", hits: P2P_WASM_STATIC_RAY_SEGMENTS.map(segment => ({ id: segment.id, ...match.raycastStatic(segment) })) }; }
  finally { match.close(); }
}

export async function captureNativeStaticRaycast(executable, { profile = "combat-lineup" } = {}) {
  if (!hasBridgeFile(executable)) throw new NativeStaticRayBridgeUnavailableError("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  const combatAlpha = profile === "combat-alpha";
  if (!combatAlpha && profile !== "combat-lineup") throw new TypeError("Native P2P-WASM static raycast profile is unsupported.");
  const segments = combatAlpha ? P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS : P2P_WASM_STATIC_RAY_SEGMENTS;
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    try {
      const ready = await bridge.start({ arena: profile, cars: combatAlpha ? [{ id: 1, team: "blue" }] : [{ id: 1, team: "blue" }, { id: 2, team: "blue" }] });
      assert.equal(ready.features?.staticRaycast, true, `R20 ${profile} must expose static raycast`);
    } catch (cause) {
      if (hasErrorCode(cause, "ENOENT")) throw new NativeStaticRayBridgeUnavailableError(`Native R20 static-ray bridge is unavailable: ${cause?.message || cause}`, { cause });
      throw new Error(`Native R20 static-ray bridge violated its startup contract: ${cause?.message || cause}`, { cause });
    }
    const frame = await bridge.raycast(segments.map(cloneSegment));
    return { source: "RocketSim R20 native bridge", tick: frame.tick, hits: frame.hits };
  } finally { await bridge.shutdown(); }
}

export async function compareStaticRaycastWithBridge(executable, { wasm, profile = "combat-lineup" } = {}) {
  const wasmReport = wasm ?? await captureWasmStaticRaycast({ profile });
  const native = await captureNativeStaticRaycast(executable, { profile });
  return { wasm: wasmReport, native, report: compareStaticRaycastReports(wasmReport, native) };
}

export async function runStaticRaycastBridgeComparison(executable = process.env.ROCKETSIM_BRIDGE_EXE) {
  if (!hasBridgeFile(executable)) { console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo RocketSim R20 existente"); return 2; }
  const { report } = await compareStaticRaycastWithBridge(executable);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  try { process.exitCode = await runStaticRaycastBridgeComparison(); }
  catch (error) { console.error(error?.message || error); process.exitCode = 1; }
}
