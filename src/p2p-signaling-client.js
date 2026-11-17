import {
  SIGNAL_MAX_FRAME_BYTES,
  SIGNAL_MAX_PAYLOAD_BYTES,
  SIGNAL_PROTOCOL_VERSION,
  SIGNAL_ROOM_TTL_MS,
  SIGNAL_SECRET_PATTERN,
  createJoinMessage,
  decodeSignalFrame,
  normalizeRoomId,
} from "./p2p-signaling-protocol.js";
import { normalizeSignalOrigin, P2P_SIGNAL_ORIGIN } from "./p2p-room-config.js";

const ROOM_RESPONSE_KEYS = ["roomId", "hostSecret", "guestSecret", "expiresAt"];
const ROOM_CODE_RESPONSE_KEYS = ["roomCode", "roomId", "guestSecret", "expiresAt"];
const SESSION_STORAGE_KEY = "arsenal.p2p.invite.v1";
const encoder = new TextEncoder();

// Crockford avoids characters that are easy to confuse when reading a code
// aloud or copying it from a game window. A code is only a user-facing lookup
// handle; the signaling secret is still returned by the Worker and never
// derived in the browser.
export const P2P_ROOM_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8,12}$/u;

export function normalizeP2PRoomCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase().replace(/[\s-]/gu, "");
  return P2P_ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function parseCreateResponse(value, now) {
  const validShape = exactObject(value, ROOM_RESPONSE_KEYS)
    || exactObject(value, [...ROOM_RESPONSE_KEYS, "roomCode"]);
  if (!validShape) return null;
  if (!normalizeRoomId(value.roomId)
    || typeof value.hostSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(value.hostSecret)
    || typeof value.guestSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(value.guestSecret)
    || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= now
    || value.expiresAt > now + SIGNAL_ROOM_TTL_MS + 5000) return null;
  return { roomId: value.roomId, hostSecret: value.hostSecret, guestSecret: value.guestSecret, expiresAt: value.expiresAt };
}

function parseRoomCodeResponse(value, now) {
  if (!exactObject(value, ROOM_CODE_RESPONSE_KEYS)) return null;
  const roomCode = normalizeP2PRoomCode(value.roomCode);
  if (!roomCode || !normalizeRoomId(value.roomId)
    || typeof value.guestSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(value.guestSecret)
    || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= now
    || value.expiresAt > now + SIGNAL_ROOM_TTL_MS + 5000) return null;
  return { roomCode, roomId: value.roomId, guestSecret: value.guestSecret, expiresAt: value.expiresAt };
}

function safeError(code, message) {
  return Object.freeze({ code, message });
}

export class P2PSignalingClient {
  constructor({
    origin = P2P_SIGNAL_ORIGIN,
    fetch: fetchImpl = globalThis.fetch,
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    crypto: cryptoImpl = globalThis.crypto,
    scheduler = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
    now = () => Date.now(),
  } = {}) {
    this.origin = normalizeSignalOrigin(origin);
    // Browser `fetch` is a method whose receiver must be the global object.
    // Keep injected test doubles untouched, but bind the native default so a
    // call through `this.fetch(...)` cannot fail with an opaque TypeError.
    this.fetch = fetchImpl === globalThis.fetch && typeof fetchImpl === "function"
      ? fetchImpl.bind(globalThis)
      : fetchImpl;
    this.WebSocket = WebSocketImpl;
    this.crypto = cryptoImpl;
    this.scheduler = scheduler;
    this.now = now;
    this.listeners = new Map();
    this.socket = null;
    this.expiryTimer = null;
    this.closed = true;
    this.outgoingSequence = 0;
    this.incomingSequence = 0;
    this.credentials = null;
  }

  on(type, listener) {
    if (typeof listener !== "function") throw new TypeError("Listener must be a function.");
    const set = this.listeners.get(type) || new Set();
    set.add(listener);
    this.listeners.set(type, set);
    return () => set.delete(listener);
  }

