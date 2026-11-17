import {
  P2P_CONTROL_CHANNEL,
  P2P_METADATA_CHANNEL,
  P2P_MAX_MESSAGE_BYTES,
  createP2PWebRTCCandidate,
  createP2PWebRTCDescription,
  normalizeP2PWebRTCSignal,
} from "./p2p-session-protocol.js";
import { isP2PIceConnectionState } from "./p2p-room-config.js";

const MAX_QUEUED_CANDIDATES = 64;
const MAX_SEEN_CANDIDATES = 128;
// The ordinary P2P protocol remains capped at 2 KiB. The causal v5 renderer
// can opt in to one bounded 4 KiB control frame for two cars plus telemetry.
// v6 multiplayer snapshots carry up to six cars. The ordinary protocol keeps
// its smaller per-channel limit; the explicit multiplayer adapter opts into
// this bounded ceiling.
export const P2P_WEBRTC_MAX_MESSAGE_BYTES = 16 * 1024;
const encoder = new TextEncoder();

function safeEvent(type, fields = {}) {
  return Object.freeze({ type, ...fields });
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  try {
    const value = typeof candidate.toJSON === "function" ? candidate.toJSON() : candidate;
    return {
      candidate: value.candidate,
      sdpMid: value.sdpMid ?? null,
      sdpMLineIndex: value.sdpMLineIndex ?? null,
      usernameFragment: value.usernameFragment ?? null,
    };
  } catch {
    return null;
  }
}

export class P2PWebRTCSession {
  constructor({ role, signaling, RTCPeerConnection: PeerConnection = globalThis.RTCPeerConnection, iceServers = [], timeoutMs = 20_000, offerMode = "automatic", scheduler = globalThis, onEvent = () => {}, metadata = false, maxMessageBytes = P2P_MAX_MESSAGE_BYTES, metadataMaxMessageBytes = P2P_MAX_MESSAGE_BYTES } = {}) {
    if (role !== "host" && role !== "guest") throw new TypeError("Invalid P2P role.");
    if (!signaling || typeof signaling.on !== "function" || typeof signaling.sendSignal !== "function") {
      throw new TypeError("A connected signaling client is required.");
    }
    if (typeof PeerConnection !== "function") throw new TypeError("RTCPeerConnection is unavailable.");
    if (!Array.isArray(iceServers) || !Number.isFinite(timeoutMs) || timeoutMs < 1
      || (offerMode !== "automatic" && offerMode !== "deferred") || typeof onEvent !== "function"
      || typeof metadata !== "boolean"
      || !Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < P2P_MAX_MESSAGE_BYTES || maxMessageBytes > P2P_WEBRTC_MAX_MESSAGE_BYTES
      || !Number.isSafeInteger(metadataMaxMessageBytes) || metadataMaxMessageBytes < P2P_MAX_MESSAGE_BYTES || metadataMaxMessageBytes > P2P_WEBRTC_MAX_MESSAGE_BYTES
      || typeof scheduler?.setTimeout !== "function" || typeof scheduler?.clearTimeout !== "function") {
      throw new TypeError("Invalid P2P WebRTC session options.");
    }
    this.role = role;
    this.signaling = signaling;
    this.PeerConnection = PeerConnection;
    this.iceServers = iceServers;
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
    this.offerMode = offerMode;
    this.metadataEnabled = metadata;
    this.maxMessageBytes = maxMessageBytes;
    this.metadataMaxMessageBytes = metadataMaxMessageBytes;
    this.scheduler = scheduler;
    this.state = "new";
    this.pc = null;
    this.channel = null;
    this.metadataChannel = null;
    this.metadataChannelOpen = false;
    this.started = false;
    this.offerStarted = false;
    this.terminal = false;
    this.remoteDescriptionSet = false;
    this.remoteDescriptionSeen = false;
    this.localDescriptionSent = false;
    this.queuedCandidates = [];
    this.seenCandidates = new Set();
    this.unsubscribers = [];
    this.timer = null;
    this.channelCleanup = [];
    this.metadataChannelCleanup = [];
    this.pcHandlers = null;
    this.lastIceState = null;
  }

