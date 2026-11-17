import { forwardFromBridgeOrientation, normalizeWasmTraceSnapshot } from "./trace-contract.mjs";

export const CAR_CONTACT_TRACE_SCHEMA_VERSION = 1;
export const CAR_CONTACT_TRACE_FIXED_STEP_HZ = 120;
export const CAR_CONTACT_TRACE_FRAME_COUNT = 180;
export const CAR_CONTACT_TRACE_FIXTURE = "combat-lineup-clean-six-planes-two-car-r1";
export const CAR_CONTACT_EXPECTED_FIRST_TRANSFER_TICK = 108;
export const CAR_CONTACT_TRANSFER_TICK_TOLERANCE = 2;

const TARGET_ID = 1;
const CHASER_ID = 2;
const TARGET_MAX_QUIET_SPEED = 0.02;
// This gate detects an impulse transfer from the pair's public state deltas;
// it deliberately does not claim to observe RocketSim's internal carContact.
const MIN_TARGET_DELTA_VX = 500;
const MIN_CHASER_DROP_VX = 200;
// Both cars are blue and the trace rejects speeds above 2000 UU/s, below
// RocketSim's 2200 UU/s supersonic threshold; the fixture therefore avoids demos.
const MAX_SPEED_BEFORE_SUPERSONIC = 2000;

function requireTick(tick) {
  if (!Number.isSafeInteger(tick) || tick < 1 || tick > CAR_CONTACT_TRACE_FRAME_COUNT) {
    throw new Error("car-contact trace tick is out of range");
  }
}

export function carContactTraceInputs(tick) {
  requireTick(tick);
  return [
    { id: TARGET_ID, throttle: 0, steer: 0, jump: false, boost: false },
    { id: CHASER_ID, throttle: 1, steer: 0, jump: false, boost: false },
  ];
}

export function normalizeCarContactWasmSnapshot(tick, values, grounded) {
  return { ...normalizeWasmTraceSnapshot(tick, values), grounded: grounded === true };
}

export function normalizeCarContactNativeSnapshot(tick, inputs, cars) {
  if (!Array.isArray(cars) || cars.length !== 2) throw new Error("native car-contact frame must contain two cars");
  const carsById = new Map(cars.map(car => [car?.id, car]));
  if (carsById.size !== 2 || !carsById.has(TARGET_ID) || !carsById.has(CHASER_ID)) {
    throw new Error("native car-contact frame must retain the configured car IDs");
  }
  return {
    tick,
    cars: inputs.map(input => {
      const car = carsById.get(input.id);
      return {
      id: input.id,
      input,
      grounded: car.grounded === true,
      state: {
        position: car.position,
        velocity: car.velocity,
        forward: forwardFromBridgeOrientation(car.orientation),
      },
    };
    }),
  };
}

