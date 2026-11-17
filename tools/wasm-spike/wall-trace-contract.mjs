import { normalizeWasmTraceSnapshot } from "./trace-contract.mjs";

export const WALL_TRACE_SCHEMA_VERSION = 1;
export const WALL_TRACE_FIXED_STEP_HZ = 120;
export const WALL_TRACE_FRAME_COUNT = 180;
export const WALL_TRACE_FIXTURE = "clean-six-planes-one-car-r1";
export const WALL_TRACE_EXPECTED_FIRST_CONTACT_TICK = 119;
export const WALL_TRACE_CONTACT_TICK_TOLERANCE = 2;

export function wallTraceInput(tick) {
  if (!Number.isSafeInteger(tick) || tick < 1 || tick > WALL_TRACE_FRAME_COUNT) throw new Error("wall trace tick is out of range");
  return { throttle: 1, steer: 0, jump: false, boost: true };
}

function jsonBasisNormal(nativeNormal) {
  if (!Array.isArray(nativeNormal) || nativeNormal.length !== 3 || !nativeNormal.every(Number.isFinite)) {
    throw new Error("wall trace contact normal is invalid");
  }
  // RocketSim uses x/y/z with z up; the bridge JSON contract uses x/y/z with y up.
  return { x: nativeNormal[0], y: nativeNormal[2], z: nativeNormal[1] };
}

export function normalizeWallWasmSnapshot(tick, values, grounded, hasContact, nativeNormal) {
  return {
    ...normalizeWasmTraceSnapshot(tick, values),
    grounded: grounded === true,
    contact: { hasContact: hasContact === true, normal: jsonBasisNormal(nativeNormal) },
  };
}

export function normalizeWallNativeSnapshot(tick, input, car) {
  return {
    tick,
    input,
    grounded: car.grounded === true,
    contact: {
      hasContact: car.worldContact?.hasContact === true,
      normal: car.worldContact?.normal,
    },
    state: { position: car.position, velocity: car.velocity },
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

function validateTrace(trace, label) {
  if (!trace || trace.schemaVersion !== WALL_TRACE_SCHEMA_VERSION || trace.fixture !== WALL_TRACE_FIXTURE
    || trace.fixedStepHz !== WALL_TRACE_FIXED_STEP_HZ || !Array.isArray(trace.samples) || trace.samples.length !== WALL_TRACE_FRAME_COUNT) {
    throw new Error(`${label} wall trace contract is invalid`);
  }
  for (let index = 0; index < WALL_TRACE_FRAME_COUNT; index += 1) {
    const sample = trace.samples[index];
    if (sample.tick !== index + 1 || !sameInput(sample.input, wallTraceInput(index + 1))) {
      throw new Error(`${label} wall input contract differs at tick ${index + 1}`);
    }
    if (typeof sample.grounded !== "boolean" || typeof sample.contact?.hasContact !== "boolean"
      || !sample.state || ![sample.state.position, sample.state.velocity, sample.contact.normal].every(value => value
        && [value.x, value.y, value.z].every(Number.isFinite))) {
      throw new Error(`${label} wall sample is invalid at tick ${index + 1}`);
    }
  }
  const firstContact = trace.samples.find(sample => sample.contact.hasContact);
  if (!firstContact) throw new Error(`${label} body-wall contact is missing`);
  if (Math.abs(firstContact.tick - WALL_TRACE_EXPECTED_FIRST_CONTACT_TICK) > WALL_TRACE_CONTACT_TICK_TOLERANCE) {
    throw new Error(`${label} first body-wall contact differs at tick ${firstContact.tick}`);
  }
  if (!firstContact.grounded) throw new Error(`${label} first body-wall contact is not grounded`);
  if (firstContact.contact.normal.x >= -0.9) throw new Error(`${label} first body-wall normal does not point toward -X`);
  return firstContact;
}

export function compareWallTraces(wasmTrace, nativeTrace, { positionTolerance = 0.1, velocityTolerance = 0.1, normalTolerance = 0.05 } = {}) {
  const wasmContact = validateTrace(wasmTrace, "WASM");
  const nativeContact = validateTrace(nativeTrace, "native");
  const maximum = { position: 0, velocity: 0, contactNormal: 0, tick: 0 };
  for (let index = 0; index < WALL_TRACE_FRAME_COUNT; index += 1) {
    const wasm = wasmTrace.samples[index];
    const native = nativeTrace.samples[index];
    if (wasm.contact.hasContact !== native.contact.hasContact || wasm.grounded !== native.grounded) {
      throw new Error(`wall contact state differs at tick ${index + 1}`);
    }
    for (const key of ["position", "velocity"]) {
      const delta = distance(wasm.state[key], native.state[key]);
      if (delta > maximum[key]) { maximum[key] = delta; maximum.tick = wasm.tick; }
    }
    if (wasm.contact.hasContact) {
      const delta = distance(wasm.contact.normal, native.contact.normal);
      if (delta > maximum.contactNormal) { maximum.contactNormal = delta; maximum.tick = wasm.tick; }
    }
  }
  const ok = maximum.position <= positionTolerance && maximum.velocity <= velocityTolerance
    && maximum.contactNormal <= normalTolerance && wasmContact.tick === nativeContact.tick;
  return {
    ok,
    tolerances: { position: positionTolerance, velocity: velocityTolerance, contactNormal: normalTolerance },
    firstContactTick: wasmContact.tick,
    maximum,
  };
}
