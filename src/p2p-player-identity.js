// ONLINE-IDENTITY-22: bounded player-facing metadata for a validated P2P
// causal channel. This module never handles invite credentials or simulation
// state; it only normalizes a display name and frames a presentation envelope.

export const P2P_IDENTITY_PROTOCOL_VERSION = 1;
export const P2P_IDENTITY_TYPE = "wasm-causal-combat-identity";
export const P2P_IDENTITY_MAX_NAME_LENGTH = 16;
export const P2P_IDENTITY_MAX_BYTES = 512;

const SAFE_CONTEXT = /^[A-Za-z0-9_-]{1,64}$/u;
const ROLES = Object.freeze(["host", "pilot"]);
const ENVELOPE_KEYS = Object.freeze(["protocolVersion", "type", "roomId", "sessionId", "role", "name"]);
const encoder = new TextEncoder();

function exactRecord(value, expectedKeys) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function safeFallback(fallback) {
  return fallback === "host" || fallback === "HOST" ? "HOST" : "PILOTO";
}

/** Normalize untrusted UI or peer text to a short player-facing label. */
export function normalizeP2PPlayerName(value, fallback = "PILOTO") {
  let normalized = "";
  try {
    normalized = (typeof value === "string" ? value : "")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  } catch {
    normalized = "";
  }
  const limited = Array.from(normalized).slice(0, P2P_IDENTITY_MAX_NAME_LENGTH).join("");
  return limited || safeFallback(fallback);
}

function validContext(value) {
  return typeof value === "string" && SAFE_CONTEXT.test(value);
}

function normalizedEnvelope(value, { roomId, sessionId, expectedRole } = {}) {
  const envelope = exactRecord(value, ENVELOPE_KEYS);
  if (!envelope
    || envelope.protocolVersion !== P2P_IDENTITY_PROTOCOL_VERSION
    || envelope.type !== P2P_IDENTITY_TYPE
    || !validContext(envelope.roomId)
    || !validContext(envelope.sessionId)
    || (roomId !== undefined && envelope.roomId !== roomId)
    || (sessionId !== undefined && envelope.sessionId !== sessionId)
    || !ROLES.includes(envelope.role)
    || (expectedRole !== undefined && envelope.role !== expectedRole)
    || typeof envelope.name !== "string") return null;
  return {
    protocolVersion: P2P_IDENTITY_PROTOCOL_VERSION,
    type: P2P_IDENTITY_TYPE,
    roomId: envelope.roomId,
    sessionId: envelope.sessionId,
    role: envelope.role,
    name: normalizeP2PPlayerName(envelope.name, envelope.role),
  };
}

export function createP2PPlayerIdentityEnvelope({ roomId, sessionId, role, name } = {}) {
  const envelope = normalizedEnvelope({
    protocolVersion: P2P_IDENTITY_PROTOCOL_VERSION,
    type: P2P_IDENTITY_TYPE,
    roomId,
    sessionId,
    role,
    name: normalizeP2PPlayerName(name, role),
  });
  if (!envelope) throw new TypeError("P2P player identity envelope is invalid.");
  const text = JSON.stringify(envelope);
  if (encoder.encode(text).byteLength > P2P_IDENTITY_MAX_BYTES) {
    throw new RangeError("P2P player identity envelope exceeds its byte limit.");
  }
  return text;
}

/** Decode and normalize one peer announcement; callers gate it by handshake state. */
export function decodeP2PPlayerIdentityEnvelope(text, context = {}) {
  if (typeof text !== "string" || encoder.encode(text).byteLength > P2P_IDENTITY_MAX_BYTES) {
    return { ok: false, reason: "La identidad P2P supera el límite permitido." };
  }
  let value;
  try { value = JSON.parse(text); } catch {
    return { ok: false, reason: "La identidad P2P no es JSON válido." };
  }
  const normalized = normalizedEnvelope(value, context);
  return normalized
    ? { ok: true, identity: Object.freeze(normalized) }
    : { ok: false, reason: "La identidad P2P no respeta el contrato de presentación." };
}

