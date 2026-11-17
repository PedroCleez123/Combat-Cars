import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const { default: createRocketSimWasm } = await import(new URL('./build/rocketsim_wasm.mjs', import.meta.url));
const initStart = performance.now();
const Module = await createRocketSimWasm();
const initMs = performance.now() - initStart;
assert.equal(Module._rs_init(), 1, 'RocketSim initialization should succeed');

const tickPtr = Module._malloc(4);
const statePtr = Module._malloc(9 * 4);
assert.ok(tickPtr && statePtr, 'snapshot buffers should allocate');
const snapshot = () => {
  assert.equal(Module._rs_snapshot(tickPtr, statePtr), 1, 'snapshot should be finite');
  const tick = Module.HEAPU32[tickPtr >>> 2];
  const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
  assert.ok(values.every(Number.isFinite), 'all snapshot values should be finite');
  return { tick, values };
};

const before = snapshot();
const stepsStart = performance.now();
for (let i = 0; i < 120; i += 1) {
  assert.equal(Module._rs_set_controls(1, i < 60 ? 0 : 0.25, 0, 0), 1);
  assert.equal(Module._rs_step(), 1);
}
const steps120Ms = performance.now() - stepsStart;
const after = snapshot();
assert.equal(after.tick - before.tick, 120, 'one wrapper call must advance exactly one tick');
const displacement = Math.hypot(
  after.values[0] - before.values[0],
  after.values[1] - before.values[1],
  after.values[2] - before.values[2],
);
assert.ok(displacement > 1, `car should move under the fixed trace; displacement=${displacement}`);

console.log(JSON.stringify({ ok: true, ticks: after.tick, displacement, initMs, steps120Ms }));
Module._free(statePtr);
Module._free(tickPtr);
Module._rs_destroy();
