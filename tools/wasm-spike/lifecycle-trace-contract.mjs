// Test-only physical lifecycle contract for the isolated combat-lineup WASM
// fixture and the native R20 bridge. This says nothing about combat events.
export const LIFECYCLE_TRACE_SCHEMA_VERSION = 1;
export const LIFECYCLE_TRACE_FIXTURE = "combat-lineup-two-blue-cars-id-2-lifecycle";
export const LIFECYCLE_TRACE_FIXED_STEP_HZ = 120;
export const LIFECYCLE_TRACE_PHASES = Object.freeze([
  "initial",
  "inactive",
  "inactive-step",
  "respawned",
  "respawn-step",
]);

// R20 frames are printed to six decimal places. These bounds allow the
// serialization/floating-point noise while remaining tiny relative to the
// 600 UU spawn separation and the 10,000 UU inactive sentinel.
export const LIFECYCLE_POSITION_TOLERANCE_UU = 0.05;
export const LIFECYCLE_VELOCITY_TOLERANCE_UU_PER_SECOND = 0.05;
export const LIFECYCLE_FORWARD_TOLERANCE = 0.0005;
// The established fixture-init gate allows ±2 UU around the native spawn;
// startup settling moves this car about 0.16 UU before its initial snapshot.
export const LIFECYCLE_SPAWN_TOLERANCE_UU = 2;
export const LIFECYCLE_OUTSIDE_ARENA_FLOOR_Z = -1000;

const VECTOR_LENGTH = 3;
const REQUIRED_CAR_IDS = [1, 2];

function fail(message) {
  throw new TypeError(`WASM physical lifecycle trace ${message}.`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isFiniteVector(value) {
  return Array.isArray(value) && value.length === VECTOR_LENGTH && value.every(Number.isFinite);
}

function toVector(value, axes, label) {
  const result = axes.map(axis => value?.[axis]);
  if (!result.every(Number.isFinite)) fail(`${label} contains a non-finite vector`);
  return result;
}

function carFromInternal(index, values, grounded) {
  if (!Array.isArray(values) || values.length !== 9 || !values.every(Number.isFinite)) {
    fail(`car ${index + 1} snapshot is invalid`);
  }
  if (grounded !== 0 && grounded !== 1) fail(`car ${index + 1} grounded flag is invalid`);
  return {
    id: index + 1,
    index,
    position: values.slice(0, 3),
    velocity: values.slice(3, 6),
    forward: values.slice(6, 9),
    grounded: grounded === 1,
  };
}

export function normalizeWasmLifecycleCar(index, values, grounded) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 1) fail("WASM car index is invalid");
  return carFromInternal(index, values, grounded);
}

export function normalizeNativeLifecycleCar(car) {
  if (!isRecord(car) || !REQUIRED_CAR_IDS.includes(car.id)) fail("native car identity is invalid");
  const axes = ["x", "z", "y"];
  const position = toVector(car.position, axes, `native car ${car.id} position`);
  const velocity = toVector(car.velocity, axes, `native car ${car.id} velocity`);
  const orientation = car.orientation;
  const quaternion = orientation && [orientation.x, orientation.y, orientation.z, orientation.w];
  if (!quaternion || !quaternion.every(Number.isFinite)) fail(`native car ${car.id} orientation quaternion is invalid`);
  const [qx, qy, qz, qw] = quaternion;
  // The bridge protocol retains the external y-up quaternion but strips its
  // convenience forward vector. Rotate local +X, then map back to RocketSim's
  // internal z-up xyz axes for a direct comparison with the WASM snapshot.
  const externalForward = [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy + qz * qw),
    2 * (qx * qz - qy * qw),
  ];
  const forward = [externalForward[0], externalForward[2], externalForward[1]];
  if (typeof car.grounded !== "boolean") fail(`native car ${car.id} grounded flag is invalid`);
  return { id: car.id, index: car.id - 1, position, velocity, forward, grounded: car.grounded };
}

