// P2P-WASM-41 / ONLINE-PROTOCOL-02B: versioned presentation envelope.
// It deliberately does not alter the LAN/P2P v1 protocol. The v5
// receiver gets authoritative pose/combat from the v3 causal snapshot plus
// additional WASM telemetry that a renderer may read but never simulate.
import {
  causalCombatSnapshotFromHost,
  normalizeP2PWasmCausalCombatSnapshot,
  P2P_WASM_CAUSAL_COMBAT_CAR_IDS,
  P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE,
} from "./p2p-wasm-causal-combat-protocol.mjs";

export const P2P_WASM_PRESENTATION_PROTOCOL_VERSION = 5;
export const P2P_WASM_PRESENTATION_TYPE = "wasm-causal-combat-presentation";
export const P2P_WASM_PRESENTATION_MAX_BYTES = 4096;
export const P2P_WASM_PRESENTATION_JUMP_STATES = Object.freeze([
  "grounded", "first-jump", "double-jump", "dodge", "airborne",
]);
export const P2P_WASM_PRESENTATION_ACTION_SERIAL_KEYS = Object.freeze([
  "jump", "doubleJump", "dodge", "respawn",
]);

const TEAMS = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const encoder = new TextEncoder();
const TOP_LEVEL_KEYS = ["protocolVersion", "type", "roomId", "sessionId", "sequence", "snapshot", "presentation"];
const PRESENTATION_KEYS = ["id", "team", "orientation", "boost", "grounded", "wheelCount", "jumps", "jumpState", "actionSerials", "boosting", "supersonic", "powerslide", "angularVelocity", "wheelContact", "worldContact"];
const QUATERNION_KEYS = ["x", "y", "z", "w"];
const VECTOR_KEYS = ["x", "y", "z"];
const ANGULAR_KEYS = ["pitch", "yaw", "roll"];
const CONTACT_KEYS = ["hasContact", "normal"];
const JUMP_STATE_SET = new Set(P2P_WASM_PRESENTATION_JUMP_STATES);

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

function exactArray(value, length) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || !ownKeys.includes("length")) return null;
    return Array.from({ length }, (_, index) => Object.hasOwn(value, index) ? value[index] : undefined);
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

function safeContext(value) { return typeof value === "string" && SAFE_ID.test(value); }

function vector(value, maximum = 1_000) {
  const input = exactRecord(value, VECTOR_KEYS);
  return input && [input.x, input.y, input.z].every(part => finite(part, -maximum, maximum))
    ? { x: input.x, y: input.y, z: input.z } : null;
}

function quaternion(value) {
  const input = exactRecord(value, QUATERNION_KEYS);
  if (!input || ![input.x, input.y, input.z, input.w].every(part => finite(part, -1, 1))) return null;
  const norm = Math.hypot(input.x, input.y, input.z, input.w);
  return norm > .999 && norm < 1.001 ? { x: input.x, y: input.y, z: input.z, w: input.w } : null;
}

function contact(value) {
  const input = exactRecord(value, CONTACT_KEYS);
  if (!input || typeof input.hasContact !== "boolean") return null;
  const normal = vector(input.normal, 1.001);
  const length = normal ? Math.hypot(normal.x, normal.y, normal.z) : NaN;
  if (!normal || length > 1.001 || (input.hasContact && length < .9)) return null;
  return { hasContact: input.hasContact, normal };
}

function presentationCar(value, expectedId) {
  const input = exactRecord(value, PRESENTATION_KEYS);
  if (!input || input.id !== expectedId || input.team !== TEAMS[expectedId]) return null;
  const orientation = quaternion(input.orientation);
  const angularVelocity = exactRecord(input.angularVelocity, ANGULAR_KEYS);
  const actionSerials = exactRecord(input.actionSerials, P2P_WASM_PRESENTATION_ACTION_SERIAL_KEYS);
  const wheelContact = contact(input.wheelContact);
  const worldContact = contact(input.worldContact);
  if (!orientation || !angularVelocity || !wheelContact || !worldContact
    || !Object.values(angularVelocity).every(part => finite(part, -1_000, 1_000))
    || !finite(input.boost, 0, 100) || typeof input.grounded !== "boolean"
    || !integer(input.wheelCount, 0, 4) || !integer(input.jumps, 0, 2)
    || !JUMP_STATE_SET.has(input.jumpState)
    || !actionSerials || !P2P_WASM_PRESENTATION_ACTION_SERIAL_KEYS.every(key => integer(actionSerials[key], 0, P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE))
    || typeof input.boosting !== "boolean" || typeof input.supersonic !== "boolean"
    || !finite(input.powerslide, 0, 1)) return null;
  return {
    id: input.id, team: input.team, orientation, boost: input.boost,
    grounded: input.grounded, wheelCount: input.wheelCount, jumps: input.jumps,
    jumpState: input.jumpState,
    actionSerials: Object.fromEntries(P2P_WASM_PRESENTATION_ACTION_SERIAL_KEYS.map(key => [key, actionSerials[key]])),
    boosting: input.boosting, supersonic: input.supersonic, powerslide: input.powerslide,
    angularVelocity: { pitch: angularVelocity.pitch, yaw: angularVelocity.yaw, roll: angularVelocity.roll },
    wheelContact, worldContact,
  };
}

