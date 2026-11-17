// P2P-WASM-21: browser-safe wire contract for snapshots produced by the
// causal WASM combat host. It is deliberately separate from P2P v1: v1 only
// carries compact physical cars and must not silently drop combat authority.

export const P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION = 3;
export const P2P_WASM_CAUSAL_COMBAT_TYPE = "wasm-causal-combat-snapshot";
export const P2P_WASM_CAUSAL_COMBAT_MAX_BYTES = 2048;
export const P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE = 10_000_000;
export const P2P_WASM_CAUSAL_COMBAT_MAX_VELOCITY_COMPONENT = 2500;
export const P2P_WASM_CAUSAL_COMBAT_CAR_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TEAMS_BY_ID = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
// The full RocketSim combat host also reports boost-pad pickups.  They are
// presentation events from the authoritative snapshot, so they must cross
// the causal wire unchanged instead of being treated as a protocol error.
const EVENT_KINDS = new Set(["fire", "hit", "miss", "elimination", "respawn", "winner", "round", "pad", "recovery"]);
const MAX_ROCKETS = 16;
const MAX_EVENTS = 8;
const MAX_EVENT_TEXT_LENGTH = 160;
const encoder = new TextEncoder();
const TOP_LEVEL_KEYS = ["protocolVersion", "type", "roomId", "sessionId", "sequence", "snapshot"];
const SNAPSHOT_KEYS = ["tick", "lastInputSequence", "physical", "score", "round", "cars", "rockets", "events"];
const SCORE_KEYS = ["blue", "red"];
const ROUND_KEYS = ["state", "scoreToWin", "winner", "serial"];
const PHYSICAL_KEYS = ["id", "team", "x", "z", "h", "yaw", "vx", "vz", "vh"];
const CAR_KEYS = ["id", "team", "hp", "respawn", "kills", "deaths", "rocketCooldown", "alive"];
const ROCKET_KEYS = ["id", "owner", "team", "x", "z", "h", "vx", "vz", "vh", "life", "targetId"];
const EVENT_KEYS = ["kind", "text", "at"];

function exactRecord(value, keys) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function exactArray(value, { min = 0, max = Infinity } = {}) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (descriptors.length?.enumerable || descriptors.length?.value !== value.length) return null;
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      entries.push(descriptor.value);
    }
    return entries;
  } catch {
    return null;
  }
}

