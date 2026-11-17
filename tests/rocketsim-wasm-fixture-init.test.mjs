import test from "node:test";
import assert from "node:assert/strict";

async function loadWasm() {
  const modulePath = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?fixture-init=${Date.now()}`);
  return createRocketSimWasm();
}

test("WASM fixture initialization rejects a different active fixture until destroy", async () => {
  const Module = await loadWasm();
  try {
    assert.equal(Module._rs_init(), 1);
    assert.equal(Module._rs_init_trace_air_void(), 0);
    assert.equal(Module._rs_init_trace_clean_ground(), 0);
    Module._rs_destroy();
    assert.equal(Module._rs_init_trace_clean_ground(), 1);
    assert.equal(Module._rs_init_trace_air_void(), 0);
  } finally {
    Module._rs_destroy();
  }
});

test("WASM warm-up refill is an authoritative native operation", async () => {
  const Module = await loadWasm();
  let tickPtr = 0;
  let statePtr = 0;
  try {
    assert.equal(Module._rs_init_combat_alpha_roster(1), 1);
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(28 * Float32Array.BYTES_PER_ELEMENT);
    assert.ok(tickPtr && statePtr);
    assert.equal(Module._rs_set_controls_for_car_full(0, 1, 0, 0, 0, 0, 0, 1, 0), 1);
    for (let index = 0; index < 120; index += 1) assert.equal(Module._rs_step(), 1);
    assert.equal(Module._rs_snapshot_car_presentation(0, tickPtr, statePtr), 1);
    const spent = Module.HEAPF32[(statePtr >>> 2) + 10];
    assert.ok(spent < 100, `boost should be consumed by native physics, got ${spent}`);
    assert.equal(Module._rs_refill_car_boost(0), 1);
    assert.equal(Module._rs_snapshot_car_presentation(0, tickPtr, statePtr), 1);
    assert.equal(Module.HEAPF32[(statePtr >>> 2) + 10], 100);
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
});

test("WASM combat boost waits two seconds then accelerates to a one-second refill", async () => {
  const Module = await loadWasm();
  let tickPtr = 0;
  let statePtr = 0;
  const readBoost = () => {
    assert.equal(Module._rs_snapshot_car_presentation(0, tickPtr, statePtr), 1);
    return Module.HEAPF32[(statePtr >>> 2) + 10];
  };
  try {
    assert.equal(Module._rs_init_combat_alpha_roster(1), 1);
    assert.equal(Module._rs_boost_regeneration_contract(), 1);
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(40 * Float32Array.BYTES_PER_ELEMENT);
    assert.ok(tickPtr && statePtr);
    assert.equal(Module._rs_set_controls_for_car_full(0, 1, 0, 0, 0, 0, 0, 1, 0), 1);
    for (let index = 0; index < 120; index += 1) assert.equal(Module._rs_step(), 1);
    const spent = readBoost();
    assert.ok(spent < 100);
    assert.equal(Module._rs_set_controls_for_car_full(0, 0, 0, 0, 0, 0, 0, 0, 0), 1);
    for (let index = 0; index < 239; index += 1) assert.equal(Module._rs_step(), 1);
    assert.equal(readBoost(), spent);
    assert.equal(Module._rs_step(), 1);
    const firstRegeneration = readBoost();
    assert.ok(firstRegeneration > spent && firstRegeneration < spent + 1);
    for (let index = 0; index < 119; index += 1) assert.equal(Module._rs_step(), 1);
    const fullAfterOneSecond = readBoost();
    assert.ok(fullAfterOneSecond >= 99.99, `accelerated refill must reach full in one second, got ${fullAfterOneSecond}`);
    assert.equal(Module._rs_set_controls_for_car_full(0, 1, 0, 0, 0, 0, 0, 1, 0), 1);
    assert.equal(Module._rs_step(), 1);
    const interrupted = readBoost();
    assert.ok(interrupted < fullAfterOneSecond);
    assert.equal(Module._rs_set_controls_for_car_full(0, 0, 0, 0, 0, 0, 0, 0, 0), 1);
    for (let index = 0; index < 239; index += 1) assert.equal(Module._rs_step(), 1);
    const afterResetDelay = readBoost();
    assert.ok(afterResetDelay <= interrupted + 0.001, `boost must not regenerate during reset delay: ${afterResetDelay} > ${interrupted}`);
    let resetDelaySample = afterResetDelay;
    for (let index = 0; index < 250; index += 1) {
      assert.equal(Module._rs_step(), 1);
      resetDelaySample = readBoost();
    }
    assert.ok(resetDelaySample > afterResetDelay);
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
});
