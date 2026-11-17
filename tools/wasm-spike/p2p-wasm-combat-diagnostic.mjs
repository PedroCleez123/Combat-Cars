// Diagnostic-only P2P-WASM combat envelope and deterministic fixture.
//
// This module deliberately does not claim that the current RocketSim WASM
// wrapper creates rockets.  It overlays a small, deterministic combat state
// machine on top of the two-car physical snapshots produced by the P2P-WASM
// host adapter (or an equivalent fixture).  It is kept outside src/, the
// public WebRTC protocol, and server.mjs until the contract is accepted.

export const P2P_WASM_COMBAT_PROTOCOL_VERSION = 1;
export const P2P_WASM_COMBAT_SNAPSHOT_PROTOCOL_VERSION = P2P_WASM_COMBAT_PROTOCOL_VERSION;
export const P2P_WASM_COMBAT_TYPE = "wasm-combat-snapshot";
export const P2P_WASM_COMBAT_SNAPSHOT_TYPE = P2P_WASM_COMBAT_TYPE;
export const P2P_WASM_COMBAT_MAX_BYTES = 2048;
export const P2P_WASM_COMBAT_SNAPSHOT_MAX_BYTES = P2P_WASM_COMBAT_MAX_BYTES;
export const P2P_WASM_COMBAT_MAX_TICK = 10_000_000;
export const P2P_WASM_COMBAT_MAX_INPUT_SEQUENCE = 10_000_000;
export const P2P_WASM_COMBAT_MAX_CONTEXT_ID_LENGTH = 64;
export const P2P_WASM_COMBAT_MAX_SCORE = 1_000_000;
export const P2P_WASM_COMBAT_MAX_HP = 100;
export const P2P_WASM_COMBAT_MAX_RESPAWN = 600;
export const P2P_WASM_COMBAT_MAX_KILLS = 1_000_000;
export const P2P_WASM_COMBAT_MAX_DEATHS = 1_000_000;
export const P2P_WASM_COMBAT_MAX_ROCKET_COOLDOWN = 600;
export const P2P_WASM_COMBAT_MAX_ROCKETS = 16;
export const P2P_WASM_COMBAT_MAX_ROCKET_LIFE = 600;
export const P2P_WASM_COMBAT_MAX_VELOCITY_COMPONENT = 2_500;
export const P2P_WASM_COMBAT_MAX_EVENTS = 8;

export const P2P_WASM_COMBAT_CAR_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);
export const P2P_WASM_COMBAT_TEAMS = Object.freeze(["blue", "red"]);
export const P2P_WASM_COMBAT_MAX_CAR_HP = P2P_WASM_COMBAT_MAX_HP;
export const P2P_WASM_COMBAT_DEFAULT_CONTEXT = Object.freeze({
  roomId: "p2p-wasm-combat-room",
  sessionId: "p2p-wasm-combat-session",
});

const TOP_LEVEL_KEYS = [
  "protocolVersion", "type", "context", "tick", "lastInputSequence",
  "score", "cars", "rockets", "events", "physics",
];
const CONTEXT_KEYS = ["roomId", "sessionId"];
const SCORE_KEYS = ["blue", "red"];
const CAR_KEYS = ["id", "team", "hp", "respawn", "kills", "deaths", "rocketCooldown", "alive"];
const ROCKET_KEYS = ["id", "owner", "team", "x", "z", "h", "vx", "vz", "vh", "life", "targetId"];
const PHYSICS_KEYS = ["id", "team", "x", "z", "h", "yaw", "vx", "vz", "vh"];
const EVENT_COMMON_KEYS = ["id", "tick", "kind"];
const EVENT_KEYS_BY_KIND = Object.freeze({
  fire: [...EVENT_COMMON_KEYS, "rocketId", "owner", "team"],
  hit: [...EVENT_COMMON_KEYS, "rocketId", "targetId", "damage"],
  elimination: [...EVENT_COMMON_KEYS, "targetId", "killerId"],
  respawn: [...EVENT_COMMON_KEYS, "targetId"],
});
const TEAMS_BY_ID = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
const SAFE_CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_ROCKET_ID = /^rocket-[1-9][0-9]{0,5}$/;
const SAFE_EVENT_ID = /^event-[1-9][0-9]{0,5}$/;
const utf8Encoder = new TextEncoder();