function finite(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function safeContextId(value) {
  return typeof value === "string" && SAFE_ID.test(value);
}

function validPhysical(value, expectedId) {
  const car = exactRecord(value, PHYSICAL_KEYS);
  if (!car || car.id !== expectedId || car.team !== TEAMS_BY_ID[expectedId]) return null;
  if (![car.x, car.z].every(part => finite(part, -10_000, 10_000))
    || !finite(car.h, -10_000, 1_000) || !finite(car.yaw, -Math.PI, Math.PI)
    || ![car.vx, car.vz, car.vh].every(part => finite(part, -P2P_WASM_CAUSAL_COMBAT_MAX_VELOCITY_COMPONENT, P2P_WASM_CAUSAL_COMBAT_MAX_VELOCITY_COMPONENT))) return null;
  return Object.fromEntries(PHYSICAL_KEYS.map(key => [key, car[key]]));
}

function validCombatCar(value, expectedId) {
  const car = exactRecord(value, CAR_KEYS);
  if (!car || car.id !== expectedId || car.team !== TEAMS_BY_ID[expectedId]) return null;
  if (!integer(car.hp, 0, 100) || !finite(car.respawn, 0, 600)
    || !integer(car.kills, 0, 1_000_000) || !integer(car.deaths, 0, 1_000_000)
    || !finite(car.rocketCooldown, 0, 600) || typeof car.alive !== "boolean"
    || (car.alive ? car.hp <= 0 || car.respawn !== 0 : car.hp !== 0 || car.respawn <= 0)) return null;
  return Object.fromEntries(CAR_KEYS.map(key => [key, car[key]]));
}

function validRocket(value) {
  const rocket = exactRecord(value, ROCKET_KEYS);
  if (!rocket || !integer(rocket.id, 1, 1_000_000) || !P2P_WASM_CAUSAL_COMBAT_CAR_IDS.includes(rocket.owner)
    || rocket.team !== TEAMS_BY_ID[rocket.owner]
    || !(rocket.targetId === null || P2P_WASM_CAUSAL_COMBAT_CAR_IDS.includes(rocket.targetId))) return null;
  if (![rocket.x, rocket.z].every(part => finite(part, -10_000, 10_000))
    || !finite(rocket.h, -100, 1_000) || ![rocket.vx, rocket.vz, rocket.vh].every(part => finite(part, -P2P_WASM_CAUSAL_COMBAT_MAX_VELOCITY_COMPONENT, P2P_WASM_CAUSAL_COMBAT_MAX_VELOCITY_COMPONENT))
    || !finite(rocket.life, 0, 600)) return null;
  return Object.fromEntries(ROCKET_KEYS.map(key => [key, rocket[key]]));
}

function validEvent(value) {
  const event = exactRecord(value, EVENT_KEYS);
  if (!event || !EVENT_KINDS.has(event.kind) || typeof event.text !== "string"
    || event.text.length > MAX_EVENT_TEXT_LENGTH || /[\u0000-\u001F\u007F]/u.test(event.text)
    || !finite(event.at, 0, 600)) return null;
  return Object.fromEntries(EVENT_KEYS.map(key => [key, event[key]]));
}

function validRound(value, score) {
  const round = exactRecord(value, ROUND_KEYS);
  if (!round || (round.state !== "active" && round.state !== "complete")
    || !integer(round.scoreToWin, 1, 100)
    || !integer(round.serial, 1, 1_000_000)
    || !(round.winner === null || round.winner === "blue" || round.winner === "red")) return null;
  if (round.state === "active" && round.winner !== null) return null;
  if (round.state === "complete" && (!round.winner || score[round.winner] < round.scoreToWin)) return null;
  return { state: round.state, scoreToWin: round.scoreToWin, winner: round.winner, serial: round.serial };
}

function normalizeSnapshot(value) {
  const snapshot = exactRecord(value, SNAPSHOT_KEYS);
  if (!snapshot || !integer(snapshot.tick, 1, P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE)
    || !integer(snapshot.lastInputSequence, 1, P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE)) return null;
  const physicalInput = exactArray(snapshot.physical, { min: 2, max: 2 });
  const carsInput = exactArray(snapshot.cars, { min: 2, max: 2 });
  const rocketsInput = exactArray(snapshot.rockets, { max: MAX_ROCKETS });
  const eventsInput = exactArray(snapshot.events, { max: MAX_EVENTS });
  const score = exactRecord(snapshot.score, SCORE_KEYS);
  const round = validRound(snapshot.round, score);
  if (!physicalInput || !carsInput || !rocketsInput || !eventsInput || !score || !round
    || !integer(score.blue, 0, 1_000_000) || !integer(score.red, 0, 1_000_000)) return null;
  const physical = P2P_WASM_CAUSAL_COMBAT_CAR_IDS.map((id, index) => validPhysical(physicalInput[index], id));
  const cars = P2P_WASM_CAUSAL_COMBAT_CAR_IDS.map((id, index) => validCombatCar(carsInput[index], id));
  const rockets = rocketsInput.map(validRocket);
  const events = eventsInput.map(validEvent);
  if (physical.some(value => value === null) || cars.some(value => value === null)
    || rockets.some(value => value === null) || events.some(value => value === null)) return null;
  const rocketIds = new Set();
  if (rockets.some(rocket => rocketIds.has(rocket.id) || !rocketIds.add(rocket.id))) return null;
  return {
    tick: snapshot.tick,
    lastInputSequence: snapshot.lastInputSequence,
    physical,
    score: { blue: score.blue, red: score.red },
    round,
    cars,
    rockets,
    events,
  };
}

/**
 * Validate one decoded v3 causal snapshot without accepting a host-internal
 * shape. This is the narrow bridge used by a later, explicitly versioned
 * presentation envelope; it never mutates or advances a match.
 */
export function normalizeP2PWasmCausalCombatSnapshot(value) {
  return normalizeSnapshot(value);
}

/** Convert exactly one host snapshot without mutating its simulation state. */
export function causalCombatSnapshotFromHost(value) {
  const source = exactRecord(value, ["tick", "lastInputSequence", "physical", "combat"]);
  if (!source) throw new TypeError("P2P WASM causal host snapshot has an invalid shape.");
  const combat = exactRecord(source.combat, ["score", "round", "cars", "rockets", "events", "eliminated", "respawns"]);
  if (!combat) throw new TypeError("P2P WASM causal host combat state has an invalid shape.");
  const snapshot = {
    tick: source.tick,
    lastInputSequence: source.lastInputSequence,
    physical: source.physical,
    score: combat.score,
    round: combat.round,
    cars: combat.cars,
    rockets: combat.rockets.map(rocket => ({
      id: rocket.id,
      owner: rocket.owner,
      team: rocket.team,
      x: rocket.x,
      z: rocket.z,
      h: rocket.h,
      vx: rocket.vx,
      vz: rocket.vz,
      vh: rocket.vh,
      life: rocket.life,
      targetId: rocket.targetId ?? null,
    })),
    events: combat.events.map(item => ({ kind: item.kind, text: item.text, at: item.at })),
  };
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) throw new TypeError("P2P WASM causal host snapshot is outside the wire contract.");
  return normalized;
}

