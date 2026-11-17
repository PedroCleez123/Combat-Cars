// P2P-WASM-26: browser-safe coordination between the reusable WebRTC session
// and the isolated causal WASM channel. This module owns only lifecycle and
// event wiring; it does not add a transport protocol or a retry policy.
import { P2PWebRTCSession } from "../../src/p2p-webrtc-session.js";
import {
  P2PWasmCausalCombatHostChannelSession,
  P2PWasmCausalCombatPilotChannelSession,
} from "./p2p-wasm-causal-combat-channel.mjs";
import { causalCombatSnapshotFromHost } from "./p2p-wasm-causal-combat-protocol.mjs";
import { createP2PWasmCombatHost } from "./p2p-wasm-combat-host.mjs";
import { P2PWasmHostClock } from "./p2p-wasm-host-clock.mjs";
import { normalizeP2PPlayerName } from "../../src/p2p-player-identity.js";
import {
  createP2PWasmMetadataEnvelope,
  decodeP2PWasmMetadataEnvelope,
  P2P_WASM_METADATA_MAX_BYTES,
} from "./p2p-wasm-metadata-channel.mjs";
import { P2P_WASM_PRESENTATION_MAX_BYTES } from "./p2p-wasm-causal-combat-presentation-protocol.mjs";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_METADATA_EVERY_TICKS = 15;
const METADATA_PLAYER_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);
const METADATA_TEAMS = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
// The presentation renderer cannot start its input loop until it has received
// a two-car authoritative snapshot.  Prime the causal clock with one bounded
// neutral pilot command immediately after welcome so the host publishes that
// first frame instead of waiting for the renderer that depends on it.
const PILOT_PRIME_COMMAND = Object.freeze({
  controls: Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false }),
  fire: false,
  targetId: null,
});

function safeEvent(type, fields = {}) {
  return Object.freeze({ type, ...fields });
}

function errorMessage(error, fallback) {
  return typeof error?.message === "string" && error.message.length > 0
    ? error.message
    : fallback;
}

/**
 * Compose one host/pilot causal room boundary around an injected WebRTC
 * session. The pilot role is deliberately named `pilot` at this boundary;
 * it maps to the guest role required by P2PWebRTCSession.
 */
export class P2PWasmCausalRoomSession {
  constructor({
    role,
    signaling,
    roomId,
    sessionId,
    context,
    WebRTCSession = P2PWebRTCSession,
    hostFactory = createP2PWasmCombatHost,
    createHost,
    HostClock = P2PWasmHostClock,
    clockScheduler,
    hostClockOptions = {},
    onEvent = () => {},
    onSnapshot = () => {},
    onMetadata = () => {},
    onIdentity = () => {},
    identityName,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    iceServers = [],
    RTCPeerConnection,
    scheduler,
    webrtcOptions = {},
    presentation = false,
    primePilotOnWelcome = false,
    metadata = false,
    metadataEveryTicks = DEFAULT_METADATA_EVERY_TICKS,
  } = {}) {
    if (role !== "host" && role !== "pilot" && role !== "guest") {
      throw new TypeError("P2P WASM causal room role must be host or pilot.");
    }
    if (!signaling || typeof signaling.on !== "function") {
      throw new TypeError("P2P WASM causal room signaling is required.");
    }
    const resolvedContext = context || { roomId, sessionId };
    if (!resolvedContext || typeof resolvedContext !== "object") {
      throw new TypeError("P2P WASM causal room context is required.");
    }
    if (typeof resolvedContext.roomId !== "string" || typeof resolvedContext.sessionId !== "string") {
      throw new TypeError("P2P WASM causal room context must contain roomId and sessionId.");
    }
    if (typeof WebRTCSession !== "function" || typeof hostFactory !== "function"
      || typeof HostClock !== "function"
      || (createHost !== undefined && typeof createHost !== "function")
      || typeof onEvent !== "function" || typeof onSnapshot !== "function"
      || typeof onMetadata !== "function" || typeof onIdentity !== "function") {
      throw new TypeError("P2P WASM causal room dependencies are invalid.");
    }
    if (typeof presentation !== "boolean" || typeof primePilotOnWelcome !== "boolean" || typeof metadata !== "boolean"
      || !Number.isSafeInteger(metadataEveryTicks) || metadataEveryTicks < 1 || metadataEveryTicks > 60) {
      throw new TypeError("Las opciones de presentación/metadatos causales no son válidas.");
    }
    this.role = role === "guest" ? "pilot" : role;
    this.transportRole = this.role === "host" ? "host" : "guest";
    this.signaling = signaling;
    this.context = Object.freeze({ roomId: resolvedContext.roomId, sessionId: resolvedContext.sessionId });
    this.WebRTCSession = WebRTCSession;
    this.hostFactory = createHost || hostFactory;
    this.HostClock = HostClock;
    this.clockScheduler = clockScheduler;
    this.hostClockOptions = { ...hostClockOptions };
    this.onEvent = onEvent;
    this.onSnapshot = onSnapshot;
    this.onMetadata = onMetadata;
    this.onIdentity = onIdentity;
    this.identityName = identityName;
    this.timeoutMs = timeoutMs;
    this.iceServers = iceServers;
    this.RTCPeerConnection = RTCPeerConnection;
    this.scheduler = scheduler;
    this.webrtcOptions = { ...webrtcOptions };
    this.presentation = presentation;
    this.primePilotOnWelcome = primePilotOnWelcome;
    this.metadata = metadata;
    this.metadataEveryTicks = metadataEveryTicks;

    this.state = "new";
    this.peerReady = false;
    this.offerStarted = false;
    this.channelOpen = false;
    this.channelReady = false;
    this.transport = null;
    this.causalSession = null;
    this.host = null;
    this.hostClock = null;
    this.pendingMessages = [];
    this.signalingUnsubscribe = null;
    this.closing = false;
    this.closed = false;
    this.closeReason = null;
    this.metadataSequence = 0;
    this.lastMetadataAttemptTick = 0;
    this.lastMetadataTick = 0;
    this.pilotPrimed = false;
  }