function exactPlainRecord(value, expectedKeys) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length
      || ownKeys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    // A revoked proxy, hostile prototype, or accessor must fail closed.
    return null;
  }
}

function plainRecordValues(value) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== "string")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of ownKeys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function exactArray(value, { min = 0, max = Infinity } = {}) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (!ownKeys.includes("length") || ownKeys.length !== value.length + 1) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (descriptors.length?.enumerable || descriptors.length?.value !== value.length) return null;
    if (value.length < min || value.length > max) return null;
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function finite(number, minimum, maximum) {
  return typeof number === "number" && Number.isFinite(number) && number >= minimum && number <= maximum;
}

function boundedInteger(number, minimum, maximum) {
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum;
}

function validContext(value) {
  const context = exactPlainRecord(value, CONTEXT_KEYS);
  return Boolean(context) && CONTEXT_KEYS.every(key => typeof context[key] === "string"
    && context[key].length >= 1
    && context[key].length <= P2P_WASM_COMBAT_MAX_CONTEXT_ID_LENGTH
    && SAFE_CONTEXT_ID.test(context[key]));
}

function validScore(value) {
  const score = exactPlainRecord(value, SCORE_KEYS);
  return Boolean(score) && SCORE_KEYS.every(key => boundedInteger(score[key], 0, P2P_WASM_COMBAT_MAX_SCORE));
}

function validCombatCar(value, expectedId) {
  const car = exactPlainRecord(value, CAR_KEYS);
  if (!car || car.id !== expectedId || car.team !== TEAMS_BY_ID[expectedId]) return false;
  return boundedInteger(car.hp, 0, P2P_WASM_COMBAT_MAX_HP)
    && boundedInteger(car.respawn, 0, P2P_WASM_COMBAT_MAX_RESPAWN)
    && boundedInteger(car.kills, 0, P2P_WASM_COMBAT_MAX_KILLS)
    && boundedInteger(car.deaths, 0, P2P_WASM_COMBAT_MAX_DEATHS)
    && boundedInteger(car.rocketCooldown, 0, P2P_WASM_COMBAT_MAX_ROCKET_COOLDOWN)
    && typeof car.alive === "boolean"
    && (car.alive ? car.hp > 0 && car.respawn === 0 : car.hp === 0 && car.respawn > 0);
}

function validPhysicalCar(value, expectedId) {
  const car = exactPlainRecord(value, PHYSICS_KEYS);
  if (!car || car.id !== expectedId || car.team !== TEAMS_BY_ID[expectedId]) return false;
  return finite(car.x, -10_000, 10_000)
    && finite(car.z, -10_000, 10_000)
    && finite(car.h, -100, 1_000)
    && finite(car.yaw, -Math.PI, Math.PI)
    && [car.vx, car.vz, car.vh].every(valuePart => finite(
      valuePart,
      -P2P_WASM_COMBAT_MAX_VELOCITY_COMPONENT,
      P2P_WASM_COMBAT_MAX_VELOCITY_COMPONENT,
    ));
}

function validRocket(value, knownIds = P2P_WASM_COMBAT_CAR_IDS) {
  const rocket = exactPlainRecord(value, ROCKET_KEYS);
  if (!rocket || typeof rocket.id !== "string" || !SAFE_ROCKET_ID.test(rocket.id)) return false;
  if (!knownIds.includes(rocket.owner) || rocket.team !== TEAMS_BY_ID[rocket.owner]) return false;
  if (!finite(rocket.x, -10_000, 10_000)
    || !finite(rocket.z, -10_000, 10_000)
    || !finite(rocket.h, -100, 1_000)
    || ![rocket.vx, rocket.vz, rocket.vh].every(valuePart => finite(
      valuePart,
      -P2P_WASM_COMBAT_MAX_VELOCITY_COMPONENT,
      P2P_WASM_COMBAT_MAX_VELOCITY_COMPONENT,
    ))
    || !boundedInteger(rocket.life, 0, P2P_WASM_COMBAT_MAX_ROCKET_LIFE)) return false;
  return rocket.targetId === null || knownIds.includes(rocket.targetId);
}

