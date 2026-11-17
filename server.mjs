import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ArenaMatch } from "./src/simulation.js";
import { acceptInputSequence } from "./src/input-ack.js";
import { ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS, RocketSimBridge } from "./src/rocketsim-backend.js";
import { createRocketSimWasmBridge } from "./src/rocketsim-wasm-backend.js";
import { ROCKETSIM_DEFAULT_ARENA, RocketSimPracticeMatch } from "./src/rocketsim-practice-match.js";
import { resolvePublicAsset } from "./src/http-static-boundary.js";
import {
  LAN_DEFAULT_ROOM_ID,
  LAN_HEARTBEAT_TIMEOUT_MS,
  LAN_MAX_BUFFER_BYTES,
  LAN_MAX_CLIENT_FRAME_BYTES,
  LAN_MAX_INPUTS_PER_SECOND,
  LAN_PROTOCOL_VERSION,
  LAN_RECONNECT_GRACE_MS,
  isAllowedOrigin,
  parseAllowedOrigins,
  validateHello,
} from "./src/lan-session-protocol.js";
import {
  assignSessionOwner,
  isSessionOwner,
  LAN_HELLO_TIMEOUT_MS,
  resetPeerInputWindow,
  releaseSessionOwner,
} from "./src/lan-session-control.js";
import { sendWebSocketMessage } from "./src/lan-outbound-queue.js";
import { rocketSimArenaRequiresR20, rocketSimBridgeSupportsArena } from "./src/rocketsim-arena-profile.js";
import { assertOnlineDeploymentPolicy } from "./src/online-deployment-policy.js";
import { verifyOnlineAccessToken } from "./src/online-jwt-auth.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5189);
const roomId = String(process.env.LAN_ROOM_ID || LAN_DEFAULT_ROOM_ID);
const allowedOrigins = parseAllowedOrigins(process.env.LAN_ALLOWED_ORIGINS);
const movementBackend = String(process.env.MOVEMENT_BACKEND || "js").toLowerCase();
const debugLan = process.env.DEBUG_LAN === "1";
const desktopShutdownToken = String(process.env.ARSENAL_DESKTOP_SHUTDOWN_TOKEN || "");
const debug = (...values) => { if (debugLan) console.log("[LAN]", ...values); };
async function createMatch() {
  // Development starts in the clean CAL-01 arena. The simulation default
  // stays scrapyard so its existing regression cases can exercise ramps/covers.
  if (movementBackend === "js") {
    const configuredVehicleLimit = Number(process.env.VEHICLE_LIMIT || 1);
    const vehicleLimit = Number.isInteger(configuredVehicleLimit) && configuredVehicleLimit >= 1 && configuredVehicleLimit <= 6
      ? configuredVehicleLimit
      : 1;
    const arena = process.env.ARENA_PROFILE === "scrapyard" ? "scrapyard" : "calibration";
    return new ArenaMatch(20261010, { vehicleLimit, botCount: 0, arena });
  }
  if (movementBackend === "rocketsim-wasm") {
    const configuredVehicleLimit = Number(process.env.VEHICLE_LIMIT || 6);
    const vehicleLimit = Number.isInteger(configuredVehicleLimit) && configuredVehicleLimit >= 1 && configuredVehicleLimit <= 6
      ? configuredVehicleLimit
      : 6;
    const arena = process.env.ROCKETSIM_ARENA || "combat-alpha";
    const rocketsimMode = String(process.env.ROCKETSIM_MODE || "combat").toLowerCase();
    if (arena !== "combat-alpha") throw new Error("MOVEMENT_BACKEND=rocketsim-wasm requiere ROCKETSIM_ARENA=combat-alpha");
    if (rocketsimMode !== "combat") throw new Error("MOVEMENT_BACKEND=rocketsim-wasm requiere ROCKETSIM_MODE=combat");
    const match = new RocketSimPracticeMatch({
      arena,
      bridgeLabel: "WASM-R20",
      combat: true,
      vehicleLimit,
      bridgeFactory: () => createRocketSimWasmBridge(),
    });
    await match.start();
    return match;
  }
  if (movementBackend !== "rocketsim") throw new Error(`MOVEMENT_BACKEND no soportado: ${movementBackend}`);
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  if (!executable || !existsSync(executable)) throw new Error("MOVEMENT_BACKEND=rocketsim requiere ROCKETSIM_BRIDGE_EXE válido");
  const arena = process.env.ROCKETSIM_ARENA || ROCKETSIM_DEFAULT_ARENA;
  const rocketsimMode = String(process.env.ROCKETSIM_MODE || "practice").toLowerCase();
  if (rocketsimMode !== "practice" && rocketsimMode !== "combat") throw new Error(`ROCKETSIM_MODE no soportado: ${rocketsimMode}`);
  const configuredTimeout = process.env.ROCKETSIM_REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = configuredTimeout === undefined ? ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS : Number(configuredTimeout);
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("ROCKETSIM_REQUEST_TIMEOUT_MS debe ser un número positivo");
  const bridgeLabel = basename(executable).match(/r\d+(?=\.exe$)/i)?.[0].toUpperCase() || "NATIVE";
  if (!rocketSimBridgeSupportsArena(arena, bridgeLabel)) {
    const requirement = rocketSimArenaRequiresR20(arena) ? "R20 o posterior" : "una build compatible";
    throw new Error(`La arena ${arena} requiere un bridge RocketSim ${requirement}; se detectó ${bridgeLabel}.`);
  }
  const match = new RocketSimPracticeMatch({ arena, bridgeLabel, combat: rocketsimMode === "combat", bridgeFactory: () => new RocketSimBridge({ executable, requestTimeoutMs }) });
  await match.start();
  return match;
}
// Deployment policy must run before constructing ArenaMatch/RocketSim or
// opening the listener. LAN remains the default; online is fail-closed until
// an authenticated, bounded hosted adapter is implemented.
let networkPolicy;
try {
  networkPolicy = assertOnlineDeploymentPolicy(process.env, { adapterAvailable: true });
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
  throw error;
}
const match = await createMatch();
const peers = new Map();
let sessionOwnerId = null;
const onlineMode = networkPolicy.mode === "online";
const onlineConfig = networkPolicy.config;
const maxClientFrameBytes = onlineMode ? onlineConfig.maxFrameBytes : LAN_MAX_CLIENT_FRAME_BYTES;
const maxBufferBytes = onlineMode ? onlineConfig.maxFrameBytes + 128 : LAN_MAX_BUFFER_BYTES;
const maxConnections = onlineMode ? onlineConfig.maxConnections : Infinity;
const listenerHost = onlineMode ? "127.0.0.1" : "0.0.0.0";
const MAX_TIMEOUT_MS = 0x7fffffff;