  start() {
    if (this.state !== "new") return this;
    this.state = "starting";
    this.subscribePeerReady();
    if (this.closing) return this;
    try {
      const options = {
        ...this.webrtcOptions,
        role: this.transportRole,
        signaling: this.signaling,
        iceServers: this.iceServers,
        timeoutMs: this.timeoutMs,
        offerMode: this.role === "host" ? "deferred" : "automatic",
        onEvent: event => this.handleTransportEvent(event),
      };
      if (this.metadata) options.metadata = true;
      if (this.metadata) options.metadataMaxMessageBytes = P2P_WASM_METADATA_MAX_BYTES;
      // The v5 envelope has its own strict 4 KiB wire cap. Keep every other
      // WebRTC user on the transport's 2 KiB default.
      if (this.presentation) options.maxMessageBytes = P2P_WASM_PRESENTATION_MAX_BYTES;
      if (this.RTCPeerConnection !== undefined) options.RTCPeerConnection = this.RTCPeerConnection;
      if (this.scheduler !== undefined) options.scheduler = this.scheduler;
      this.transport = new this.WebRTCSession(options);
      this.state = "negotiating";
      this.transport.start();
    } catch (error) {
      this.fail("transport-start-failed", errorMessage(error, "No se pudo iniciar la sesión WebRTC."));
    }
    return this;
  }

  beginOffer() {
    if (this.role !== "host" || !this.peerReady || this.closing || !this.transport || this.offerStarted) return this;
    this.offerStarted = true;
    try { this.transport.beginOffer(); }
    catch (error) { this.fail("offer-start-failed", errorMessage(error, "No se pudo iniciar la oferta WebRTC.")); }
    return this;
  }

  /**
   * Apply the host's next bounded intent without advancing simulation. The
   * fixed host clock owns simulation cadence; local UI can never create a
   * second authority.
   */
  setHostCommand(command) {
    if (this.role !== "host" || !this.channelReady || !this.host || typeof this.host.setHostCommand !== "function") {
      return Object.freeze({ accepted: false, reason: "El host causal aún no está listo para controles." });
    }
    try {
      const outcome = this.host.setHostCommand(command);
      return Object.freeze({
        accepted: outcome?.accepted === true,
        reason: typeof outcome?.reason === "string" ? outcome.reason : undefined,
      });
    } catch (error) {
      return Object.freeze({ accepted: false, reason: error instanceof Error ? error.message : "No se pudo actualizar el control del host." });
    }
  }

  subscribePeerReady() {
    try {
      this.signalingUnsubscribe = this.signaling.on("peer-ready", event => {
        if (this.closing || this.role !== "host" || this.peerReady) return;
        if (event?.role !== "guest" && event?.role !== "pilot") return;
        this.peerReady = true;
        this.emit("peer-ready", { role: "guest" });
        this.beginOffer();
      });
    } catch (error) {
      this.fail("signaling-listener-failed", errorMessage(error, "No se pudo observar la señalización."));
    }
  }