function validEvent(value, index, maxTick, knownRocketIds) {
  const loose = plainRecordValues(value);
  const common = loose && EVENT_COMMON_KEYS.every(key => Object.hasOwn(loose, key)) ? loose : null;
  if (!common || typeof common.id !== "string" || !SAFE_EVENT_ID.test(common.id)
    || !boundedInteger(common.tick, 1, maxTick) || typeof common.kind !== "string"
    || !Object.hasOwn(EVENT_KEYS_BY_KIND, common.kind)) return false;
  const event = exactPlainRecord(value, EVENT_KEYS_BY_KIND[common.kind]);
  if (!event || event.id !== common.id || event.tick !== common.tick || event.kind !== common.kind) return false;
  switch (event.kind) {
    case "fire":
      return typeof event.rocketId === "string" && SAFE_ROCKET_ID.test(event.rocketId)
        && P2P_WASM_COMBAT_CAR_IDS.includes(event.owner)
        && event.team === TEAMS_BY_ID[event.owner];
    case "hit":
      return typeof event.rocketId === "string" && SAFE_ROCKET_ID.test(event.rocketId)
        && P2P_WASM_COMBAT_CAR_IDS.includes(event.targetId)
        && boundedInteger(event.damage, 1, P2P_WASM_COMBAT_MAX_HP);
    case "elimination":
      return P2P_WASM_COMBAT_CAR_IDS.includes(event.targetId) && P2P_WASM_COMBAT_CAR_IDS.includes(event.killerId)
        && event.targetId !== event.killerId;
    case "respawn":
      return P2P_WASM_COMBAT_CAR_IDS.includes(event.targetId);
    default:
      return false;
  }
}

function validEvents(value, maxTick, rockets) {
  const events = exactArray(value, { max: P2P_WASM_COMBAT_MAX_EVENTS });
  if (!events) return false;
  const knownRocketIds = new Set(rockets.map(rocket => rocket.id));
  let previousTick = 0;
  let previousIdNumber = null;
  const seen = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!validEvent(event, index, maxTick, knownRocketIds)) return false;
    const parsed = Number(event.id.slice("event-".length));
    if (seen.has(event.id) || !Number.isSafeInteger(parsed) || parsed < 1
      || (previousIdNumber !== null && parsed !== previousIdNumber + 1)
      || event.tick < previousTick) return false;
    seen.add(event.id);
    previousIdNumber = parsed;
    previousTick = event.tick;
    if ((event.kind === "fire" || event.kind === "hit") && !knownRocketIds.has(event.rocketId)) return false;
  }
  return true;
}

function validateParts(value) {
  const message = exactPlainRecord(value, TOP_LEVEL_KEYS);
  if (!message
    || message.protocolVersion !== P2P_WASM_COMBAT_PROTOCOL_VERSION
    || message.type !== P2P_WASM_COMBAT_TYPE
    || !validContext(message.context)
    || !boundedInteger(message.tick, 1, P2P_WASM_COMBAT_MAX_TICK)
    || !boundedInteger(message.lastInputSequence, 1, P2P_WASM_COMBAT_MAX_INPUT_SEQUENCE)
    || !validScore(message.score)) return null;

  const cars = exactArray(message.cars, { min: 2, max: 2 });
  if (!cars || !validCombatCar(cars[0], P2P_WASM_COMBAT_CAR_IDS[0])
    || !validCombatCar(cars[1], P2P_WASM_COMBAT_CAR_IDS[1])) return null;
  const rockets = exactArray(message.rockets, { max: P2P_WASM_COMBAT_MAX_ROCKETS });
  if (!rockets || !rockets.every(rocket => validRocket(rocket))) return null;
  const rocketIds = new Set();
  for (const rocket of rockets) {
    if (rocketIds.has(rocket.id)) return null;
    rocketIds.add(rocket.id);
  }
  if (!validEvents(message.events, message.tick, rockets)) return null;
  const physics = exactArray(message.physics, { min: 2, max: 2 });
  if (!physics || !validPhysicalCar(physics[0], P2P_WASM_COMBAT_CAR_IDS[0])
    || !validPhysicalCar(physics[1], P2P_WASM_COMBAT_CAR_IDS[1])) return null;
  return { message, context: exactPlainRecord(message.context, CONTEXT_KEYS), score: exactPlainRecord(message.score, SCORE_KEYS), cars, rockets, events: exactArray(message.events), physics };
}

