import {
  SIGNAL_MAX_FRAME_BYTES,
  SIGNAL_MAX_PAYLOAD_BYTES,
  SIGNAL_SECRET_PATTERN,
  normalizeRoomId,
} from "./p2p-signaling-protocol.js";
import {
  P2P_MULTI_MAX_GUEST_SLOTS,
  P2P_MULTI_ROOM_RETENTION_MS,
  P2P_MULTI_SIGNAL_PROTOCOL_VERSION,
  createP2PMultiJoinMessage,
  createP2PMultiSignalFrame,
  normalizeP2PMultiSignalFrame,
} from "./p2p-multiparty-signaling.js";
import { isP2PMatchMode, normalizeSignalOrigin, P2P_SIGNAL_ORIGIN, p2pMatchPlayerRange } from "./p2p-room-config.js";

const RESPONSE_KEYS = ["roomId", "hostSecret", "guestSecrets", "expiresAt", "mode", "maxPlayers"];
const RESPONSE_KEYS_WITH_CODE = [...RESPONSE_KEYS, "roomCode"];
const RESPONSE_KEYS_WITH_PHASE = [...RESPONSE_KEYS_WITH_CODE, "phase"];
const encoder = new TextEncoder();

const MULTI_INVITE_PREFIX = "#p2pm=";
export const P2P_MULTI_ROOM_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/u;

function validPersistentRoomCapacity(mode, maxPlayers) {
  const range = p2pMatchPlayerRange(mode);
  return Boolean(range && Number.isSafeInteger(maxPlayers)
    && ((maxPlayers >= range.min && maxPlayers <= range.max) || maxPlayers === P2P_MULTI_MAX_GUEST_SLOTS + 1));
}

export function normalizeP2PMultiRoomCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase().replace(/[\s-]/gu, "");
  return P2P_MULTI_ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

