import {
  isAllowedOrigin,
  normalizeAllowedOrigins,
  normalizeCorsPreflight,
  normalizeRoomCode,
  normalizeRoomId,
  normalizeWebSocketRequest,
  SIGNAL_ROOM_TTL_MS,
  SIGNAL_SECRET_PATTERN,
  SignalRoomCore,
} from "../src/p2p-signaling-protocol.js";
import {
  P2P_MULTI_MAX_GUEST_SLOTS,
  P2P_MULTI_MAX_PLAYERS,
  P2P_MULTI_PARTICIPANT_GRACE_MS,
  P2P_MULTI_ROOM_RETENTION_MS,
  P2PMultiPeerSignalRoomCore,
  normalizeP2PMultiRoomRecord,
} from "../src/p2p-multiparty-signaling.js";
import { isP2PMatchMode, p2pMatchPlayerRange } from "../src/p2p-room-config.js";

const INTERNAL_CREATE_PATH = "/_internal/create";
const INTERNAL_CREATE_KEYS = ["expiresAt", "guestHash", "hostHash", "roomId"];
const INTERNAL_REDEEM_PATH = "/_internal/redeem-guest";
const INTERNAL_REDEEM_KEYS = ["guestHash", "reservationUntil", "roomCode"];
const MULTI_INTERNAL_CREATE_PATH = "/_internal/create-multi";
const MULTI_INTERNAL_CREATE_KEYS = ["expiresAt", "guestHashes", "hostHash", "maxPlayers", "mode", "roomId"];
const MULTI_INTERNAL_REDEEM_PATH = "/_internal/redeem-guest";
const MULTI_INTERNAL_CONFIGURE_PATH = "/_internal/configure";
const MULTI_INTERNAL_REDEEM_KEYS = ["guestHash", "mode", "participantId", "reservationUntil", "roomCode", "ticketHash"];
const MULTI_INTERNAL_REDEEM_LEGACY_KEYS = ["guestHash", "mode", "reservationUntil", "roomCode"];
const MULTI_INTERNAL_CONFIGURE_KEYS = ["hostHash", "maxPlayers", "mode", "roomCode"];
const MULTI_CONFIGURE_KEYS = ["hostSecret", "maxPlayers", "mode", "roomCode"];
const MULTI_PARTICIPANT_ID = /^[A-Za-z0-9_-]{16,64}$/u;

function validPersistentRoomCapacity(mode, maxPlayers) {
  const range = p2pMatchPlayerRange(mode);
  return Boolean(range && Number.isSafeInteger(maxPlayers)
    && ((maxPlayers >= range.min && maxPlayers <= range.max) || maxPlayers === P2P_MULTI_MAX_PLAYERS));
}

function validPersistentRoomConfiguration(mode, maxPlayers) {
  return mode === null
    ? maxPlayers === P2P_MULTI_MAX_PLAYERS
    : validPersistentRoomCapacity(mode, maxPlayers);
}

function jsonResponse(body, status, origin) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function corsPreflightResponse(result) {
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
  if (result.ok) {
    headers.set("access-control-allow-origin", result.origin);
    headers.set("access-control-allow-methods", result.methods);
    if (result.headers) headers.set("access-control-allow-headers", result.headers);
  }
  return new Response(result.ok ? null : result.reason, { status: result.ok ? 204 : result.status, headers });
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function randomHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function randomHash() {
  return randomHex(crypto.getRandomValues(new Uint8Array(32)));
}

const ROOM_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomRoomCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => ROOM_CODE_ALPHABET[value & 31]).join("");
}

function sha256Hex(value) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then(randomHex);
}

function getAllowedOrigins(env) {
  return normalizeAllowedOrigins(env?.ALLOWED_ORIGINS);
}

async function createRoom(request, env, origin) {
  const roomCode = randomRoomCode();
  // The room code is a public routing identifier, not a credential. The
  // independent 256-bit secret remains mandatory in the WebSocket join frame.
  const roomId = roomCode;
  const hostSecret = randomBase64Url(32);
  const guestSecret = randomBase64Url(32);
  const expiresAt = Date.now() + SIGNAL_ROOM_TTL_MS;
  const [hostHash, guestHash] = await Promise.all([sha256Hex(hostSecret), sha256Hex(guestSecret)]);
  const stub = env.ARSENAL_SIGNAL_ROOM.get(env.ARSENAL_SIGNAL_ROOM.idFromName(roomId));
  const internal = new Request(`https://signal-room.internal${INTERNAL_CREATE_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, hostHash, guestHash, expiresAt }),
  });
  const result = await stub.fetch(internal);
  if (!result.ok) return jsonResponse({ error: "Room creation failed." }, 503, origin);
  return jsonResponse({ roomCode, roomId, hostSecret, guestSecret, expiresAt }, 201, origin);
}

async function joinRoomByCode(request, env, origin) {
  const size = Number(request.headers.get("content-length"));
  if (Number.isFinite(size) && size > 1024) return jsonResponse({ error: "Invalid room code." }, 400, origin);
  let input;
  try { input = await request.json(); } catch { return jsonResponse({ error: "Invalid room code." }, 400, origin); }
  if (!isExactObject(input, ["roomCode"])) return jsonResponse({ error: "Invalid room code." }, 400, origin);
  const roomCode = normalizeRoomCode(input.roomCode);
  if (!roomCode) return jsonResponse({ error: "Invalid room code." }, 400, origin);
  if (!env?.ARSENAL_SIGNAL_ROOM) return jsonResponse({ error: "Signaling unavailable." }, 503, origin);

  const guestSecret = randomBase64Url(32);
  const guestHash = await sha256Hex(guestSecret);
  const reservationUntil = Date.now() + 45_000;
  const stub = env.ARSENAL_SIGNAL_ROOM.get(env.ARSENAL_SIGNAL_ROOM.idFromName(roomCode));
  const internal = new Request(`https://signal-room.internal${INTERNAL_REDEEM_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode, guestHash, reservationUntil }),
  });
  const result = await stub.fetch(internal);
  if (!result.ok) {
    if (result.status === 409) return jsonResponse({ error: "La sala ya tiene un rival conectado. Espera a que quede libre." }, 409, origin);
    if (result.status === 410) return jsonResponse({ error: "La sala ha caducado." }, 410, origin);
    return jsonResponse({ error: "No se encontró una sala activa con esa clave." }, 404, origin);
  }
  let room;
  try { room = await result.json(); } catch { return jsonResponse({ error: "No se pudo preparar la sala." }, 503, origin); }
  if (!isExactObject(room, ["expiresAt", "roomId"]) || room.roomId !== roomCode
    || !Number.isSafeInteger(room.expiresAt) || room.expiresAt <= Date.now()) {
    return jsonResponse({ error: "No se pudo preparar la sala." }, 503, origin);
  }
  return jsonResponse({ roomCode, roomId: room.roomId, guestSecret, expiresAt: room.expiresAt }, 200, origin);
}