export function createLifecycleTrace(source, samples) {
  const trace = {
    schemaVersion: LIFECYCLE_TRACE_SCHEMA_VERSION,
    fixture: LIFECYCLE_TRACE_FIXTURE,
    fixedStepHz: LIFECYCLE_TRACE_FIXED_STEP_HZ,
    source,
    samples,
  };
  validateLifecycleTrace(trace);
  return trace;
}

function vectorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function requireNear(value, expected, tolerance, label) {
  const distance = vectorDistance(value, expected);
  if (distance > tolerance) fail(`${label} differs by ${distance.toFixed(6)} (limit ${tolerance})`);
  return distance;
}

function validateLifecycleTrace(trace) {
  if (!isRecord(trace)
    || trace.schemaVersion !== LIFECYCLE_TRACE_SCHEMA_VERSION
    || trace.fixture !== LIFECYCLE_TRACE_FIXTURE
    || trace.fixedStepHz !== LIFECYCLE_TRACE_FIXED_STEP_HZ
    || typeof trace.source !== "string"
    || !Array.isArray(trace.samples)
    || trace.samples.length !== LIFECYCLE_TRACE_PHASES.length) {
    fail("header or sample count is invalid");
  }

  let initialTick;
  for (let phaseIndex = 0; phaseIndex < LIFECYCLE_TRACE_PHASES.length; phaseIndex += 1) {
    const sample = trace.samples[phaseIndex];
    const expectedPhase = LIFECYCLE_TRACE_PHASES[phaseIndex];
    if (!isRecord(sample) || sample.phase !== expectedPhase
      || !Number.isSafeInteger(sample.tick) || sample.tick < 0
      || !Array.isArray(sample.cars) || sample.cars.length !== 2) {
      fail(`phase ${expectedPhase} is malformed or out of order`);
    }
    if (phaseIndex === 0) initialTick = sample.tick;
    const expectedTick = initialTick + (phaseIndex >= 2 ? 1 : 0) + (phaseIndex >= 4 ? 1 : 0);
    if (sample.tick !== expectedTick) {
      fail(`phase ${expectedPhase} has an unexpected tick; mutations must align by phase`);
    }
    for (let index = 0; index < 2; index += 1) {
      const car = sample.cars[index];
      if (!isRecord(car) || car.id !== REQUIRED_CAR_IDS[index] || car.index !== index
        || !isFiniteVector(car.position) || !isFiniteVector(car.velocity) || !isFiniteVector(car.forward)
        || typeof car.grounded !== "boolean") {
        fail(`phase ${expectedPhase} car ${REQUIRED_CAR_IDS[index]} is malformed`);
      }
    }
  }

  const first = trace.samples[0].cars[0];
  const second = trace.samples[0].cars[1];
  if (Math.abs(second.position[0] + 600) > LIFECYCLE_SPAWN_TOLERANCE_UU
    || Math.abs(second.position[1]) > LIFECYCLE_POSITION_TOLERANCE_UU
    || !first.grounded || !second.grounded) {
    fail("combat-lineup initial spawn is incompatible with the two-car fixture");
  }

  const inactiveMutation = trace.samples[1].cars[1];
  if (inactiveMutation.position[2] >= -9999 || inactiveMutation.grounded !== false) {
    fail("inactive mutation does not preserve the sentinel and airborne state");
  }
  if (Math.hypot(...inactiveMutation.velocity) > LIFECYCLE_VELOCITY_TOLERANCE_UU_PER_SECOND) {
    fail("inactive mutation did not clear linear velocity");
  }
  const inactiveStep = trace.samples[2].cars[1];
  // The native step applies a large out-of-bounds floor correction to the
  // sentinel. It remains far below the combat arena bounds, rather than being
  // teleported back into the world; compare its exact phase with R20 below.
  if (inactiveStep.position[2] >= LIFECYCLE_OUTSIDE_ARENA_FLOOR_Z || inactiveStep.grounded) {
    fail("inactive car returned to the arena or became grounded after one neutral step");
  }

  const respawned = trace.samples[3].cars[1];
  if (Math.abs(respawned.position[0] + 600) > LIFECYCLE_SPAWN_TOLERANCE_UU
    || Math.abs(respawned.position[1]) > LIFECYCLE_POSITION_TOLERANCE_UU
    || Math.abs(respawned.position[2] - second.position[2]) > LIFECYCLE_SPAWN_TOLERANCE_UU) {
    fail("respawn position is incompatible with the combat-lineup spawn");
  }
  requireNear(respawned.forward, [1, 0, 0], LIFECYCLE_FORWARD_TOLERANCE, "respawn forward");
  if (Math.hypot(...respawned.velocity) > LIFECYCLE_VELOCITY_TOLERANCE_UU_PER_SECOND || !respawned.grounded) {
    fail("respawn did not restore a stationary grounded car");
  }

  for (const sample of trace.samples.slice(1)) {
    const car = sample.cars[0];
    requireNear(car.position, first.position, LIFECYCLE_POSITION_TOLERANCE_UU, `${sample.phase} first-car position`);
    requireNear(car.velocity, first.velocity, LIFECYCLE_VELOCITY_TOLERANCE_UU_PER_SECOND, `${sample.phase} first-car velocity`);
    requireNear(car.forward, first.forward, LIFECYCLE_FORWARD_TOLERANCE, `${sample.phase} first-car forward`);
    if (car.grounded !== first.grounded) fail(`${sample.phase} changed first-car grounded state`);
  }
  return trace;
}