function quote(value) {
  return JSON.stringify(value);
}

function serializeContext(value) {
  return `{"roomId":${quote(value.roomId)},"sessionId":${quote(value.sessionId)}}`;
}

function serializeScore(value) {
  return `{"blue":${quote(value.blue)},"red":${quote(value.red)}}`;
}

function serializeCombatCar(value) {
  return `{"id":${quote(value.id)},"team":${quote(value.team)},"hp":${quote(value.hp)},"respawn":${quote(value.respawn)},"kills":${quote(value.kills)},"deaths":${quote(value.deaths)},"rocketCooldown":${quote(value.rocketCooldown)},"alive":${quote(value.alive)}}`;
}

function serializeRocket(value) {
  return `{"id":${quote(value.id)},"owner":${quote(value.owner)},"team":${quote(value.team)},"x":${quote(value.x)},"z":${quote(value.z)},"h":${quote(value.h)},"vx":${quote(value.vx)},"vz":${quote(value.vz)},"vh":${quote(value.vh)},"life":${quote(value.life)},"targetId":${quote(value.targetId)}}`;
}

function serializeEvent(value) {
  switch (value.kind) {
    case "fire":
      return `{"id":${quote(value.id)},"tick":${quote(value.tick)},"kind":"fire","rocketId":${quote(value.rocketId)},"owner":${quote(value.owner)},"team":${quote(value.team)}}`;
    case "hit":
      return `{"id":${quote(value.id)},"tick":${quote(value.tick)},"kind":"hit","rocketId":${quote(value.rocketId)},"targetId":${quote(value.targetId)},"damage":${quote(value.damage)}}`;
    case "elimination":
      return `{"id":${quote(value.id)},"tick":${quote(value.tick)},"kind":"elimination","targetId":${quote(value.targetId)},"killerId":${quote(value.killerId)}}`;
    case "respawn":
      return `{"id":${quote(value.id)},"tick":${quote(value.tick)},"kind":"respawn","targetId":${quote(value.targetId)}}`;
    default:
      throw new TypeError("Unknown P2P WASM combat event kind.");
  }
}

function serializePhysics(value) {
  return `{"id":${quote(value.id)},"team":${quote(value.team)},"x":${quote(value.x)},"z":${quote(value.z)},"h":${quote(value.h)},"yaw":${quote(value.yaw)},"vx":${quote(value.vx)},"vz":${quote(value.vz)},"vh":${quote(value.vh)}}`;
}

function serializeMessage(parts) {
  const { message, context, score, cars, rockets, events, physics } = parts;
  return `{"protocolVersion":${P2P_WASM_COMBAT_PROTOCOL_VERSION},"type":${quote(P2P_WASM_COMBAT_TYPE)},"context":${serializeContext(context)},"tick":${quote(message.tick)},"lastInputSequence":${quote(message.lastInputSequence)},"score":${serializeScore(score)},"cars":[${cars.map(serializeCombatCar).join(",")}],"rockets":[${rockets.map(serializeRocket).join(",")}],"events":[${events.map(serializeEvent).join(",")}],"physics":[${physics.map(serializePhysics).join(",")}]}`;
}

/** Validate an already-parsed diagnostic combat snapshot. */
export function validateP2PWasmCombatSnapshotEnvelope(value) {
  const parts = validateParts(value);
  if (!parts) return false;
  return utf8Encoder.encode(serializeMessage(parts)).byteLength <= P2P_WASM_COMBAT_MAX_BYTES;
}

/** Alias matching the shorter name used by the earlier snapshot gate. */
export const validateP2PWasmCombatEnvelope = validateP2PWasmCombatSnapshotEnvelope;