  start() {
    if (this.started || this.terminal) return this;
    this.started = true;
    this.state = "negotiating";
    this.emit("negotiating");
    this.subscribe("signal", (event) => {
      // Once the ordered control channel is open, the direct WebRTC path is
      // authoritative. Late relay messages cannot improve an established
      // connection and a malformed/stale one must not tear down a live match.
      if (this.state === "channel-open") return;
      void this.handleSignal(event?.payload);
    });
    this.subscribe("peer-left", (event) => {
      if (this.terminal) return;
      // A signaling WebSocket is only a rendezvous mechanism. It can be
      // released or transiently interrupted after ICE has completed while the
      // DataChannel remains healthy. The DataChannel close event remains the
      // source of truth for a departed direct peer.
      if (this.state === "channel-open") return;
      this.emit("peer-left", { role: event?.role === "host" ? "host" : "guest" });
      this.finish();
    });
    this.subscribe("closed", () => {
      if (this.state !== "channel-open") this.finish();
    });
    this.subscribe("error", () => {
      if (this.state !== "channel-open") this.fail("signaling-error", "La conexión de señalización falló.");
    });
    try {
      this.pc = new this.PeerConnection({ iceServers: this.iceServers });
      this.installPeerHandlers();
      if (this.role === "host") {
        this.channel = this.pc.createDataChannel(P2P_CONTROL_CHANNEL, { ordered: true });
        if (!this.validChannel(this.channel)) return this.fail("channel-invalid", "No se pudo crear el canal de control.");
        this.installChannelHandlers(this.channel);
        if (this.metadataEnabled) this.createMetadataChannel();
        if (this.offerMode === "automatic") this.beginOffer();
      } else {
        this.startTimeout();
      }
    } catch {
      this.fail("peer-setup-failed", "No se pudo iniciar la sesión WebRTC.");
    }
    return this;
  }

  createMetadataChannel() {
    if (this.terminal || this.role !== "host" || this.metadataChannel) return this.metadataChannel;
    let channel;
    try { channel = this.pc?.createDataChannel(P2P_METADATA_CHANNEL, { ordered: true }); }
    catch (error) {
      this.emitMetadataError("metadata-channel-create-failed", error);
      return null;
    }
    if (!this.validMetadataChannel(channel)) {
      try { if (channel && channel.readyState !== "closed") channel.close(); } catch { /* Optional channel cleanup is best effort. */ }
      this.emitMetadataError("metadata-channel-invalid", new Error("No se pudo crear el canal de metadatos."));
      return null;
    }
    this.metadataChannel = channel;
    this.installMetadataChannelHandlers(channel);
    return channel;
  }

  beginOffer() {
    if (this.role !== "host" || !this.started || this.terminal || this.offerStarted) return this;
    this.offerStarted = true;
    this.startTimeout();
    void this.createOffer();
    return this;
  }

  startTimeout() {
    if (this.terminal || this.timer !== null) return;
    this.timer = this.scheduler.setTimeout(() => {
      if (!this.terminal) this.fail("negotiation-timeout", "La negociación WebRTC agotó el tiempo.");
    }, this.timeoutMs);
  }

  subscribe(type, listener) {
    try {
      const remove = this.signaling.on(type, listener);
      if (typeof remove === "function") this.unsubscribers.push(remove);
    } catch {
      this.fail("signaling-listener-failed", "No se pudo observar la señalización.");
    }
  }