  handleTransportEvent(event = {}) {
    if (this.closed) return;
    const type = event.type;
    if (type === "closed") {
      this.finish(event.reason || this.closeReason || "transport-closed");
      return;
    }
    this.emit(type, event);
    if (type === "channel-open") {
      this.handleChannelOpen();
    } else if (type === "metadata-message") {
      this.handleMetadataMessage(event.data);
    } else if (type === "metadata-error" || type === "metadata-channel-open" || type === "metadata-channel-closed") {
      // The optional side channel never owns causal lifecycle. Surface its
      // state while leaving the controls channel and simulation untouched.
      return;
    } else if (type === "channel-message") {
      this.handleChannelMessage(event.data);
    } else if (type === "peer-left") {
      // Preserve the observable peer-left event and close the local boundary.
      this.close("peer-left");
    } else if (type === "error") {
      this.close("transport-error");
    }
  }

  handleMetadataMessage(data) {
    if (this.closing || typeof data !== "string") return;
    let envelope;
    try { envelope = decodeP2PWasmMetadataEnvelope(data); }
    catch (error) {
      this.emit("metadata-error", { error: Object.freeze({
        code: "metadata-message-invalid",
        message: errorMessage(error, "El mensaje de metadatos no es válido."),
      }) });
      try { this.transport?.closeMetadata?.(); } catch { /* Optional channel cleanup is best effort. */ }
      return;
    }
    if (envelope.roomId !== this.context.roomId || envelope.sessionId !== this.context.sessionId
      || envelope.sequence <= this.lastMetadataTick) {
      this.emit("metadata-error", { error: Object.freeze({
        code: "metadata-context-invalid",
        message: "El snapshot de metadatos no pertenece a esta sesión o no es creciente.",
      }) });
      try { this.transport?.closeMetadata?.(); } catch { /* Optional channel cleanup is best effort. */ }
      return;
    }
    this.lastMetadataTick = envelope.sequence;
    try {
      this.onMetadata(envelope, Object.freeze({ role: this.role, ...this.context }));
    } catch (error) {
      this.emit("metadata-error", { error: Object.freeze({
        code: "metadata-observer-failed",
        message: errorMessage(error, "Falló el observador de metadatos."),
      }) });
    }
    this.emit("metadata", { metadata: envelope });
  }

  handleChannelOpen() {
    if (this.closing || this.channelOpen) return;
    this.channelOpen = true;
    this.state = "channel-open";
    if (this.role === "pilot") {
      try {
        this.causalSession = new P2PWasmCausalCombatPilotChannelSession({
          ...this.context,
          send: text => this.transport.send(text),
          presentation: this.presentation,
          identityName: this.identityName,
        });
        this.channelReady = true;
        this.emit("causal-ready", { role: "pilot" });
        const started = this.causalSession.start();
        if (!started.accepted) this.fail("causal-start-failed", started.reason);
      } catch (error) {
        this.fail("causal-start-failed", errorMessage(error, "No se pudo iniciar el canal causal del piloto."));
      }
      return;
    }

    let created;
    try { created = this.hostFactory({ ...this.context }); }
    catch (error) {
      this.fail("host-factory-failed", errorMessage(error, "No se pudo crear el host causal WASM."));
      return;
    }
    Promise.resolve(created).then(host => {
      if (this.closing) {
        try { host?.close?.(); } catch { /* Cleanup remains idempotent. */ }
        return;
      }
      if (!host || typeof host.receivePilotCommand !== "function"
        || typeof host.advance !== "function" || typeof host.close !== "function") {
        this.fail("host-factory-failed", "La fábrica no devolvió un host causal válido.");
        return;
      }
      if (this.presentation && typeof host.presentationSnapshot !== "function") {
        this.fail("host-factory-failed", "La fábrica no devolvió un host causal de presentación válido.");
        return;
      }
      this.host = host;
      try {
        const clockScheduler = this.clockScheduler
          ?? (this.hostClockOptions.scheduler && typeof this.hostClockOptions.scheduler.setInterval === "function"
            ? this.hostClockOptions.scheduler
            : undefined);
        this.hostClock = new this.HostClock({
          ...this.hostClockOptions,
          host,
          ...(clockScheduler ? { scheduler: clockScheduler } : {}),
          onSnapshot: snapshot => this.publishAuthoritativeHostSnapshot(snapshot),
          onError: error => this.fail("host-clock-failed", errorMessage(error, "Falló el reloj causal del host.")),
        });
        this.causalSession = new P2PWasmCausalCombatHostChannelSession({
          ...this.context,
          host,
          send: text => this.transport.send(text),
          onPilotCommand: () => this.hostClock.start(),
          presentation: this.presentation,
          identityName: this.identityName,
        });
        this.channelReady = true;
        this.emit("causal-ready", { role: "host" });
        this.flushPendingMessages();
      } catch (error) {
        this.fail("causal-start-failed", errorMessage(error, "No se pudo iniciar el canal causal del host."));
      }
    }).catch(error => this.fail("host-factory-failed", errorMessage(error, "No se pudo crear el host causal WASM.")));
  }