function send(socket, data) {
  sendWebSocketMessage(socket, data, { maxQueuedBytes: maxBufferBytes });
}

function isOpenSocket(socket) {
  return Boolean(socket && !socket.destroyed && !socket.writableEnded);
}

function activeSocketCount() {
  let count = 0;
  for (const peer of peers.values()) if (isOpenSocket(peer.socket)) count += 1;
  return count;
}

function onlinePeerCanOwn(peer) {
  return !onlineMode || peer.onlineRole === "host";
}

function removePeer(peer, { transferLanOwner = !onlineMode } = {}) {
  if (!peers.delete(peer.id)) return;
  if (peer.reconnectTimer) { clearTimeout(peer.reconnectTimer); peer.reconnectTimer = null; }
  if (peer.expiryTimer) { clearTimeout(peer.expiryTimer); peer.expiryTimer = null; }
  match.removeHuman(peer.id);
  sessionOwnerId = releaseSessionOwner(sessionOwnerId, peer.id);
  // LAN's first-peer/transfer behaviour is intentionally unchanged. Hosted
  // pilots must never inherit host authority when a host leaves or expires.
  if (!sessionOwnerId && transferLanOwner) {
    const replacement = [...peers.values()].find(candidate => candidate.hello && isOpenSocket(candidate.socket));
    sessionOwnerId = replacement?.id || null;
    if (replacement?.socket) send(replacement.socket, { type: "session-owner", owner: true, protocolVersion: LAN_PROTOCOL_VERSION, roomId });
  }
}

