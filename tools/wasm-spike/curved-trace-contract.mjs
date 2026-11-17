import { forwardFromBridgeOrientation, normalizeWasmTraceSnapshot } from "./trace-contract.mjs";

export const CURVED_TRACE_SCHEMA_VERSION = 1;
export const CURVED_TRACE_FIXED_STEP_HZ = 120;
export const CURVED_TRACE_FRAME_COUNT = 480;
export const CURVED_TRACE_FIXTURE = "arsenal-curved-practice-one-car-r1";
export const CURVED_TRACE_EXPECTED_FIRST_INCLINED_TICK = 215;
export const CURVED_TRACE_EXPECTED_FIRST_STEEP_TICK = 229;
export const CURVED_TRACE_CONTACT_TICK_TOLERANCE = 4;
export const CURVED_TRACE_MAX_NORMAL_STEP_DEGREES = 8;

export const CURVED_TRACE_GEOMETRY = Object.freeze({
  kind: "original-quarter-pipe",
  scale: 56 / 2300,
  radiusUU: 256,
  segments: 32,
  bvhMargin: 0.04,
  boundary: "+X",
});

export function curvedTraceInput(tick) {
  if (!Number.isSafeInteger(tick) || tick < 1 || tick > CURVED_TRACE_FRAME_COUNT) {
    throw new Error("curved trace tick is out of range");
  }
  return { throttle: 1, steer: 0, jump: false, boost: tick >= 24 && tick <= 210 };
}

export function normalizeCurvedWasmSnapshot(tick, values, grounded, wheelCount, hasContact, nativeNormal) {
  return {
    ...normalizeWasmTraceSnapshot(tick, values),
    grounded: grounded === true,
    wheelCount: normalizeWheelCount(wheelCount),
    support: {
      hasContact: hasContact === true,
      normal: jsonBasisNormal(nativeNormal),
    },
  };
}

export function normalizeCurvedNativeSnapshot(tick, input, car) {
  const wheelContact = car.wheelContact || {};
  return {
    tick,
    input,
    grounded: car.grounded === true,
    wheelCount: normalizeWheelCount(car.wheelCount),
    support: {
      hasContact: wheelContact.hasContact === true,
      normal: finiteVector(wheelContact.normal, "native wheel support normal"),
    },
    state: {
      position: car.position,
      velocity: car.velocity,
      forward: forwardFromBridgeOrientation(car.orientation),
    },
  };
}

function normalizeWheelCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4) throw new Error("curved trace wheel count is invalid");
  return value;
}

