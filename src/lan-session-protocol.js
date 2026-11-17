export const LAN_PROTOCOL_VERSION = 1;
export const LAN_DEFAULT_ROOM_ID = "local";
export const LAN_MAX_CLIENT_FRAME_BYTES = 8192;
export const LAN_MAX_BUFFER_BYTES = LAN_MAX_CLIENT_FRAME_BYTES + 128;
export const LAN_RECONNECT_GRACE_MS = 4000;
export const LAN_HEARTBEAT_INTERVAL_MS = 5000;
export const LAN_HEARTBEAT_TIMEOUT_MS = 20000;
// A peer can keep a TCP/WebSocket connection after the authoritative tick
// loop has stalled. This client-side limit is deliberately longer than the
// normal bridge recovery window, while still turning a frozen rendered frame
// into the existing reconnect path.
export const LAN_STATE_STALL_TIMEOUT_MS = 8000;
export const LAN_MAX_INPUTS_PER_SECOND = 180;

const safeId = /^[A-Za-z0-9_-]{1,96}$/;

export function normalizePilotName(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim();
  return Array.from(normalized).slice(0, 16).join("") || "PILOTO";
}

export function normalizeRoomId(value) {
  const roomId = String(value || LAN_DEFAULT_ROOM_ID).trim();
  return safeId.test(roomId) ? roomId : null;
}

export function normalizeSessionId(value) {
  const sessionId = String(value || "").trim();
  return safeId.test(sessionId) ? sessionId : null;
}

// targetId is the only optional combat intention in an input frame; arbitrary
// client objects never cross the input normalization boundary.
export function normalizeTargetId(value) {
  return typeof value === "string" && safeId.test(value) ? value : null;
}

export function validateHello(message, expectedRoomId = LAN_DEFAULT_ROOM_ID) {
  if (!message || message.type !== "hello") return { ok: false, reason: "Se requiere un saludo hello antes de enviar controles." };
  if (message.protocolVersion !== LAN_PROTOCOL_VERSION) return { ok: false, reason: `Versión de protocolo no compatible: se esperaba ${LAN_PROTOCOL_VERSION}.` };
  const roomId = normalizeRoomId(message.roomId);
  if (!roomId || roomId !== expectedRoomId) return { ok: false, reason: "La sala solicitada no está disponible." };
  const sessionId = normalizeSessionId(message.sessionId);
  if (!sessionId) return { ok: false, reason: "La sesión efímera no es válida." };
  // The access token is deliberately not normalized, logged, or reflected to
  // clients. It crosses this protocol boundary only so the hosted server can
  // verify it before assigning an online identity.
  const accessToken = typeof message.accessToken === "string" ? message.accessToken : null;
  return { ok: true, roomId, sessionId, name: normalizePilotName(message.name), accessToken };
}

export function parseAllowedOrigins(value) {
  return new Set(String(value || "").split(",").map(origin => origin.trim()).filter(Boolean));
}

export function isAllowedOrigin(origin, { port, host = "", configured = new Set() } = {}) {
  if (!origin) return true; // Node probes and same-process tools have no Origin.
  if (configured.size) return configured.has(origin);
  return origin === `http://localhost:${port}`
    || origin === `http://127.0.0.1:${port}`
    || Boolean(host && origin === `http://${host}`);
}

export function createClientHello({ sessionId, name = "PILOTO", roomId = LAN_DEFAULT_ROOM_ID } = {}) {
  return { type: "hello", protocolVersion: LAN_PROTOCOL_VERSION, roomId, sessionId, name: normalizePilotName(name) };
}
