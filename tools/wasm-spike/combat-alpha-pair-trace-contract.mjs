// P2P-WASM-17: two-car physical parity and lifecycle contract for combat-alpha.
export const COMBAT_ALPHA_PAIR_TRACE_SCHEMA_VERSION = 1;
export const COMBAT_ALPHA_PAIR_TRACE_FIXTURE = "combat-alpha-two-blue-cars-p2p-wasm-17";
export const COMBAT_ALPHA_PAIR_FIXED_STEP_HZ = 120;
export const COMBAT_ALPHA_PAIR_CONTROL_TICKS = 60;
export const COMBAT_ALPHA_PAIR_PHASES = Object.freeze([
  "initial",
  "inactive",
  "inactive-step",
  "respawned",
  "respawn-step",
]);

// These match the established R20/WASM lifecycle comparator bounds. Spawn
// checks use its wider startup allowance because the first state follows a
// neutral tick; ongoing parity still uses the tighter position tolerance.
export const COMBAT_ALPHA_PAIR_POSITION_TOLERANCE_UU = 0.05;
export const COMBAT_ALPHA_PAIR_VELOCITY_TOLERANCE_UU_PER_SECOND = 0.05;
export const COMBAT_ALPHA_PAIR_FORWARD_TOLERANCE = 0.0005;
// The 120-step arena settle introduces a small heading drift before tick 1.
export const COMBAT_ALPHA_PAIR_SPAWN_YAW_TOLERANCE = 0.02;
export const COMBAT_ALPHA_PAIR_SPAWN_TOLERANCE_UU = 2;
export const COMBAT_ALPHA_PAIR_INACTIVE_FLOOR_Z = -1000;

const NEUTRAL_INPUT = Object.freeze({ throttle: 0, steer: 0, jump: false, boost: false });
const TAPE_INPUT = Object.freeze({ throttle: 0.5, steer: 0, jump: false, boost: false });
const REQUIRED_CAR_IDS = Object.freeze([1, 2]);
const VECTOR_LENGTH = 3;

export const COMBAT_ALPHA_PAIR_NEUTRAL_CARS = Object.freeze(REQUIRED_CAR_IDS.map(id => Object.freeze({
  id,
  input: NEUTRAL_INPUT,
})));

export const COMBAT_ALPHA_PAIR_CONTROL_TAPE = Object.freeze(Array.from(
  { length: COMBAT_ALPHA_PAIR_CONTROL_TICKS },
  () => Object.freeze([
    Object.freeze({ id: 1, input: TAPE_INPUT }),
    Object.freeze({ id: 2, input: NEUTRAL_INPUT }),
  ]),
));