  handleChannelMessage(data) {
    if (this.closing) return;
    if (!this.channelReady) {
      if (this.role === "host" && this.pendingMessages.length < 8) this.pendingMessages.push(data);
      else this.fail("causal-not-ready", "El canal causal recibió un mensaje antes de estar preparado.");
      return;
    }
    this.routeCausalMessage(data);
  }

  flushPendingMessages() {
    const pending = this.pendingMessages.splice(0);
    for (const data of pending) {
      if (this.closing) return;
      this.routeCausalMessage(data);
    }
  }

  routeCausalMessage(data) {
    let outcome;
    try { outcome = this.causalSession?.receive(data); }
    catch (error) {
      this.fail("causal-message-failed", errorMessage(error, "Falló el mensaje causal."));
      return;
    }
    if (!outcome) {
      this.fail("causal-not-ready", "El canal causal no estaba preparado para recibir mensajes.");
      return;
    }
    if (outcome.type === "snapshot" && !this.publishSnapshot(outcome.snapshot)) return;
    if (outcome.type === "presentation-snapshot" && !this.publishPresentationEnvelope(outcome.envelope)) return;
    if (outcome.type === "identity") {
      if (!this.publishIdentity(outcome.identity)) this.fail("identity-invalid", "La identidad causal no es válida.");
      return;
    }
    if (outcome.type === "welcome" && this.role === "pilot"
      && this.presentation && this.primePilotOnWelcome && !this.pilotPrimed) {
      this.pilotPrimed = true;
      let primed;
      try { primed = this.causalSession?.sendCommand(PILOT_PRIME_COMMAND); }
      catch (error) {
        this.fail("causal-prime-failed", errorMessage(error, "No se pudo iniciar el estado causal del piloto."));
        return;
      }
      if (!primed?.accepted) {
        this.fail("causal-prime-failed", primed?.reason || "No se pudo iniciar el estado causal del piloto.");
        return;
      }
    }
    let presentationOutcome = outcome;
    if (outcome.type === "snapshot" && this.role === "host") {
      try {
        presentationOutcome = Object.freeze({
          ...outcome,
          snapshot: causalCombatSnapshotFromHost(outcome.snapshot),
        });
      } catch (error) {
        this.fail("snapshot-normalization-failed", errorMessage(error, "No se pudo normalizar el snapshot causal."));
        return;
      }
    }
    this.emit("causal-message", { outcome: presentationOutcome });
    if (outcome.close && !this.closing) this.fail("causal-message-rejected", outcome.reason);
  }

  // Both roles expose the same normalized immutable wire shape to a future
  // renderer. The host owns a richer internal snapshot; normalizing it here
  // avoids making any presentation consumer depend on host-only combat state.
  // A presentation observer is intentionally non-authoritative: its failure
  // is observable but cannot close a healthy transport or mutate the match.
  publishAuthoritativeHostSnapshot(snapshot) {
    if (this.closing || this.closed || this.role !== "host") return false;
    if (this.presentation) {
      let presentationSnapshot;
      try { presentationSnapshot = this.host.presentationSnapshot(); }
      catch (error) {
        this.fail("snapshot-normalization-failed", errorMessage(error, "No se pudo obtener el snapshot causal de presentación."));
        return false;
      }
      this.publishMetadataSnapshot(presentationSnapshot, { sourceIsPresentation: true });
      const outcome = this.causalSession?.publishSnapshot(presentationSnapshot);
      if (!outcome?.accepted) {
        this.fail("snapshot-publish-failed", outcome?.reason || "No se pudo publicar el snapshot causal de presentación.");
        return false;
      }
      if (!this.publishPresentationEnvelope(outcome.envelope)) return false;
      this.emit("causal-message", { outcome: Object.freeze({ ...outcome, snapshot: outcome.envelope.snapshot }) });
      return true;
    }
    if (!this.publishSnapshot(snapshot)) return false;
    this.publishMetadataSnapshot(snapshot);
    const outcome = this.causalSession?.publishSnapshot(snapshot);
    if (!outcome?.accepted) {
      this.fail("snapshot-publish-failed", outcome?.reason || "No se pudo enviar el snapshot causal.");
      return false;
    }
    // Clock-produced frames do not pass through routeCausalMessage(). Emit the
    // same presentation event as the command-driven path so diagnostics and a
    // future renderer observe one consistent host boundary.
    let presentationSnapshot;
    try { presentationSnapshot = causalCombatSnapshotFromHost(snapshot); }
    catch (error) {
      this.fail("snapshot-normalization-failed", errorMessage(error, "No se pudo normalizar el snapshot causal."));
      return false;
    }
    this.emit("causal-message", { outcome: Object.freeze({ ...outcome, snapshot: presentationSnapshot }) });
    return true;
  }