  emit(type, detail = {}) {
    for (const listener of this.listeners.get(type) || []) {
      try { listener(detail); } catch { /* Consumer errors do not affect the transport. */ }
    }
  }

  async createRoom() {
    if (!this.origin) throw new Error("La señalización todavía no está configurada.");
    if (typeof this.fetch !== "function") throw new Error("Fetch no está disponible en este navegador.");
    let response;
    try {
      response = await this.fetch(`${this.origin}/v1/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new Error("No se pudo contactar con el servicio de señalización.");
    }
    if (!response?.ok || response.status !== 201) throw new Error("El servicio no pudo crear la sala.");
    let body;
    try { body = await response.json(); } catch { throw new Error("Respuesta de sala no válida."); }
    const room = parseCreateResponse(body, this.now());
    if (!room) {
      throw new Error("Respuesta de sala no válida.");
    }
    // The current Worker returns no short code yet. Preserve its response
    // shape and expose a code only when the server explicitly provides one.
    const roomCode = normalizeP2PRoomCode(body?.roomCode);
    return roomCode ? Object.freeze({ ...room, roomCode }) : room;
  }

  async joinRoomByCode(value) {
    const roomCode = normalizeP2PRoomCode(value);
    if (!roomCode) throw new TypeError("La clave de sala no es válida.");
    if (!this.origin) throw new Error("La señalización todavía no está configurada.");
    if (typeof this.fetch !== "function") throw new Error("Fetch no está disponible en este navegador.");
    let response;
    try {
      response = await this.fetch(`${this.origin}/v1/rooms/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode }),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new Error("No se pudo contactar con el servicio de señalización.");
    }
    if (!response?.ok || response.status !== 200) {
      if (response?.status === 404) throw new Error("La clave corta todavía no está disponible en este servicio.");
      throw new Error("El servicio no pudo resolver la clave de sala.");
    }
    let body;
    try { body = await response.json(); } catch { throw new Error("Respuesta de clave no válida."); }
    const invite = parseRoomCodeResponse(body, this.now());
    if (!invite) throw new Error("Respuesta de clave no válida o caducada.");
    return invite;
  }

  connect({ roomId, role, secret, expiresAt }) {
    if (!this.origin) throw new Error("La señalización todavía no está configurada.");
    if (this.socket || !this.closed) throw new Error("Ya hay una conexión de señalización activa.");
    if (!normalizeRoomId(roomId) || (role !== "host" && role !== "guest")
      || typeof secret !== "string" || !SIGNAL_SECRET_PATTERN.test(secret)
      || !Number.isSafeInteger(expiresAt) || expiresAt <= this.now()) {
      throw new TypeError("Invitación o credenciales no válidas o caducadas.");
    }
    if (typeof this.WebSocket !== "function") throw new Error("WebSocket no está disponible en este navegador.");
    this.credentials = { roomId, role, secret, expiresAt };
    this.outgoingSequence = 0;
    this.incomingSequence = 0;
    this.closed = false;
    const wsOrigin = new URL(this.origin);
    wsOrigin.protocol = wsOrigin.protocol === "https:" ? "wss:" : "ws:";
    wsOrigin.pathname = `/v1/rooms/${roomId}/signal`;
    wsOrigin.search = "";
    wsOrigin.hash = "";
    let socket;
    try { socket = new this.WebSocket(wsOrigin.href); }
    catch {
      this.cleanup();
      throw new Error("No se pudo abrir la conexión de señalización.");
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.closed || this.socket !== socket) return;
      if (this.now() >= expiresAt) return this.expire();
      try {
        socket.send(JSON.stringify(createJoinMessage({ role, secret })));
        this.expiryTimer = this.scheduler.setTimeout(() => this.expire(), Math.max(0, expiresAt - this.now()));
        this.emit("ready", { role, roomId, expiresAt });
      } catch {
        this.fail("send-failed", "No se pudo iniciar la señalización.");
      }
    });
    socket.addEventListener("message", (event) => this.receive(event?.data));
    socket.addEventListener("close", () => this.handleClose());
    socket.addEventListener("error", () => this.fail("connection-error", "Falló la conexión de señalización."));
    return { roomId, role, expiresAt };
  }

  sendSignal(payload) {
    if (this.closed || !this.socket || this.socket.readyState !== 1) throw new Error("La señalización no está conectada.");
    let serializedPayload;
    try { serializedPayload = JSON.stringify(payload); } catch { throw new TypeError("El mensaje de señalización no es JSON válido."); }
    if (serializedPayload === undefined || encoder.encode(serializedPayload).byteLength > SIGNAL_MAX_PAYLOAD_BYTES) {
      throw new TypeError("El mensaje de señalización supera el límite permitido.");
    }
    const frame = {
      type: "signal",
      protocolVersion: SIGNAL_PROTOCOL_VERSION,
      sequence: this.outgoingSequence + 1,
      payload: serializedPayload,
    };
    const serialized = JSON.stringify(frame);
    if (encoder.encode(serialized).byteLength > SIGNAL_MAX_FRAME_BYTES) throw new TypeError("La trama supera el límite permitido.");
    try { this.socket.send(serialized); } catch {
      this.fail("send-failed", "No se pudo enviar la señal.");
      throw new Error("No se pudo enviar la señal.");
    }
    this.outgoingSequence = frame.sequence;
    return frame.sequence;
  }

  receive(data) {
    if (this.closed) return;
    if (typeof data !== "string" || encoder.encode(data).byteLength > SIGNAL_MAX_FRAME_BYTES) {
      return this.fail("invalid-frame", "Se recibió una trama de señalización no válida.");
    }
    let message;
    try { message = JSON.parse(data); } catch { return this.fail("invalid-frame", "Se recibió una trama de señalización no válida."); }
    if (message && message.type === "signal") {
      const frame = decodeSignalFrame(data, { lastSequence: this.incomingSequence });
      if (!frame) return this.fail("invalid-frame", "Se recibió una trama de señalización no válida.");
      this.incomingSequence = frame.sequence;
      let payload;
      try { payload = JSON.parse(frame.payload); } catch { return this.fail("invalid-frame", "Se recibió una trama de señalización no válida."); }
      this.emit("signal", { payload, sequence: frame.sequence });
      return;
    }
    if (message && message.type === "peer-ready") {
      const otherRole = this.credentials?.role === "host" ? "guest" : "host";
      if (!exactObject(message, ["type", "protocolVersion", "role"])
        || message.protocolVersion !== SIGNAL_PROTOCOL_VERSION
        || (message.role !== "host" && message.role !== "guest")
        || message.role !== otherRole) {
        return this.fail("invalid-frame", "Se recibió una trama de señalización no válida.");
      }
      this.emit("peer-ready", { role: message.role });
      return;
    }
    if (exactObject(message, ["type", "protocolVersion"]) && message.protocolVersion === SIGNAL_PROTOCOL_VERSION
      && ((message.type === "host-left" && this.credentials?.role === "guest")
        || (message.type === "guest-left" && this.credentials?.role === "host"))) {
      this.emit("peer-left", { role: message.type === "host-left" ? "host" : "guest" });
      if (message.type === "guest-left") this.incomingSequence = 0;
      if (message.type === "host-left") this.finish("host-left");
      return;
    }
    this.fail("invalid-frame", "Se recibió una trama de señalización no válida.");
  }

  expire() {
    if (this.closed) return;
    this.emit("error", safeError("expired", "La sala ha caducado."));
    this.finish("expired", 4000, "Room expired.");
  }

  fail(code, message) {
    if (this.closed) return;
    this.emit("error", safeError(code, message));
    this.finish(code, 1008, "Signaling error.");
  }

  handleClose() {
    if (this.closed) return;
    this.finish("closed");
  }

  finish(reason, closeCode, closeReason) {
    if (this.closed) return;
    const socket = this.socket;
    this.cleanup();
    if (socket && closeCode && socket.readyState < 2) {
      try { socket.close(closeCode, closeReason); } catch { /* Socket may already be closing. */ }
    }
    this.emit("closed", { reason });
  }

  cleanup() {
    this.closed = true;
    if (this.expiryTimer !== null) this.scheduler.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.socket = null;
    this.credentials = null;
  }

  close() {
    if (this.closed) return;
    const socket = this.socket;
    this.finish("local");
    if (socket && socket.readyState < 2) {
      try { socket.close(1000, "Client closed."); } catch { /* Socket may already be closing. */ }
    }
  }
}