  installPeerHandlers() {
    const onicecandidate = (event) => {
      // Trickle ICE belongs to the negotiation phase. Sending late candidates
      // after the direct channel is already open reintroduces a dependency on
      // the disposable signaling socket and can falsely end a live match.
      if (this.terminal || this.state === "channel-open" || !event?.candidate) return;
      const candidate = normalizeCandidate(event.candidate);
      if (!candidate) return this.fail("candidate-invalid", "Se produjo un candidato ICE no válido.");
      try { this.signaling.sendSignal(createP2PWebRTCCandidate(candidate)); }
      catch { this.fail("signal-send-failed", "No se pudo enviar una señal WebRTC."); }
    };
    const ondatachannel = (event) => {
      if (this.terminal) return;
      const channel = event?.channel;
      if (this.role === "guest" && this.validMetadataChannel(channel)) {
        if (this.metadataChannel) {
          try { if (channel.readyState !== "closed") channel.close(); } catch { /* Reject duplicate optional channels safely. */ }
          return;
        }
        this.metadataChannel = channel;
        this.installMetadataChannelHandlers(channel);
        return;
      }
      if (this.role === "guest" && channel?.label === P2P_METADATA_CHANNEL) {
        try { if (channel.readyState !== "closed") channel.close(); } catch { /* Reject malformed optional channels safely. */ }
        this.emitMetadataError("metadata-channel-invalid", new TypeError("El canal de metadatos no es válido."));
        return;
      }
      if (this.role !== "guest" || this.channel || !this.validChannel(channel)) {
        try { if (channel && channel.readyState !== "closed") channel.close(); } catch { /* Reject malformed channels safely. */ }
        return this.fail("channel-invalid", "El canal de control recibido no es válido.");
      }
      this.channel = channel;
      this.installChannelHandlers(channel);
    };
    const onconnectionstatechange = () => {
      if (!this.terminal && this.pc?.connectionState === "failed") this.fail("peer-connection-failed", "Falló la conexión WebRTC.");
    };
    const oniceconnectionstatechange = () => {
      if (this.terminal) return;
      this.emitIceState(this.pc?.iceConnectionState);
    };
    this.pcHandlers = { onicecandidate, ondatachannel, onconnectionstatechange, oniceconnectionstatechange };
    this.pc.onicecandidate = onicecandidate;
    this.pc.ondatachannel = ondatachannel;
    this.pc.onconnectionstatechange = onconnectionstatechange;
    this.pc.oniceconnectionstatechange = oniceconnectionstatechange;
    this.emitIceState(this.pc?.iceConnectionState);
  }

  validChannel(channel) {
    return Boolean(channel)
      && channel.label === P2P_CONTROL_CHANNEL
      && channel.ordered === true;
  }

  validMetadataChannel(channel) {
    return Boolean(channel)
      && channel.label === P2P_METADATA_CHANNEL
      && channel.ordered === true;
  }

  installChannelHandlers(channel) {
    const listen = (type, listener) => {
      if (typeof channel.addEventListener === "function") {
        channel.addEventListener(type, listener);
        this.channelCleanup.push(() => channel.removeEventListener(type, listener));
      } else {
        const property = `on${type}`;
        const previous = channel[property];
        channel[property] = listener;
        this.channelCleanup.push(() => { if (channel[property] === listener) channel[property] = previous || null; });
      }
    };
    const onOpen = () => {
      if (this.terminal || this.channel !== channel) return;
      if (channel.readyState !== "open") return;
      if (this.state === "channel-open") return;
      this.clearTimer();
      this.state = "channel-open";
      this.emit("channel-open");
    };
    listen("open", onOpen);
    listen("message", (event) => {
      if (this.terminal || this.channel !== channel) return;
      const data = event?.data;
      if (typeof data !== "string" || encoder.encode(data).byteLength > this.maxMessageBytes) {
        return this.fail("channel-message-invalid", "Se recibió un mensaje de canal no válido.");
      }
      this.emit("channel-message", { data });
    });
    listen("close", () => {
      if (!this.terminal) {
        this.emit("peer-left", { role: this.role === "host" ? "guest" : "host" });
        this.finish();
      }
    });
    listen("error", () => this.fail("channel-error", "Falló el canal de control."));
    if (channel.readyState === "open") {
      globalThis.queueMicrotask(onOpen);
    }
  }