function finiteVector(value, label) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${label} must be a finite vector`);
  }
}

function vectorLength(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function sameInput(left, right) {
  return left && right
    && left.id === right.id
    && left.throttle === right.throttle
    && left.steer === right.steer
    && left.jump === right.jump
    && left.boost === right.boost;
}

function validateTrace(trace, label) {
  if (!trace || trace.schemaVersion !== CAR_CONTACT_TRACE_SCHEMA_VERSION
    || trace.fixture !== CAR_CONTACT_TRACE_FIXTURE
    || trace.fixedStepHz !== CAR_CONTACT_TRACE_FIXED_STEP_HZ
    || !Array.isArray(trace.samples) || trace.samples.length !== CAR_CONTACT_TRACE_FRAME_COUNT) {
    throw new Error(`${label} car-contact trace contract is invalid`);
  }

  for (let index = 0; index < CAR_CONTACT_TRACE_FRAME_COUNT; index += 1) {
    const tick = index + 1;
    const sample = trace.samples[index];
    const expectedInputs = carContactTraceInputs(tick);
    if (sample?.tick !== tick || !Array.isArray(sample.cars) || sample.cars.length !== 2) {
      throw new Error(`${label} car-contact frame is invalid at tick ${tick}`);
    }
    for (let carIndex = 0; carIndex < 2; carIndex += 1) {
      const car = sample.cars[carIndex];
      if (car.id !== expectedInputs[carIndex].id || !sameInput(car.input, expectedInputs[carIndex])) {
        throw new Error(`${label} car-contact input contract differs at tick ${tick}`);
      }
      if (typeof car.grounded !== "boolean" || !car.state) {
        throw new Error(`${label} car-contact state is invalid at tick ${tick}`);
      }
      for (const key of ["position", "velocity", "forward"]) finiteVector(car.state[key], `${label} ${key} at tick ${tick}`);
      if (vectorLength(car.state.velocity) >= MAX_SPEED_BEFORE_SUPERSONIC) {
        throw new Error(`${label} car-contact speed reached the supersonic demo range at tick ${tick}`);
      }
    }
  }

  let event = null;
  for (let index = 1; index < trace.samples.length; index += 1) {
    const previous = trace.samples[index - 1];
    const current = trace.samples[index];
    const targetDeltaVx = current.cars[0].state.velocity.x - previous.cars[0].state.velocity.x;
    const chaserDropVx = previous.cars[1].state.velocity.x - current.cars[1].state.velocity.x;
    if (targetDeltaVx >= MIN_TARGET_DELTA_VX && chaserDropVx >= MIN_CHASER_DROP_VX) {
      event = { tick: current.tick, targetDeltaVx, chaserDropVx };
      break;
    }
  }
  if (!event) throw new Error(`${label} car-contact impulse transfer is missing`);
  if (Math.abs(event.tick - CAR_CONTACT_EXPECTED_FIRST_TRANSFER_TICK) > CAR_CONTACT_TRANSFER_TICK_TOLERANCE) {
    throw new Error(`${label} first impulse transfer differs at tick ${event.tick}`);
  }

  for (let index = 0; index < event.tick - 1; index += 1) {
    if (vectorLength(trace.samples[index].cars[0].state.velocity) > TARGET_MAX_QUIET_SPEED) {
      throw new Error(`${label} target was moving before the impulse transfer at tick ${index + 1}`);
    }
  }
  const eventSample = trace.samples[event.tick - 1];
  const previousSample = trace.samples[event.tick - 2];
  if (eventSample.cars[0].state.position.x <= previousSample.cars[0].state.position.x) {
    throw new Error(`${label} target did not continue forward after the impulse transfer`);
  }
  return event;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

export function compareCarContactTraces(wasmTrace, nativeTrace, {
  positionTolerance = 0.001,
  velocityTolerance = 0.005,
  forwardTolerance = 0.00005,
} = {}) {
  for (const [name, value] of Object.entries({ positionTolerance, velocityTolerance, forwardTolerance })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`car-contact ${name} is invalid`);
  }
  const wasmEvent = validateTrace(wasmTrace, "WASM");
  const nativeEvent = validateTrace(nativeTrace, "native");
  if (wasmEvent.tick !== nativeEvent.tick) throw new Error("WASM/native impulse-transfer tick differs");

  const maximum = {
    position: { delta: 0, carId: 0, tick: 0 },
    velocity: { delta: 0, carId: 0, tick: 0 },
    forward: { delta: 0, carId: 0, tick: 0 },
  };
  for (let index = 0; index < CAR_CONTACT_TRACE_FRAME_COUNT; index += 1) {
    const wasm = wasmTrace.samples[index];
    const native = nativeTrace.samples[index];
    if (wasm.tick !== native.tick) throw new Error(`car-contact tick differs at sample ${index + 1}`);
    for (let carIndex = 0; carIndex < 2; carIndex += 1) {
      const wasmCar = wasm.cars[carIndex];
      const nativeCar = native.cars[carIndex];
      if (wasmCar.id !== nativeCar.id || wasmCar.grounded !== nativeCar.grounded) {
        throw new Error(`car-contact grounded state differs for car ${wasmCar.id} at tick ${wasm.tick}`);
      }
      if (!sameInput(wasmCar.input, nativeCar.input)) throw new Error(`car-contact input differs for car ${wasmCar.id} at tick ${wasm.tick}`);
      for (const key of ["position", "velocity", "forward"]) {
        const delta = distance(wasmCar.state[key], nativeCar.state[key]);
        if (delta > maximum[key].delta) maximum[key] = { delta, carId: wasmCar.id, tick: wasm.tick };
      }
    }
  }

  const ok = maximum.position.delta <= positionTolerance
    && maximum.velocity.delta <= velocityTolerance
    && maximum.forward.delta <= forwardTolerance;
  return {
    ok,
    fixture: CAR_CONTACT_TRACE_FIXTURE,
    firstTransferTick: wasmEvent.tick,
    impulseTransferProxy: {
      targetDeltaVx: wasmEvent.targetDeltaVx,
      chaserDropVx: wasmEvent.chaserDropVx,
      telemetry: "state-derived proxy; not native carContact callback telemetry",
    },
    transferTickTolerance: CAR_CONTACT_TRANSFER_TICK_TOLERANCE,
    tolerances: { position: positionTolerance, velocity: velocityTolerance, forward: forwardTolerance },
    maximum,
  };
}