  /**
   * Publish a bounded, presentation-only view over the optional metadata
   * channel. This path never feeds the causal host and silently remains
   * inactive for peers that do not expose sendMetadata().
   */
  publishMetadataSnapshot(source, { sourceIsPresentation = false } = {}) {
    if (!this.metadata || this.closing || this.closed || this.role !== "host"
      || typeof this.transport?.sendMetadata !== "function") return false;
    const sourceTick = Number.isSafeInteger(source?.tick) ? source.tick : 0;
    if (sourceTick < 1 || (this.lastMetadataAttemptTick > 0
      && sourceTick - this.lastMetadataAttemptTick < this.metadataEveryTicks)) return false;
    this.lastMetadataAttemptTick = sourceTick;
    let metadataSource = source;
    if (typeof this.host?.metadataSnapshot === "function") {
      try { metadataSource = this.host.metadataSnapshot(); }
      catch (error) {
        this.emit("metadata-error", { error: Object.freeze({
          code: "metadata-snapshot-failed",
          message: errorMessage(error, "No se pudo obtener el snapshot de metadatos."),
        }) });
        return false;
      }
    } else if (!sourceIsPresentation && typeof this.host?.presentationSnapshot === "function") {
      // Metadata is presentation-only even when the causal v5 presentation
      // envelope is disabled for this room.
      try { metadataSource = this.host.presentationSnapshot(); }
      catch (error) {
        this.emit("metadata-error", { error: Object.freeze({
          code: "metadata-snapshot-failed",
          message: errorMessage(error, "No se pudo obtener el snapshot de metadatos."),
        }) });
        return false;
      }
    }
    const records = [
      ...(Array.isArray(metadataSource?.players) ? metadataSource.players : []),
      ...(Array.isArray(metadataSource?.presentation) ? metadataSource.presentation : []),
      ...(Array.isArray(metadataSource?.physical) ? metadataSource.physical : []),
    ];
    const players = METADATA_PLAYER_IDS.map((id, index) => {
      const record = records.find(item => item?.id === id) || {};
      const fallback = index === 0 ? "HOST" : "PILOTO";
      return {
        id,
        team: METADATA_TEAMS[id],
        name: normalizeP2PPlayerName(record.name ?? (id === "p2p-host" ? this.identityName : undefined), fallback),
      };
    });
    const pads = (Array.isArray(metadataSource?.pads) ? metadataSource.pads : []).slice(0, 96).flatMap(pad => {
      if (!pad || typeof pad !== "object" || typeof pad.id !== "string"
        || !Number.isFinite(pad.x) || !Number.isFinite(pad.h) || !Number.isFinite(pad.z)
        || !Number.isFinite(pad.amount) || !Number.isFinite(pad.cooldown) || typeof pad.active !== "boolean") return [];
      return [{ id: pad.id, x: pad.x, h: pad.h, z: pad.z, amount: pad.amount, cooldown: pad.cooldown, active: pad.active }];
    });
    let envelope;
    try {
      envelope = createP2PWasmMetadataEnvelope({
        ...this.context,
        sequence: this.metadataSequence + 1,
        players,
        pads,
      });
    } catch (error) {
      this.emit("metadata-error", { error: Object.freeze({
        code: "metadata-snapshot-invalid",
        message: errorMessage(error, "El snapshot de metadatos no es válido."),
      }) });
      return false;
    }
    let sent = false;
    try { sent = this.transport.sendMetadata(envelope) === true; }
    catch (error) {
      this.emit("metadata-error", { error: Object.freeze({
        code: "metadata-send-failed",
        message: errorMessage(error, "No se pudo enviar el snapshot de metadatos."),
      }) });
      try { this.transport.closeMetadata?.(); } catch { /* Optional channel cleanup is best effort. */ }
      return false;
    }
    if (sent) {
      this.metadataSequence += 1;
      // The host owns the same presentation source locally. Feed the exact
      // validated envelope to its observer too, without looping it through
      // the network or changing the causal clock.
      this.handleMetadataMessage(envelope);
    }
    return sent;
  }