function normalizePresentation(value) {
  const input = exactArray(value, 2);
  if (!input) return null;
  const normalized = P2P_WASM_CAUSAL_COMBAT_CAR_IDS.map((id, index) => presentationCar(input[index], id));
  return normalized.some(value => value === null) ? null : normalized;
}

function normalizeEnvelope(value) {
  const envelope = exactRecord(value, TOP_LEVEL_KEYS);
  if (!envelope || envelope.protocolVersion !== P2P_WASM_PRESENTATION_PROTOCOL_VERSION
    || envelope.type !== P2P_WASM_PRESENTATION_TYPE || !safeContext(envelope.roomId)
    || !safeContext(envelope.sessionId) || !integer(envelope.sequence, 1, 10_000_000)) return null;
  const snapshot = normalizeP2PWasmCausalCombatSnapshot(envelope.snapshot);
  const presentation = normalizePresentation(envelope.presentation);
  return snapshot && presentation ? {
    protocolVersion: P2P_WASM_PRESENTATION_PROTOCOL_VERSION,
    type: P2P_WASM_PRESENTATION_TYPE,
    roomId: envelope.roomId,
    sessionId: envelope.sessionId,
    sequence: envelope.sequence,
    snapshot,
    presentation,
  } : null;
}

/**
 * Normalize one already-decoded v5 frame without advancing a match. The
 * isolated renderer adapter uses this bridge so its input boundary remains
 * identical to the wire decoder.
 */
export function normalizeP2PWasmCausalCombatPresentationEnvelope(value) {
  return normalizeEnvelope(value);
}

/** Convert one host snapshot that explicitly opted into the extended ABI. */
export function causalCombatPresentationFromHost(value) {
  // Full hosts may retain pads for the local presentation adapter. v5 does
  // not put them on the wire yet, so accept and intentionally omit that
  // optional host-internal field rather than forcing the host to discard it.
  const source = exactRecord(value, ["tick", "lastInputSequence", "physical", "presentation", "combat", "pads"])
    || exactRecord(value, ["tick", "lastInputSequence", "physical", "presentation", "combat"]);
  if (!source) throw new TypeError("P2P WASM presentation host snapshot has an invalid shape.");
  const snapshot = causalCombatSnapshotFromHost({
    tick: source.tick,
    lastInputSequence: source.lastInputSequence,
    physical: source.physical,
    combat: source.combat,
  });
  const presentation = normalizePresentation(source.presentation);
  if (!presentation) throw new TypeError("P2P WASM presentation telemetry is outside its versioned contract.");
  return { snapshot, presentation };
}

export function createP2PWasmCausalCombatPresentationEnvelope({ roomId, sessionId, sequence, snapshot } = {}) {
  const source = causalCombatPresentationFromHost(snapshot);
  const envelope = normalizeEnvelope({
    protocolVersion: P2P_WASM_PRESENTATION_PROTOCOL_VERSION,
    type: P2P_WASM_PRESENTATION_TYPE,
    roomId,
    sessionId,
    sequence,
    snapshot: source.snapshot,
    presentation: source.presentation,
  });
  if (!envelope) throw new TypeError("P2P WASM presentation envelope is outside its versioned contract.");
  const text = JSON.stringify(envelope);
  if (encoder.encode(text).byteLength > P2P_WASM_PRESENTATION_MAX_BYTES) {
    throw new RangeError(`P2P WASM presentation envelope exceeds ${P2P_WASM_PRESENTATION_MAX_BYTES} UTF-8 bytes.`);
  }
  return text;
}

export function decodeP2PWasmCausalCombatPresentationEnvelope(text) {
  if (typeof text !== "string") throw new TypeError("P2P WASM presentation envelope must be JSON text.");
  if (encoder.encode(text).byteLength > P2P_WASM_PRESENTATION_MAX_BYTES) {
    throw new RangeError(`P2P WASM presentation envelope exceeds ${P2P_WASM_PRESENTATION_MAX_BYTES} UTF-8 bytes.`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new SyntaxError("P2P WASM presentation envelope is malformed JSON."); }
  const envelope = normalizeEnvelope(parsed);
  if (!envelope) throw new TypeError("P2P WASM presentation envelope is outside its versioned contract.");
  return envelope;
}

export function validateP2PWasmCausalCombatPresentationEnvelope(value) {
  const normalized = normalizeEnvelope(value);
  return Boolean(normalized) && encoder.encode(JSON.stringify(normalized)).byteLength <= P2P_WASM_PRESENTATION_MAX_BYTES;
}
