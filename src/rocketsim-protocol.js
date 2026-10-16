export const ROCKETSIM_BRIDGE_SCHEMA = 1;
export const ROCKETSIM_FIXED_STEP_HZ = 120;
export const ROCKETSIM_MAX_CARS = 6;

const JUMP_STATES = new Set(["grounded", "first-jump", "double-jump", "dodge", "airborne"]);

function requiredNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is not finite`);
  return value;
}

function requiredInteger(value, label, minimum = Number.MIN_SAFE_INTEGER) {
  const number = requiredNumber(value, label);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${label} is invalid`);
  return number;
}

function vector(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} is missing`);
  return {
    x: requiredNumber(value.x, `${label}.x`),
    y: requiredNumber(value.y, `${label}.y`),
    z: requiredNumber(value.z, `${label}.z`),
  };
}

function quaternion(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} is missing`);
  const result = {
    x: requiredNumber(value.x, `${label}.x`),
    y: requiredNumber(value.y, `${label}.y`),
    z: requiredNumber(value.z, `${label}.z`),
    w: requiredNumber(value.w, `${label}.w`),
  };
  const magnitude = Math.hypot(result.x, result.y, result.z, result.w);
  if (magnitude < .000001) throw new Error(`${label} has zero magnitude`);
  return {
    x: result.x / magnitude,
    y: result.y / magnitude,
    z: result.z / magnitude,
    w: result.w / magnitude,
  };
}

function axes(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} is missing`);
  return {
    pitch: requiredNumber(value.pitch, `${label}.pitch`),
    yaw: requiredNumber(value.yaw, `${label}.yaw`),
    roll: requiredNumber(value.roll, `${label}.roll`),
  };
}

function direction(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} is missing`);
  return {
    forward: requiredNumber(value.forward, `${label}.forward`),
    side: requiredNumber(value.side, `${label}.side`),
  };
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function nonNegative(value, label) {
  const number = requiredNumber(value, label);
  if (number < 0) throw new Error(`${label} is invalid`);
  return number;
}

function worldContact(value, label) {
  if (!value) return { hasContact: false, normal: { x: 0, y: 0, z: 0 } };
  return {
    hasContact: boolean(value.hasContact, `${label}.hasContact`),
    normal: vector(value.normal, `${label}.normal`),
  };
}

function wheelContact(value, label) {
  if (!value) return { hasContact: false, normal: { x: 0, y: 0, z: 0 } };
  return {
    hasContact: boolean(value.hasContact, `${label}.hasContact`),
    normal: vector(value.normal, `${label}.normal`),
  };
}

function validateCarIds(cars, label, { teams = false } = {}) {
  if (!Array.isArray(cars) || cars.length < 1 || cars.length > ROCKETSIM_MAX_CARS) {
    throw new Error(`${label} is invalid`);
  }
  const ids = new Set();
  for (const [index, car] of cars.entries()) {
    const id = requiredInteger(car?.id, `${label}[${index}].id`, 1);
    if (id > ROCKETSIM_MAX_CARS || ids.has(id)) throw new Error(`${label} has invalid or duplicate car id ${id}`);
    ids.add(id);
    if (teams && car.team !== "blue" && car.team !== "red") throw new Error(`${label}[${index}].team is invalid`);
  }
  return cars;
}

export function encodeBridgeInit({ fixedStepHz = ROCKETSIM_FIXED_STEP_HZ, arena = "clean-six-planes", cars = [{ id: 1, team: "blue" }] } = {}) {
  validateCarIds(cars, "RocketSim init cars", { teams: true });
  return JSON.stringify({ type: "init", schemaVersion: ROCKETSIM_BRIDGE_SCHEMA, fixedStepHz, arena, cars });
}

export function encodeBridgeTick(tick, cars) {
  validateCarIds(cars, "RocketSim tick cars");
  return JSON.stringify({ type: "tick", tick, cars: cars.map(car => ({
    id: car.id,
    input: {
      throttle: Number.isFinite(Number(car.input?.throttle)) ? Number(car.input.throttle) : 0,
      steer: Number.isFinite(Number(car.input?.steer)) ? Number(car.input.steer) : 0,
      jump: Boolean(car.input?.jump),
      boost: Boolean(car.input?.boost),
      drift: Boolean(car.input?.drift),
      airRoll: Boolean(car.input?.airRoll),
      roll: Number.isFinite(Number(car.input?.roll)) ? Number(car.input.roll) : 0,
    },
  })) });
}

