import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import { captureWasmLifecycleTrace } from "../tools/wasm-spike/lifecycle-trace.mjs";
import {
  NativeLifecycleBridgeContractError,
  NativeLifecycleBridgeUnavailableError,
  compareLifecycleTracesWithBridge,
  isNativeLifecycleBridgeUnavailable,
  wrapNativeLifecycleStartError,
} from "../tools/wasm-spike/compare-lifecycle-with-bridge.mjs";
import {
  compareLifecycleTraces,
  LIFECYCLE_TRACE_PHASES,
} from "../tools/wasm-spike/lifecycle-trace-contract.mjs";

async function createModule() {
  const modulePath = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?lifecycle-abi=${Date.now()}`);
  return createRocketSimWasm();
}

let captured;
async function lifecycleTrace() {
  captured ??= await captureWasmLifecycleTrace();
  return structuredClone(captured);
}

function readCar(Module, index, tickPtr, statePtr) {
  assert.equal(Module._rs_snapshot_car(index, tickPtr, statePtr), 1);
  return {
    tick: Module.HEAPU32[tickPtr >>> 2],
    values: Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9)),
    grounded: Module._rs_is_grounded_car(index),
  };
}

test("P2P-WASM-11 rejects lifecycle operations outside combat-lineup and invalid indices or flags", async () => {
  const Module = await createModule();
  let tickPtr = 0;
  let statePtr = 0;
  try {
    assert.equal(Module._rs_init(), 1);
    assert.equal(Module._rs_set_combat_active_car(0, 0), 0, "generic arena is not a lifecycle fixture");
    assert.equal(Module._rs_respawn_car(0), 0, "generic arena is not a lifecycle fixture");
    Module._rs_destroy();

    assert.equal(Module._rs_init_trace_combat_lineup(), 1);
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(9 * Float32Array.BYTES_PER_ELEMENT);
    assert.ok(tickPtr && statePtr);
    const before = [readCar(Module, 0, tickPtr, statePtr), readCar(Module, 1, tickPtr, statePtr)];

    assert.equal(Module._rs_set_combat_active_car(2, 0), 0, "out-of-range slot must be rejected");
    assert.equal(Module._rs_set_combat_active_car(1, 2), 0, "active accepts only 0 or 1");
    assert.equal(Module._rs_respawn_car(2), 0, "out-of-range respawn slot must be rejected");
    assert.deepEqual([readCar(Module, 0, tickPtr, statePtr), readCar(Module, 1, tickPtr, statePtr)], before,
      "rejected lifecycle requests must leave both cars unchanged");
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
});

test("lobby containment is combat-alpha-only and leaves an in-bounds body untouched", async () => {
  const Module = await createModule();
  let tickPtr = 0;
  let statePtr = 0;
  try {
    assert.equal(Module._rs_init(), 1);
    assert.equal(Module._rs_contain_car(0), 0, "generic fixtures cannot invoke lobby containment");
    assert.equal(Module._rs_set_authority_rules(1), 0, "generic fixtures cannot opt into online-authority mutators");
    Module._rs_destroy();

    assert.equal(Module._rs_init_combat_alpha_roster(1), 1);
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(9 * Float32Array.BYTES_PER_ELEMENT);
    assert.ok(tickPtr && statePtr);
    const before = readCar(Module, 0, tickPtr, statePtr);
    assert.equal(Module._rs_contain_car(1), 0, "out-of-range lobby slot must be rejected");
    assert.equal(Module._rs_set_authority_rules(2), 0, "authority rules accept only explicit boolean flags");
    assert.equal(Module._rs_set_authority_rules(1), 1, "combat-alpha may disable native demos for browser-authoritative play");
    assert.equal(Module._rs_set_authority_rules(0), 1, "the diagnostic fixture may restore RocketSim defaults explicitly");
    assert.equal(Module._rs_contain_car(0), 1);
    assert.deepEqual(readCar(Module, 0, tickPtr, statePtr), before,
      "containment does not become a spawn/reset for a valid lobby car");
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
});

test("lobby car-to-car impact keeps RocketSim bump without demolition or teleport", async () => {
  const Module = await createModule();
  let tickPtr = 0;
  let statePtr = 0;
  try {
    assert.equal(Module._rs_init_trace_combat_alpha_lobby_bump(), 1);
    assert.equal(Module._rs_set_authority_rules(1), 1, "lobby authority disables native demolitions");
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(40 * Float32Array.BYTES_PER_ELEMENT);
    assert.ok(tickPtr && statePtr);

    const halfWidthNative = 132 * 2300 / 56;
    const halfDepthNative = 102 * 2300 / 56;
    const heightNative = 17 + 54 * 2300 / 56;
    let initialVertical = 0;
    let maximumVerticalImpulse = 0;
    let sawBump = false;
    // The enlarged arena deliberately places opposing teams farther apart.
    // Keep driving long enough for the same native, maximum-speed contact to
    // occur; changing the real spawn contract merely to shorten this test
    // would make the public lobby less readable.
    for (let tick = 1; tick <= 720; tick += 1) {
      // The six-player spawn layout is diagonal so teammates have room to
      // move at round start. Both cars make the same brief, shallow turn
      // towards the centre and then accelerate straight, producing a real
      // high-speed head-on contact instead of treating parallel spawn lanes
      // as a collision test.
      const steer = tick <= 120 ? .3 : 0;
      assert.equal(Module._rs_set_controls_for_car_full(0, 1, steer, 0, 0, 0, 0, 0, 0), 1);
      assert.equal(Module._rs_set_controls_for_car_full(1, 1, steer, 0, 0, 0, 0, 0, 0), 1);
      assert.equal(Module._rs_step(), 1);
      assert.equal(Module._rs_contain_car(0), 1);
      assert.equal(Module._rs_contain_car(1), 1);

      const frames = [];
      for (let index = 0; index < 2; index += 1) {
        assert.equal(Module._rs_snapshot_car_authority(index, tickPtr, statePtr), 1);
        const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 40));
        assert.equal(Module.HEAPU32[tickPtr >>> 2], tick);
        assert.ok(Math.abs(values[0]) <= halfWidthNative + 1, `car ${index} escaped the side bounds at tick ${tick}`);
        assert.ok(Math.abs(values[2]) <= halfDepthNative + 1, `car ${index} escaped the depth bounds at tick ${tick}`);
        assert.ok(values[1] >= -1 && values[1] <= heightNative + 1, `car ${index} was demolished or left the vertical bounds at tick ${tick}`);
        frames.push(values);
      }

      if (tick === 1) initialVertical = frames[1][1];
      maximumVerticalImpulse = Math.max(maximumVerticalImpulse, frames[1][4]);
      if (frames[1][1] > initialVertical + 1 && frames[1][4] > 5) sawBump = true;
    }

    assert.equal(sawBump, true, "the impact should produce RocketSim's upward bump impulse");
    assert.ok(maximumVerticalImpulse > 5, "the impact should change the target's vertical velocity");
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
});

test("combat-alpha CCD keeps a maximum-speed lobby car inside the wall without containment or respawn", async () => {
  const Module = await createModule();
  let tickPtr = 0;
  let statePtr = 0;
  try {
    assert.equal(Module._rs_init_combat_alpha_roster(1), 1);
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(40 * Float32Array.BYTES_PER_ELEMENT);
    assert.ok(tickPtr && statePtr);
    const halfWidthNative = 132 * 2300 / 56;
    const halfDepthNative = 102 * 2300 / 56;
    const heightNative = 17 + 54 * 2300 / 56;
    let maximumX = -Infinity;
    let maximumZ = -Infinity;
    let sawRebound = false;
    for (let tick = 1; tick <= 720; tick += 1) {
      assert.equal(Module._rs_set_controls_for_car_full(0, 1, 0, 0, 0, 0, 0, 0, 0), 1);
      assert.equal(Module._rs_step(), 1);
      // The lobby invokes movement-only containment after every native tick.
      // A valid quarter-pipe sample must remain solver-owned and unchanged.
      assert.equal(Module._rs_contain_car(0), 1);
      assert.equal(Module._rs_snapshot_car_authority(0, tickPtr, statePtr), 1);
      const values = Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 40);
      maximumX = Math.max(maximumX, values[0]);
      maximumZ = Math.max(maximumZ, values[1]);
      if (values[0] > halfWidthNative - 350 && values[3] < -5) sawRebound = true;
      assert.ok(Math.abs(values[0]) <= halfWidthNative + .5, `tick ${tick} escaped the +X/-X arena limits`);
      assert.ok(Math.abs(values[2]) <= halfDepthNative + .5, `tick ${tick} escaped the depth limits`);
      assert.ok(values[1] >= -1 && values[1] <= heightNative + 1, `tick ${tick} escaped the floor/ceiling transition`);
    }
    assert.ok(maximumX > halfWidthNative - 100, "drive reached the wall at high speed");
    assert.ok(maximumZ > 1200, "drive climbed the native floor-to-wall quarter-pipe without a post-step clamp");
    assert.equal(sawRebound, true, "the native collision solver sends the car back into the arena");
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
});

test("P2P-WASM-11 captures a deterministic active → inactive → respawn physical sequence", async () => {
  const first = await captureWasmLifecycleTrace();
  const second = await captureWasmLifecycleTrace();
  assert.deepEqual(first, second);
  assert.deepEqual(first.samples.map(sample => sample.phase), LIFECYCLE_TRACE_PHASES);
  assert.equal(first.samples[0].cars.length, 2);
  assert.ok(first.samples[1].cars[1].position[2] < -9999);
  assert.equal(first.samples[1].cars[1].grounded, false);
  assert.ok(first.samples[2].cars[1].position[2] < -1000, "inactive car should stay outside combat-lineup bounds after one neutral step");
  assert.ok(Math.hypot(...first.samples[3].cars[1].velocity) <= 0.05);
  assert.ok(Math.abs(first.samples[3].cars[1].position[0] + 600) <= 0.05);
});

test("lifecycle comparator aligns phases and rejects a bad sentinel or phase order", async () => {
  const trace = await lifecycleTrace();
  assert.equal(compareLifecycleTraces(trace, trace).ok, true);

  const badSentinel = structuredClone(trace);
  badSentinel.samples[1].cars[1].position[2] = -9999;
  assert.throws(() => compareLifecycleTraces(trace, badSentinel), /inactive mutation.*sentinel/);

  const badPhase = structuredClone(trace);
  badPhase.samples[2].phase = "respawned";
  assert.throws(() => compareLifecycleTraces(trace, badPhase), /out of order/);
});

test("native lifecycle gate skips only a missing process and fails an incompatible bridge", () => {
  const missing = Object.assign(new Error("spawn bridge ENOENT"), { code: "ENOENT" });
  assert.equal(isNativeLifecycleBridgeUnavailable(missing), true);
  assert.equal(isNativeLifecycleBridgeUnavailable(new Error("ready frame schema mismatch")), false);
  assert.ok(wrapNativeLifecycleStartError(missing) instanceof NativeLifecycleBridgeUnavailableError);
  assert.ok(wrapNativeLifecycleStartError(new Error("ready frame schema mismatch")) instanceof NativeLifecycleBridgeContractError);
});

test("native P2P-WASM-11 comparison uses R20 or skips explicitly without the executable", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* Native R20 is optional in ordinary test runs. */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a file; native R20 lifecycle comparison omitted");
    return;
  }

  try {
    const result = await compareLifecycleTracesWithBridge(executable, { wasmTrace: await lifecycleTrace() });
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
  } catch (error) {
    if (error instanceof NativeLifecycleBridgeUnavailableError) {
      t.skip(`Native R20 bridge is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
});