function expireOnlinePeer(peer) {
  if (!onlineMode || !peers.has(peer.id)) return;
  peer.expired = true;
  removePeer(peer, { transferLanOwner: false });
  // Destroy, rather than gracefully reserving/reconnecting, after expiry.
  if (isOpenSocket(peer.socket)) peer.socket.destroy();
}

function scheduleOnlineExpiry(peer) {
  if (!onlineMode || !Number.isFinite(peer.tokenExpiresAt)) return;
  if (peer.expiryTimer) clearTimeout(peer.expiryTimer);
  const delay = peer.tokenExpiresAt * 1000 - Date.now();
  if (delay <= 0) { expireOnlinePeer(peer); return; }
  peer.expiryTimer = setTimeout(() => {
    if (!peers.has(peer.id)) return;
    if (peer.tokenExpiresAt * 1000 <= Date.now()) expireOnlinePeer(peer);
    else scheduleOnlineExpiry(peer);
  }, Math.min(delay, MAX_TIMEOUT_MS));
  peer.expiryTimer.unref?.();
}

function isExpiredOnlinePeer(peer) {
  if (!onlineMode || !Number.isFinite(peer.tokenExpiresAt)) return false;
  if (peer.tokenExpiresAt * 1000 > Date.now()) return false;
  expireOnlinePeer(peer);
  return true;
}

function handleMessage(peer, frame) {
  if (isExpiredOnlinePeer(peer)) return;
  peer.lastSeen = Date.now();
  if (!peer.hello) {
    if (frame.type !== "hello") return rejectPeer(peer, "Se requiere hello como primer mensaje.");
    const hello = validateHello(frame, roomId);
    if (!hello.ok) return rejectPeer(peer, hello.reason);
    return attachSession(peer, hello);
  }
  if (frame.type === "hello") {
    return rejectPeer(peer, "La sesión ya está identificada.");
  }
  if (frame.type === "input") {
    if (!Number.isSafeInteger(frame.sequence)) return;
    const now = Date.now();
    if (now - peer.inputWindowStarted >= 1000) { peer.inputWindowStarted = now; peer.inputCount = 0; }
    if (++peer.inputCount > LAN_MAX_INPUTS_PER_SECOND) return;
    const sequence = acceptInputSequence(peer.lastInputSequence, frame.sequence);
    if (sequence <= peer.lastInputSequence) return;
    peer.lastInputSequence = sequence;
    match.input(peer.id, frame.input || {});
  }
  if (frame.type === "restart") {
    if (!onlinePeerCanOwn(peer) || !isSessionOwner(sessionOwnerId, peer.id)) return send(peer.socket, { type: "error", text: "Solo el host de la sesión puede reiniciar la ronda." });
    Promise.resolve().then(() => match.restart()).catch(error => send(peer.socket, { type: "error", text: error.message || "No se pudo reiniciar la partida." }));
  }
  if (frame.type === "configure") {
    if (!onlinePeerCanOwn(peer) || !isSessionOwner(sessionOwnerId, peer.id)) return send(peer.socket, { type: "error", text: "Solo el host de la sesión puede configurar la partida." });
    try {
      Promise.resolve(match.configure(frame.settings || {})).catch(error => send(peer.socket, { type: "error", text: error.message || "No se pudo configurar la partida." }));
    } catch (error) {
      send(peer.socket, { type: "error", text: error.message || "No se pudo configurar la partida." });
    }
  }
  if (frame.type === "heartbeat") send(peer.socket, { type: "heartbeat", protocolVersion: LAN_PROTOCOL_VERSION, roomId });
}

function rejectPeer(peer, text, code = null) {
  debug("reject", peer.id, text);
  if (peer.helloTimer) clearTimeout(peer.helloTimer);
  send(peer.socket, { type: "error", text, ...(code ? { code } : {}) });
  peer.socket?.end();
}

