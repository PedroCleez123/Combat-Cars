// Diagnostic-only wire envelope for the isolated RocketSim WASM spike.
// This is intentionally a distinct protocol from the public/session P2P v1.

export const P2P_WASM_SNAPSHOT_PROTOCOL_VERSION = 1;
export const P2P_WASM_SNAPSHOT_TYPE = "wasm-snapshot";
export const P2P_WASM_SNAPSHOT_MAX_BYTES = 2048;

// RocketSim's normal supersonic threshold is 2200 UU/s. The controlled
// collision trace also measured +1257.8899 UU/s on one axis. A component-wise
// +/-2500 UU/s envelope covers either direction through the normal speed range
// and that measured impulse, with modest headroom while still bounding spikes.
// This is a diagnostic transport limit only; values are rejected, never clamped.
export const P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT = 2500;

export const P2P_WASM_SNAPSHOT_MAX_TICK = 10_000_000;
// The host fixture's tick ceiling bounds the monotonically increasing input
// sequence as well; keeping the two limits aligned avoids unbounded counters.
export const P2P_WASM_SNAPSHOT_MAX_INPUT_SEQUENCE = 10_000_000;
export const P2P_WASM_SNAPSHOT_MAX_CONTEXT_ID_LENGTH = 64;
export const P2P_WASM_SNAPSHOT_CAR_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);

const TOP_LEVEL_KEYS = ["protocolVersion", "type", "context", "tick", "lastInputSequence", "cars"];
const SNAPSHOT_KEYS = ["tick", "lastInputSequence", "cars"];
const CONTEXT_KEYS = ["roomId", "sessionId"];
const CAR_KEYS = ["id", "team", "x", "z", "h", "yaw", "vx", "vz", "vh"];
const TEAMS_BY_ID = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
const SAFE_CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const utf8Encoder = new TextEncoder();

function exactPlainRecord(value, expectedKeys) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length || ownKeys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) {
      return null;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    // Proxies and hostile accessors must fail closed rather than escaping validation.
    return null;
  }
}

function exactTwoElementArray(value) {
  try {
    if (!Array.isArray(value)) return null;
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== 3 || !ownKeys.includes("0") || !ownKeys.includes("1") || !ownKeys.includes("length")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (descriptors.length.value !== 2 || descriptors.length.enumerable) return null;
    for (const index of ["0", "1"]) {
      if (!descriptors[index]?.enumerable || !Object.hasOwn(descriptors[index], "value")) return null;
    }
    return [descriptors["0"].value, descriptors["1"].value];
  } catch {
    return null;
  }
}

function validContext(context) {
  const fields = exactPlainRecord(context, CONTEXT_KEYS);
  if (!fields) return false;
  return CONTEXT_KEYS.every(key => typeof fields[key] === "string"
    && fields[key].length >= 1
    && fields[key].length <= P2P_WASM_SNAPSHOT_MAX_CONTEXT_ID_LENGTH
    && SAFE_CONTEXT_ID.test(fields[key]));
}

function validCar(value, expectedId) {
  const car = exactPlainRecord(value, CAR_KEYS);
  if (!car || car.id !== expectedId || car.team !== TEAMS_BY_ID[expectedId]) return false;

  const positionRanges = [
    [car.x, -10_000, 10_000],
    [car.z, -10_000, 10_000],
    [car.h, -100, 1_000],
    [car.yaw, -Math.PI, Math.PI],
  ];
  if (positionRanges.some(([number, minimum, maximum]) => !Number.isFinite(number) || number < minimum || number > maximum)) {
    return false;
  }

  return [car.vx, car.vz, car.vh].every(number => Number.isFinite(number)
    && number >= -P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT
    && number <= P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT);
}

