export const SIGNAL_PROTOCOL_VERSION = 1;
export const SIGNAL_ROOM_TTL_MS = 15 * 60 * 1000;
export const SIGNAL_MAX_FRAME_BYTES = 20 * 1024;
export const SIGNAL_MAX_PAYLOAD_BYTES = 16 * 1024;
export const SIGNAL_SECRET_BYTES = 32;
export const SIGNAL_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Per-WebSocket relay budget. The small, persisted state lets a Durable Object
// hibernate without turning hibernation into a rate-limit reset.
export const SIGNAL_RATE_LIMIT_WINDOW_MS = 10 * 1000;
export const SIGNAL_RATE_LIMIT_MAX_MESSAGES = 32;

const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const ROOM_ID = /^(?:[A-Za-z0-9_-]{16,64}|[0-9A-HJKMNP-TV-Z]{10})$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const JOIN_KEYS = ["role", "secret", "type"];
const SIGNAL_KEYS = ["payload", "protocolVersion", "sequence", "type"];
const SAFE_FAILURE = Object.freeze({ ok: false, code: 1008, reason: "Invalid signaling message." });

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizeRoomId(value) {
  return typeof value === "string" && ROOM_ID.test(value) ? value : null;
}

export function normalizeRoomCode(value) {
  return typeof value === "string" && ROOM_CODE.test(value) ? value : null;
}

export function normalizeAllowedOrigins(value) {
  if (typeof value !== "string" || value.length === 0) return [];
  const origins = new Set();
  for (const part of value.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    try {
      const url = new URL(entry);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== entry || url.username || url.password) continue;
      origins.add(url.origin);
    } catch {
      // Invalid configuration entries are ignored; an empty effective list fails closed.
    }
  }
  return [...origins];
}

export function isAllowedOrigin(origin, configuredOrigins) {
  if (typeof origin !== "string" || origin === "null") return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== origin) return false;
  const allowlist = Array.isArray(configuredOrigins) ? configuredOrigins : normalizeAllowedOrigins(configuredOrigins);
  return allowlist.includes(origin);
}

export function createJoinMessage({ role, secret } = {}) {
  const normalized = normalizeJoinMessage({ type: "join", role, secret });
  if (!normalized) throw new TypeError("Invalid signaling join message.");
  return normalized;
}

export function normalizeJoinMessage(message) {
  if (!hasExactKeys(message, JOIN_KEYS) || message.type !== "join") return null;
  if (message.role !== "host" && message.role !== "guest") return null;
  if (typeof message.secret !== "string" || !SIGNAL_SECRET_PATTERN.test(message.secret)) return null;
  return { type: "join", role: message.role, secret: message.secret };
}

export function normalizeSignalMessage(message, { lastSequence = 0 } = {}) {
  if (!hasExactKeys(message, SIGNAL_KEYS) || message.type !== "signal") return null;
  if (message.protocolVersion !== SIGNAL_PROTOCOL_VERSION) return null;
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 1 || message.sequence <= lastSequence) return null;
  if (typeof message.payload !== "string" || utf8Bytes(message.payload) > SIGNAL_MAX_PAYLOAD_BYTES) return null;
  try {
    JSON.parse(message.payload);
  } catch {
    return null;
  }
  return {
    type: "signal",
    protocolVersion: SIGNAL_PROTOCOL_VERSION,
    sequence: message.sequence,
    payload: message.payload,
  };
}

export function decodeSignalFrame(serialized, { lastSequence = 0 } = {}) {
  if (typeof serialized !== "string" || utf8Bytes(serialized) > SIGNAL_MAX_FRAME_BYTES) return null;
  let message;
  try {
    message = JSON.parse(serialized);
  } catch {
    return null;
  }
  return normalizeSignalMessage(message, { lastSequence });
}

export function normalizeRoomRecord(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["roomId", "hostHash", "guestHash", "expiresAt"])) return null;
  if (!normalizeRoomId(value.roomId) || typeof value.hostHash !== "string" || !HEX_SHA256.test(value.hostHash)) return null;
  if (typeof value.guestHash !== "string" || !HEX_SHA256.test(value.guestHash)) return null;
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1) return null;
  return { roomId: value.roomId, hostHash: value.hostHash, guestHash: value.guestHash, expiresAt: value.expiresAt };
}

export function safePeerNotice(type) {
  if (type !== "host-left" && type !== "guest-left") throw new TypeError("Invalid signaling notice.");
  return JSON.stringify({ type, protocolVersion: SIGNAL_PROTOCOL_VERSION });
}