  publishSnapshot(snapshot) {
    let normalized;
    try {
      normalized = this.role === "host" ? causalCombatSnapshotFromHost(snapshot) : snapshot;
    } catch (error) {
      this.fail("snapshot-normalization-failed", errorMessage(error, "No se pudo normalizar el snapshot causal."));
      return false;
    }
    try {
      this.onSnapshot(normalized, Object.freeze({ role: this.role, ...this.context }));
    } catch (error) {
      this.emit("presentation-error", { error: Object.freeze({ code: "presentation-observer-failed", message: errorMessage(error, "Falló el observador de presentación causal.") }) });
    }
    return true;
  }

  publishPresentationEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object") {
      this.emit("presentation-error", { error: Object.freeze({ code: "presentation-envelope-invalid", message: "El sobre causal de presentación no es válido." }) });
      return false;
    }
    try {
      this.onSnapshot(envelope, Object.freeze({ role: this.role, ...this.context }));
    } catch (error) {
      this.emit("presentation-error", { error: Object.freeze({ code: "presentation-observer-failed", message: errorMessage(error, "Falló el observador de presentación causal.") }) });
    }
    return true;
  }

  publishIdentity(identity) {
    if (!identity || typeof identity !== "object" || (identity.role !== "host" && identity.role !== "pilot")
      || typeof identity.name !== "string") {
      this.emit("presentation-error", { error: Object.freeze({ code: "identity-invalid", message: "La identidad causal no es válida." }) });
      return false;
    }
    const name = normalizeP2PPlayerName(identity.name, identity.role);
    try {
      this.onIdentity(Object.freeze({ role: identity.role, name }));
    } catch (error) {
      this.emit("presentation-error", { error: Object.freeze({ code: "identity-observer-failed", message: errorMessage(error, "Falló el observador de identidad causal.") }) });
    }
    this.emit("identity", { role: identity.role, name });
    return true;
  }

  fail(code, message) {
    if (this.closing || this.closed) return this;
    this.emit("error", { error: Object.freeze({ code, message }) });
    return this.close(code);
  }

  close(reason = "local") {
    if (this.closed || this.closing) return this;
    this.closing = true;
    this.closeReason = reason;
    this.pendingMessages.length = 0;
    try { this.hostClock?.close(); } catch { /* Continue closing transport. */ }
    try { this.causalSession?.close(reason); } catch { /* Continue closing transport. */ }
    if (!this.causalSession) {
      try { this.host?.close?.(); } catch { /* Continue closing transport. */ }
    }
    try { this.transport?.close?.(); } catch { /* Continue finalization. */ }
    if (!this.transport || this.transport.state === "closed") this.finish(reason);
    return this;
  }

  finish(reason = this.closeReason || "closed") {
    if (this.closed) return this;
    this.closing = true;
    this.closed = true;
    this.state = "closed";
    this.closeReason = reason;
    this.pendingMessages.length = 0;
    try { this.hostClock?.close(); } catch { /* Continue finalization. */ }
    try { this.causalSession?.close(reason); } catch { /* Continue finalization. */ }
    if (!this.causalSession) {
      try { this.host?.close?.(); } catch { /* Continue finalization. */ }
    }
    if (this.signalingUnsubscribe) {
      try { this.signalingUnsubscribe(); } catch { /* Cleanup continues. */ }
      this.signalingUnsubscribe = null;
    }
    this.emit("closed", { reason });
    return this;
  }

  emit(type, fields = {}) {
    try { this.onEvent(safeEvent(type, fields)); } catch { /* Observers cannot break cleanup. */ }
  }
}

export function createP2PWasmCausalRoomSession(options) {
  return new P2PWasmCausalRoomSession(options);
}

export { DEFAULT_TIMEOUT_MS as P2P_WASM_CAUSAL_ROOM_DEFAULT_TIMEOUT_MS };