/** Compare only matching lifecycle phases; native and WASM mutation ticks differ by design. */
export function compareLifecycleTraces(wasmTrace, nativeTrace) {
  validateLifecycleTrace(wasmTrace);
  validateLifecycleTrace(nativeTrace);
  const phaseComparisons = [];
  const mismatches = [];

  for (let phaseIndex = 0; phaseIndex < LIFECYCLE_TRACE_PHASES.length; phaseIndex += 1) {
    const wasm = wasmTrace.samples[phaseIndex];
    const native = nativeTrace.samples[phaseIndex];
    const cars = [];
    for (let carIndex = 0; carIndex < 2; carIndex += 1) {
      const wasmCar = wasm.cars[carIndex];
      const nativeCar = native.cars[carIndex];
      const positionDistance = vectorDistance(wasmCar.position, nativeCar.position);
      const velocityDistance = vectorDistance(wasmCar.velocity, nativeCar.velocity);
      const forwardDistance = vectorDistance(wasmCar.forward, nativeCar.forward);
      if (positionDistance > LIFECYCLE_POSITION_TOLERANCE_UU) {
        mismatches.push(`${wasm.phase} car ${wasmCar.id} position ${positionDistance.toFixed(6)} UU`);
      }
      if (velocityDistance > LIFECYCLE_VELOCITY_TOLERANCE_UU_PER_SECOND) {
        mismatches.push(`${wasm.phase} car ${wasmCar.id} velocity ${velocityDistance.toFixed(6)} UU/s`);
      }
      if (forwardDistance > LIFECYCLE_FORWARD_TOLERANCE) {
        mismatches.push(`${wasm.phase} car ${wasmCar.id} forward ${forwardDistance.toFixed(6)}`);
      }
      if (wasmCar.grounded !== nativeCar.grounded) {
        mismatches.push(`${wasm.phase} car ${wasmCar.id} grounded differs`);
      }
      cars.push({
        id: wasmCar.id,
        positionDistance,
        velocityDistance,
        forwardDistance,
        groundedMatches: wasmCar.grounded === nativeCar.grounded,
      });
    }
    phaseComparisons.push({
      phase: wasm.phase,
      wasmTick: wasm.tick,
      nativeTick: native.tick,
      cars,
    });
  }
  return { ok: mismatches.length === 0, mismatches, phaseComparisons };
}