function attachSession(peer, hello) {
  if (peer.helloTimer) { clearTimeout(peer.helloTimer); peer.helloTimer = null; }
  let onlineIdentity = null;
  if (onlineMode) {
    if (typeof hello.accessToken !== "string" || !hello.accessToken) {
      return rejectPeer(peer, "Falta el token de acceso online. Abre el enlace de acceso proporcionado.", "online-access-token-required");
    }
    onlineIdentity = verifyOnlineAccessToken(hello.accessToken, {
      secret: String(process.env.ARSENAL_ONLINE_JWT_SECRET || ""),
      issuer: onlineConfig.jwtIssuer,
      audience: onlineConfig.jwtAudience,
    });
    if (!onlineIdentity.ok) return rejectPeer(peer, "El acceso online no es válido o ha caducado. Solicita un enlace nuevo.", "online-access-token-invalid");
  }
  const identityKey = onlineMode ? onlineIdentity.subject : hello.sessionId;
  const existing = [...peers.values()].find(candidate => candidate.identityKey === identityKey && candidate !== peer);
  if (isOpenSocket(existing?.socket)) return rejectPeer(peer, "La sesión ya está conectada.");
  if (existing) {
    const oldSocket = existing.socket;
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    peers.delete(peer.id);
    existing.socket = peer.socket;
    existing.buffer = Buffer.alloc(0);
    existing.lastSeen = Date.now();
    resetPeerInputWindow(existing, existing.lastSeen);
    existing.hello = true;
    existing.expired = false;
    if (onlineMode) {
      existing.onlineRole = onlineIdentity.role;
      existing.tokenExpiresAt = onlineIdentity.expiresAt;
      // A host must present a host token again when reconnecting; an ordinary
      // pilot token cannot retain authority from an earlier incarnation.
      if (!onlinePeerCanOwn(existing)) sessionOwnerId = releaseSessionOwner(sessionOwnerId, existing.id);
      scheduleOnlineExpiry(existing);
    }
    existing.socket.removeAllListeners("data");
    existing.socket.removeAllListeners("close");
    existing.socket.removeAllListeners("error");
    bindSocket(existing, existing.socket);
    if (oldSocket && !oldSocket.destroyed) oldSocket.end();
    send(existing.socket, { type: "welcome", id: existing.id, team: existing.team, owner: isSessionOwner(sessionOwnerId, existing.id), protocolVersion: LAN_PROTOCOL_VERSION, roomId });
    return;
  }
  peer.hello = true;
  peer.sessionId = hello.sessionId;
  peer.identityKey = identityKey;
  peer.roomId = hello.roomId;
  peer.name = onlineIdentity?.displayName || hello.name;
  peer.onlineRole = onlineIdentity?.role || null;
  peer.tokenExpiresAt = onlineIdentity?.expiresAt || null;
  const car = match.addHuman(peer.id, peer.name);
  if (!car) return rejectPeer(peer, "La capacidad de esta arena ya está completa.");
  if (onlinePeerCanOwn(peer)) sessionOwnerId = assignSessionOwner(sessionOwnerId, peer.id);
  peer.team = car.team;
  debug("welcome", peer.id, onlineMode
    ? { team: peer.team, owner: isSessionOwner(sessionOwnerId, peer.id) }
    : { name: peer.name, team: peer.team, owner: isSessionOwner(sessionOwnerId, peer.id) });
  send(peer.socket, { type: "welcome", id: peer.id, team: car.team, owner: isSessionOwner(sessionOwnerId, peer.id), protocolVersion: LAN_PROTOCOL_VERSION, roomId });
  scheduleOnlineExpiry(peer);
}

