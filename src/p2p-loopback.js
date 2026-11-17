import {
  createP2PHello,
  createP2PInput,
  createP2PState,
  createP2PWelcome,
  decodeP2PMessage,
  P2P_CONTROL_CHANNEL,
  P2P_LOOPBACK_ROOM_ID,
} from "./p2p-session-protocol.js";

const LOOPBACK_CONTROLS = Object.freeze({ throttle: 0.5, steer: -0.25, boost: true, jump: false });
const DEFAULT_TIMEOUT_MS = 10000;

function diagnosticError(reason) {
  const error = new Error(reason);
  error.diagnostic = reason;
  return error;
}

function emitStatus(onStatus, message) {
  try {
    onStatus(message);
  } catch {
    // Diagnostics must not interrupt transport cleanup.
  }
}

function makeSessionId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function bindEvent(target, eventName, handler) {
  if (typeof target.addEventListener === "function") {
    target.addEventListener(eventName, handler);
    return () => target.removeEventListener?.(eventName, handler);
  }
  const property = `on${eventName}`;
  const previous = target[property];
  target[property] = function(event) {
    previous?.call(this, event);
    handler(event);
  };
  return () => {
    if (target[property] !== handler) target[property] = previous || null;
  };
}

function waitForIceGatheringComplete(peer, timeoutMs) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = bindEvent(peer, "icegatheringstatechange", check);
    const timer = setTimeout(() => finish(reject, diagnosticError("La recopilación ICE local superó el tiempo límite.")), timeoutMs);

    function finish(done, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      done(value);
    }

    function check() {
      if (peer.iceGatheringState === "complete") finish(resolve);
    }

    check();
  });
}

function waitForChannelOpen(channel, timeoutMs) {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const removeOpen = bindEvent(channel, "open", () => finish(resolve));
    const removeClose = bindEvent(channel, "close", () => finish(reject, diagnosticError("El canal de datos se cerró antes de abrirse.")));
    const timer = setTimeout(() => finish(reject, diagnosticError("El canal de datos superó el tiempo límite.")), timeoutMs);

    function finish(done, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeOpen();
      removeClose();
      done(value);
    }

    if (channel.readyState === "open") finish(resolve);
  });
}

function withTimeout(promise, timeoutMs, reason) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(diagnosticError(reason)), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sendMessage(channel, message) {
  if (!channel || channel.readyState !== "open") {
    throw diagnosticError("El canal de datos no está abierto.");
  }
  channel.send(JSON.stringify(message));
}

function closeQuietly(resource) {
  try {
    resource?.close?.();
  } catch {
    // Cleanup is best effort for partially constructed browser peers.
  }
}