function rayVector(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} is missing`);
  return {
    x: requiredNumber(value.x, `${label}.x`),
    y: requiredNumber(value.y, `${label}.y`),
    z: requiredNumber(value.z, `${label}.z`),
  };
}

export function encodeBridgeRaycast(segments = []) {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 32) throw new Error("RocketSim raycast segments are invalid");
  return JSON.stringify({ type: "raycast", segments: segments.map((segment, index) => ({
    id: requiredInteger(segment?.id, `RocketSim raycast segments[${index}].id`, 1),
    from: rayVector(segment?.from, `RocketSim raycast segments[${index}].from`),
    to: rayVector(segment?.to, `RocketSim raycast segments[${index}].to`),
  })) });
}

export function normalizeBridgeRaycastFrame(message) {
  if (message?.type !== "raycast-state") throw new Error(`Expected raycast-state frame, received ${message?.type || "unknown"}`);
  if (requiredInteger(message.schemaVersion, "RocketSim raycast schemaVersion") !== ROCKETSIM_BRIDGE_SCHEMA) throw new Error("RocketSim raycast schemaVersion is unsupported");
  const tick = requiredInteger(message.tick, "RocketSim raycast tick", 0);
  if (!Array.isArray(message.hits) || message.hits.length > 32) throw new Error("RocketSim raycast hits are invalid");
  const ids = new Set();
  const hits = message.hits.map((hit, index) => {
    const label = `RocketSim raycast hits[${index}]`;
    const id = requiredInteger(hit?.id, `${label}.id`, 1);
    if (ids.has(id)) throw new Error(`RocketSim raycast has duplicate id ${id}`);
    ids.add(id);
    if (typeof hit.hit !== "boolean") throw new Error(`${label}.hit is invalid`);
    const fraction = requiredNumber(hit.fraction, `${label}.fraction`);
    if (fraction < 0 || fraction > 1) throw new Error(`${label}.fraction is invalid`);
    return { id, hit: hit.hit, fraction, point: rayVector(hit.point, `${label}.point`), normal: rayVector(hit.normal, `${label}.normal`), kind: String(hit.kind || "static") };
  });
  return { type: "raycast-state", schemaVersion: ROCKETSIM_BRIDGE_SCHEMA, tick, hits };
}

// A respawn is a server-authorized placement. Node may request it for one
// existing native car but never sends pose or velocity values across this
// boundary, so RocketSim remains the physics authority.
export function encodeBridgeRespawn(id) {
  const carId = requiredInteger(id, "RocketSim respawn id", 1);
  if (carId > ROCKETSIM_MAX_CARS) throw new Error("RocketSim respawn id is invalid");
  return JSON.stringify({ type: "respawn", id: carId });
}

export function encodeBridgeCombatActive(id, active) {
  const carId = requiredInteger(id, "RocketSim combat-state id", 1);
  if (carId > ROCKETSIM_MAX_CARS || typeof active !== "boolean") throw new Error("RocketSim combat-state is invalid");
  return JSON.stringify({ type: "combat-state", id: carId, active });
}

export function encodeBridgeShutdown() {
  return JSON.stringify({ type: "shutdown" });
}

export function parseBridgeLine(line) {
  const message = JSON.parse(line);
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    throw new Error("RocketSim bridge frame has no type");
  }
  return message;
}

export function normalizeBridgeStateFrame(message) {
  if (message?.type !== "state") throw new Error(`Expected state frame, received ${message?.type || "unknown"}`);
  if (requiredInteger(message.schemaVersion, "RocketSim schemaVersion") !== ROCKETSIM_BRIDGE_SCHEMA) {
    throw new Error("RocketSim state schemaVersion is unsupported");
  }
  if (requiredInteger(message.fixedStepHz, "RocketSim fixedStepHz") !== ROCKETSIM_FIXED_STEP_HZ) {
    throw new Error("RocketSim state fixedStepHz is unsupported");
  }
  const tick = requiredInteger(message.tick, "RocketSim state tick", 1);
  validateCarIds(message.cars, "RocketSim state cars");
  const ids = new Set();
  const cars = message.cars.map((car, index) => {
    const label = `RocketSim state cars[${index}]`;
    const id = requiredInteger(car?.id, `${label}.id`, 1);
    if (ids.has(id)) throw new Error(`RocketSim state has duplicate car id ${id}`);
    ids.add(id);
    const jumpState = String(car.jumpState || "");
    if (!JUMP_STATES.has(jumpState)) throw new Error(`${label}.jumpState is invalid`);
    return {
      id,
      position: vector(car.position, `${label}.position`),
      velocity: vector(car.velocity, `${label}.velocity`),
      orientation: quaternion(car.orientation, `${label}.orientation`),
      angularVelocity: vector(car.angularVelocity, `${label}.angularVelocity`),
      localAngularVelocity: axes(car.localAngularVelocity, `${label}.localAngularVelocity`),
      worldContact: worldContact(car.worldContact, `${label}.worldContact`),
      wheelContact: wheelContact(car.wheelContact, `${label}.wheelContact`),
      grounded: boolean(car.grounded, `${label}.grounded`),
      wheelCount: requiredInteger(car.wheelCount, `${label}.wheelCount`, 0),
      jumps: requiredInteger(car.jumps, `${label}.jumps`, 0),
      jumpState,
      secondJumpWindow: nonNegative(car.secondJumpWindow, `${label}.secondJumpWindow`),
      dodgeTime: nonNegative(car.dodgeTime, `${label}.dodgeTime`),
      dodgeDirection: direction(car.dodgeDirection, `${label}.dodgeDirection`),
      actionFlags: {
        hasJumped: boolean(car.actionFlags?.hasJumped, `${label}.actionFlags.hasJumped`),
        hasDoubleJumped: boolean(car.actionFlags?.hasDoubleJumped, `${label}.actionFlags.hasDoubleJumped`),
        hasFlipped: boolean(car.actionFlags?.hasFlipped, `${label}.actionFlags.hasFlipped`),
      },
      boost: nonNegative(car.boost, `${label}.boost`),
    };
  });
  return { type: "state", schemaVersion: ROCKETSIM_BRIDGE_SCHEMA, tick, fixedStepHz: ROCKETSIM_FIXED_STEP_HZ, cars };
}

export function summarizeBridgeFrame(frame) {
  const normalized = normalizeBridgeStateFrame(frame);
  return JSON.stringify({
    schemaVersion: normalized.schemaVersion,
    fixedStepHz: normalized.fixedStepHz,
    tick: normalized.tick,
    cars: normalized.cars.map(car => ({
      id: car.id,
      position: car.position,
      velocity: car.velocity,
      orientation: car.orientation,
      localAngularVelocity: car.localAngularVelocity,
      grounded: car.grounded,
      wheelCount: car.wheelCount,
      jumps: car.jumps,
      jumpState: car.jumpState,
      dodgeTime: car.dodgeTime,
    })),
  });
}