  installMetadataChannelHandlers(channel) {
    const listen = (type, listener) => {
      if (typeof channel.addEventListener === "function") {
        channel.addEventListener(type, listener);
        this.metadataChannelCleanup.push(() => channel.removeEventListener(type, listener));
      } else {
        const property = `on${type}`;
        const previous = channel[property];
        channel[property] = listener;
        this.metadataChannelCleanup.push(() => { if (channel[property] === listener) channel[property] = previous || null; });
      }
    };
    const onOpen = () => {
      if (this.terminal || this.metadataChannel !== channel || channel.readyState !== "open") return;
      if (this.metadataChannelOpen) return;
      this.metadataChannelOpen = true;
      this.emit("metadata-channel-open");
    };
    listen("open", onOpen);
    listen("message", event => {
      if (this.terminal || this.metadataChannel !== channel) return;
      const data = event?.data;
      if (typeof data !== "string" || encoder.encode(data).byteLength > this.metadataMaxMessageBytes) {
        this.emitMetadataError("metadata-message-invalid", new TypeError("El mensaje de metadatos no es válido."));
        this.closeMetadata();
        return;
      }
      this.emit("metadata-message", { data });
    });
    listen("close", () => {
      if (this.metadataChannel !== channel) return;
      this.metadataChannelOpen = false;
      this.emit("metadata-channel-closed");
    });
    listen("error", () => {
      this.emitMetadataError("metadata-channel-error", new Error("Falló el canal de metadatos."));
      this.closeMetadata();
    });
    if (channel.readyState === "open") globalThis.queueMicrotask(onOpen);
  }