export async function runP2PLoopback({
  RTCPeerConnection: PeerConnection = globalThis.RTCPeerConnection,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  roomId = P2P_LOOPBACK_ROOM_ID,
  sessionId = makeSessionId(),
  onStatus = () => {},
} = {}) {
  if (typeof PeerConnection !== "function") {
    const reason = "Este navegador no ofrece RTCPeerConnection.";
    emitStatus(onStatus, reason);
    return { ok: false, reason };
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000) {
    const reason = "El tiempo límite configurado no es válido.";
    emitStatus(onStatus, reason);
    return { ok: false, reason };
  }

  let hostPeer;
  let pilotPeer;
  let pilotChannel;
  let hostChannel;
  let closing = false;
  const channels = new Set();
  let resolveHostChannel;
  let rejectHostChannel;
  let hostChannelSettled = false;
  const hostChannelReady = new Promise((resolve, reject) => {
    resolveHostChannel = resolve;
    rejectHostChannel = reject;
  });
  void hostChannelReady.catch(() => {});
  const acceptHostChannel = channel => {
    if (hostChannelSettled) return;
    hostChannelSettled = true;
    resolveHostChannel(channel);
  };
  const failHostChannel = reason => {
    if (hostChannelSettled) return;
    hostChannelSettled = true;
    rejectHostChannel(diagnosticError(reason));
  };
  let protocolResolve;
  let protocolReject;
  let protocolSettled = false;
  const protocolComplete = new Promise((resolve, reject) => {
    protocolResolve = resolve;
    protocolReject = reject;
  });
  void protocolComplete.catch(() => {});
  const rejectProtocol = reason => {
    if (protocolSettled) return;
    protocolSettled = true;
    protocolReject(diagnosticError(reason));
  };
  const resolveProtocol = result => {
    if (protocolSettled) return;
    protocolSettled = true;
    protocolResolve(result);
  };
  const context = { roomId, sessionId };
  let helloAccepted = false;
  let welcomeSent = false;
  let welcomeReceived = false;
  let inputSent = false;

  try {
    emitStatus(onStatus, "Creando dos peers WebRTC locales sin STUN/TURN.");
    hostPeer = new PeerConnection({ iceServers: [] });
    pilotPeer = new PeerConnection({ iceServers: [] });
    pilotChannel = pilotPeer.createDataChannel(P2P_CONTROL_CHANNEL, { ordered: true });
    channels.add(pilotChannel);

    hostPeer.ondatachannel = event => {
      const channel = event?.channel;
      if (closing) {
        closeQuietly(channel);
        return;
      }
      if (!channel || channel.label !== P2P_CONTROL_CHANNEL || channel.ordered !== true) {
        closeQuietly(channel);
        const reason = "El host recibió un canal de datos inesperado.";
        failHostChannel(reason);
        rejectProtocol(reason);
        return;
      }
      hostChannel = channel;
      channels.add(channel);
      acceptHostChannel(channel);
      bindEvent(channel, "message", eventMessage => {
        const decoded = decodeP2PMessage(eventMessage?.data, context);
        if (!decoded.ok) {
          rejectProtocol(decoded.reason);
          return;
        }
        const message = decoded.message;
        if (message.type === "hello" && !helloAccepted) {
          helloAccepted = true;
          emitStatus(onStatus, "El host aceptó hello con sala y sesión válidas.");
          try {
            sendMessage(hostChannel, createP2PWelcome(context));
            welcomeSent = true;
          } catch {
            rejectProtocol("El host no pudo enviar welcome.");
          }
          return;
        }
        if (message.type === "input" && helloAccepted && welcomeSent && message.sequence === 1) {
          emitStatus(onStatus, "El host aceptó input, secuencia 1.");
          try {
            sendMessage(hostChannel, createP2PState({ ...context, sequence: message.sequence, controls: message.controls }));
          } catch {
            rejectProtocol("El host no pudo devolver state.");
          }
          return;
        }
        rejectProtocol("El host recibió un mensaje fuera de orden.");
      });
    };

    bindEvent(pilotChannel, "message", event => {
      const decoded = decodeP2PMessage(event?.data, context);
      if (!decoded.ok) {
        rejectProtocol(decoded.reason);
        return;
      }
      const message = decoded.message;
      if (message.type === "welcome" && !welcomeReceived) {
        welcomeReceived = true;
        emitStatus(onStatus, "El piloto recibió welcome.");
        try {
          sendMessage(pilotChannel, createP2PInput({ ...context, sequence: 1, controls: LOOPBACK_CONTROLS }));
          inputSent = true;
        } catch {
          rejectProtocol("El piloto no pudo enviar input.");
        }
        return;
      }
      if (message.type === "state" && inputSent && message.sequence === 1
        && JSON.stringify(message.state.controls) === JSON.stringify(LOOPBACK_CONTROLS)) {
        emitStatus(onStatus, "El piloto recibió state para la secuencia 1.");
        resolveProtocol({ sequence: message.sequence, channelLabel: P2P_CONTROL_CHANNEL, ordered: true });
        return;
      }
      rejectProtocol("El piloto recibió un mensaje fuera de orden o state no coincidente.");
    });

    emitStatus(onStatus, "Negociando oferta, respuesta e ICE directamente entre peers.");
    const offer = await pilotPeer.createOffer();
    await pilotPeer.setLocalDescription(offer);
    await waitForIceGatheringComplete(pilotPeer, timeoutMs);
    await hostPeer.setRemoteDescription(pilotPeer.localDescription);

    const answer = await hostPeer.createAnswer();
    await hostPeer.setLocalDescription(answer);
    await waitForIceGatheringComplete(hostPeer, timeoutMs);
    await pilotPeer.setRemoteDescription(hostPeer.localDescription);
    hostChannel = await withTimeout(
      hostChannelReady,
      timeoutMs,
      "El host no creó el canal de datos esperado dentro del tiempo límite.",
    );

    await Promise.all([
      waitForChannelOpen(pilotChannel, timeoutMs),
      waitForChannelOpen(hostChannel, timeoutMs),
    ]);
    emitStatus(onStatus, "Canal ordenado arsenal-controls abierto.");
    sendMessage(pilotChannel, createP2PHello(context));
    emitStatus(onStatus, "El piloto envió hello.");

    const result = await withTimeout(
      protocolComplete,
      timeoutMs,
      "El intercambio hello/welcome/input/state superó el tiempo límite.",
    );
    emitStatus(onStatus, "Prueba P2P local completada.");
    return { ok: true, roomId, sessionId, ...result };
  } catch (error) {
    const reason = error?.diagnostic || "No se pudo completar la negociación WebRTC local.";
    emitStatus(onStatus, reason);
    return { ok: false, reason };
  } finally {
    closing = true;
    for (const channel of channels) closeQuietly(channel);
    closeQuietly(pilotPeer);
    closeQuietly(hostPeer);
    emitStatus(onStatus, "Peers y canales locales cerrados.");
  }
}
