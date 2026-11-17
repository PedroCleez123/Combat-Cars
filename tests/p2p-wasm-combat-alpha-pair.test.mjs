import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import {
  NativeCombatAlphaPairBridgeUnavailableError,
  compareCombatAlphaPairWithBridge,
  isNativeCombatAlphaPairBridgeUnavailable,
} from "../tools/wasm-spike/compare-combat-alpha-pair-with-bridge.mjs";
import {
  COMBAT_ALPHA_PAIR_CONTROL_TAPE,
  COMBAT_ALPHA_PAIR_PHASES,
  compareCombatAlphaPairTraces,
} from "../tools/wasm-spike/combat-alpha-pair-trace-contract.mjs";
import { captureWasmCombatAlphaPairTrace } from "../tools/wasm-spike/combat-alpha-pair-trace.mjs";

async function createModule() {
  const modulePath = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?p2p-wasm-17=${Date.now()}`);
  return createRocketSimWasm();
}

function readCar(Module, index, tickPtr, statePtr) {
  assert.equal(Module._rs_snapshot_car(index, tickPtr, statePtr), 1);
  return {
    tick: Module.HEAPU32[tickPtr >>> 2],
    values: Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9)),
    grounded: Module._rs_is_grounded_car(index),
  };
}

let deterministicTrace;
async function getDeterministicTrace() {
  deterministicTrace ??= await captureWasmCombatAlphaPairTrace();
  return structuredClone(deterministicTrace);
}

test("P2P-WASM-17 pair init rejects conflicts and invalid lifecycle requests without mutation", async () => {
  const Module = await createModule();
  let tickPtr = 0;
  let statePtr = 0;
  try {
    assert.equal(Module._rs_init_trace_combat_alpha_pair(), 1);
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(9 * Float32Array.BYTES_PER_ELEMENT);
    assert.ok(tickPtr && statePtr);
    const before = [readCar(Module, 0, tickPtr, statePtr), readCar(Module, 1, tickPtr, statePtr)];

    assert.equal(Module._rs_init_trace_combat_alpha(), 0, "single-car combat-alpha must conflict with the active pair fixture");
    assert.equal(Module._rs_init_trace_combat_lineup(), 0, "combat-lineup must conflict with the active pair fixture");
    assert.equal(Module._rs_init_trace_combat_alpha_pair(), 1, "same-fixture init is idempotent");
    assert.equal(Module._rs_set_combat_active_car(2, 0), 0, "out-of-range slot must be rejected");
    assert.equal(Module._rs_set_combat_active_car(1, 2), 0, "active accepts only 0 or 1");
    assert.equal(Module._rs_respawn_car(2), 0, "out-of-range respawn slot must be rejected");
    assert.deepEqual([readCar(Module, 0, tickPtr, statePtr), readCar(Module, 1, tickPtr, statePtr)], before,
      "rejected fixture and lifecycle requests must leave both cars unchanged");
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
});

test("P2P-WASM-17 deterministic trace checks the two spawns, opposite yaw, 60 no-boost ticks, and lifecycle", async () => {
  const first = await captureWasmCombatAlphaPairTrace();
  const second = await captureWasmCombatAlphaPairTrace();
  assert.deepEqual(second, first);
  assert.equal(first.timeline.length, 60);
  assert.deepEqual(first.phases.map(sample => sample.phase), COMBAT_ALPHA_PAIR_PHASES);
  assert.deepEqual(first.controlTape, COMBAT_ALPHA_PAIR_CONTROL_TAPE);
  assert.ok(first.controlTape.every(frame => frame.every(car => car.input.boost === false)));
  assert.ok(Math.abs(first.initial.cars[0].position[0] + 1500) <= 2);
  assert.ok(Math.abs(first.initial.cars[0].position[1] + 1230) <= 2);
  assert.ok(Math.abs(first.initial.cars[1].position[0] - 1970) <= 2);
  assert.ok(Math.abs(first.initial.cars[1].position[1] - 1230) <= 2);
  assert.ok(first.initial.cars[0].forward[0] > 0.999);
  assert.ok(first.initial.cars[1].forward[0] < -0.999);
  assert.ok(first.phases[1].cars[1].position[2] < -9999);
  assert.equal(first.phases[1].cars[1].grounded, false);
  assert.ok(first.phases[2].cars[1].position[2] < -1000);
  assert.equal(first.phases[3].tick, first.phases[2].tick, "respawn must not advance the tick");
  assert.ok(Math.abs(first.phases[3].cars[1].position[0] - 1970) <= 2);
  assert.ok(first.phases[3].cars[1].forward[0] < -0.999);
  assert.equal(first.phases[3].cars[1].grounded, true);
});

test("P2P-WASM-17 comparison validates every tape sample and rejects physical drift", async () => {
  const trace = await getDeterministicTrace();
  assert.equal(compareCombatAlphaPairTraces(trace, trace).ok, true);
  const changed = structuredClone(trace);
  changed.timeline[20].cars[0].position[0] += 1;
  const report = compareCombatAlphaPairTraces(trace, changed);
  assert.equal(report.ok, false);
  assert.ok(report.mismatches.some(mismatch => mismatch.includes("control-21 car 1 position")));
});

test("native P2P-WASM-17 comparison uses R20 or skips only a missing bridge", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* absent optional native bridge */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a bridge file; native R20 comparison omitted");
    return;
  }

  try {
    const result = await compareCombatAlphaPairWithBridge(executable, { wasmTrace: await getDeterministicTrace() });
    assert.equal(result.native.initial.tick, 1, "first physical native sample follows one neutral tick");
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
  } catch (error) {
    if (error instanceof NativeCombatAlphaPairBridgeUnavailableError
      && isNativeCombatAlphaPairBridgeUnavailable(error.cause)) {
      t.skip(`Native R20 bridge process is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
});