function receive(peer, chunk) {
  if (peer.buffer.length + chunk.length > maxBufferBytes) { peer.socket.destroy(); return; }
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0], second = peer.buffer[1], opcode = first & 15;
    if ((second & 128) === 0) { peer.socket.destroy(); return; }
    let length = second & 127, offset = 2;
    // 127 is the 64-bit-length marker only in the original header. Once a
    // 16-bit extended length has been decoded, values 126/127 are ordinary
    // payload sizes and must remain valid. The previous check rejected a
    // perfectly valid 127-byte JSON hello and closed the socket without a
    // diagnostic.
    if (length === 127) { peer.socket.destroy(); return; }
    if (length === 126) { if (peer.buffer.length < 4) return; length = peer.buffer.readUInt16BE(2); offset = 4; }
    if (length > maxClientFrameBytes) { peer.socket.destroy(); return; }
    if (peer.buffer.length < offset + 4 + length) return;
    const mask = peer.buffer.subarray(offset, offset + 4); offset += 4;
    const payload = Buffer.from(peer.buffer.subarray(offset, offset + length));
    peer.buffer = peer.buffer.subarray(offset + length);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    if (opcode === 8) return peer.socket.end();
    if (opcode === 9) { peer.socket.write(Buffer.from([0x8a, 0])); continue; }
    if (opcode !== 1) continue;
    try { handleMessage(peer, JSON.parse(payload.toString("utf8"))); } catch (error) { debug("frame-error", peer.id, error.message || error); /* ignore malformed input */ }
  }
}

const app = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/__arsenal/desktop-shutdown") {
    if (!desktopShutdownToken || request.headers["x-arsenal-desktop-token"] !== desktopShutdownToken) {
      response.writeHead(404); response.end("Not found"); return;
    }
    response.writeHead(202); response.end();
    queueMicrotask(() => { void closeServer("desktop-launcher"); });
    return;
  }
  const asset = resolvePublicAsset(request.url || "/", root);
  if (!asset || !existsSync(asset.path) || statSync(asset.path).isDirectory()) { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "content-type": asset.contentType, "x-content-type-options": "nosniff", "cache-control": "no-store" });
  createReadStream(asset.path).pipe(response);
});

