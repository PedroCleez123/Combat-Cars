import {
  createP2PHello,
  createP2PHostSnapshot,
  createP2PInput,
  createP2PWelcome,
  decodeP2PMessage,
  P2P_CONTROL_CHANNEL,
  P2P_LOOPBACK_ROOM_ID,
} from "./p2p-session-protocol.js";
import { P2PHostMatch } from "./p2p-host-match.js";

const DEFAULT_TIMEOUT_MS = 10000;
const INPUTS = [1, 2, 3, 4].map(sequence => ({
  sequence,
  controls: { throttle: 1, steer: 0, boost: false, jump: false },
}));

function diagnosticError(reason) {
  const error = new Error(reason);
  error.diagnostic = reason;
  return error;
}

function emitStatus(onStatus, message) {
  try { onStatus(message); } catch { /* Status reporting cannot block peer cleanup. */ }
}

function bind(target, name, handler) {
  if (typeof target.addEventListener === "function") {
    target.addEventListener(name, handler);
    return () => target.removeEventListener?.(name, handler);
  }
  const property = `on${name}`;
  target[property] = handler;
  return () => { if (target[property] === handler) target[property] = null; };
}

function waitForIce(peer, timeoutMs) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(reject, diagnosticError("La recopilación ICE local superó el tiempo límite.")), timeoutMs);
    const remove = bind(peer, "icegatheringstatechange", () => {
      if (peer.iceGatheringState === "complete") finish(resolve);
    });
    function finish(done, value) { clearTimeout(timer); remove(); done(value); }
  });
}

function waitForOpen(channel, timeoutMs) {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const removeOpen = bind(channel, "open", () => finish(resolve));
    const removeClose = bind(channel, "close", () => finish(reject, diagnosticError("El canal cerró antes de abrir.")));
    const timer = setTimeout(() => finish(reject, diagnosticError("El canal superó el tiempo límite.")), timeoutMs);
    function finish(done, value) { clearTimeout(timer); removeOpen(); removeClose(); done(value); }
  });
}

function withTimeout(promise, timeoutMs, reason) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(diagnosticError(reason)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function send(channel, message) {
  if (channel?.readyState !== "open") throw diagnosticError("El canal de datos no está abierto.");
  channel.send(JSON.stringify(message));
}

function close(resource) {
  try { resource?.close?.(); } catch { /* Close all other local resources on partial failure. */ }
}

export async function closeP2PResources(peers, channels, timeoutMs) {
  const resources = [
    ...peers.filter(Boolean).map(resource => ({ resource, event: "connectionstatechange", isClosed: value => value.connectionState === "closed" })),
    ...[...channels].filter(Boolean).map(resource => ({ resource, event: "close", isClosed: value => value.readyState === "closed" })),
  ];
  const pending = resources.filter(item => !item.isClosed(item.resource));
  if (!pending.length) return { peersClosed: true };

  let removeListeners = () => {};
  let timer;
  const closed = new Promise(resolve => {
    const check = () => {
      if (resources.every(item => item.isClosed(item.resource))) resolve();
    };
    const removers = pending.map(({ resource, event }) => bind(resource, event, check));
    removeListeners = () => removers.forEach(remove => remove());
    timer = setTimeout(resolve, timeoutMs);
    check();
  });

  // Attach listeners before close(): browsers may dispatch state changes asynchronously.
  for (const { resource } of pending) close(resource);
  await closed;
  clearTimeout(timer);
  removeListeners();

  const peersClosed = resources.every(item => item.isClosed(item.resource));
  return peersClosed
    ? { peersClosed: true }
    : { peersClosed: false, reason: "El cierre de peers o canales WebRTC superó el tiempo límite." };
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z, a.h - b.h); }

