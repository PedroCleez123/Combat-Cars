import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ArenaMatch } from "./src/simulation.js";
import { acceptInputSequence } from "./src/input-ack.js";
import { ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS, RocketSimBridge } from "./src/rocketsim-backend.js";
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
  releaseSessionOwner,
} from "./src/lan-session-control.js";
import { sendWebSocketMessage } from "./src/lan-outbound-queue.js";

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
  const match = new RocketSimPracticeMatch({ arena, bridgeLabel, combat: rocketsimMode === "combat", bridgeFactory: () => new RocketSimBridge({ executable, requestTimeoutMs }) });
  await match.start();
  return match;
}
const match = await createMatch();
const peers = new Map();
let sessionOwnerId = null;

function send(socket, data) {
  sendWebSocketMessage(socket, data, { maxQueuedBytes: LAN_MAX_BUFFER_BYTES });
}

function handleMessage(peer, frame) {
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
    if (!isSessionOwner(sessionOwnerId, peer.id)) return send(peer.socket, { type: "error", text: "Solo el host de la sesión puede reiniciar la ronda." });
    Promise.resolve().then(() => match.restart()).catch(error => send(peer.socket, { type: "error", text: error.message || "No se pudo reiniciar la partida." }));
  }
  if (frame.type === "configure") {
    if (!isSessionOwner(sessionOwnerId, peer.id)) return send(peer.socket, { type: "error", text: "Solo el host de la sesión puede configurar la partida." });
    try {
      Promise.resolve(match.configure(frame.settings || {})).catch(error => send(peer.socket, { type: "error", text: error.message || "No se pudo configurar la partida." }));
    } catch (error) {
      send(peer.socket, { type: "error", text: error.message || "No se pudo configurar la partida." });
    }
  }
  if (frame.type === "heartbeat") send(peer.socket, { type: "heartbeat", protocolVersion: LAN_PROTOCOL_VERSION, roomId });
}

function rejectPeer(peer, text) {
  debug("reject", peer.id, text);
  if (peer.helloTimer) clearTimeout(peer.helloTimer);
  send(peer.socket, { type: "error", text });
  peer.socket?.end();
}

function attachSession(peer, hello) {
  if (peer.helloTimer) { clearTimeout(peer.helloTimer); peer.helloTimer = null; }
  const existing = [...peers.values()].find(candidate => candidate.sessionId === hello.sessionId && candidate !== peer);
  if (existing?.socket && !existing.socket.destroyed) return rejectPeer(peer, "La sesión ya está conectada.");
  if (existing) {
    const oldSocket = existing.socket;
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    peers.delete(peer.id);
    existing.socket = peer.socket;
    existing.buffer = Buffer.alloc(0);
    existing.lastSeen = Date.now();
    existing.hello = true;
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
  peer.roomId = hello.roomId;
  peer.name = hello.name;
  const car = match.addHuman(peer.id, hello.name);
  if (!car) return rejectPeer(peer, "La capacidad de esta arena ya está completa.");
  sessionOwnerId = assignSessionOwner(sessionOwnerId, peer.id);
  peer.team = car.team;
  debug("welcome", peer.id, { name: peer.name, team: peer.team, owner: isSessionOwner(sessionOwnerId, peer.id) });
  send(peer.socket, { type: "welcome", id: peer.id, team: car.team, owner: isSessionOwner(sessionOwnerId, peer.id), protocolVersion: LAN_PROTOCOL_VERSION, roomId });
}

function receive(peer, chunk) {
  if (peer.buffer.length + chunk.length > LAN_MAX_BUFFER_BYTES) { peer.socket.destroy(); return; }
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0], second = peer.buffer[1], opcode = first & 15;
    if ((second & 128) === 0) { peer.socket.destroy(); return; }
    let length = second & 127, offset = 2;
    if (length === 126) { if (peer.buffer.length < 4) return; length = peer.buffer.readUInt16BE(2); offset = 4; }
    if (length === 127 || length > LAN_MAX_CLIENT_FRAME_BYTES) { peer.socket.destroy(); return; }
    if (peer.buffer.length < offset + 4 + length) return;
    const mask = peer.buffer.subarray(offset, offset + 4); offset += 4;
    const payload = Buffer.from(peer.buffer.subarray(offset, offset + length));
    peer.buffer = peer.buffer.subarray(offset + length);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    if (opcode === 8) return peer.socket.end();
    if (opcode === 9) { peer.socket.write(Buffer.from([0x8a, 0])); continue; }
    if (opcode !== 1) continue;
    try { handleMessage(peer, JSON.parse(payload.toString("utf8"))); } catch { /* ignore malformed input */ }
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
  if (!isAllowedOrigin(request.headers.origin, { port, host: request.headers.host, configured: allowedOrigins })) {
    debug("reject-origin", { origin: request.headers.origin || null, host: request.headers.host || null });
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  debug("upgrade", { origin: request.headers.origin || null, host: request.headers.host || null });
  const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const peer = { id: randomUUID(), socket, buffer: Buffer.alloc(0), lastInputSequence: 0, lastSeen: Date.now(), inputWindowStarted: Date.now(), inputCount: 0, hello: false, helloTimer: null, sessionId: null, team: null, reconnectTimer: null };
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
  if (!peer.hello) { peers.delete(peer.id); return; }
  peer.reconnectTimer = setTimeout(() => {
    if (peer.socket || !peers.has(peer.id)) return;
    peers.delete(peer.id);
    match.removeHuman(peer.id);
    sessionOwnerId = releaseSessionOwner(sessionOwnerId, peer.id);
    if (!sessionOwnerId) {
      const replacement = [...peers.values()].find(candidate => candidate.hello && candidate.socket && !candidate.socket.destroyed);
      sessionOwnerId = replacement?.id || null;
      if (replacement?.socket) send(replacement.socket, { type: "session-owner", owner: true, protocolVersion: LAN_PROTOCOL_VERSION, roomId });
    }
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

app.listen(port, "0.0.0.0", () => console.log(`Car Soccer: Arsenal · backend=${movementBackend} · http://localhost:${port}`));

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