app.on("upgrade", (request, socket) => {
  if (request.headers.upgrade?.toLowerCase() !== "websocket" || !request.headers["sec-websocket-key"]) { socket.destroy(); return; }
  // Offline peers stay as reconnect reservations, but do not occupy an active
  // WebSocket slot. This lets a valid identity reconnect under a one-socket
  // hosted cap without admitting concurrent accepted sockets over that cap.
  if (activeSocketCount() >= maxConnections) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const allowedOrigin = onlineMode
    ? typeof request.headers.origin === "string" && onlineConfig.allowedOrigins.includes(request.headers.origin)
    : isAllowedOrigin(request.headers.origin, { port, host: request.headers.host, configured: allowedOrigins });
  if (!allowedOrigin) {
    debug("reject-origin", onlineMode ? { online: true } : { origin: request.headers.origin || null, host: request.headers.host || null });
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  debug("upgrade", onlineMode ? { online: true } : { origin: request.headers.origin || null, host: request.headers.host || null });
  const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const peer = { id: randomUUID(), socket, buffer: Buffer.alloc(0), lastInputSequence: 0, lastSeen: Date.now(), inputWindowStarted: Date.now(), inputCount: 0, hello: false, helloTimer: null, sessionId: null, identityKey: null, team: null, reconnectTimer: null, onlineRole: null, tokenExpiresAt: null, expiryTimer: null, expired: false };
  peers.set(peer.id, peer);
  peer.helloTimer = setTimeout(() => {
    if (!peer.hello && peers.has(peer.id)) rejectPeer(peer, "La sesión debe enviar hello en cinco segundos.");
  }, LAN_HELLO_TIMEOUT_MS);
  peer.helloTimer.unref?.();
  bindSocket(peer, socket);
});

function bindSocket(peer, socket) {
  socket.on("data", chunk => receive(peer, chunk));
  socket.on("close", () => handleDisconnect(peer, socket));
  socket.on("error", () => handleDisconnect(peer, socket));
}

function handleDisconnect(peer, socket) {
  if (peer.socket !== socket) return;
  if (peer.helloTimer) { clearTimeout(peer.helloTimer); peer.helloTimer = null; }
  peer.socket = null;
  if (!peers.has(peer.id) || peer.expired) return;
  if (!peer.hello) { peers.delete(peer.id); return; }
  peer.reconnectTimer = setTimeout(() => {
    if (peer.socket || !peers.has(peer.id)) return;
    removePeer(peer);
  }, LAN_RECONNECT_GRACE_MS);
  peer.reconnectTimer.unref?.();
}

let previous = performance.now();
let tickInFlight = false;
let runtimeError = null;
let recoveryInFlight = false;
let recoveryAttempt = 0;
const MAX_RUNTIME_RECOVERY_ATTEMPTS = 3;

function broadcastError(text) {
  for (const peer of peers.values()) if (peer.socket && !peer.socket.destroyed) send(peer.socket, { type: "error", text });
}

async function recoverRuntime(error) {
  if (recoveryInFlight || !match.restart) return;
  recoveryInFlight = true;
  const attempt = ++recoveryAttempt;
  try {
    await match.restart();
    runtimeError = null;
    recoveryAttempt = 0;
    previous = performance.now();
    broadcastError("La simulación autoritativa se ha recuperado; la ronda se ha reiniciado.");
    console.warn(`Car Soccer runtime recovered after attempt ${attempt}: ${error.message || error}`);
  } catch (recoveryError) {
    runtimeError = recoveryError;
    console.error(`Car Soccer runtime recovery attempt ${attempt} failed: ${recoveryError.stack || recoveryError.message || recoveryError}`);
    if (attempt < MAX_RUNTIME_RECOVERY_ATTEMPTS) {
      recoveryInFlight = false;
      setTimeout(() => { void recoverRuntime(recoveryError); }, Math.min(1500, 250 * attempt)).unref?.();
      return;
    }
    broadcastError("La simulación autoritativa se ha detenido; reinicia el servidor.");
  } finally {
    recoveryInFlight = false;
  }
}

const tickTimer = setInterval(async () => {
  if (tickInFlight || runtimeError || recoveryInFlight) return;
  const now = performance.now();
  const dt = Math.min(.05, (now - previous) / 1000); previous = now;
  tickInFlight = true;
  try {
    const state = await match.tick(dt);
    for (const peer of peers.values()) if (peer.socket && !peer.socket.destroyed) send(peer.socket, { type: "state", state, inputAcknowledged: peer.lastInputSequence });
  } catch (error) {
    runtimeError = error;
    console.error(`Car Soccer runtime stopped: ${error.stack || error.message || error}`);
    broadcastError("La simulación autoritativa está recuperándose; la ronda se reiniciará automáticamente.");
    void recoverRuntime(error);
  } finally {
    tickInFlight = false;
  }
}, 1000 / 60);

const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  for (const peer of peers.values()) {
    if (!peer.socket) continue;
    if (now - peer.lastSeen > LAN_HEARTBEAT_TIMEOUT_MS) peer.socket.end();
  }
}, 5000);
heartbeatTimer.unref?.();

app.listen(port, listenerHost, () => console.log(`Combat Cars · backend=${movementBackend} · http://localhost:${port}`));

let closeInProgress = false;
async function closeServer(signal) {
  if (closeInProgress) return;
  closeInProgress = true;
  clearInterval(tickTimer);
  clearInterval(heartbeatTimer);
  const forceExit = setTimeout(() => process.exit(0), 1200);
  forceExit.unref();
  try {
    await match.shutdown?.();
  } catch (error) {
    console.error(`Car Soccer shutdown failed: ${error.stack || error.message || error}`);
  }
  for (const peer of peers.values()) if (peer.socket && !peer.socket.destroyed) peer.socket.end();
  app.close(() => { clearTimeout(forceExit); process.exit(0); });
  console.log(`Car Soccer: cierre solicitado (${signal})`);
}
process.once("SIGINT", () => { void closeServer("SIGINT"); });
process.once("SIGTERM", () => { void closeServer("SIGTERM"); });