function fail(message) {
  throw new TypeError(`P2P-WASM-17 combat-alpha pair trace ${message}.`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isFiniteVector(value) {
  return Array.isArray(value) && value.length === VECTOR_LENGTH && value.every(Number.isFinite);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function requireNear(actual, expected, tolerance, label) {
  const error = distance(actual, expected);
  if (error > tolerance) fail(`${label} differs by ${error.toFixed(6)} (limit ${tolerance})`);
}

function validateCar(car, index, label) {
  if (!isRecord(car) || car.id !== REQUIRED_CAR_IDS[index] || car.index !== index
    || !isFiniteVector(car.position) || !isFiniteVector(car.velocity) || !isFiniteVector(car.forward)
    || typeof car.grounded !== "boolean") {
    fail(`${label} car ${REQUIRED_CAR_IDS[index]} is malformed`);
  }
}

function validateCars(cars, label) {
  if (!Array.isArray(cars) || cars.length !== 2) fail(`${label} must contain both cars`);
  for (let index = 0; index < 2; index += 1) validateCar(cars[index], index, label);
}

function validateInputFrame(frame, index) {
  if (!Array.isArray(frame) || frame.length !== 2) fail(`control tape frame ${index + 1} is malformed`);
  for (let carIndex = 0; carIndex < 2; carIndex += 1) {
    const entry = frame[carIndex];
    const expected = carIndex === 0 ? TAPE_INPUT : NEUTRAL_INPUT;
    if (!isRecord(entry) || entry.id !== REQUIRED_CAR_IDS[carIndex] || !isRecord(entry.input)
      || entry.input.throttle !== expected.throttle || entry.input.steer !== expected.steer
      || entry.input.jump !== expected.jump || entry.input.boost !== false
      || Object.keys(entry.input).length !== 4) {
      fail(`control tape frame ${index + 1} car ${REQUIRED_CAR_IDS[carIndex]} is not the no-boost reference input`);
    }
  }
}

export function createCombatAlphaPairTrace(source, { initial, timeline, phases }) {
  const trace = {
    schemaVersion: COMBAT_ALPHA_PAIR_TRACE_SCHEMA_VERSION,
    fixture: COMBAT_ALPHA_PAIR_TRACE_FIXTURE,
    fixedStepHz: COMBAT_ALPHA_PAIR_FIXED_STEP_HZ,
    source,
    controlTape: COMBAT_ALPHA_PAIR_CONTROL_TAPE,
    initial,
    timeline,
    phases,
  };
  validateCombatAlphaPairTrace(trace);
  return trace;
}

export function validateCombatAlphaPairTrace(trace) {
  if (!isRecord(trace) || trace.schemaVersion !== COMBAT_ALPHA_PAIR_TRACE_SCHEMA_VERSION
    || trace.fixture !== COMBAT_ALPHA_PAIR_TRACE_FIXTURE
    || trace.fixedStepHz !== COMBAT_ALPHA_PAIR_FIXED_STEP_HZ || typeof trace.source !== "string"
    || !Array.isArray(trace.controlTape) || trace.controlTape.length !== COMBAT_ALPHA_PAIR_CONTROL_TICKS
    || !Array.isArray(trace.timeline) || trace.timeline.length !== COMBAT_ALPHA_PAIR_CONTROL_TICKS
    || !Array.isArray(trace.phases) || trace.phases.length !== COMBAT_ALPHA_PAIR_PHASES.length) {
    fail("header, control tape, timeline, or phase count is invalid");
  }
  trace.controlTape.forEach(validateInputFrame);

  if (!isRecord(trace.initial) || trace.initial.phase !== "initial"
    || !Number.isSafeInteger(trace.initial.tick) || trace.initial.tick < 1) {
    fail("initial phase is malformed");
  }
  validateCars(trace.initial.cars, "initial phase");
  const startTick = trace.initial.tick;

  for (let index = 0; index < trace.timeline.length; index += 1) {
    const sample = trace.timeline[index];
    if (!isRecord(sample) || sample.tick !== startTick + index + 1) {
      fail(`control tape tick ${index + 1} is malformed or out of order`);
    }
    validateCars(sample.cars, `control tape tick ${index + 1}`);
    if (!sample.cars[0].grounded || !sample.cars[1].grounded) {
      fail(`control tape tick ${index + 1} lost grounded support`);
    }
  }

  const expectedTicks = [
    startTick,
    startTick + COMBAT_ALPHA_PAIR_CONTROL_TICKS,
    startTick + COMBAT_ALPHA_PAIR_CONTROL_TICKS + 1,
    startTick + COMBAT_ALPHA_PAIR_CONTROL_TICKS + 1,
    startTick + COMBAT_ALPHA_PAIR_CONTROL_TICKS + 2,
  ];
  for (let index = 0; index < COMBAT_ALPHA_PAIR_PHASES.length; index += 1) {
    const sample = trace.phases[index];
    if (!isRecord(sample) || sample.phase !== COMBAT_ALPHA_PAIR_PHASES[index]
      || sample.tick !== expectedTicks[index]) {
      fail(`phase ${COMBAT_ALPHA_PAIR_PHASES[index]} is malformed, out of order, or advanced the wrong tick`);
    }
    validateCars(sample.cars, `${sample.phase} phase`);
  }

  const initialFirst = trace.initial.cars[0];
  const initialSecond = trace.initial.cars[1];
  requireNear(initialFirst.position, [-1500, -1230, initialFirst.position[2]], COMBAT_ALPHA_PAIR_SPAWN_TOLERANCE_UU, "slot 0 spawn");
  requireNear(initialSecond.position, [1970, 1230, initialFirst.position[2]], COMBAT_ALPHA_PAIR_SPAWN_TOLERANCE_UU, "slot 1 spawn");
  if (Math.abs(initialSecond.position[2] - initialFirst.position[2]) > COMBAT_ALPHA_PAIR_SPAWN_TOLERANCE_UU
    || !initialFirst.grounded || !initialSecond.grounded
    || Math.hypot(...initialFirst.velocity) > COMBAT_ALPHA_PAIR_VELOCITY_TOLERANCE_UU_PER_SECOND
    || Math.hypot(...initialSecond.velocity) > COMBAT_ALPHA_PAIR_VELOCITY_TOLERANCE_UU_PER_SECOND) {
    fail("initial spawn is not a neutral, grounded two-car state");
  }
  requireNear(initialFirst.forward, [1, 0, 0], COMBAT_ALPHA_PAIR_SPAWN_YAW_TOLERANCE, "slot 0 yaw after settle");
  requireNear(initialSecond.forward, [-1, 0, 0], COMBAT_ALPHA_PAIR_SPAWN_YAW_TOLERANCE, "slot 1 opposite yaw after settle");

  const lastTape = trace.timeline.at(-1);
  if (lastTape.cars[0].position[0] <= initialFirst.position[0] + 0.1) {
    fail("the 60-tick throttle tape did not move car 1 forward");
  }

  const inactive = trace.phases[1].cars[1];
  if (inactive.position[2] >= -9999 || inactive.grounded
    || Math.hypot(...inactive.velocity) > COMBAT_ALPHA_PAIR_VELOCITY_TOLERANCE_UU_PER_SECOND) {
    fail("inactive phase did not preserve the lifecycle sentinel");
  }
  const inactiveStep = trace.phases[2].cars[1];
  if (inactiveStep.position[2] >= COMBAT_ALPHA_PAIR_INACTIVE_FLOOR_Z || inactiveStep.grounded) {
    fail("inactive-step returned the car to the arena or support surface");
  }

  const respawned = trace.phases[3].cars[1];
  requireNear(respawned.position, initialSecond.position, COMBAT_ALPHA_PAIR_SPAWN_TOLERANCE_UU, "respawned slot 1 position");
  requireNear(respawned.velocity, [0, 0, 0], COMBAT_ALPHA_PAIR_VELOCITY_TOLERANCE_UU_PER_SECOND, "respawned slot 1 velocity");
  requireNear(respawned.forward, [-1, 0, 0], COMBAT_ALPHA_PAIR_SPAWN_YAW_TOLERANCE, "respawned slot 1 yaw");
  if (!respawned.grounded) fail("respawn did not restore grounded support");

  const inactiveCar1 = trace.phases[1].cars[0];
  requireNear(inactiveCar1.position, lastTape.cars[0].position, COMBAT_ALPHA_PAIR_POSITION_TOLERANCE_UU, "inactive car 1 position");
  requireNear(inactiveCar1.velocity, lastTape.cars[0].velocity, COMBAT_ALPHA_PAIR_VELOCITY_TOLERANCE_UU_PER_SECOND, "inactive car 1 velocity");
  requireNear(inactiveCar1.forward, lastTape.cars[0].forward, COMBAT_ALPHA_PAIR_FORWARD_TOLERANCE, "inactive car 1 forward");

  return trace;
}

/** Compare every control-tape sample and each lifecycle boundary by phase. */
export function compareCombatAlphaPairTraces(wasmTrace, nativeTrace) {
  validateCombatAlphaPairTrace(wasmTrace);
  validateCombatAlphaPairTrace(nativeTrace);
  const mismatches = [];
  const comparisons = [];
  const pairs = [
    { label: "initial", wasm: wasmTrace.initial, native: nativeTrace.initial },
    ...wasmTrace.timeline.map((wasm, index) => ({
      label: `control-${index + 1}`,
      wasm,
      native: nativeTrace.timeline[index],
    })),
    ...COMBAT_ALPHA_PAIR_PHASES.slice(1).map((phase, index) => ({
      label: phase,
      wasm: wasmTrace.phases[index + 1],
      native: nativeTrace.phases[index + 1],
    })),
  ];

  for (const pair of pairs) {
    const cars = [];
    for (let carIndex = 0; carIndex < 2; carIndex += 1) {
      const wasmCar = pair.wasm.cars[carIndex];
      const nativeCar = pair.native.cars[carIndex];
      const positionError = distance(wasmCar.position, nativeCar.position);
      const velocityError = distance(wasmCar.velocity, nativeCar.velocity);
      const forwardError = distance(wasmCar.forward, nativeCar.forward);
      if (positionError > COMBAT_ALPHA_PAIR_POSITION_TOLERANCE_UU) {
        mismatches.push(`${pair.label} car ${wasmCar.id} position ${positionError.toFixed(6)} UU`);
      }
      if (velocityError > COMBAT_ALPHA_PAIR_VELOCITY_TOLERANCE_UU_PER_SECOND) {
        mismatches.push(`${pair.label} car ${wasmCar.id} velocity ${velocityError.toFixed(6)} UU/s`);
      }
      if (forwardError > COMBAT_ALPHA_PAIR_FORWARD_TOLERANCE) {
        mismatches.push(`${pair.label} car ${wasmCar.id} forward ${forwardError.toFixed(6)}`);
      }
      if (wasmCar.grounded !== nativeCar.grounded) mismatches.push(`${pair.label} car ${wasmCar.id} grounded differs`);
      cars.push({ id: wasmCar.id, positionError, velocityError, forwardError, groundedMatches: wasmCar.grounded === nativeCar.grounded });
    }
    comparisons.push({ phase: pair.label, wasmTick: pair.wasm.tick, nativeTick: pair.native.tick, cars });
  }
  return { ok: mismatches.length === 0, mismatches, comparisons };
}