function encodeInvite(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function decodeInvite(value) {
  try {
    const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + "===".slice((value.length + 3) % 4));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseRoom(value, now) {
  const roomCode = value?.roomCode === undefined ? value?.roomId : normalizeP2PMultiRoomCode(value?.roomCode);
  const hasPhase = exact(value, RESPONSE_KEYS_WITH_PHASE);
  const invalidConfiguredMode = value?.mode !== null && (!isP2PMatchMode(value?.mode) || !validPersistentRoomCapacity(value.mode, value.maxPlayers)
    || value?.guestSecrets?.length !== value.maxPlayers - 1
    || (hasPhase && value.phase !== "team-selection"));
  if ((!exact(value, RESPONSE_KEYS) && !exact(value, RESPONSE_KEYS_WITH_CODE) && !hasPhase)
    || !normalizeRoomId(value.roomId)
    || (value.roomCode !== undefined && (!roomCode || roomCode !== value.roomId))
    || typeof value.hostSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(value.hostSecret)
    || !Array.isArray(value.guestSecrets) || value.guestSecrets.length < 1 || value.guestSecrets.length > P2P_MULTI_MAX_GUEST_SLOTS
    || value.guestSecrets.some(secret => typeof secret !== "string" || !SIGNAL_SECRET_PATTERN.test(secret))
    || new Set(value.guestSecrets).size !== value.guestSecrets.length
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + P2P_MULTI_ROOM_RETENTION_MS + 5000
    || !Number.isSafeInteger(value.maxPlayers)
    || (value.mode === null ? (value.maxPlayers !== 6 || value.guestSecrets.length !== 5 || (hasPhase && value.phase !== "room-open")) : invalidConfiguredMode)) return null;
  return Object.freeze({ roomCode, roomId: value.roomId, hostSecret: value.hostSecret, guestSecrets: Object.freeze([...value.guestSecrets]), expiresAt: value.expiresAt, mode: value.mode, maxPlayers: value.maxPlayers, phase: value.mode === null ? "room-open" : "team-selection" });
}

function parseJoin(value, now) {
  const keys = ["roomCode", "roomId", "guestSecret", "participantId", "reconnectToken", "slot", "expiresAt", "mode", "maxPlayers"];
  const legacyKeys = ["roomCode", "roomId", "guestSecret", "slot", "expiresAt", "mode", "maxPlayers"];
  const keysWithPhase = [...keys, "phase"];
  const legacyKeysWithPhase = [...legacyKeys, "phase"];
  const hasTicketPhase = exact(value, keysWithPhase);
  const hasLegacyPhase = exact(value, legacyKeysWithPhase);
  const hasTicket = exact(value, keys) || hasTicketPhase;
  const hasPhase = hasTicketPhase || hasLegacyPhase;
  const invalidConfiguredMode = value?.mode !== null && (!isP2PMatchMode(value?.mode)
    || !validPersistentRoomCapacity(value.mode, value.maxPlayers)
    || (hasPhase && value.phase !== "team-selection"));
  if ((!hasTicket && !hasTicketPhase && !exact(value, legacyKeys) && !hasLegacyPhase) || !normalizeP2PMultiRoomCode(value.roomCode) || value.roomCode !== value.roomId
    || typeof value.guestSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(value.guestSecret)
    || (hasTicket && (typeof value.participantId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/u.test(value.participantId)
      || typeof value.reconnectToken !== "string" || !SIGNAL_SECRET_PATTERN.test(value.reconnectToken)))
    || !Number.isSafeInteger(value.slot) || value.slot < 1 || value.slot > P2P_MULTI_MAX_GUEST_SLOTS
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + P2P_MULTI_ROOM_RETENTION_MS + 5000
    || !Number.isSafeInteger(value.maxPlayers) || value.slot >= value.maxPlayers
    || (value.mode === null ? (value.maxPlayers !== 6 || (hasPhase && value.phase !== "room-open")) : invalidConfiguredMode)) return null;
  return Object.freeze({ roomCode: value.roomCode, roomId: value.roomId, guestSecret: value.guestSecret, participantId: (hasTicket || hasTicketPhase) ? value.participantId : null, reconnectToken: (hasTicket || hasTicketPhase) ? value.reconnectToken : null, slot: value.slot, expiresAt: value.expiresAt, mode: value.mode, maxPlayers: value.maxPlayers, phase: value.mode === null ? "room-open" : "team-selection" });
}

function safeError(code, message) { return Object.freeze({ code, message }); }
function roomRequestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** v2 signaling client. It carries only slot-routed WebRTC setup; gameplay remains P2P. */
export class P2PMultiSignalingClient {
  constructor({
    origin = P2P_SIGNAL_ORIGIN,
    fetch: fetchImpl = globalThis.fetch,
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    scheduler = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
    now = () => Date.now(),
  } = {}) {
    this.origin = normalizeSignalOrigin(origin);
    this.fetch = fetchImpl === globalThis.fetch && typeof fetchImpl === "function" ? fetchImpl.bind(globalThis) : fetchImpl;
    this.WebSocket = WebSocketImpl;
    this.scheduler = scheduler;
    this.now = now;
    this.listeners = new Map();
    this.socket = null;
    this.expiryTimer = null;
    this.closed = true;
    this.outgoingSequence = 0;
    // A host receives a distinct monotonic sequence from every guest socket.
    // A single global cursor made the first frame from slot 2+ look like a
    // replay after slot 1 had connected, preventing 2v2/3v3 stars from
    // completing their WebRTC negotiation.
    this.incomingSequences = new Map();
    this.credentials = null;
  }

  on(type, listener) {
    if (typeof listener !== "function") throw new TypeError("Listener must be a function.");
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  emit(type, detail = {}) {
    for (const listener of this.listeners.get(type) || []) {
      try { listener(detail); } catch { /* Consumers cannot break the signaling transport. */ }
    }
  }

  async createRoom({ mode = null, maxPlayers = null } = {}) {
    if (!this.origin || typeof this.fetch !== "function") throw new Error("La señalización multiusuario no está disponible.");
    let response;
    try {
      const body = mode === null ? {} : { mode, maxPlayers };
      response = await this.fetch(`${this.origin}/v2/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", redirect: "error", cache: "no-store" });
    } catch { throw new Error("No se pudo contactar con la señalización multiusuario."); }
    if (!response?.ok || response.status !== 201) throw new Error("El servicio no pudo crear la sala multiusuario.");
    let body;
    try { body = await response.json(); } catch { throw new Error("Respuesta de sala multiusuario no válida."); }
    const room = parseRoom(body, this.now());
    if (!room) throw new Error("Respuesta de sala multiusuario no válida.");
    return room;
  }

  async configureRoom({ roomCode, hostSecret, mode, maxPlayers } = {}) {
    const normalized = normalizeP2PMultiRoomCode(roomCode);
    if (!normalized || typeof hostSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(hostSecret) || !validPersistentRoomCapacity(mode, maxPlayers)) throw new TypeError("La configuración de la sala no es válida.");
    if (!this.origin || typeof this.fetch !== "function") throw new Error("La señalización multiusuario no está disponible.");
    let response;
    try {
      response = await this.fetch(`${this.origin}/v2/rooms/configure`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: normalized, hostSecret, mode, maxPlayers }), credentials: "omit", redirect: "error", cache: "no-store" });
    } catch { throw new Error("No se pudo contactar con la señalización multiusuario."); }
    if (!response?.ok || response.status !== 200) {
      if (response?.status === 409) throw new Error("El modo no admite a los pilotos que ya están en la sala.");
      if (response?.status === 410) throw roomRequestError("room-expired", "La sala ha caducado.");
      if (response?.status === 403) throw roomRequestError("room-not-owner", "Solo el host actual puede configurar la sala.");
      throw new Error("El servicio no pudo configurar la sala multiusuario.");
    }
    let body; try { body = await response.json(); } catch { throw new Error("Respuesta de configuración no válida."); }
    if (!body || body.roomCode !== normalized || body.mode !== mode || body.maxPlayers !== maxPlayers || body.phase !== "team-selection") throw new Error("Respuesta de configuración no válida.");
    return Object.freeze(body);
  }

  async resetRoom({ roomCode, hostSecret } = {}) {
    const normalized = normalizeP2PMultiRoomCode(roomCode);
    const maxPlayers = P2P_MULTI_MAX_GUEST_SLOTS + 1;
    if (!normalized || typeof hostSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(hostSecret)) throw new TypeError("La restauración de la sala no es válida.");
    if (!this.origin || typeof this.fetch !== "function") throw new Error("La señalización multiusuario no está disponible.");
    let response;
    try {
      response = await this.fetch(`${this.origin}/v2/rooms/configure`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: normalized, hostSecret, mode: null, maxPlayers }), credentials: "omit", redirect: "error", cache: "no-store" });
    } catch { throw new Error("No se pudo contactar con la señalización multiusuario."); }
    if (!response?.ok || response.status !== 200) {
      if (response?.status === 410) throw roomRequestError("room-expired", "La sala ha caducado.");
      if (response?.status === 403) throw roomRequestError("room-not-owner", "Solo el host actual puede restaurar la sala.");
      // A persistent room can disappear from the Durable Object before the
      // browser-side credential reaches its local expiry (for example after
      // a previous host migration or a Worker retention expiry). Treat a
      // missing room exactly like an expired one so the entry flow discards
      // the stale owner record and mints a fresh personal room.
      if (response?.status === 404) throw roomRequestError("room-expired", "La sala ha caducado.");
      throw new Error("El servicio no pudo restaurar la sala multiusuario.");
    }
    let body; try { body = await response.json(); } catch { throw new Error("Respuesta de restauración no válida."); }
    if (!body || body.roomCode !== normalized || body.mode !== null || body.maxPlayers !== maxPlayers || body.phase !== "room-open") throw new Error("Respuesta de restauración no válida.");
    return Object.freeze(body);
  }

  async joinRoomByCode(value, { mode = null, reconnect = null } = {}) {
    const roomCode = normalizeP2PMultiRoomCode(value);
    if (!roomCode || (mode !== null && typeof mode !== "string")) throw new TypeError("La clave de sala multiusuario no es válida.");
    if (!this.origin || typeof this.fetch !== "function") throw new Error("La señalización multiusuario no está disponible.");
    let response;
    try {
      const body = reconnect
        ? { roomCode, ...(mode === null ? {} : { mode }), participantId: reconnect.participantId, reconnectToken: reconnect.reconnectToken }
        : (mode === null ? { roomCode, persistent: true } : { roomCode, mode, persistent: true });
      response = await this.fetch(`${this.origin}/v2/rooms/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit", redirect: "error", cache: "no-store" });
    } catch { throw new Error("No se pudo contactar con la señalización multiusuario."); }
    if (!response?.ok || response.status !== 200) {
      if (response?.status === 409) throw new Error("La sala está llena o el modo no coincide.");
      if (response?.status === 410) throw new Error("La sala ha caducado.");
      if (response?.status === 404) throw new Error("No se encontró una sala activa con esa clave.");
      throw new Error("El servicio no pudo preparar la sala multiusuario.");
    }
    let body;
    try { body = await response.json(); } catch { throw new Error("Respuesta de sala multiusuario no válida."); }
    const joined = parseJoin(body, this.now());
    if (!joined || (mode !== null && joined.mode !== mode)) throw new Error("La sala no coincide con el modo seleccionado.");
    return joined;
  }

  connect({ roomId, role, slot = role === "host" ? null : undefined, secret, expiresAt }) {
    if (!this.origin || typeof this.WebSocket !== "function") throw new Error("WebSocket multiusuario no está disponible.");
    if (this.socket || !this.closed || !normalizeRoomId(roomId) || (role !== "host" && role !== "guest")
      || (role === "guest" && (!Number.isSafeInteger(slot) || slot < 1 || slot > P2P_MULTI_MAX_GUEST_SLOTS))
      || (role === "host" && slot !== null) || typeof secret !== "string" || !SIGNAL_SECRET_PATTERN.test(secret)
      || !Number.isSafeInteger(expiresAt) || expiresAt <= this.now()) throw new TypeError("Credenciales multiusuario no válidas o caducadas.");
    this.credentials = { roomId, role, slot, secret, expiresAt };
    this.outgoingSequence = 0;
    this.incomingSequences.clear();
    this.closed = false;
    const wsOrigin = new URL(this.origin);
    wsOrigin.protocol = wsOrigin.protocol === "https:" ? "wss:" : "ws:";
    wsOrigin.pathname = `/v2/rooms/${roomId}/signal`;
    wsOrigin.search = "";
    wsOrigin.hash = "";
    let socket;
    try { socket = new this.WebSocket(wsOrigin.href); } catch { this.cleanup(); throw new Error("No se pudo abrir la señalización multiusuario."); }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.closed || this.socket !== socket) return;
      try {
        socket.send(JSON.stringify(createP2PMultiJoinMessage({ role, slot, secret })));
        this.expiryTimer = this.scheduler.setTimeout(() => this.expire(), Math.max(0, expiresAt - this.now()));
        this.emit("ready", { role, slot, roomId, expiresAt });
      } catch { this.fail("send-failed", "No se pudo iniciar la señalización multiusuario."); }
    });
    socket.addEventListener("message", event => this.receive(event?.data));
    socket.addEventListener("close", () => this.handleClose());
    socket.addEventListener("error", () => this.fail("connection-error", "Falló la señalización multiusuario."));
    return { roomId, role, slot, expiresAt };
  }

  sendSignal(payload, { targetSlot = null } = {}) {
    if (this.closed || !this.socket || this.socket.readyState !== 1) throw new Error("La señalización multiusuario no está conectada.");
    if (this.credentials?.role === "guest" && targetSlot !== null) throw new TypeError("Un invitado no puede elegir el destino de una señal.");
    let frame;
    try { frame = createP2PMultiSignalFrame(payload, { sequence: this.outgoingSequence + 1, targetSlot }); } catch (error) { throw error; }
    const serialized = JSON.stringify(frame);
    if (encoder.encode(serialized).byteLength > SIGNAL_MAX_FRAME_BYTES || encoder.encode(frame.payload).byteLength > SIGNAL_MAX_PAYLOAD_BYTES) throw new TypeError("La señal multiusuario supera el límite permitido.");
    try { this.socket.send(serialized); } catch { this.fail("send-failed", "No se pudo enviar la señal multiusuario."); throw new Error("No se pudo enviar la señal multiusuario."); }
    this.outgoingSequence = frame.sequence;
    return frame.sequence;
  }

  receive(data) {
    if (this.closed || typeof data !== "string" || encoder.encode(data).byteLength > SIGNAL_MAX_FRAME_BYTES) return this.fail("invalid-frame", "Se recibió una trama multiusuario no válida.");
    let message;
    try { message = JSON.parse(data); } catch { return this.fail("invalid-frame", "Se recibió una trama multiusuario no válida."); }
    if (message?.type === "signal") {
      const provisionalSource = message.sourceSlot === null ? "host" : Number.isSafeInteger(message.sourceSlot) ? `guest-${message.sourceSlot}` : "invalid";
      const frame = normalizeP2PMultiSignalFrame(message, { lastSequence: this.incomingSequences.get(provisionalSource) || 0 });
      if (!frame) return this.fail("invalid-frame", "Se recibió una trama multiusuario no válida.");
      const source = frame.sourceSlot === null ? "host" : `guest-${frame.sourceSlot}`;
      this.incomingSequences.set(source, frame.sequence);
      let payload;
      try { payload = JSON.parse(frame.payload); } catch { return this.fail("invalid-frame", "Se recibió una trama multiusuario no válida."); }
      this.emit("signal", { payload, sequence: frame.sequence, targetSlot: frame.targetSlot, sourceSlot: frame.sourceSlot });
      return;
    }
    if (message?.type === "peer-ready" && exact(message, ["protocolVersion", "type", "slot"]) && message.protocolVersion === P2P_MULTI_SIGNAL_PROTOCOL_VERSION && (message.slot === null || (Number.isSafeInteger(message.slot) && message.slot >= 1 && message.slot <= P2P_MULTI_MAX_GUEST_SLOTS))) {
      this.emit("peer-ready", { slot: message.slot });
      return;
    }
    if (message?.type === "guest-left" && exact(message, ["protocolVersion", "type", "slot"]) && message.protocolVersion === P2P_MULTI_SIGNAL_PROTOCOL_VERSION) {
      this.emit("peer-left", { role: "guest", slot: message.slot });
      return;
    }
    if (message?.type === "host-promoted" && exact(message, ["protocolVersion", "type", "slot", "hostEpoch", "connectedSlots"])
      && message.protocolVersion === P2P_MULTI_SIGNAL_PROTOCOL_VERSION
      && Number.isSafeInteger(message.slot) && message.slot >= 1 && message.slot <= P2P_MULTI_MAX_GUEST_SLOTS
      && Number.isSafeInteger(message.hostEpoch) && message.hostEpoch >= 1
      && Array.isArray(message.connectedSlots) && message.connectedSlots.length >= 1
      && message.connectedSlots.every(slot => Number.isSafeInteger(slot) && slot >= 1 && slot <= P2P_MULTI_MAX_GUEST_SLOTS)
      && new Set(message.connectedSlots).size === message.connectedSlots.length && message.connectedSlots.includes(message.slot)) {
      const promoted = this.credentials?.role === "guest" && this.credentials.slot === message.slot;
      // The Durable Object has already fenced the old host and changed this
      // socket's attachment. Keep the same opaque guest credential, but let
      // the promoted browser emit host-star offers without reopening a socket.
      // A new host has a new authority epoch. Forget inbound host-frame
      // sequence history so the replacement star can negotiate independently
      // of the departed host's final ICE frames.
      this.incomingSequences.clear();
      this.outgoingSequence = 0;
      if (promoted) this.credentials = { ...this.credentials, role: "host", slot: null };
      this.emit("host-promoted", { slot: message.slot, hostEpoch: message.hostEpoch, connectedSlots: [...message.connectedSlots], promoted });
      return;
    }
    if (message?.type === "host-left" && exact(message, ["protocolVersion", "type", "slot"]) && message.protocolVersion === P2P_MULTI_SIGNAL_PROTOCOL_VERSION) {
      this.emit("peer-left", { role: "host", slot: null });
      return this.finish("host-left");
    }
    this.fail("invalid-frame", "Se recibió una trama multiusuario no válida.");
  }

  expire() { if (!this.closed) { this.emit("error", safeError("expired", "La sala multiusuario ha caducado.")); this.finish("expired"); } }
  fail(code, message) { if (!this.closed) { this.emit("error", safeError(code, message)); this.finish(code); } }
  handleClose() { if (!this.closed) this.finish("closed"); }
  finish(reason) { if (this.closed) return; const socket = this.socket; this.cleanup(); try { socket?.close?.(1000, "Client closed."); } catch {} this.emit("closed", { reason }); }
  cleanup() { this.closed = true; if (this.expiryTimer !== null) this.scheduler.clearTimeout(this.expiryTimer); this.expiryTimer = null; this.socket = null; this.credentials = null; this.incomingSequences.clear(); }
  close() { if (!this.closed) this.finish("local"); }
}

export function parseP2PMultiRoomResponse(value, now = Date.now()) { return parseRoom(value, now); }
export function parseP2PMultiJoinResponse(value, now = Date.now()) { return parseJoin(value, now); }

export function createP2PMultiInviteUrl({ baseUrl, roomId, guestSecret, slot, expiresAt, mode, maxPlayers } = {}) {
  if (typeof baseUrl !== "string" || !normalizeRoomId(roomId) || typeof guestSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(guestSecret)
    || !Number.isSafeInteger(slot) || slot < 1 || slot > P2P_MULTI_MAX_GUEST_SLOTS || !Number.isSafeInteger(expiresAt)
    || typeof mode !== "string" || !Number.isSafeInteger(maxPlayers)) throw new TypeError("La invitación multiusuario no es válida.");
  const url = new URL(baseUrl);
  url.hash = `${MULTI_INVITE_PREFIX}${encodeInvite({ roomId, guestSecret, slot, expiresAt, mode, maxPlayers })}`;
  return url.href;
}

export function consumeP2PMultiInviteFragment({ hash = "", now = Date.now() } = {}) {
  if (typeof hash !== "string" || !hash.startsWith(MULTI_INVITE_PREFIX)) return Object.freeze({ recognized: false, invite: null });
  const value = decodeInvite(hash.slice(MULTI_INVITE_PREFIX.length));
  const invite = value && normalizeRoomId(value.roomId) && typeof value.guestSecret === "string" && SIGNAL_SECRET_PATTERN.test(value.guestSecret)
    && Number.isSafeInteger(value.slot) && value.slot >= 1 && value.slot <= P2P_MULTI_MAX_GUEST_SLOTS && Number.isSafeInteger(value.expiresAt)
    && value.expiresAt > now && typeof value.mode === "string" && Number.isSafeInteger(value.maxPlayers) ? Object.freeze({ ...value }) : null;
  return Object.freeze({ recognized: true, invite });
}