export function createP2PInviteUrl(currentUrl, { roomId, guestSecret, expiresAt } = {}) {
  if (!normalizeRoomId(roomId) || typeof guestSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(guestSecret)
    || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()
    || expiresAt > Date.now() + SIGNAL_ROOM_TTL_MS + 5000) throw new TypeError("Invalid P2P invitation.");
  const url = new URL(currentUrl);
  const encoded = typeof btoa === "function"
    ? btoa(unescape(encodeURIComponent(JSON.stringify({ roomId, guestSecret, expiresAt }))))
    : Buffer.from(JSON.stringify({ roomId, guestSecret, expiresAt }), "utf8").toString("base64");
  const token = encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  url.hash = `p2p=${token}`;
  return url.href;
}

export function consumeP2PInviteFragment({ hash, storage, now = () => Date.now() } = {}) {
  const recognized = typeof hash === "string" && hash.startsWith("#p2p=");
  if (!recognized) return { recognized: false, invite: null };
  const raw = hash.slice(5);
  let invite = null;
  if (raw && raw.length <= 512 && /^[A-Za-z0-9_-]+$/u.test(raw) && !raw.includes("&") && !raw.includes("=")) {
    try {
      const base64 = raw.replaceAll("-", "+").replaceAll("_", "/");
      const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
      const json = typeof atob === "function"
        ? decodeURIComponent(escape(atob(padded)))
        : Buffer.from(padded, "base64").toString("utf8");
      const parsed = JSON.parse(json);
      if (exactObject(parsed, ["roomId", "guestSecret", "expiresAt"])
        && normalizeRoomId(parsed.roomId) && typeof parsed.guestSecret === "string"
        && SIGNAL_SECRET_PATTERN.test(parsed.guestSecret) && Number.isSafeInteger(parsed.expiresAt)
        && parsed.expiresAt > now() && parsed.expiresAt <= now() + SIGNAL_ROOM_TTL_MS + 5000) {
        invite = { roomId: parsed.roomId, guestSecret: parsed.guestSecret, expiresAt: parsed.expiresAt };
      }
    } catch { /* Invalid invitation fragments are discarded without exposing details. */ }
  }
  try {
    if (invite) storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(invite));
    else storage?.removeItem(SESSION_STORAGE_KEY);
  } catch { /* Storage may be disabled; the in-memory invite remains usable. */ }
  return { recognized: true, invite };
}

export function restoreP2PInvite({ storage, now = () => Date.now() } = {}) {
  try {
    const raw = storage?.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (exactObject(value, ["roomId", "guestSecret", "expiresAt"])
      && normalizeRoomId(value.roomId) && typeof value.guestSecret === "string"
      && SIGNAL_SECRET_PATTERN.test(value.guestSecret) && Number.isSafeInteger(value.expiresAt)
      && value.expiresAt > now() && value.expiresAt <= now() + SIGNAL_ROOM_TTL_MS + 5000) return value;
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch { try { storage?.removeItem(SESSION_STORAGE_KEY); } catch { /* unavailable */ } }
  return null;
}
