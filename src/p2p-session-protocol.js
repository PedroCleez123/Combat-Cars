export const P2P_PROTOCOL_VERSION = 1;
export const P2P_LOOPBACK_ROOM_ID = "local";
export const P2P_CONTROL_CHANNEL = "arsenal-controls";
// Optional presentation-only side channel. It is deliberately separate from
// the causal controls channel so an older peer can keep playing without it.
export const P2P_METADATA_CHANNEL = "arsenal-metadata";
// Two compact car records fit well below this existing ceiling; 2 KiB leaves
// room for protocol envelope fields while bounding any single ordered frame.
export const P2P_MAX_MESSAGE_BYTES = 2048;
export const P2P_WEBRTC_SIGNAL_VERSION = 1;
export const P2P_MAX_SDP_BYTES = 12 * 1024;
export const P2P_MAX_ICE_CANDIDATE_BYTES = 2048;

const WEBRTC_DESCRIPTION_KEYS = ["protocolVersion", "sdp", "type"];
const WEBRTC_CANDIDATE_KEYS = ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"];
const WEBRTC_CANDIDATE_SIGNAL_KEYS = ["candidate", "protocolVersion", "type"];
const utf8Encoder = new TextEncoder();

function utf8Length(value) {
  return utf8Encoder.encode(value).byteLength;
}

function normalizeWebRTCCandidate(value) {
  if (!hasExactKeys(value, WEBRTC_CANDIDATE_KEYS)) return null;
  if (typeof value.candidate !== "string" || utf8Length(value.candidate) > P2P_MAX_ICE_CANDIDATE_BYTES) return null;
  if (!(value.sdpMid === null || (typeof value.sdpMid === "string" && value.sdpMid.length <= 256))) return null;
  if (!(value.sdpMLineIndex === null || (Number.isSafeInteger(value.sdpMLineIndex) && value.sdpMLineIndex >= 0 && value.sdpMLineIndex <= 255))) return null;
  if (!(value.usernameFragment === null || (typeof value.usernameFragment === "string" && value.usernameFragment.length <= 256))) return null;
  return {
    candidate: value.candidate,
    sdpMid: value.sdpMid,
    sdpMLineIndex: value.sdpMLineIndex,
    usernameFragment: value.usernameFragment,
  };
}

export function normalizeP2PWebRTCSignal(value) {
  if (!isRecord(value) || value.protocolVersion !== P2P_WEBRTC_SIGNAL_VERSION) return null;
  if (value.type === "offer" || value.type === "answer") {
    if (!hasExactKeys(value, WEBRTC_DESCRIPTION_KEYS)
      || typeof value.sdp !== "string"
      || value.sdp.length === 0
      || utf8Length(value.sdp) > P2P_MAX_SDP_BYTES) return null;
    return { type: value.type, protocolVersion: P2P_WEBRTC_SIGNAL_VERSION, sdp: value.sdp };
  }
  if (value.type === "candidate") {
    if (!hasExactKeys(value, WEBRTC_CANDIDATE_SIGNAL_KEYS)) return null;
    const candidate = normalizeWebRTCCandidate(value.candidate);
    if (!candidate) return null;
    return { type: "candidate", protocolVersion: P2P_WEBRTC_SIGNAL_VERSION, candidate };
  }
  return null;
}

export function createP2PWebRTCDescription(type, sdp) {
  const signal = normalizeP2PWebRTCSignal({ type, protocolVersion: P2P_WEBRTC_SIGNAL_VERSION, sdp });
  if (!signal) throw new TypeError("Invalid P2P WebRTC description.");
  return signal;
}