function safePeerReady(role) {
  if (role !== "host" && role !== "guest") throw new TypeError("Invalid signaling peer role.");
  return JSON.stringify({ type: "peer-ready", protocolVersion: SIGNAL_PROTOCOL_VERSION, role });
}

export class SignalRoomCore {
  constructor({ room, now = () => Date.now(), digestSecret }) {
    const normalizedRoom = normalizeRoomRecord(room);
    if (!normalizedRoom || typeof digestSecret !== "function") throw new TypeError("Invalid signaling room configuration.");
    this.room = normalizedRoom;
    this.now = now;
    this.digestSecret = digestSecret;
    this.peers = new Map();
  }

  rehydrate(peerAttachments) {
    this.peers.clear();
    for (const peer of peerAttachments) {
      if (!peer || peer.id === null || peer.id === undefined || !isRecord(peer.attachment)) continue;
      const { role, lastSequence = 0 } = peer.attachment;
      if ((role !== "host" && role !== "guest") || !Number.isSafeInteger(lastSequence) || lastSequence < 0) continue;
      if (this.peers.has(role)) continue;
      this.peers.set(role, { id: peer.id, role, lastSequence, ...readRateLimitState(peer.attachment, this.now()) });
    }
    return this;
  }

  async join(peerId, serializedJoin, refreshPeers) {
    if (this.now() >= this.room.expiresAt) return { ok: false, code: 1008, reason: "Room expired." };
    if (peerId === null || peerId === undefined) return SAFE_FAILURE;
    const parsed = parseBoundedJson(serializedJoin, 1024);
    const join = parsed && normalizeJoinMessage(parsed);
    if (!join) return SAFE_FAILURE;
    if ([...this.peers.values()].some((peer) => peer.id === peerId)) return SAFE_FAILURE;
    if (this.peers.has(join.role)) return { ok: false, code: 1008, reason: "Role already connected." };
    if (this.peers.size >= 2) return { ok: false, code: 1008, reason: "Room full." };
    const expectedHash = join.role === "host" ? this.room.hostHash : this.room.guestHash;
    let providedHash;
    try {
      providedHash = await this.digestSecret(join.secret);
    } catch {
      return SAFE_FAILURE;
    }
    if (typeof providedHash !== "string" || !constantTimeStringEqual(providedHash, expectedHash)) return SAFE_FAILURE;
    if (typeof refreshPeers === "function") this.rehydrate(refreshPeers());
    if ([...this.peers.values()].some((peer) => peer.id === peerId) || this.peers.has(join.role) || this.peers.size >= 2) {
      return { ok: false, code: 1008, reason: this.peers.has(join.role) ? "Role already connected." : "Room full." };
    }
    const attachment = { role: join.role, lastSequence: 0 };
    this.peers.set(join.role, { id: peerId, ...attachment });
    const otherPeer = [...this.peers.values()].find((peer) => peer.role !== join.role);
    const notices = otherPeer
      ? [
        { recipientId: peerId, serialized: safePeerReady(otherPeer.role) },
        { recipientId: otherPeer.id, serialized: safePeerReady(join.role) },
      ]
      : [];
    return { ok: true, attachment, notices };
  }

  relay(peerId, serializedFrame) {
    const now = this.now();
    if (now >= this.room.expiresAt) return { ok: false, code: 1008, reason: "Room expired." };
    const sender = [...this.peers.values()].find((peer) => peer.id === peerId);
    if (!sender) return SAFE_FAILURE;
    const frame = decodeSignalFrame(serializedFrame, { lastSequence: sender.lastSequence });
    if (!frame) return SAFE_FAILURE;
    const receiver = [...this.peers.values()].find((peer) => peer.id !== peerId);
    if (!receiver) return { ok: false, code: 1008, reason: "Peer unavailable." };
    const rateLimit = takeRateLimitSlot(sender, now);
    if (!rateLimit.ok) return { ok: false, code: 1008, reason: "Signaling rate limit exceeded." };
    sender.lastSequence = frame.sequence;
    sender.rateWindowStartedAt = rateLimit.rateWindowStartedAt;
    sender.rateWindowCount = rateLimit.rateWindowCount;
    return {
      ok: true,
      recipientId: receiver.id,
      serialized: JSON.stringify(frame),
      senderAttachment: {
        role: sender.role,
        lastSequence: sender.lastSequence,
        rateWindowStartedAt: sender.rateWindowStartedAt,
        rateWindowCount: sender.rateWindowCount,
      },
    };
  }