async function joinMultiRoomByCode(request, env, origin) {
  const size = Number(request.headers.get("content-length"));
  if (Number.isFinite(size) && size > 1024) return jsonResponse({ error: "Invalid multi-party room code." }, 400, origin);
  let input;
  try { input = await request.json(); } catch { return jsonResponse({ error: "Invalid multi-party room code." }, 400, origin); }
  const freshKeys = ["roomCode"];
  const freshWithModeKeys = ["mode", "roomCode"];
  const persistentKeys = ["persistent", "roomCode"];
  const persistentWithModeKeys = ["mode", "persistent", "roomCode"];
  const rejoinKeys = ["participantId", "reconnectToken", "roomCode"];
  const rejoinWithModeKeys = ["mode", "participantId", "reconnectToken", "roomCode"];
  if (!isExactObject(input, freshKeys) && !isExactObject(input, freshWithModeKeys)
    && !isExactObject(input, persistentKeys) && !isExactObject(input, persistentWithModeKeys)
    && !isExactObject(input, rejoinKeys) && !isExactObject(input, rejoinWithModeKeys)) return jsonResponse({ error: "Invalid multi-party room code." }, 400, origin);
  const roomCode = normalizeRoomCode(input.roomCode);
  const mode = input.mode === undefined ? null : input.mode;
  if (!roomCode || (mode !== null && !isP2PMatchMode(mode))) return jsonResponse({ error: "Invalid multi-party room code." }, 400, origin);
  const rejoining = input.participantId !== undefined || input.reconnectToken !== undefined;
  const wantsTicket = rejoining || input.persistent === true;
  if (input.persistent !== undefined && input.persistent !== true) return jsonResponse({ error: "Invalid multi-party room code." }, 400, origin);
  const participantId = wantsTicket ? (rejoining ? input.participantId : randomBase64Url(16)) : null;
  const reconnectToken = wantsTicket ? (rejoining ? input.reconnectToken : randomBase64Url(32)) : null;
  if (wantsTicket && (typeof participantId !== "string" || !MULTI_PARTICIPANT_ID.test(participantId)
    || typeof reconnectToken !== "string" || !SIGNAL_SECRET_PATTERN.test(reconnectToken))) return jsonResponse({ error: "Invalid multi-party room code." }, 400, origin);
  if (!env?.ARSENAL_MULTI_SIGNAL_ROOM) return jsonResponse({ error: "Signaling unavailable." }, 503, origin);

  const guestSecret = randomBase64Url(32);
  const guestHash = await sha256Hex(guestSecret);
  const ticketHash = wantsTicket ? await sha256Hex(reconnectToken) : null;
  const reservationUntil = Date.now() + 45_000;
  const stub = env.ARSENAL_MULTI_SIGNAL_ROOM.get(env.ARSENAL_MULTI_SIGNAL_ROOM.idFromName(roomCode));
  const internal = new Request(`https://signal-room.internal${MULTI_INTERNAL_REDEEM_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode, guestHash, mode, reservationUntil, ...(wantsTicket ? { participantId, ticketHash } : {}) }),
  });
  const result = await stub.fetch(internal);
  if (!result.ok) {
    if (result.status === 409) return jsonResponse({ error: "La sala está llena o el modo no coincide." }, 409, origin);
    if (result.status === 410) return jsonResponse({ error: "La sala ha caducado." }, 410, origin);
    return jsonResponse({ error: "No se encontró una sala activa con esa clave." }, 404, origin);
  }
  let room;
  try { room = await result.json(); } catch { return jsonResponse({ error: "No se pudo preparar la sala." }, 503, origin); }
  if ((!isExactObject(room, ["expiresAt", "maxPlayers", "mode", "roomId", "slot"]) && !isExactObject(room, ["expiresAt", "maxPlayers", "mode", "roomId", "phase", "slot"]))
    || room.roomId !== roomCode || (room.mode !== null && !isP2PMatchMode(room.mode)) || !Number.isSafeInteger(room.maxPlayers)
    || !Number.isSafeInteger(room.slot) || room.slot < 1 || room.slot >= room.maxPlayers
    || !Number.isSafeInteger(room.expiresAt) || room.expiresAt <= Date.now()) {
    return jsonResponse({ error: "No se pudo preparar la sala." }, 503, origin);
  }
  return jsonResponse({ roomCode, roomId: room.roomId, guestSecret, ...(wantsTicket ? { participantId, reconnectToken } : {}), slot: room.slot, expiresAt: room.expiresAt, mode: room.mode, maxPlayers: room.maxPlayers, ...(room.mode === null ? { phase: "room-open" } : {}) }, 200, origin);
}

function normalizeMultiCreateRequest(value) {
  if (isExactObject(value, [])) return { mode: null, maxPlayers: 6 };
  if (!isExactObject(value, ["mode", "maxPlayers"]) || !isP2PMatchMode(value.mode) || !Number.isSafeInteger(value.maxPlayers)) return null;
  const range = p2pMatchPlayerRange(value.mode);
  if (!range || value.maxPlayers < range.min || value.maxPlayers > range.max) return null;
  return { mode: value.mode, maxPlayers: value.maxPlayers };
}

async function configureMultiRoom(request, env, origin) {
  const size = Number(request.headers.get("content-length"));
  if (Number.isFinite(size) && size > 2048) return jsonResponse({ error: "Invalid multi-party room configuration." }, 400, origin);
  let input;
  try { input = await request.json(); } catch { return jsonResponse({ error: "Invalid multi-party room configuration." }, 400, origin); }
  if (!isExactObject(input, MULTI_CONFIGURE_KEYS) || !normalizeRoomCode(input.roomCode)
    || typeof input.hostSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(input.hostSecret) || !validPersistentRoomConfiguration(input.mode, input.maxPlayers)) return jsonResponse({ error: "Invalid multi-party room configuration." }, 400, origin);
  if (!env?.ARSENAL_MULTI_SIGNAL_ROOM) return jsonResponse({ error: "Signaling unavailable." }, 503, origin);
  const hostHash = await sha256Hex(input.hostSecret);
  const stub = env.ARSENAL_MULTI_SIGNAL_ROOM.get(env.ARSENAL_MULTI_SIGNAL_ROOM.idFromName(input.roomCode));
  const internal = new Request(`https://signal-room.internal${MULTI_INTERNAL_CONFIGURE_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomCode: input.roomCode, hostHash, mode: input.mode, maxPlayers: input.maxPlayers }) });
  const result = await stub.fetch(internal);
  if (!result.ok) {
    if (result.status === 403) return jsonResponse({ error: "Solo el host actual puede configurar la sala." }, 403, origin);
    if (result.status === 409) return jsonResponse({ error: "El modo no admite a los pilotos que ya están en la sala." }, 409, origin);
    if (result.status === 410) return jsonResponse({ error: "La sala ha caducado." }, 410, origin);
    if (result.status === 404) return jsonResponse({ error: "No se encontró una sala activa con esa clave." }, 404, origin);
    return jsonResponse({ error: "No se pudo configurar la sala." }, 503, origin);
  }
  let room; try { room = await result.json(); } catch { return jsonResponse({ error: "Respuesta de configuración no válida." }, 503, origin); }
  if (!room || room.roomId !== input.roomCode || room.mode !== input.mode || room.maxPlayers !== input.maxPlayers) return jsonResponse({ error: "Respuesta de configuración no válida." }, 503, origin);
  return jsonResponse({ roomCode: input.roomCode, roomId: room.roomId, expiresAt: room.expiresAt, mode: room.mode, maxPlayers: room.maxPlayers, phase: room.mode === null ? "room-open" : "team-selection" }, 200, origin);
}

function normalizeMultiWebSocketRequest({ method, pathname, origin, allowedOrigins }) {
  if (!isAllowedOrigin(origin, allowedOrigins)) return { ok: false, status: 403, reason: "Origin not allowed." };
  if (method !== "GET") return { ok: false, status: 405, reason: "Method not allowed." };
  const match = typeof pathname === "string" && pathname.match(/^\/v2\/rooms\/([A-Za-z0-9_-]{16,64}|[0-9A-HJKMNP-TV-Z]{10})\/signal$/u);
  if (!match || !normalizeRoomId(match[1])) return { ok: false, status: 404, reason: "Not found." };
  return { ok: true, roomId: match[1] };
}

function normalizeMultiCorsPreflight({ method, pathname, search = "", origin, requestMethod, requestHeaders, allowedOrigins }) {
  if (!isAllowedOrigin(origin, allowedOrigins)) return { ok: false, status: 403, reason: "Origin not allowed." };
  if (method !== "OPTIONS") return { ok: false, status: 405, reason: "Method not allowed." };
  if (!((pathname === "/v2/rooms" || pathname === "/v2/rooms/join" || pathname === "/v2/rooms/configure") && search === "")) return { ok: false, status: 404, reason: "Not found." };
  if (requestMethod !== "POST") return { ok: false, status: 405, reason: "Method not allowed." };
  const requested = typeof requestHeaders === "string" && requestHeaders.trim()
    ? requestHeaders.split(",").map(header => header.trim().toLowerCase()).filter(Boolean)
    : [];
  if (requested.some(header => header !== "content-type")) return { ok: false, status: 400, reason: "Headers not allowed." };
  return { ok: true, origin, methods: "POST", headers: "Content-Type" };
}

async function createMultiRoom(request, env, origin) {
  const size = Number(request.headers.get("content-length"));
  if (Number.isFinite(size) && size > 1024) return jsonResponse({ error: "Invalid multi-party room request." }, 400, origin);
  let input;
  try { input = await request.json(); } catch { return jsonResponse({ error: "Invalid multi-party room request." }, 400, origin); }
  const requested = normalizeMultiCreateRequest(input);
  if (!requested || !env?.ARSENAL_MULTI_SIGNAL_ROOM) return jsonResponse({ error: requested ? "Signaling unavailable." : "Invalid multi-party room request." }, requested ? 503 : 400, origin);
  // v2 uses the short Crockford code as its Durable Object name and as the
  // public routing identifier. Secrets remain independent credentials.
  const roomId = randomRoomCode();
  const hostSecret = randomBase64Url(32);
  const guestSecrets = Array.from({ length: requested.maxPlayers - 1 }, () => randomBase64Url(32));
  const [hostHash, ...guestHashes] = await Promise.all([sha256Hex(hostSecret), ...guestSecrets.map(sha256Hex)]);
  const expiresAt = Date.now() + P2P_MULTI_ROOM_RETENTION_MS;
  const stub = env.ARSENAL_MULTI_SIGNAL_ROOM.get(env.ARSENAL_MULTI_SIGNAL_ROOM.idFromName(roomId));
  const internal = new Request(`https://signal-room.internal${MULTI_INTERNAL_CREATE_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, hostHash, guestHashes, expiresAt, mode: requested.mode, maxPlayers: requested.maxPlayers }),
  });
  const result = await stub.fetch(internal);
  if (!result.ok) return jsonResponse({ error: "Multi-party room creation failed." }, 503, origin);
  return jsonResponse({ roomCode: roomId, roomId, hostSecret, guestSecrets, expiresAt, mode: requested.mode, maxPlayers: requested.maxPlayers, ...(requested.mode === null ? { phase: "room-open" } : {}) }, 201, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const allowedOrigins = getAllowedOrigins(env);
    if (!isAllowedOrigin(origin, allowedOrigins)) return jsonResponse({ error: "Origin not allowed." }, 403);

    if (request.method === "OPTIONS") {
      if (url.pathname === "/v2/rooms" || url.pathname === "/v2/rooms/join" || url.pathname === "/v2/rooms/configure") {
        return corsPreflightResponse(normalizeMultiCorsPreflight({
          method: request.method, pathname: url.pathname, search: url.search, origin,
          requestMethod: request.headers.get("access-control-request-method"),
          requestHeaders: request.headers.get("access-control-request-headers"), allowedOrigins,
        }));
      }
      return corsPreflightResponse(normalizeCorsPreflight({
        method: request.method,
        pathname: url.pathname,
        search: url.search,
        origin,
        requestMethod: request.headers.get("access-control-request-method"),
        requestHeaders: request.headers.get("access-control-request-headers"),
        allowedOrigins,
      }));
    }

    if (request.method === "POST" && url.pathname === "/v2/rooms" && !url.search) {
      try { return await createMultiRoom(request, env, origin); }
      catch { return jsonResponse({ error: "Multi-party room creation failed." }, 503, origin); }
    }

    if (request.method === "POST" && url.pathname === "/v2/rooms/join" && !url.search) {
      try { return await joinMultiRoomByCode(request, env, origin); }
      catch { return jsonResponse({ error: "No se pudo resolver la clave multiusuario." }, 503, origin); }
    }

    if (request.method === "POST" && url.pathname === "/v2/rooms/configure" && !url.search) {
      try { return await configureMultiRoom(request, env, origin); }
      catch { return jsonResponse({ error: "No se pudo configurar la sala multiusuario." }, 503, origin); }
    }

    if (request.method === "POST" && url.pathname === "/v1/rooms" && !url.search) {
      if (!env?.ARSENAL_SIGNAL_ROOM) return jsonResponse({ error: "Signaling unavailable." }, 503, origin);
      try {
        return await createRoom(request, env, origin);
      } catch {
        return jsonResponse({ error: "Room creation failed." }, 503, origin);
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/rooms/join" && !url.search) {
      try { return await joinRoomByCode(request, env, origin); }
      catch { return jsonResponse({ error: "No se pudo resolver la clave de sala." }, 503, origin); }
    }

    const multiMatch = normalizeMultiWebSocketRequest({ method: request.method, pathname: url.pathname, origin, allowedOrigins });
    if (multiMatch.ok && !url.search) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonResponse({ error: "WebSocket upgrade required." }, 426, origin);
      if (!env?.ARSENAL_MULTI_SIGNAL_ROOM) return jsonResponse({ error: "Signaling unavailable." }, 503, origin);
      const stub = env.ARSENAL_MULTI_SIGNAL_ROOM.get(env.ARSENAL_MULTI_SIGNAL_ROOM.idFromName(multiMatch.roomId));
      return stub.fetch(request);
    }
    const match = normalizeWebSocketRequest({ method: request.method, pathname: url.pathname, origin, allowedOrigins });
    if (!match.ok || url.search) return jsonResponse({ error: match.ok ? "Unexpected query." : match.reason }, match.ok ? 400 : match.status, origin);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return jsonResponse({ error: "WebSocket upgrade required." }, 426, origin);
    if (!env?.ARSENAL_SIGNAL_ROOM) return jsonResponse({ error: "Signaling unavailable." }, 503, origin);
    const stub = env.ARSENAL_SIGNAL_ROOM.get(env.ARSENAL_SIGNAL_ROOM.idFromName(match.roomId));
    return stub.fetch(request);
  },
};

export class ArsenalSignalRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      room_id TEXT NOT NULL,
      host_hash TEXT NOT NULL,
      guest_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      guest_reservation_until INTEGER NOT NULL DEFAULT 0
    )`);
    // Existing deployed rooms keep their SQLite state across Worker uploads.
    // Add the short-lived guest-seat reservation without resetting them.
    try {
      const columns = ctx.storage.sql.exec("PRAGMA table_info(room)").toArray();
      if (!columns.some((column) => column.name === "guest_reservation_until")) {
        ctx.storage.sql.exec("ALTER TABLE room ADD COLUMN guest_reservation_until INTEGER NOT NULL DEFAULT 0");
      }
    } catch { /* New namespaces already have the field in CREATE TABLE. */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === INTERNAL_CREATE_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
      return this.createRoom(request);
    }
    if (url.pathname === INTERNAL_REDEEM_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
      return this.redeemGuest(request);
    }

    const origin = request.headers.get("origin");
    const allowlist = getAllowedOrigins(this.env);
    const match = normalizeWebSocketRequest({ method: request.method, pathname: url.pathname, origin, allowedOrigins: allowlist });
    if (!match.ok) return new Response(match.reason, { status: match.status });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket" || url.search) return new Response("WebSocket upgrade required.", { status: 426 });
    const room = this.readRoom();
    if (!room || room.roomId !== match.roomId) return new Response("Room unavailable.", { status: 404 });
    if (Date.now() >= room.expiresAt) return new Response("Room expired.", { status: 410 });

    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);
    this.ctx.acceptWebSocket(serverSocket);
    serverSocket.serializeAttachment({ role: null, lastSequence: 0 });
    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  async createRoom(request) {
    const size = Number(request.headers.get("content-length"));
    if (Number.isFinite(size) && size > 1024) return new Response("Invalid room request.", { status: 400 });
    let input;
    try {
      input = await request.json();
    } catch {
      return new Response("Invalid room request.", { status: 400 });
    }
    if (!isExactObject(input, INTERNAL_CREATE_KEYS) || !normalizeRoomId(input.roomId)) return new Response("Invalid room request.", { status: 400 });
    if (!validHash(input.hostHash) || !validHash(input.guestHash)) return new Response("Invalid room request.", { status: 400 });
    const now = Date.now();
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + SIGNAL_ROOM_TTL_MS + 5000) return new Response("Invalid room request.", { status: 400 });
    const existing = this.readRoom();
    if (existing) return new Response("Room already initialized.", { status: 409 });
    this.ctx.storage.sql.exec(
      "INSERT INTO room (singleton, room_id, host_hash, guest_hash, expires_at, guest_reservation_until) VALUES (1, ?, ?, ?, ?, 0)",
      input.roomId,
      input.hostHash,
      input.guestHash,
      input.expiresAt,
    );
    return new Response(null, { status: 201 });
  }

  async redeemGuest(request) {
    const size = Number(request.headers.get("content-length"));
    if (Number.isFinite(size) && size > 1024) return new Response("Invalid room code request.", { status: 400 });
    let input;
    try { input = await request.json(); } catch { return new Response("Invalid room code request.", { status: 400 }); }
    if (!isExactObject(input, INTERNAL_REDEEM_KEYS) || !normalizeRoomCode(input.roomCode)
      || input.roomCode !== normalizeRoomCode(input.roomCode) || !validHash(input.guestHash)) {
      return new Response("Invalid room code request.", { status: 400 });
    }
    const now = Date.now();
    if (!Number.isSafeInteger(input.reservationUntil) || input.reservationUntil <= now
      || input.reservationUntil > now + 50_000) return new Response("Invalid room code request.", { status: 400 });
    const room = this.readRoom();
    if (!room || room.roomId !== input.roomCode) return new Response("Room unavailable.", { status: 404 });
    if (now >= room.expiresAt) return new Response("Room expired.", { status: 410 });
    if (this.peers().some(({ attachment }) => attachment?.role === "guest")
      || room.guestReservationUntil > now) return new Response("Guest seat is occupied.", { status: 409 });
    this.ctx.storage.sql.exec(
      "UPDATE room SET guest_hash = ?, guest_reservation_until = ? WHERE singleton = 1 AND room_id = ? AND expires_at > ? AND guest_reservation_until <= ?",
      input.guestHash,
      input.reservationUntil,
      input.roomCode,
      now,
      now,
    );
    const updated = this.readRoom();
    if (!updated || updated.guestHash !== input.guestHash || updated.guestReservationUntil !== input.reservationUntil) {
      return new Response("Guest seat is occupied.", { status: 409 });
    }
    return new Response(JSON.stringify({ roomId: updated.roomId, expiresAt: updated.expiresAt }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  readRoom() {
    const rows = this.ctx.storage.sql.exec("SELECT room_id, host_hash, guest_hash, expires_at, guest_reservation_until FROM room WHERE singleton = 1").toArray();
    if (rows.length !== 1) return null;
    return {
      roomId: rows[0].room_id,
      hostHash: rows[0].host_hash,
      guestHash: rows[0].guest_hash,
      expiresAt: rows[0].expires_at,
      guestReservationUntil: Number.isSafeInteger(rows[0].guest_reservation_until) ? rows[0].guest_reservation_until : 0,
    };
  }

  peers() {
    return this.ctx.getWebSockets().map((socket) => ({ id: socket, attachment: socket.deserializeAttachment() }));
  }

  async webSocketMessage(socket, message) {
    const room = this.readRoom();
    if (!room || Date.now() >= room.expiresAt) return closeSocket(socket, 1008, "Room expired.");
    const attachment = socket.deserializeAttachment();
    const core = this.createCore(room);
    if (!attachment || (attachment.role !== "host" && attachment.role !== "guest")) {
      const serialized = messageToBoundedString(message, 1024);
      if (serialized === null) return closeSocket(socket, 1009, "Message too large.");
      const result = await core.join(socket, serialized, () => this.peers());
      if (!result.ok) return closeSocket(socket, result.code, result.reason);
      socket.serializeAttachment(result.attachment);
      if (result.attachment.role === "guest") {
        this.ctx.storage.sql.exec("UPDATE room SET guest_reservation_until = 0 WHERE singleton = 1");
      }
      const sockets = this.ctx.getWebSockets();
      for (const notice of result.notices) {
        const peer = sockets.find((candidate) => candidate === notice.recipientId);
        if (!peer) continue;
        try { peer.send(notice.serialized); } catch { /* Ready notices are best effort. */ }
      }
      return;
    }

    const serialized = messageToBoundedString(message, 20 * 1024);
    if (serialized === null) return closeSocket(socket, 1009, "Message too large.");
    const relayed = core.relay(socket, serialized);
    if (!relayed.ok) return closeSocket(socket, relayed.code, relayed.reason);
    socket.serializeAttachment(relayed.senderAttachment);
    const receiver = this.ctx.getWebSockets().find((candidate) => candidate === relayed.recipientId);
    if (!receiver) return closeSocket(socket, 1008, "Peer unavailable.");
    try {
      receiver.send(relayed.serialized);
    } catch {
      closeSocket(socket, 1011, "Relay failed.");
      closeSocket(receiver, 1011, "Relay failed.");
    }
  }

  webSocketClose(socket) {
    this.disconnect(socket);
  }

  webSocketError(socket) {
    this.disconnect(socket);
  }

  disconnect(socket) {
    const room = this.readRoom();
    if (!room) return;
    const core = this.createCore(room);
    const result = core.disconnect(socket, socket.deserializeAttachment());
    const sockets = this.ctx.getWebSockets();
    for (const notice of result.notices) {
      const peer = sockets.find((candidate) => candidate === notice.recipientId);
      if (!peer) continue;
      try { peer.send(notice.serialized); } catch { closeSocket(peer, 1011, "Relay failed."); }
    }
    for (const id of result.closeIds) {
      const peer = sockets.find((candidate) => candidate === id);
      if (peer) closeSocket(peer, 1000, "Host left.");
    }
  }

  createCore(room) {
    const { guestReservationUntil: _reservation, ...protocolRoom } = room;
    return new SignalRoomCore({ room: protocolRoom, digestSecret: sha256Hex }).rehydrate(this.peers());
  }
}

// v2 lives in its own Durable Object namespace so the working v1 pair is not
// migrated in place. Its only job is bounded signaling: RocketSim authority
// and all match traffic remain in the browser host and WebRTC data channels.
export class ArsenalMultiSignalRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS multi_room (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      room_id TEXT NOT NULL,
      host_hash TEXT NOT NULL,
      guest_hashes TEXT NOT NULL,
      guest_reservations TEXT NOT NULL DEFAULT '{}',
      guest_tickets TEXT NOT NULL DEFAULT '{}',
      expires_at INTEGER NOT NULL,
      mode TEXT NOT NULL,
      max_players INTEGER NOT NULL,
      host_epoch INTEGER NOT NULL DEFAULT 0
    )`);
    try {
      const columns = ctx.storage.sql.exec("PRAGMA table_info(multi_room)").toArray();
      if (!columns.some((column) => column.name === "guest_reservations")) {
        ctx.storage.sql.exec("ALTER TABLE multi_room ADD COLUMN guest_reservations TEXT NOT NULL DEFAULT '{}'");
      }
      if (!columns.some((column) => column.name === "host_epoch")) {
        ctx.storage.sql.exec("ALTER TABLE multi_room ADD COLUMN host_epoch INTEGER NOT NULL DEFAULT 0");
      }
      if (!columns.some((column) => column.name === "guest_tickets")) {
        ctx.storage.sql.exec("ALTER TABLE multi_room ADD COLUMN guest_tickets TEXT NOT NULL DEFAULT '{}'");
      }
    } catch { /* Existing test/runtime adapters may not expose PRAGMA. */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === MULTI_INTERNAL_CREATE_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
      return this.createRoom(request);
    }
    if (url.pathname === MULTI_INTERNAL_REDEEM_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
      return this.redeemGuest(request);
    }
    if (url.pathname === MULTI_INTERNAL_CONFIGURE_PATH) {
      if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
      return this.configureRoom(request);
    }
    const origin = request.headers.get("origin");
    const match = normalizeMultiWebSocketRequest({ method: request.method, pathname: url.pathname, origin, allowedOrigins: getAllowedOrigins(this.env) });
    if (!match.ok) return new Response(match.reason, { status: match.status });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket" || url.search) return new Response("WebSocket upgrade required.", { status: 426 });
    const room = this.readRoom();
    if (!room || room.roomId !== match.roomId) return new Response("Room unavailable.", { status: 404 });
    if (Date.now() >= room.expiresAt) return new Response("Room expired.", { status: 410 });
    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);
    this.ctx.acceptWebSocket(serverSocket);
    serverSocket.serializeAttachment({ role: null, slot: null, lastSequence: 0, rateWindowStartedAt: null, rateWindowCount: 0 });
    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  async createRoom(request) {
    const size = Number(request.headers.get("content-length"));
    if (Number.isFinite(size) && size > 2048) return new Response("Invalid multi-party room request.", { status: 400 });
    let input;
    try { input = await request.json(); } catch { return new Response("Invalid multi-party room request.", { status: 400 }); }
    if (!isExactObject(input, MULTI_INTERNAL_CREATE_KEYS)) return new Response("Invalid multi-party room request.", { status: 400 });
    const room = normalizeP2PMultiRoomRecord(input);
    const now = Date.now();
    if (!room || room.expiresAt <= now || room.expiresAt > now + P2P_MULTI_ROOM_RETENTION_MS + 5000) return new Response("Invalid multi-party room request.", { status: 400 });
    if (this.readRoom()) return new Response("Room already initialized.", { status: 409 });
    this.ctx.storage.sql.exec(
      "INSERT INTO multi_room (singleton, room_id, host_hash, guest_hashes, guest_reservations, guest_tickets, expires_at, mode, max_players, host_epoch) VALUES (1, ?, ?, ?, '{}', '{}', ?, ?, ?, 0)",
      room.roomId, room.hostHash, JSON.stringify(room.guestHashes), room.expiresAt, room.mode ?? "room-open", room.maxPlayers,
    );
    return new Response(null, { status: 201 });
  }

  async configureRoom(request) {
    const size = Number(request.headers.get("content-length"));
    if (Number.isFinite(size) && size > 2048) return new Response("Invalid multi-party room configuration.", { status: 400 });
    let input;
    try { input = await request.json(); } catch { return new Response("Invalid multi-party room configuration.", { status: 400 }); }
    if (!isExactObject(input, MULTI_INTERNAL_CONFIGURE_KEYS) || !normalizeRoomCode(input.roomCode) || input.roomCode !== normalizeRoomCode(input.roomCode)
      || !validHash(input.hostHash) || !validPersistentRoomConfiguration(input.mode, input.maxPlayers)) return new Response("Invalid multi-party room configuration.", { status: 400 });
    const now = Date.now();
    const room = this.readRoom();
    if (!room || room.roomId !== input.roomCode) return new Response("Room unavailable.", { status: 404 });
    if (now >= room.expiresAt) return new Response("Room expired.", { status: 410 });
    if (room.hostHash !== input.hostHash) return new Response("Host credentials rejected.", { status: 403 });
    const occupiedSlots = new Set(this.peers().filter(({ attachment }) => attachment?.role === "guest" && Number.isSafeInteger(attachment.slot)).map(({ attachment }) => attachment.slot));
    for (const slot of Object.keys(this.readReservations())) occupiedSlots.add(Number(slot));
    for (const ticket of Object.values(this.readGuestTickets())) if (ticket.until > now) occupiedSlots.add(ticket.slot);
    if ([...occupiedSlots].some(slot => slot >= input.maxPlayers)) return new Response("Mode capacity does not fit connected guests.", { status: 409 });
    // Keep all five persistent guest hashes. A waiting host may change mode or
    // capacity repeatedly; truncating here would make a later expansion lose
    // the stable credentials/slots of players who already joined.
    this.ctx.storage.sql.exec("UPDATE multi_room SET guest_hashes = ?, mode = ?, max_players = ? WHERE singleton = 1 AND room_id = ? AND host_hash = ?", JSON.stringify(room.guestHashes), input.mode ?? "room-open", input.maxPlayers, input.roomCode, input.hostHash);
    const updated = this.readRoom();
    if (!updated || updated.mode !== input.mode || updated.maxPlayers !== input.maxPlayers) return new Response("Room configuration failed.", { status: 503 });
    return new Response(JSON.stringify({ roomId: updated.roomId, expiresAt: updated.expiresAt, mode: updated.mode, maxPlayers: updated.maxPlayers }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }

  async redeemGuest(request) {
    const size = Number(request.headers.get("content-length"));
    if (Number.isFinite(size) && size > 2048) return new Response("Invalid multi-party room code request.", { status: 400 });
    let input;
    try { input = await request.json(); } catch { return new Response("Invalid multi-party room code request.", { status: 400 }); }
    const hasTicket = isExactObject(input, MULTI_INTERNAL_REDEEM_KEYS);
    if ((!hasTicket && !isExactObject(input, MULTI_INTERNAL_REDEEM_LEGACY_KEYS)) || !normalizeRoomCode(input.roomCode)
      || input.roomCode !== normalizeRoomCode(input.roomCode) || !validHash(input.guestHash)
      || (hasTicket && (typeof input.participantId !== "string" || !MULTI_PARTICIPANT_ID.test(input.participantId)
        || !validHash(input.ticketHash)))
      || (input.mode !== null && !isP2PMatchMode(input.mode))) return new Response("Invalid multi-party room code request.", { status: 400 });
    const now = Date.now();
    if (!Number.isSafeInteger(input.reservationUntil) || input.reservationUntil <= now
      || input.reservationUntil > now + 50_000) return new Response("Invalid multi-party room code request.", { status: 400 });
    const room = this.readRoom();
    if (!room || room.roomId !== input.roomCode) return new Response("Room unavailable.", { status: 404 });
    if (now >= room.expiresAt) return new Response("Room expired.", { status: 410 });
    if (input.mode !== null && input.mode !== room.mode) return new Response("Room mode mismatch.", { status: 409 });

    const peers = this.peers();
    const connectedSlots = new Set(peers.filter(({ attachment }) => attachment?.role === "guest").map(({ attachment }) => attachment.slot));
    const reservations = this.readReservations();
    const tickets = this.readGuestTickets();
    const existing = hasTicket ? tickets[input.participantId] : null;
    let slot = existing?.slot ?? null;
    if (existing) {
      const reservation = reservations[String(slot)];
      // A reconnect request can arrive while the previous WebSocket/ICE
      // attempt is still inside its short reservation window.  That
      // reservation belongs to the same participant, so rejecting it as
      // "full" makes a transient negotiation failure unrecoverable until the
      // 45-second lease expires.  Only a different participant may hold the
      // seat during the handoff.
      if (existing.ticketHash !== input.ticketHash || existing.until <= now
        || connectedSlots.has(slot)
        || (reservation && reservation.until > now && reservation.participantId !== input.participantId)) {
        return new Response("Guest seat is occupied.", { status: 409 });
      }
    } else {
      for (let candidate = 1; candidate < room.maxPlayers; candidate += 1) {
        const reservation = reservations[String(candidate)];
        const hasLiveTicket = Object.values(tickets).some(ticket => ticket.slot === candidate && ticket.until > now);
        if (connectedSlots.has(candidate) || (reservation && reservation.until > now) || hasLiveTicket) continue;
        slot = candidate;
        break;
      }
    }
    if (slot === null) return new Response("Guest seat is occupied.", { status: 409 });
    reservations[String(slot)] = { hash: input.guestHash, until: input.reservationUntil, ...(hasTicket ? { participantId: input.participantId } : {}) };
    // Promote the one-time credential into its deterministic seat before the
    // browser opens WebSocket. The short reservation still prevents a second
    // caller from receiving that seat during the WebRTC handoff; after a
    // successful socket join it is cleared, allowing an immediate replacement
    // if the player leaves before the match begins.
    const guestHashes = [...room.guestHashes];
    guestHashes[slot - 1] = input.guestHash;
    if (hasTicket) {
      tickets[input.participantId] = { slot, ticketHash: input.ticketHash, until: input.reservationUntil };
      this.writeGuestTickets(tickets);
    }
    this.ctx.storage.sql.exec("UPDATE multi_room SET guest_hashes = ?, guest_reservations = ? WHERE singleton = 1 AND room_id = ? AND expires_at > ?", JSON.stringify(guestHashes), JSON.stringify(reservations), input.roomCode, now);
    const updated = this.readRoom();
    const effective = updated && this.readReservations()[String(slot)];
    if (!updated || !effective || effective.hash !== input.guestHash || effective.until !== input.reservationUntil) {
      return new Response("Guest seat is occupied.", { status: 409 });
    }
    return new Response(JSON.stringify({ roomId: updated.roomId, expiresAt: updated.expiresAt, mode: updated.mode, maxPlayers: updated.maxPlayers, slot }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  readReservations() {
    const rows = this.ctx.storage.sql.exec("SELECT guest_reservations FROM multi_room WHERE singleton = 1").toArray();
    if (rows.length !== 1 || typeof rows[0].guest_reservations !== "string") return {};
    let parsed;
    try { parsed = JSON.parse(rows[0].guest_reservations); } catch { return {}; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([slot, reservation]) => /^\d+$/u.test(slot)
      && reservation && typeof reservation === "object" && validHash(reservation.hash)
      && Number.isSafeInteger(reservation.until)
      && (reservation.participantId === undefined || (typeof reservation.participantId === "string" && MULTI_PARTICIPANT_ID.test(reservation.participantId)))));
  }

  readGuestTickets() {
    const rows = this.ctx.storage.sql.exec("SELECT guest_tickets FROM multi_room WHERE singleton = 1").toArray();
    if (rows.length !== 1 || typeof rows[0].guest_tickets !== "string") return {};
    let parsed;
    try { parsed = JSON.parse(rows[0].guest_tickets); } catch { return {}; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([participantId, ticket]) => MULTI_PARTICIPANT_ID.test(participantId)
      && ticket && typeof ticket === "object" && Number.isSafeInteger(ticket.slot)
      && ticket.slot >= 1 && ticket.slot <= P2P_MULTI_MAX_GUEST_SLOTS
      && validHash(ticket.ticketHash) && Number.isSafeInteger(ticket.until) && ticket.until > now));
  }

  writeGuestTickets(tickets) {
    this.ctx.storage.sql.exec("UPDATE multi_room SET guest_tickets = ? WHERE singleton = 1", JSON.stringify(tickets));
  }

  clearGuestReservation(slot) {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > P2P_MULTI_MAX_GUEST_SLOTS) return;
    const reservations = this.readReservations();
    if (!Object.hasOwn(reservations, String(slot))) return;
    delete reservations[String(slot)];
    this.ctx.storage.sql.exec("UPDATE multi_room SET guest_reservations = ? WHERE singleton = 1", JSON.stringify(reservations));
  }

  activateGuestTicket(slot) {
    const room = this.readRoom();
    if (!room || !Number.isSafeInteger(slot)) return;
    const tickets = this.readGuestTickets();
    let changed = false;
    for (const ticket of Object.values(tickets)) {
      if (ticket.slot === slot && ticket.until !== room.expiresAt) { ticket.until = room.expiresAt; changed = true; }
    }
    if (changed) this.writeGuestTickets(tickets);
  }

  markGuestDisconnected(slot) {
    const room = this.readRoom();
    if (!room || !Number.isSafeInteger(slot)) return;
    const tickets = this.readGuestTickets();
    const until = Math.min(room.expiresAt, Date.now() + P2P_MULTI_PARTICIPANT_GRACE_MS);
    let changed = false;
    for (const ticket of Object.values(tickets)) {
      if (ticket.slot === slot && ticket.until !== until) { ticket.until = until; changed = true; }
    }
    if (changed) this.writeGuestTickets(tickets);
  }

  revokeGuestTicket(slot) {
    if (!Number.isSafeInteger(slot)) return;
    const tickets = this.readGuestTickets();
    let changed = false;
    for (const [participantId, ticket] of Object.entries(tickets)) {
      if (ticket.slot === slot) { delete tickets[participantId]; changed = true; }
    }
    if (changed) this.writeGuestTickets(tickets);
  }

  readRoom() {
    const rows = this.ctx.storage.sql.exec("SELECT room_id, host_hash, guest_hashes, guest_reservations, guest_tickets, expires_at, mode, max_players, host_epoch FROM multi_room WHERE singleton = 1").toArray();
    if (rows.length !== 1) return null;
    let guestHashes;
    try { guestHashes = JSON.parse(rows[0].guest_hashes); } catch { return null; }
    const reservations = this.readReservations();
    const now = Date.now();
    for (const [slot, reservation] of Object.entries(reservations)) {
      const index = Number(slot) - 1;
      if (reservation.until > now && index >= 0 && index < guestHashes.length) guestHashes[index] = reservation.hash;
    }
    const roomOpen = rows[0].mode === "room-open";
    const effectiveMaxPlayers = roomOpen ? P2P_MULTI_MAX_PLAYERS : rows[0].max_players;
    const normalized = normalizeP2PMultiRoomRecord({
      roomId: rows[0].room_id,
      hostHash: rows[0].host_hash,
      guestHashes,
      expiresAt: rows[0].expires_at,
      mode: roomOpen ? null : rows[0].mode,
      maxPlayers: effectiveMaxPlayers,
    });
    return normalized ? { ...normalized, hostEpoch: Number.isSafeInteger(rows[0].host_epoch) ? rows[0].host_epoch : 0 } : null;
  }

  peers() { return this.ctx.getWebSockets().map(socket => ({ id: socket, attachment: socket.deserializeAttachment() })); }

  async webSocketMessage(socket, message) {
    const room = this.readRoom();
    if (!room || Date.now() >= room.expiresAt) return closeSocket(socket, 1008, "Room expired.");
    const attachment = socket.deserializeAttachment();
    const core = this.createCore(room);
    if (!attachment || (attachment.role !== "host" && attachment.role !== "guest")) {
      const serialized = messageToBoundedString(message, 1024);
      if (serialized === null) return closeSocket(socket, 1009, "Message too large.");
      const result = await core.join(socket, serialized, () => this.peers());
      if (!result.ok) return closeSocket(socket, result.code, result.reason);
      socket.serializeAttachment(result.attachment);
      if (result.attachment.role === "guest") {
        this.clearGuestReservation(result.attachment.slot);
        this.activateGuestTicket(result.attachment.slot);
      }
      this.sendNotices(result.notices);
      return;
    }
    const serialized = messageToBoundedString(message, 20 * 1024);
    if (serialized === null) return closeSocket(socket, 1009, "Message too large.");
    const relayed = core.relay(socket, serialized);
    if (!relayed.ok) return closeSocket(socket, relayed.code, relayed.reason);
    socket.serializeAttachment(relayed.senderAttachment);
    const receiver = this.ctx.getWebSockets().find(candidate => candidate === relayed.recipientId);
    if (!receiver) return closeSocket(socket, 1008, "Peer unavailable.");
    try { receiver.send(relayed.serialized); }
    catch { closeSocket(socket, 1011, "Relay failed."); closeSocket(receiver, 1011, "Relay failed."); }
  }

  webSocketClose(socket) { this.disconnect(socket); }
  webSocketError(socket) { this.disconnect(socket); }

  disconnect(socket) {
    const room = this.readRoom();
    if (!room) return;
    const attachment = socket.deserializeAttachment();
    const result = this.createCore(room).disconnect(socket, attachment);
    if (attachment?.role === "guest" && Number.isSafeInteger(attachment.slot)) this.markGuestDisconnected(attachment.slot);
    if (result.promotedPeerId !== undefined && Number.isSafeInteger(result.promotedSlot) && validHash(result.promotedHostHash) && Number.isSafeInteger(result.hostEpoch)) {
      // The elected player's former guest credential becomes the host
      // credential. Replace the former guest-slot hash before it can be
      // redeemed again, so one secret cannot authenticate both roles.
      const guestHashes = [...room.guestHashes];
      guestHashes[result.promotedSlot - 1] = randomHash();
      this.ctx.storage.sql.exec("UPDATE multi_room SET host_hash = ?, guest_hashes = ?, host_epoch = ? WHERE singleton = 1 AND room_id = ?", result.promotedHostHash, JSON.stringify(guestHashes), result.hostEpoch, room.roomId);
      this.revokeGuestTicket(result.promotedSlot);
      const promoted = this.ctx.getWebSockets().find((candidate) => candidate === result.promotedPeerId);
      try { promoted?.serializeAttachment?.(result.promotedAttachment); } catch { /* The promoted socket may close concurrently. */ }
    }
    this.sendNotices(result.notices);
    const sockets = this.ctx.getWebSockets();
    for (const id of result.closeIds) {
      const peer = sockets.find(candidate => candidate === id);
      if (peer) closeSocket(peer, 1000, "Host left.");
    }
  }

  sendNotices(notices) {
    const sockets = this.ctx.getWebSockets();
    for (const notice of notices) {
      const peer = sockets.find(candidate => candidate === notice.recipientId);
      if (!peer) continue;
      try { peer.send(notice.serialized); } catch { closeSocket(peer, 1011, "Relay failed."); }
    }
  }

  createCore(room) {
    const { hostEpoch = 0, ...protocolRoom } = room;
    return new P2PMultiPeerSignalRoomCore({ room: protocolRoom, digestSecret: sha256Hex, enableHostFailover: true, hostEpoch }).rehydrate(this.peers());
  }
}

function isExactObject(value, expectedKeys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join("\0") === [...expectedKeys].sort().join("\0");
}

function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function messageToBoundedString(message, limit) {
  if (typeof message === "string") return new TextEncoder().encode(message).byteLength <= limit ? message : null;
  if (message instanceof ArrayBuffer) {
    if (message.byteLength > limit) return null;
    try { return new TextDecoder("utf-8", { fatal: true }).decode(message); } catch { return null; }
  }
  if (ArrayBuffer.isView(message)) {
    if (message.byteLength > limit) return null;
    try { return new TextDecoder("utf-8", { fatal: true }).decode(message); } catch { return null; }
  }
  return null;
}

function closeSocket(socket, code, reason) {
  try { socket.close(code, reason); } catch { /* The peer may already be gone. */ }
}