export function createP2PWebRTCCandidate(candidate) {
  const signal = normalizeP2PWebRTCSignal({ type: "candidate", protocolVersion: P2P_WEBRTC_SIGNAL_VERSION, candidate });
  if (!signal) throw new TypeError("Invalid P2P WebRTC candidate.");
  return signal;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL_KEYS = ["boost", "jump", "steer", "throttle"];
const MESSAGE_KEYS = {
  hello: ["protocolVersion", "roomId", "sequence", "sessionId", "type"],
  welcome: ["protocolVersion", "roomId", "sequence", "sessionId", "type"],
  input: ["controls", "protocolVersion", "roomId", "sequence", "sessionId", "type"],
  state: ["protocolVersion", "roomId", "sequence", "sessionId", "state", "type"],
  snapshot: ["protocolVersion", "roomId", "sequence", "sessionId", "snapshot", "type"],
};

const SNAPSHOT_CAR_KEYS = ["h", "id", "team", "vx", "vh", "vz", "x", "yaw", "z"];

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSafeId(value) {
  return typeof value === "string" && SAFE_ID.test(value);
}

function isSequence(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeControls(value) {
  if (!hasExactKeys(value, CONTROL_KEYS)) return null;
  const { throttle, steer, boost, jump } = value;
  if (!Number.isFinite(throttle) || throttle < 0 || throttle > 1) return null;
  if (!Number.isFinite(steer) || steer < -1 || steer > 1) return null;
  if (typeof boost !== "boolean" || typeof jump !== "boolean") return null;
  return { throttle, steer, boost, jump };
}

function normalizeSnapshot(value) {
  if (!hasExactKeys(value, ["cars", "lastInputSequence", "tick"])) return null;
  if (!Number.isSafeInteger(value.tick) || value.tick < 1 || value.tick > 10_000_000) return null;
  if (!Number.isSafeInteger(value.lastInputSequence) || value.lastInputSequence < 1) return null;
  if (!Array.isArray(value.cars) || value.cars.length !== 2) return null;
  const cars = [];
  const ids = new Set();
  for (const car of value.cars) {
    if (!hasExactKeys(car, SNAPSHOT_CAR_KEYS) || !isSafeId(car.id) || ids.has(car.id)) return null;
    if (car.team !== "blue" && car.team !== "red") return null;
    const ranges = [
      [car.x, -10000, 10000], [car.z, -10000, 10000], [car.h, -100, 1000],
      [car.yaw, -Math.PI, Math.PI], [car.vx, -200, 200], [car.vz, -200, 200], [car.vh, -200, 200],
    ];
    if (ranges.some(([number, minimum, maximum]) => !Number.isFinite(number) || number < minimum || number > maximum)) return null;
    ids.add(car.id);
    cars.push({ id: car.id, team: car.team, x: car.x, z: car.z, h: car.h, yaw: car.yaw, vx: car.vx, vz: car.vz, vh: car.vh });
  }
  if (cars[0].team === cars[1].team) return null;
  return { tick: value.tick, lastInputSequence: value.lastInputSequence, cars };
}

function normalizeMessage(message, expectedType) {
  if (!isRecord(message) || !Object.hasOwn(MESSAGE_KEYS, message.type)) return null;
  if (expectedType && message.type !== expectedType) return null;
  if (!hasExactKeys(message, MESSAGE_KEYS[message.type])) return null;
  if (message.protocolVersion !== P2P_PROTOCOL_VERSION) return null;
  if (!isSafeId(message.roomId) || !isSafeId(message.sessionId)) return null;
  if (!isSequence(message.sequence)) return null;

  if (message.type === "hello" || message.type === "welcome") {
    if (message.sequence !== 0) return null;
    return {
      type: message.type,
      protocolVersion: P2P_PROTOCOL_VERSION,
      roomId: message.roomId,
      sessionId: message.sessionId,
      sequence: 0,
    };
  }

  if (message.sequence < 1) return null;
  if (message.type === "input") {
    const controls = normalizeControls(message.controls);
    if (!controls) return null;
    return {
      type: "input",
      protocolVersion: P2P_PROTOCOL_VERSION,
      roomId: message.roomId,
      sessionId: message.sessionId,
      sequence: message.sequence,
      controls,
    };
  }

  if (message.type === "snapshot") {
    const snapshot = normalizeSnapshot(message.snapshot);
    if (!snapshot) return null;
    return {
      type: "snapshot",
      protocolVersion: P2P_PROTOCOL_VERSION,
      roomId: message.roomId,
      sessionId: message.sessionId,
      sequence: message.sequence,
      snapshot,
    };
  }

  if (!hasExactKeys(message.state, ["controls", "lastInputSequence"])) return null;
  if (message.state.lastInputSequence !== message.sequence) return null;
  const controls = normalizeControls(message.state.controls);
  if (!controls) return null;
  return {
    type: "state",
    protocolVersion: P2P_PROTOCOL_VERSION,
    roomId: message.roomId,
    sessionId: message.sessionId,
    sequence: message.sequence,
    state: { lastInputSequence: message.sequence, controls },
  };
}

export function createP2PHello({ roomId = P2P_LOOPBACK_ROOM_ID, sessionId } = {}) {
  return createSessionMessage("hello", { roomId, sessionId, sequence: 0 });
}

export function createP2PWelcome({ roomId = P2P_LOOPBACK_ROOM_ID, sessionId } = {}) {
  return createSessionMessage("welcome", { roomId, sessionId, sequence: 0 });
}

export function createP2PInput({ roomId = P2P_LOOPBACK_ROOM_ID, sessionId, sequence, controls } = {}) {
  const message = { type: "input", protocolVersion: P2P_PROTOCOL_VERSION, roomId, sessionId, sequence, controls };
  const normalized = normalizeMessage(message, "input");
  if (!normalized) throw new TypeError("Invalid P2P input message.");
  return normalized;
}

export function createP2PState({ roomId = P2P_LOOPBACK_ROOM_ID, sessionId, sequence, controls } = {}) {
  const message = {
    type: "state",
    protocolVersion: P2P_PROTOCOL_VERSION,
    roomId,
    sessionId,
    sequence,
    state: { lastInputSequence: sequence, controls },
  };
  const normalized = normalizeMessage(message, "state");
  if (!normalized) throw new TypeError("Invalid P2P state message.");
  return normalized;
}

export function createP2PHostSnapshot({ roomId = P2P_LOOPBACK_ROOM_ID, sessionId, sequence, snapshot } = {}) {
  const message = { type: "snapshot", protocolVersion: P2P_PROTOCOL_VERSION, roomId, sessionId, sequence, snapshot };
  const normalized = normalizeMessage(message, "snapshot");
  if (!normalized) throw new TypeError("Invalid P2P host snapshot message.");
  return normalized;
}

function createSessionMessage(type, { roomId, sessionId, sequence }) {
  const message = { type, protocolVersion: P2P_PROTOCOL_VERSION, roomId, sessionId, sequence };
  const normalized = normalizeMessage(message, type);
  if (!normalized) throw new TypeError("Invalid P2P session message.");
  return normalized;
}

export function validateP2PMessage(message, { expectedType, roomId, sessionId } = {}) {
  const normalized = normalizeMessage(message, expectedType);
  if (!normalized) return { ok: false, reason: "Mensaje P2P no válido." };
  if (roomId !== undefined && normalized.roomId !== roomId) {
    return { ok: false, reason: "Sala P2P no coincidente." };
  }
  if (sessionId !== undefined && normalized.sessionId !== sessionId) {
    return { ok: false, reason: "Sesión P2P no coincidente." };
  }
  return { ok: true, message: normalized };
}

export function decodeP2PMessage(serialized, options) {
  if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > P2P_MAX_MESSAGE_BYTES) {
    return { ok: false, reason: "Mensaje P2P no válido." };
  }
  let message;
  try {
    message = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: "Mensaje P2P no válido." };
  }
  return validateP2PMessage(message, options);
}
