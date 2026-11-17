import { P2PHostChannelSession, P2PPilotChannelSession } from "./p2p-match-channel.js";
import { P2P_LOOPBACK_ROOM_ID } from "./p2p-session-protocol.js";
import { P2PWebRTCSession } from "./p2p-webrtc-session.js";

const CONTROLS = Object.freeze({ throttle: 1, steer: 0, boost: false, jump: false });
const INPUT_COUNT = 4;
const DEFAULT_TIMEOUT_MS = 10_000;
const FIXED_HOST_TICK_MS = 1000 / 60;

class LocalSignaling {
  constructor() { this.listeners = new Map(); this.peer = null; }
  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
  sendSignal(payload) {
    // Signal delivery is asynchronous, as it would be through a room service.
    globalThis.queueMicrotask(() => this.peer?.emit("signal", { payload }));
  }
}

function diagnosticError(reason) {
  const error = new Error(reason);
  error.diagnostic = reason;
  return error;
}

function emitStatus(onStatus, message) {
  try { onStatus(message); } catch { /* Diagnostics never own the transport. */ }
}

function makeSessionId() {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function withTimeout(promise, timeoutMs, reason) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => { timer = globalThis.setTimeout(() => reject(diagnosticError(reason)), timeoutMs); }),
  ]).finally(() => globalThis.clearTimeout(timer));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z, a.h - b.h);
}