/** Build deterministic JSON text for a versioned diagnostic combat snapshot. */
export function createP2PWasmCombatSnapshotEnvelope(snapshot, context) {
  const payloadKeys = TOP_LEVEL_KEYS.filter(key => key !== "protocolVersion" && key !== "type" && key !== "context");
  const full = exactPlainRecord(snapshot, TOP_LEVEL_KEYS);
  const source = full
    ? Object.assign(Object.create(null), Object.fromEntries(payloadKeys.map(key => [key, full[key]])), { context: full.context })
    : exactPlainRecord(snapshot, payloadKeys);
  const envelopeContext = context ?? (full ? source.context : P2P_WASM_COMBAT_DEFAULT_CONTEXT);
  if (!source || !validContext(envelopeContext)) throw new TypeError("P2P WASM combat snapshot must have the exact diagnostic fields.");
  const envelope = {
    protocolVersion: P2P_WASM_COMBAT_PROTOCOL_VERSION,
    type: P2P_WASM_COMBAT_TYPE,
    context: envelopeContext,
    ...Object.fromEntries(payloadKeys.map(key => [key, source[key]])),
  };
  const parts = validateParts(envelope);
  if (!parts) throw new TypeError("P2P WASM combat diagnostic snapshot is outside its versioned envelope contract.");
  const text = serializeMessage(parts);
  if (utf8Encoder.encode(text).byteLength > P2P_WASM_COMBAT_MAX_BYTES) {
    throw new RangeError(`P2P WASM combat snapshot exceeds ${P2P_WASM_COMBAT_MAX_BYTES} UTF-8 bytes.`);
  }
  return text;
}

export const createP2PWasmCombatEnvelope = createP2PWasmCombatSnapshotEnvelope;