  disconnect(peerId, attachment) {
    if (attachment && (attachment.role === "host" || attachment.role === "guest")
      && !this.peers.has(attachment.role)) {
      this.peers.set(attachment.role, { id: peerId, role: attachment.role, lastSequence: attachment.lastSequence ?? 0 });
    }
    const peer = [...this.peers.values()].find((entry) => entry.id === peerId);
    if (!peer) return { notices: [], closeIds: [] };
    this.peers.delete(peer.role);
    const remaining = [...this.peers.values()];
    if (peer.role === "host") {
      return { notices: remaining.map((entry) => ({ recipientId: entry.id, serialized: safePeerNotice("host-left") })), closeIds: remaining.map((entry) => entry.id) };
    }
    return { notices: remaining.map((entry) => ({ recipientId: entry.id, serialized: safePeerNotice("guest-left") })), closeIds: [] };
  }
}

function readRateLimitState(attachment, now) {
  const hasStart = Object.hasOwn(attachment, "rateWindowStartedAt");
  const hasCount = Object.hasOwn(attachment, "rateWindowCount");
  // Attachments written before ONLINE-SECURITY-09A have no quota state.
  if (!hasStart && !hasCount) return { rateWindowStartedAt: null, rateWindowCount: 0 };
  if (Number.isSafeInteger(attachment.rateWindowStartedAt) && attachment.rateWindowStartedAt >= 0
    && Number.isSafeInteger(attachment.rateWindowCount) && attachment.rateWindowCount >= 0
    && attachment.rateWindowCount <= SIGNAL_RATE_LIMIT_MAX_MESSAGES) {
    return { rateWindowStartedAt: attachment.rateWindowStartedAt, rateWindowCount: attachment.rateWindowCount };
  }
  // A malformed persisted quota must not become a bypass after hibernation.
  return { rateWindowStartedAt: now, rateWindowCount: SIGNAL_RATE_LIMIT_MAX_MESSAGES };
}

function takeRateLimitSlot(sender, now) {
  let rateWindowStartedAt = sender.rateWindowStartedAt;
  let rateWindowCount = sender.rateWindowCount;
  if (!Number.isSafeInteger(rateWindowStartedAt) || rateWindowStartedAt < 0
    || !Number.isSafeInteger(rateWindowCount) || rateWindowCount < 0) {
    rateWindowStartedAt = now;
    rateWindowCount = 0;
  }
  if (rateWindowStartedAt === null || now - rateWindowStartedAt >= SIGNAL_RATE_LIMIT_WINDOW_MS) {
    rateWindowStartedAt = now;
    rateWindowCount = 0;
  }
  if (rateWindowCount >= SIGNAL_RATE_LIMIT_MAX_MESSAGES) return { ok: false };
  return { ok: true, rateWindowStartedAt, rateWindowCount: rateWindowCount + 1 };
}

function parseBoundedJson(serialized, maxBytes) {
  if (typeof serialized !== "string" || utf8Bytes(serialized) > maxBytes) return null;
  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function constantTimeStringEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function normalizeWebSocketRequest({ method, pathname, origin, allowedOrigins }) {
  if (!isAllowedOrigin(origin, allowedOrigins)) return { ok: false, status: 403, reason: "Origin not allowed." };
  if (method !== "GET") return { ok: false, status: 405, reason: "Method not allowed." };
  const match = typeof pathname === "string" && pathname.match(/^\/v1\/rooms\/([A-Za-z0-9_-]{16,64}|[0-9A-HJKMNP-TV-Z]{10})\/signal$/);
  if (!match || !normalizeRoomId(match[1])) return { ok: false, status: 404, reason: "Not found." };
  return { ok: true, roomId: match[1] };
}

export function normalizeCorsPreflight({ method, pathname, search = "", origin, requestMethod, requestHeaders, allowedOrigins }) {
  if (!isAllowedOrigin(origin, allowedOrigins)) return { ok: false, status: 403, reason: "Origin not allowed." };
  if (method !== "OPTIONS") return { ok: false, status: 405, reason: "Method not allowed." };
  if ((pathname !== "/v1/rooms" && pathname !== "/v1/rooms/join") || search !== "") return { ok: false, status: 404, reason: "Not found." };
  if (requestMethod !== "POST") return { ok: false, status: 405, reason: "Method not allowed." };
  const requested = typeof requestHeaders === "string" && requestHeaders.trim()
    ? requestHeaders.split(",").map((header) => header.trim().toLowerCase()).filter(Boolean)
    : [];
  if (requested.some((header) => header !== "content-type")) return { ok: false, status: 400, reason: "Headers not allowed." };
  return { ok: true, origin, methods: "POST", headers: "Content-Type" };
}

export const SIGNAL_SAFE_FAILURE = SAFE_FAILURE;