function finiteVector(value, label) {
  if (!value || typeof value !== "object" || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${label} is invalid`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

function jsonBasisNormal(nativeNormal) {
  const value = finiteVector(
    Array.isArray(nativeNormal)
      ? { x: nativeNormal[0], y: nativeNormal[1], z: nativeNormal[2] }
      : nativeNormal,
    "curved trace support normal",
  );
  // RocketSim uses x/y/z with z up; the bridge JSON contract uses x/y/z with y up.
  return { x: value.x, y: value.z, z: value.y };
}

function vectorDistance(left, right, label) {
  const a = finiteVector(left, `${label}.left`);
  const b = finiteVector(right, `${label}.right`);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sameInput(left, right) {
  return left && right
    && left.throttle === right.throttle
    && left.steer === right.steer
    && left.jump === right.jump
    && left.boost === right.boost;
}

function supportNormal(sample) {
  return finiteVector(sample?.support?.normal, "curved trace support normal");
}

function supported(sample) {
  return sample?.support?.hasContact === true && sample.wheelCount > 0;
}

function transitionMetrics(trace, label) {
  let firstInclined = null;
  let firstSteep = null;
  let contactGapsBeforeSteep = 0;
  let previousNormal = null;
  let maxNormalStepDegrees = 0;
  for (const sample of trace.samples) {
    const normal = supportNormal(sample);
    if (!firstInclined && supported(sample) && normal.y < .96 && normal.y > .2 && normal.x < -.05) {
      firstInclined = sample;
    }
    if (!firstSteep && supported(sample) && normal.y < .55 && normal.x < -.4) {
      firstSteep = sample;
    }
    if (firstInclined && !firstSteep && !supported(sample)) contactGapsBeforeSteep += 1;
    if (supported(sample) && normal.y < .999 && normal.x < -.01) {
      if (previousNormal) {
        const dot = Math.max(-1, Math.min(1,
          normal.x * previousNormal.x + normal.y * previousNormal.y + normal.z * previousNormal.z,
        ));
        maxNormalStepDegrees = Math.max(maxNormalStepDegrees, Math.acos(dot) * 180 / Math.PI);
      }
      previousNormal = normal;
    }
  }
  if (!firstInclined) throw new Error(`${label} trace never observed an inclined wheel support`);
  if (!firstSteep) throw new Error(`${label} trace never observed a steep wheel support`);
  if (contactGapsBeforeSteep !== 0) throw new Error(`${label} trace has ${contactGapsBeforeSteep} support gaps before the steep transition`);
  if (maxNormalStepDegrees > CURVED_TRACE_MAX_NORMAL_STEP_DEGREES) {
    throw new Error(`${label} trace normal step exceeds ${CURVED_TRACE_MAX_NORMAL_STEP_DEGREES} degrees: ${maxNormalStepDegrees}`);
  }
  if (Math.abs(firstInclined.tick - CURVED_TRACE_EXPECTED_FIRST_INCLINED_TICK) > CURVED_TRACE_CONTACT_TICK_TOLERANCE) {
    throw new Error(`${label} first inclined support differs at tick ${firstInclined.tick}`);
  }
  if (Math.abs(firstSteep.tick - CURVED_TRACE_EXPECTED_FIRST_STEEP_TICK) > CURVED_TRACE_CONTACT_TICK_TOLERANCE) {
    throw new Error(`${label} first steep support differs at tick ${firstSteep.tick}`);
  }
  return { firstInclined, firstSteep, contactGapsBeforeSteep, maxNormalStepDegrees };
}

function validateTrace(trace, label) {
  if (!trace || trace.schemaVersion !== CURVED_TRACE_SCHEMA_VERSION || trace.fixture !== CURVED_TRACE_FIXTURE
    || trace.fixedStepHz !== CURVED_TRACE_FIXED_STEP_HZ || !Array.isArray(trace.samples)
    || trace.samples.length !== CURVED_TRACE_FRAME_COUNT) {
    throw new Error(`${label} curved trace contract is invalid`);
  }
  for (let index = 0; index < CURVED_TRACE_FRAME_COUNT; index += 1) {
    const sample = trace.samples[index];
    if (!sample || sample.tick !== index + 1 || !sameInput(sample.input, curvedTraceInput(index + 1))) {
      throw new Error(`${label} curved input contract differs at tick ${index + 1}`);
    }
    if (typeof sample.grounded !== "boolean" || !Number.isSafeInteger(sample.wheelCount)
      || sample.wheelCount < 0 || sample.wheelCount > 4 || typeof sample.support?.hasContact !== "boolean") {
      throw new Error(`${label} curved support state is invalid at tick ${index + 1}`);
    }
    for (const key of ["position", "velocity", "forward"]) finiteVector(sample.state?.[key], `${label} ${key} at tick ${index + 1}`);
    supportNormal(sample);
  }
  return transitionMetrics(trace, label);
}

export function analyzeCurvedTrace(trace, label = "curved") {
  return validateTrace(trace, label);
}

export function compareCurvedTraces(wasmTrace, nativeTrace, {
  positionTolerance = 0.1,
  velocityTolerance = 0.1,
  forwardTolerance = 0.01,
  normalTolerance = 0.05,
} = {}) {
  const wasmMetrics = validateTrace(wasmTrace, "WASM");
  const nativeMetrics = validateTrace(nativeTrace, "native");
  const maximum = { position: 0, velocity: 0, forward: 0, supportNormal: 0, tick: 0 };
  for (let index = 0; index < CURVED_TRACE_FRAME_COUNT; index += 1) {
    const wasm = wasmTrace.samples[index];
    const native = nativeTrace.samples[index];
    if (wasm.tick !== native.tick || wasm.grounded !== native.grounded
      || wasm.wheelCount !== native.wheelCount || wasm.support.hasContact !== native.support.hasContact) {
      throw new Error(`curved support state differs at tick ${index + 1}`);
    }
    for (const key of ["position", "velocity", "forward"]) {
      const delta = vectorDistance(wasm.state[key], native.state[key], `${key}[${index}]`);
      if (delta > maximum[key]) { maximum[key] = delta; maximum.tick = wasm.tick; }
    }
    if (wasm.support.hasContact) {
      const delta = vectorDistance(wasm.support.normal, native.support.normal, `supportNormal[${index}]`);
      if (delta > maximum.supportNormal) { maximum.supportNormal = delta; maximum.tick = wasm.tick; }
    }
  }
  const ok = maximum.position <= positionTolerance && maximum.velocity <= velocityTolerance
    && maximum.forward <= forwardTolerance && maximum.supportNormal <= normalTolerance
    && wasmMetrics.firstInclined.tick === nativeMetrics.firstInclined.tick
    && wasmMetrics.firstSteep.tick === nativeMetrics.firstSteep.tick;
  return {
    ok,
    tolerances: { position: positionTolerance, velocity: velocityTolerance, forward: forwardTolerance, supportNormal: normalTolerance },
    firstInclinedTick: wasmMetrics.firstInclined.tick,
    firstSteepTick: wasmMetrics.firstSteep.tick,
    maximum,
  };
}