// End-to-end browser diagnostic for the reusable WebRTC session and the
// host-authoritative message boundary. It remains isolated from client.js and
// RocketSim; both peers live in the same browser and use no STUN/TURN.
export async function runP2PSessionLoopback({
  RTCPeerConnection: PeerConnection = globalThis.RTCPeerConnection,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  roomId = P2P_LOOPBACK_ROOM_ID,
  sessionId = makeSessionId(),
  onStatus = () => {},
} = {}) {
  if (typeof PeerConnection !== "function") return { ok: false, reason: "Este navegador no ofrece RTCPeerConnection." };
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000) {
    return { ok: false, reason: "El tiempo límite configurado no es válido." };
  }

  const hostSignaling = new LocalSignaling();
  const pilotSignaling = new LocalSignaling();
  hostSignaling.peer = pilotSignaling;
  pilotSignaling.peer = hostSignaling;
  const context = { roomId, sessionId };
  const snapshots = [];
  let hostTransport;
  let pilotTransport;
  let hostBoundary = null;
  let pilotBoundary = null;
  let hostChannelOpen = false;
  let pilotChannelOpen = false;
  let closing = false;
  let result;
  let hostTickTimer = null;
  let settled = false;
  let resolveProtocol;
  let rejectProtocol;
  const protocol = new Promise((resolve, reject) => { resolveProtocol = resolve; rejectProtocol = reject; });
  void protocol.catch(() => {});
  const complete = result => {
    if (settled) return;
    settled = true;
    resolveProtocol(result);
  };
  const fail = reason => {
    if (settled) return;
    settled = true;
    rejectProtocol(diagnosticError(reason));
  };

  const beginGameBoundary = () => {
    if (closing || hostBoundary || !hostChannelOpen || !pilotChannelOpen) return;
    hostBoundary = new P2PHostChannelSession({
      ...context,
      advanceOnPilotInput: false,
      send: serialized => hostTransport.send(serialized),
    });
    pilotBoundary = new P2PPilotChannelSession({
      ...context,
      send: serialized => pilotTransport.send(serialized),
    });
    emitStatus(onStatus, "Los dos canales ordenados están abiertos; el piloto envía hello al host autoritativo.");
    const hello = pilotBoundary.start();
    if (!hello.accepted) fail(hello.reason);
  };

  const startFixedHostTick = () => {
    if (closing || hostTickTimer !== null || !hostBoundary) return;
    const localInput = hostBoundary.setHostInput({ throttle: 0.5, steer: 0, boost: false, jump: false });
    if (!localInput.accepted) return fail(localInput.reason);
    emitStatus(onStatus, "El host conserva ambos controles y empieza su tick fijo de 60 Hz.");
    hostTickTimer = globalThis.setInterval(() => {
      if (closing || !hostBoundary || snapshots.length >= INPUT_COUNT) return;
      const outcome = hostBoundary.advance(1);
      if (!outcome.accepted && outcome.close) fail(outcome.reason);
    }, FIXED_HOST_TICK_MS);
  };

  const handleHostEvent = event => {
    if (event.type === "channel-open") {
      hostChannelOpen = true;
      emitStatus(onStatus, "Canal del host abierto.");
      beginGameBoundary();
      return;
    }
    if (event.type === "channel-message") {
      const outcome = hostBoundary?.receive(event.data);
      if (!outcome || (outcome.close && !closing)) fail(outcome?.reason || "El host recibió un mensaje antes de preparar la partida.");
      else if (outcome.type === "input") startFixedHostTick();
      return;
    }
    if (event.type === "error") fail(event.error?.message || "Falló el transporte WebRTC del host.");
    if (event.type === "peer-left" && !closing) fail("El piloto cerró el canal WebRTC.");
  };

  const handlePilotEvent = event => {
    if (event.type === "channel-open") {
      pilotChannelOpen = true;
      emitStatus(onStatus, "Canal del piloto abierto.");
      beginGameBoundary();
      return;
    }
    if (event.type === "channel-message") {
      const outcome = pilotBoundary?.receive(event.data);
      if (!outcome || (outcome.close && !closing)) return fail(outcome?.reason || "El piloto recibió un mensaje antes de preparar la partida.");
      if (outcome.type === "welcome") {
        emitStatus(onStatus, "Welcome validado; el piloto envía cuatro inputs al host.");
        for (let sequence = 0; sequence < INPUT_COUNT; sequence += 1) {
          const input = pilotBoundary.sendInput(CONTROLS);
          if (!input.accepted) return fail(input.reason);
        }
      } else if (outcome.type === "snapshot") {
        snapshots.push(outcome.snapshot);
        emitStatus(onStatus, `Snapshot ${snapshots.length} validado (tick ${outcome.snapshot.tick}).`);
        if (snapshots.length === INPUT_COUNT) {
          const first = snapshots[0].cars.find(car => car.id === "p2p-pilot");
          const last = snapshots.at(-1).cars.find(car => car.id === "p2p-pilot");
          const movedDistance = first && last ? distance(first, last) : 0;
          if (!first || !last || movedDistance <= 0.01) return fail("El piloto no mostró movimiento medible.");
          complete({ tickCount: snapshots.at(-1).tick, movedDistance, snapshots: snapshots.length });
        }
      }
      return;
    }
    if (event.type === "error") fail(event.error?.message || "Falló el transporte WebRTC del piloto.");
    if (event.type === "peer-left" && !closing) fail("El host cerró el canal WebRTC.");
  };

  try {
    emitStatus(onStatus, "Preparando dos peers WebRTC locales con oferta diferida, sin STUN/TURN.");
    pilotTransport = new P2PWebRTCSession({
      role: "guest", signaling: pilotSignaling, RTCPeerConnection: PeerConnection,
      iceServers: [], timeoutMs, onEvent: handlePilotEvent,
    });
    hostTransport = new P2PWebRTCSession({
      role: "host", signaling: hostSignaling, RTCPeerConnection: PeerConnection,
      iceServers: [], timeoutMs, offerMode: "deferred", onEvent: handleHostEvent,
    });
    pilotTransport.start();
    hostTransport.start();
    emitStatus(onStatus, "El receptor del piloto está preparado; el host inicia una única oferta diferida.");
    hostTransport.beginOffer();
    const protocolResult = await withTimeout(protocol, timeoutMs, "El diagnóstico P2P de sesión superó el tiempo límite.");
    emitStatus(onStatus, "Diagnóstico de sesión P2P completado.");
    result = { ok: true, roomId, sessionId, ...protocolResult };
  } catch (error) {
    const reason = error?.diagnostic || "No se pudo completar el diagnóstico de sesión P2P.";
    emitStatus(onStatus, reason);
    result = { ok: false, reason, snapshots: snapshots.length };
  } finally {
    closing = true;
    if (hostTickTimer !== null) globalThis.clearInterval(hostTickTimer);
    try { hostTransport?.close(); } catch { /* Best-effort cleanup. */ }
    try { pilotTransport?.close(); } catch { /* Best-effort cleanup. */ }
    result = { ...result, peersClosed: hostTransport?.state === "closed" && pilotTransport?.state === "closed" };
    emitStatus(onStatus, "Peers y canales de sesión cerrados.");
  }
  return result;
}