  async createOffer() {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const sdp = this.pc.localDescription?.sdp ?? offer?.sdp;
      const signal = createP2PWebRTCDescription("offer", sdp);
      this.signaling.sendSignal(signal);
      this.localDescriptionSent = true;
    } catch {
      this.fail("offer-failed", "No se pudo crear la oferta WebRTC.");
    }
  }

  async handleSignal(payload) {
    if (this.terminal) return;
    const signal = normalizeP2PWebRTCSignal(payload);
    if (!signal) return this.fail("signal-invalid", "Se recibió una señal WebRTC no válida.");
    if (signal.type === "candidate") return this.receiveCandidate(signal.candidate);
    if (this.remoteDescriptionSeen) return this.fail("description-duplicate", "Se recibió una descripción WebRTC duplicada.");
    if (this.role === "guest" && signal.type !== "offer") return this.fail("description-order", "El orden de negociación WebRTC no es válido.");
    if (this.role === "host" && (signal.type !== "answer" || !this.localDescriptionSent)) {
      return this.fail("description-order", "El orden de negociación WebRTC no es válido.");
    }
    this.remoteDescriptionSeen = true;
    try {
      await this.pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
      this.remoteDescriptionSet = true;
      await this.flushCandidates();
      if (this.role === "guest") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        const sdp = this.pc.localDescription?.sdp ?? answer?.sdp;
        this.signaling.sendSignal(createP2PWebRTCDescription("answer", sdp));
        this.localDescriptionSent = true;
      }
    } catch {
      this.fail("description-apply-failed", "No se pudo aplicar la descripción WebRTC.");
    }
  }

  receiveCandidate(candidate) {
    const key = JSON.stringify(candidate);
    if (this.seenCandidates.has(key)) return this.fail("candidate-duplicate", "Se recibió un candidato ICE duplicado.");
    if (this.seenCandidates.size >= MAX_SEEN_CANDIDATES) return this.fail("candidate-limit", "Se excedió el límite de candidatos ICE.");
    this.seenCandidates.add(key);
    if (!this.remoteDescriptionSet) {
      if (this.queuedCandidates.length >= MAX_QUEUED_CANDIDATES) return this.fail("candidate-queue-limit", "Se excedió la cola de candidatos ICE.");
      this.queuedCandidates.push(candidate);
      return;
    }
    void this.addCandidate(candidate);
  }

  async flushCandidates() {
    const candidates = this.queuedCandidates.splice(0);
    for (const candidate of candidates) {
      if (this.terminal) return;
      await this.addCandidate(candidate);
    }
  }

  async addCandidate(candidate) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      this.fail("candidate-apply-failed", "No se pudo aplicar un candidato ICE.");
    }
  }

  send(data) {
    if (this.terminal || this.state !== "channel-open" || !this.channel || this.channel.readyState !== "open") {
      throw new Error("El canal P2P no está abierto.");
    }
    if (typeof data !== "string" || encoder.encode(data).byteLength > this.maxMessageBytes) {
      throw new TypeError("El mensaje P2P no es válido o supera el límite permitido.");
    }
    try { this.channel.send(data); }
    catch (error) {
      const state = typeof this.channel?.readyState === "string" ? ` (${this.channel.readyState})` : "";
      this.fail("channel-send-failed", `No se pudo enviar el mensaje P2P${state}.`);
      throw new Error(`No se pudo enviar el mensaje P2P${state}.`, { cause: error });
    }
  }

  sendMetadata(data) {
    const channel = this.metadataChannel;
    if (this.terminal || !channel || this.metadataChannelOpen !== true || channel.readyState !== "open") return false;
    if (typeof data !== "string" || encoder.encode(data).byteLength > this.metadataMaxMessageBytes) return false;
    try {
      channel.send(data);
      return true;
    } catch (error) {
      this.emitMetadataError("metadata-send-failed", error);
      this.closeMetadata();
      return false;
    }
  }

  closeMetadata() {
    const channel = this.metadataChannel;
    this.metadataChannelOpen = false;
    if (channel && channel.readyState !== "closed") {
      try { channel.close(); } catch { /* Optional channel cleanup is best effort. */ }
    }
    return this;
  }

  emitMetadataError(code, cause) {
    this.emit("metadata-error", { error: Object.freeze({ code, message: typeof cause?.message === "string" ? cause.message : "El canal de metadatos falló." }) });
  }

  emit(type, fields = {}) {
    try { this.onEvent(safeEvent(type, fields)); } catch { /* Observers cannot break session cleanup. */ }
  }

  emitIceState(state) {
    if (!isP2PIceConnectionState(state) || state === this.lastIceState) return false;
    this.lastIceState = state;
    this.emit("ice-state", { state });
    return true;
  }

  fail(code, message) {
    if (this.terminal) return;
    this.emit("error", { error: Object.freeze({ code, message }) });
    this.finish();
  }

  clearTimer() {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  finish() {
    if (this.terminal) return;
    this.terminal = true;
    this.state = "closed";
    this.emitIceState("closed");
    this.clearTimer();
    for (const remove of this.unsubscribers.splice(0)) {
      try { remove(); } catch { /* Cleanup continues for other resources. */ }
    }
    for (const remove of this.channelCleanup.splice(0)) {
      try { remove(); } catch { /* Cleanup continues for other resources. */ }
    }
    for (const remove of this.metadataChannelCleanup.splice(0)) {
      try { remove(); } catch { /* Cleanup continues for other resources. */ }
    }
    if (this.pcHandlers && this.pc) {
      for (const key of Object.keys(this.pcHandlers)) {
        try { if (this.pc[key] === this.pcHandlers[key]) this.pc[key] = null; } catch { /* Peer may already be disposed. */ }
      }
    }
    const channel = this.channel;
    this.channel = null;
    if (channel && channel.readyState !== "closed") {
      try { channel.close(); } catch { /* Channel may already be closed. */ }
    }
    const metadataChannel = this.metadataChannel;
    this.metadataChannel = null;
    this.metadataChannelOpen = false;
    if (metadataChannel && metadataChannel.readyState !== "closed") {
      try { metadataChannel.close(); } catch { /* Optional channel may already be closed. */ }
    }
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      try { pc.close(); } catch { /* Peer may already be closed. */ }
    }
    this.queuedCandidates.length = 0;
    this.emit("closed");
  }

  close() {
    this.finish();
  }
}