function normalizeEnvelope(value) {
  const envelope = exactRecord(value, TOP_LEVEL_KEYS);
  if (!envelope || envelope.protocolVersion !== P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION
    || envelope.type !== P2P_WASM_CAUSAL_COMBAT_TYPE || !safeContextId(envelope.roomId)
    || !safeContextId(envelope.sessionId) || !integer(envelope.sequence, 1, P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE)) return null;
  const snapshot = normalizeSnapshot(envelope.snapshot);
  return snapshot ? {
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION,
    type: P2P_WASM_CAUSAL_COMBAT_TYPE,
    roomId: envelope.roomId,
    sessionId: envelope.sessionId,
    sequence: envelope.sequence,
    snapshot,
  } : null;
}

function encodeEnvelope(envelope) {
  return JSON.stringify(envelope);
}

/** Create a strict causal wire frame from a real host snapshot. */
export function createP2PWasmCausalCombatEnvelope({ roomId, sessionId, sequence, snapshot } = {}) {
  const normalizedSnapshot = causalCombatSnapshotFromHost(snapshot);
  const envelope = normalizeEnvelope({
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION,
    type: P2P_WASM_CAUSAL_COMBAT_TYPE,
    roomId,
    sessionId,
    sequence,
    snapshot: normalizedSnapshot,
  });
  if (!envelope) throw new TypeError("P2P WASM causal combat envelope is outside its versioned contract.");
  const text = encodeEnvelope(envelope);
  if (encoder.encode(text).byteLength > P2P_WASM_CAUSAL_COMBAT_MAX_BYTES) {
    throw new RangeError(`P2P WASM causal combat envelope exceeds ${P2P_WASM_CAUSAL_COMBAT_MAX_BYTES} UTF-8 bytes.`);
  }
  return text;
}

/** Decode one bounded causal wire frame. It does not alter a match. */
export function decodeP2PWasmCausalCombatEnvelope(text) {
  if (typeof text !== "string") throw new TypeError("P2P WASM causal combat envelope must be JSON text.");
  if (encoder.encode(text).byteLength > P2P_WASM_CAUSAL_COMBAT_MAX_BYTES) {
    throw new RangeError(`P2P WASM causal combat envelope exceeds ${P2P_WASM_CAUSAL_COMBAT_MAX_BYTES} UTF-8 bytes.`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new SyntaxError("P2P WASM causal combat envelope is malformed JSON."); }
  const envelope = normalizeEnvelope(parsed);
  if (!envelope) throw new TypeError("P2P WASM causal combat envelope is outside its versioned contract.");
  return envelope;
}

export function validateP2PWasmCausalCombatEnvelope(value) {
  const normalized = normalizeEnvelope(value);
  return Boolean(normalized) && encoder.encode(encodeEnvelope(normalized)).byteLength <= P2P_WASM_CAUSAL_COMBAT_MAX_BYTES;
}