/** Parse and validate an incoming UTF-8 diagnostic combat envelope. */
export function decodeP2PWasmCombatSnapshotEnvelope(text) {
  if (typeof text !== "string") throw new TypeError("P2P WASM combat envelope must be JSON text.");
  if (utf8Encoder.encode(text).byteLength > P2P_WASM_COMBAT_MAX_BYTES) {
    throw new RangeError(`P2P WASM combat snapshot exceeds ${P2P_WASM_COMBAT_MAX_BYTES} UTF-8 bytes.`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SyntaxError("P2P WASM combat envelope is malformed JSON.");
  }
  if (!validateP2PWasmCombatSnapshotEnvelope(value)) {
    throw new TypeError("P2P WASM combat envelope is outside its versioned contract.");
  }
  return value;
}

export const decodeP2PWasmCombatEnvelope = decodeP2PWasmCombatSnapshotEnvelope;

function clonePhysicalCar(value, expectedId) {
  if (!validPhysicalCar(value, expectedId)) throw new TypeError(`Physical P2P WASM car ${expectedId} is invalid.`);
  return Object.fromEntries(PHYSICS_KEYS.map(key => [key, value[key]]));
}

function normalizePhysicalSnapshot(value, index) {
  if (value === null || typeof value !== "object") throw new TypeError("Physical P2P WASM snapshot must be an object.");
  const snapshot = exactPlainRecord(value, ["tick", "lastInputSequence", "cars"]);
  if (!snapshot || !boundedInteger(snapshot.tick, 1, P2P_WASM_COMBAT_MAX_TICK)
    || !boundedInteger(snapshot.lastInputSequence, 1, P2P_WASM_COMBAT_MAX_INPUT_SEQUENCE)) {
    throw new TypeError("Physical P2P WASM snapshot has an invalid tick or input sequence.");
  }
  const cars = exactArray(snapshot.cars, { min: 2, max: 2 });
  if (!cars || !validPhysicalCar(cars[0], P2P_WASM_COMBAT_CAR_IDS[0])
    || !validPhysicalCar(cars[1], P2P_WASM_COMBAT_CAR_IDS[1])) {
    throw new TypeError("Physical P2P WASM snapshot must contain host blue and pilot red cars.");
  }
  return {
    tick: snapshot.tick,
    lastInputSequence: snapshot.lastInputSequence,
    cars: [clonePhysicalCar(cars[0], P2P_WASM_COMBAT_CAR_IDS[0]), clonePhysicalCar(cars[1], P2P_WASM_COMBAT_CAR_IDS[1])],
    index,
  };
}

export const P2P_WASM_COMBAT_DEFAULT_PHYSICAL_FIXTURE = Object.freeze([
  Object.freeze({
    tick: 1,
    lastInputSequence: 1,
    cars: Object.freeze([
      Object.freeze({ id: "p2p-host", team: "blue", x: 0, z: 0, h: 17, yaw: 0, vx: 0, vz: 0, vh: 0 }),
      Object.freeze({ id: "p2p-pilot", team: "red", x: 600, z: 0, h: 17, yaw: Math.PI, vx: 0, vz: 0, vh: 0 }),
    ]),
  }),
  Object.freeze({
    tick: 2,
    lastInputSequence: 2,
    cars: Object.freeze([
      Object.freeze({ id: "p2p-host", team: "blue", x: 12, z: 0, h: 17, yaw: 0, vx: 180, vz: 0, vh: 0 }),
      Object.freeze({ id: "p2p-pilot", team: "red", x: 588, z: 0, h: 17, yaw: Math.PI, vx: -180, vz: 0, vh: 0 }),
    ]),
  }),
  Object.freeze({
    tick: 3,
    lastInputSequence: 3,
    cars: Object.freeze([
      Object.freeze({ id: "p2p-host", team: "blue", x: 24, z: 0, h: 17, yaw: 0, vx: 180, vz: 0, vh: 0 }),
      Object.freeze({ id: "p2p-pilot", team: "red", x: 576, z: 0, h: 17, yaw: Math.PI, vx: -180, vz: 0, vh: 0 }),
    ]),
  }),
  Object.freeze({
    tick: 4,
    lastInputSequence: 4,
    cars: Object.freeze([
      Object.freeze({ id: "p2p-host", team: "blue", x: 36, z: 0, h: 17, yaw: 0, vx: 180, vz: 0, vh: 0 }),
      Object.freeze({ id: "p2p-pilot", team: "red", x: 564, z: 0, h: 17, yaw: Math.PI, vx: -180, vz: 0, vh: 0 }),
    ]),
  }),
]);

function physicalSource(options) {
  const source = options?.physicalSnapshots ?? P2P_WASM_COMBAT_DEFAULT_PHYSICAL_FIXTURE;
  const snapshots = exactArray(source, { min: 4, max: 4 });
  if (!snapshots) throw new TypeError("P2P WASM combat fixture requires exactly four physical snapshots.");
  const normalized = snapshots.map(normalizePhysicalSnapshot);
  let previousTick = 0;
  let previousSequence = 0;
  for (const snapshot of normalized) {
    if (snapshot.tick <= previousTick || snapshot.lastInputSequence <= previousSequence) {
      throw new RangeError("P2P WASM combat physical ticks and input sequences must increase strictly.");
    }
    previousTick = snapshot.tick;
    previousSequence = snapshot.lastInputSequence;
  }
  return normalized;
}

function makeCombatState(step) {
  const host = { id: "p2p-host", team: "blue", hp: 100, respawn: 0, kills: step >= 3 ? 1 : 0, deaths: 0, rocketCooldown: step === 1 ? 30 : 0, alive: true };
  const pilot = {
    id: "p2p-pilot", team: "red", hp: step === 2 ? 40 : step === 3 ? 0 : 100,
    respawn: step === 3 ? 180 : 0, kills: 0, deaths: step >= 3 ? 1 : 0,
    rocketCooldown: 0, alive: step !== 3,
  };
  return {
    score: { blue: step >= 3 ? 1 : 0, red: 0 },
    cars: [host, pilot],
    rockets: step === 1
      ? [{ id: "rocket-1", owner: "p2p-host", team: "blue", x: 32, z: 0, h: 20, vx: 900, vz: 0, vh: 0, life: 120, targetId: "p2p-pilot" }]
      : step === 2
        ? [{ id: "rocket-1", owner: "p2p-host", team: "blue", x: 400, z: 0, h: 20, vx: 900, vz: 0, vh: 0, life: 118, targetId: "p2p-pilot" }]
        : [],
  };
}

function eventFor(step, tick) {
  switch (step) {
    case 1: return { id: "event-1", tick, kind: "fire", rocketId: "rocket-1", owner: "p2p-host", team: "blue" };
    case 2: return { id: "event-2", tick, kind: "hit", rocketId: "rocket-1", targetId: "p2p-pilot", damage: 60 };
    case 3: return { id: "event-3", tick, kind: "elimination", targetId: "p2p-pilot", killerId: "p2p-host" };
    case 4: return { id: "event-4", tick, kind: "respawn", targetId: "p2p-pilot" };
    default: throw new RangeError("P2P WASM combat fixture step is out of range.");
  }
}

/**
 * Return the four deterministic combat snapshots. `physicalSnapshots` may be
 * the sequence returned by createP2PWasmHostMatch().snapshot()/receiveInput,
 * preserving the measured two-car physics beside the overlay state.
 */
export function createP2PWasmCombatDiagnosticFixture(options = {}) {
  const physical = physicalSource(options);
  const context = options.context ?? P2P_WASM_COMBAT_DEFAULT_CONTEXT;
  if (!validContext(context)) throw new TypeError("P2P WASM combat fixture context is invalid.");
  const snapshots = physical.map((source, index) => {
    const state = makeCombatState(index + 1);
    return {
      protocolVersion: P2P_WASM_COMBAT_PROTOCOL_VERSION,
      type: P2P_WASM_COMBAT_TYPE,
      context: { roomId: context.roomId, sessionId: context.sessionId },
      tick: source.tick,
      lastInputSequence: source.lastInputSequence,
      ...state,
      events: [eventFor(index + 1, source.tick)],
      physics: source.cars,
    };
  });
  const errors = [];
  for (const snapshot of snapshots) {
    if (!validateP2PWasmCombatSnapshotEnvelope(snapshot)) errors.push(snapshot.tick);
  }
  if (errors.length) throw new TypeError(`P2P WASM combat fixture produced invalid snapshots: ${errors.join(",")}`);
  return snapshots;
}

export const createP2PWasmCombatFixture = createP2PWasmCombatDiagnosticFixture;
export const runP2PWasmCombatDiagnostic = createP2PWasmCombatDiagnosticFixture;

/** Validate a complete fixture sequence, including monotonic wire lifecycle. */
export function validateP2PWasmCombatSequence(sequence) {
  const snapshots = exactArray(sequence, { min: 4, max: 4 });
  if (!snapshots) return false;
  let previousTick = 0;
  let previousSequence = 0;
  let previousEventId = 0;
  const expectedKinds = ["fire", "hit", "elimination", "respawn"];
  for (let index = 0; index < snapshots.length; index += 1) {
    if (!validateP2PWasmCombatSnapshotEnvelope(snapshots[index])) return false;
    const snapshot = snapshots[index];
    if (snapshot.tick <= previousTick || snapshot.lastInputSequence <= previousSequence) return false;
    if (snapshot.events.length !== 1 || snapshot.events[0].kind !== expectedKinds[index]) return false;
    const eventNumber = Number(snapshot.events[0].id.slice("event-".length));
    if (eventNumber !== previousEventId + 1) return false;
    previousTick = snapshot.tick;
    previousSequence = snapshot.lastInputSequence;
    previousEventId = eventNumber;
  }
  const elimination = snapshots[2];
  const pilotElimination = elimination.cars[1];
  if (pilotElimination.hp !== 0 || pilotElimination.respawn <= 0 || pilotElimination.alive !== false
    || elimination.score.blue !== 1 || elimination.cars[0].kills !== 1 || pilotElimination.deaths !== 1) return false;
  const respawn = snapshots[3].cars[1];
  return respawn.hp === P2P_WASM_COMBAT_MAX_HP && respawn.respawn === 0 && respawn.alive === true;
}

/** Build all four wire envelopes for deterministic replay/inspection. */
export function createP2PWasmCombatDiagnosticEnvelopes(options = {}) {
  const snapshots = createP2PWasmCombatDiagnosticFixture(options);
  return snapshots.map(snapshot => createP2PWasmCombatSnapshotEnvelope(snapshot, snapshot.context));
}

// A tiny CLI is useful in the isolated spike directory: each line is one
// versioned envelope. It has no network or game-server side effects.
if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  for (const text of createP2PWasmCombatDiagnosticEnvelopes()) process.stdout.write(`${text}\n`);
}