export async function runP2PHostLoopback({
  RTCPeerConnection: PeerConnection = globalThis.RTCPeerConnection,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  roomId = P2P_LOOPBACK_ROOM_ID,
  sessionId = `host-${Math.random().toString(36).slice(2, 12)}`,
  onStatus = () => {},
} = {}) {
  if (typeof PeerConnection !== "function") return { ok: false, reason: "Este navegador no ofrece RTCPeerConnection.", peersClosed: true };
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000) {
    return { ok: false, reason: "El tiempo límite configurado no es válido.", peersClosed: true };
  }

  let hostPeer;
  let pilotPeer;
  let hostChannel;
  let pilotChannel;
  let closing = false;
  let rejectRun;
  const channels = new Set();
  const match = new P2PHostMatch();
  const initialPilot = match.snapshot().cars.find(car => car.id === "p2p-pilot");
  const snapshots = [];
  const appliedInputSequences = [];
  const rejectedInputSequences = [];
  let helloAccepted = false;
  let success;
  let failureReason;
  let snapshotSequence = 0;
  const context = { roomId, sessionId };
  let finish;
  const protocolComplete = new Promise((resolve, reject) => { finish = resolve; rejectRun = reject; });
  void protocolComplete.catch(() => {});

  try {
    emitStatus(onStatus, "Creando host autoritativo y piloto en dos peers WebRTC locales, sin STUN/TURN.");
    hostPeer = new PeerConnection({ iceServers: [] });
    pilotPeer = new PeerConnection({ iceServers: [] });
    pilotChannel = pilotPeer.createDataChannel(P2P_CONTROL_CHANNEL, { ordered: true });
    channels.add(pilotChannel);

    hostPeer.ondatachannel = event => {
      const channel = event?.channel;
      if (closing) { close(channel); return; }
      if (!channel || channel.label !== P2P_CONTROL_CHANNEL || channel.ordered !== true) {
        close(channel);
        rejectRun(diagnosticError("El host recibió un canal de datos inesperado."));
        return;
      }
      hostChannel = channel;
      channels.add(channel);
      bind(channel, "message", eventMessage => {
        const decoded = decodeP2PMessage(eventMessage?.data, context);
        if (!decoded.ok) { rejectRun(diagnosticError(decoded.reason)); return; }
        const message = decoded.message;
        if (message.type === "hello" && !helloAccepted) {
          helloAccepted = true;
          emitStatus(onStatus, "El host aceptó hello con sala y sesión válidas.");
          send(hostChannel, createP2PWelcome(context));
          return;
        }
        if (message.type !== "input" || !helloAccepted) {
          rejectRun(diagnosticError("El host recibió un mensaje fuera de orden."));
          return;
        }
        const outcome = match.receivePilotInput(message);
        if (!outcome.accepted) {
          rejectedInputSequences.push(message.sequence);
          emitStatus(onStatus, `El host rechazó input repetido o fuera de orden (${message.sequence}).`);
          return;
        }
        appliedInputSequences.push(message.sequence);
        const response = createP2PHostSnapshot({ ...context, sequence: ++snapshotSequence, snapshot: outcome.snapshot });
        send(hostChannel, response);
        emitStatus(onStatus, `El host avanzó a tick ${outcome.snapshot.tick} y transmitió snapshot ${snapshotSequence}.`);
      });
    };

    bind(pilotChannel, "message", event => {
      const decoded = decodeP2PMessage(event?.data, context);
      if (!decoded.ok) { rejectRun(diagnosticError(decoded.reason)); return; }
      const message = decoded.message;
      if (message.type === "welcome" && snapshots.length === 0) {
        emitStatus(onStatus, "El piloto recibió welcome; enviará cuatro inputs crecientes sólo al host.");
        for (const input of INPUTS) send(pilotChannel, createP2PInput({ ...context, ...input }));
        return;
      }
      if (message.type !== "snapshot" || message.sequence !== snapshots.length + 1) {
        rejectRun(diagnosticError("El piloto recibió un snapshot fuera de secuencia."));
        return;
      }
      snapshots.push(message);
      emitStatus(onStatus, `El piloto recibió snapshot ${message.sequence} (${message.snapshot.cars.length} coches).`);
      if (snapshots.length === INPUTS.length) finish();
    });

    emitStatus(onStatus, "Negociando oferta, respuesta e ICE localmente.");
    const offer = await pilotPeer.createOffer();
    await pilotPeer.setLocalDescription(offer);
    await waitForIce(pilotPeer, timeoutMs);
    await hostPeer.setRemoteDescription(pilotPeer.localDescription);
    await hostPeer.setLocalDescription(await hostPeer.createAnswer());
    await waitForIce(hostPeer, timeoutMs);
    await pilotPeer.setRemoteDescription(hostPeer.localDescription);

    await withTimeout(new Promise(resolve => {
      const channelReady = event => {
        const channel = event?.channel;
        if (channel?.label !== P2P_CONTROL_CHANNEL || channel.ordered !== true) return;
        hostChannel = channel;
        channels.add(channel);
        resolve(channel);
      };
      if (hostChannel) resolve(hostChannel);
      else {
        const previous = hostPeer.ondatachannel;
        hostPeer.ondatachannel = event => { previous?.(event); channelReady(event); };
      }
    }), timeoutMs, "El host no recibió el canal dentro del tiempo límite.");
    await Promise.all([waitForOpen(pilotChannel, timeoutMs), waitForOpen(hostChannel, timeoutMs)]);
    send(pilotChannel, createP2PHello(context));
    await withTimeout(protocolComplete, timeoutMs, "El intercambio de cuatro snapshots autoritativos superó el tiempo límite.");

    const first = snapshots[0].snapshot.cars.find(car => car.id === "p2p-pilot");
    const last = snapshots.at(-1).snapshot.cars.find(car => car.id === "p2p-pilot");
    const movedDistance = first && last ? distance(first, last) : 0;
    if (!first || !last || movedDistance <= 0.01) throw diagnosticError("El coche piloto no mostró movimiento medible.");
    const tickCount = snapshots.at(-1).snapshot.tick;
    if (tickCount < INPUTS.length * 2) throw diagnosticError("El host no avanzó los ticks fijos esperados.");
    emitStatus(onStatus, `Validado: el piloto se movió ${movedDistance.toFixed(2)} unidades; el host alcanzó ${tickCount} ticks.`);
  } catch (error) {
    const reason = error?.diagnostic || "No se pudo completar la prueba P2P host local.";
    emitStatus(onStatus, reason);
    failureReason = reason;
  } finally {
    closing = true;
    const cleanup = await closeP2PResources([hostPeer, pilotPeer], channels, timeoutMs);
    if (!cleanup.peersClosed) {
      emitStatus(onStatus, cleanup.reason);
      if (!failureReason) failureReason = cleanup.reason;
    } else {
      emitStatus(onStatus, "Peers cerrados.");
    }
    success = cleanup;
  }

  if (failureReason) return {
    ok: false,
    reason: failureReason,
    snapshots: snapshots.length,
    peersClosed: success.peersClosed,
    ...(success.reason ? { cleanupError: success.reason } : {}),
  };

  const first = snapshots[0].snapshot.cars.find(car => car.id === "p2p-pilot");
  const last = snapshots.at(-1).snapshot.cars.find(car => car.id === "p2p-pilot");
  return {
    ok: true,
    roomId,
    sessionId,
    snapshots: snapshots.map(message => message.snapshot),
    snapshotSequences: snapshots.map(message => message.sequence),
    appliedInputSequences,
    rejectedInputSequences,
    tickCount: snapshots.at(-1).snapshot.tick,
    movedDistance: distance(first, last),
    initialPilotPosition: { x: initialPilot.x, z: initialPilot.z, h: initialPilot.h },
    channelLabel: P2P_CONTROL_CHANNEL,
    peersClosed: success.peersClosed,
  };
}
