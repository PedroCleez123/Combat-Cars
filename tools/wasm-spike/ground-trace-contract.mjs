import { forwardFromBridgeOrientation, normalizeWasmTraceSnapshot } from "./trace-contract.mjs";

export const GROUND_TRACE_SCHEMA_VERSION = 1;
export const GROUND_TRACE_FIXED_STEP_HZ = 120;
export const GROUND_TRACE_FRAME_COUNT = 240;
export const GROUND_TRACE_FIXTURE = "clean-six-planes-one-car-r1";

export function groundTraceInput(tick) {
  if (!Number.isSafeInteger(tick) || tick < 1 || tick > GROUND_TRACE_FRAME_COUNT) throw new Error("ground trace tick is out of range");
  if (tick <= 60) return { throttle: 0, steer: 0, jump: false, boost: false };
  if (tick <= 120) return { throttle: 1, steer: 0, jump: false, boost: false };
  if (tick <= 180) return { throttle: 1, steer: 0.4, jump: false, boost: false };
  return { throttle: -0.25, steer: -0.25, jump: false, boost: false };
}

export function normalizeGroundWasmSnapshot(tick, values, grounded) {
  const normalized = normalizeWasmTraceSnapshot(tick, values);
  return { ...normalized, grounded: grounded === true };
}

export function normalizeGroundNativeSnapshot(tick, input, car) {
  return {
    tick,
    input,
    grounded: car.grounded === true,
    state: {
      position: car.position,
      velocity: car.velocity,
      forward: forwardFromBridgeOrientation(car.orientation),
    },
  };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function sameInput(left, right) {
  return left && right
    && left.throttle === right.throttle
    && left.steer === right.steer
    && left.jump === right.jump
    && left.boost === right.boost;
}

export function compareGroundTraces(wasmTrace, nativeTrace, { tolerance = 0.02 } = {}) {
  for (const trace of [wasmTrace, nativeTrace]) {
    if (trace.schemaVersion !== GROUND_TRACE_SCHEMA_VERSION || trace.fixture !== GROUND_TRACE_FIXTURE
      || trace.fixedStepHz !== GROUND_TRACE_FIXED_STEP_HZ || trace.samples.length !== GROUND_TRACE_FRAME_COUNT) {
      throw new Error("ground trace contract is invalid");
    }
  }
  const maximum = { position: 0, velocity: 0, forward: 0, tick: 0 };
  for (let index = 0; index < GROUND_TRACE_FRAME_COUNT; index += 1) {
    const wasm = wasmTrace.samples[index];
    const native = nativeTrace.samples[index];
    const expectedInput = groundTraceInput(index + 1);
    if (wasm.tick !== native.tick || wasm.tick !== index + 1 || wasm.grounded !== native.grounded
      || !sameInput(wasm.input, expectedInput) || !sameInput(native.input, expectedInput)) {
      throw new Error(`ground state differs at tick ${index + 1}`);
    }
    for (const key of ["position", "velocity", "forward"]) {
      const delta = distance(wasm.state[key], native.state[key]);
      if (delta > maximum[key]) { maximum[key] = delta; maximum.tick = wasm.tick; }
    }
  }
  const maxDelta = Math.max(maximum.position, maximum.velocity, maximum.forward);
  return { ok: maxDelta <= tolerance, tolerance, maximum, maxDelta };
}