function messageParts(value) {
  const message = exactPlainRecord(value, TOP_LEVEL_KEYS);
  if (!message
    || message.protocolVersion !== P2P_WASM_SNAPSHOT_PROTOCOL_VERSION
    || message.type !== P2P_WASM_SNAPSHOT_TYPE
    || !Number.isSafeInteger(message.tick)
    || message.tick < 1
    || message.tick > P2P_WASM_SNAPSHOT_MAX_TICK
    || !Number.isSafeInteger(message.lastInputSequence)
    || message.lastInputSequence < 1
    || message.lastInputSequence > P2P_WASM_SNAPSHOT_MAX_INPUT_SEQUENCE
    || !validContext(message.context)) return null;

  const cars = exactTwoElementArray(message.cars);
  if (!cars || !validCar(cars[0], P2P_WASM_SNAPSHOT_CAR_IDS[0])
    || !validCar(cars[1], P2P_WASM_SNAPSHOT_CAR_IDS[1])) return null;

  const context = exactPlainRecord(message.context, CONTEXT_KEYS);
  const host = exactPlainRecord(cars[0], CAR_KEYS);
  const pilot = exactPlainRecord(cars[1], CAR_KEYS);
  return { message, context, host, pilot };
}

function quote(value) {
  return JSON.stringify(value);
}

function serializeCar(car) {
  return `{"id":${quote(car.id)},"team":${quote(car.team)},"x":${quote(car.x)},"z":${quote(car.z)},"h":${quote(car.h)},"yaw":${quote(car.yaw)},"vx":${quote(car.vx)},"vz":${quote(car.vz)},"vh":${quote(car.vh)}}`;
}

function serializeMessage({ message, context, host, pilot }) {
  return `{"protocolVersion":${P2P_WASM_SNAPSHOT_PROTOCOL_VERSION},"type":${quote(P2P_WASM_SNAPSHOT_TYPE)},"context":{"roomId":${quote(context.roomId)},"sessionId":${quote(context.sessionId)}},"tick":${quote(message.tick)},"lastInputSequence":${quote(message.lastInputSequence)},"cars":[${serializeCar(host)},${serializeCar(pilot)}]}`;
}

/**
 * Validate a parsed message object. Returns false for malformed, extended,
 * oversized, or non-plain/prototype-bearing values.
 */
export function validateP2PWasmSnapshotEnvelope(value) {
  const parts = messageParts(value);
  if (!parts) return false;
  return utf8Encoder.encode(serializeMessage(parts)).byteLength <= P2P_WASM_SNAPSHOT_MAX_BYTES;
}

/**
 * Build a JSON text envelope from the host adapter's { tick,
 * lastInputSequence, cars } snapshot and { roomId, sessionId } context.
 * The returned string is intentionally tagged wasm-snapshot, not P2P v1's
 * snapshot message type.
 */
export function createP2PWasmSnapshotEnvelope(snapshot, context) {
  const source = exactPlainRecord(snapshot, SNAPSHOT_KEYS);
  if (!source) throw new TypeError("P2P WASM snapshot must have exactly tick, lastInputSequence, and cars.");
  const envelope = {
    protocolVersion: P2P_WASM_SNAPSHOT_PROTOCOL_VERSION,
    type: P2P_WASM_SNAPSHOT_TYPE,
    context,
    tick: source.tick,
    lastInputSequence: source.lastInputSequence,
    cars: source.cars,
  };
  const parts = messageParts(envelope);
  if (!parts) throw new TypeError("P2P WASM diagnostic snapshot is outside its versioned envelope contract.");
  const text = serializeMessage(parts);
  if (utf8Encoder.encode(text).byteLength > P2P_WASM_SNAPSHOT_MAX_BYTES) {
    throw new RangeError(`P2P WASM snapshot exceeds ${P2P_WASM_SNAPSHOT_MAX_BYTES} UTF-8 bytes.`);
  }
  return text;
}

/** Parse and validate an incoming UTF-8 JSON text envelope. */
export function decodeP2PWasmSnapshotEnvelope(text) {
  if (typeof text !== "string") throw new TypeError("P2P WASM snapshot envelope must be JSON text.");
  if (utf8Encoder.encode(text).byteLength > P2P_WASM_SNAPSHOT_MAX_BYTES) {
    throw new RangeError(`P2P WASM snapshot exceeds ${P2P_WASM_SNAPSHOT_MAX_BYTES} UTF-8 bytes.`);
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SyntaxError("P2P WASM snapshot envelope is malformed JSON.");
  }
  if (!validateP2PWasmSnapshotEnvelope(value)) {
    throw new TypeError("P2P WASM snapshot envelope is outside its versioned contract.");
  }
  return value;
}
