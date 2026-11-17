// P2P-WASM-22 / ONLINE-IDENTITY-22: an isolated ordered channel boundary for
// the causal WASM combat spike. This deliberately does not modify P2P v1,
// WebRTC wiring, the renderer, server.mjs or any public room. It carries the
// already bounded causal snapshot plus optional, presentation-only identity
// metadata after the causal handshake.
import {
  createP2PWasmCausalCombatEnvelope,
  decodeP2PWasmCausalCombatEnvelope,
  P2P_WASM_CAUSAL_COMBAT_CAR_IDS,
  P2P_WASM_CAUSAL_COMBAT_MAX_BYTES,
  P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE,
  P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION,
  P2P_WASM_CAUSAL_COMBAT_TYPE,
} from "./p2p-wasm-causal-combat-protocol.mjs";
import {
  createP2PWasmCausalCombatPresentationEnvelope,
  decodeP2PWasmCausalCombatPresentationEnvelope,
  P2P_WASM_PRESENTATION_MAX_BYTES,
  P2P_WASM_PRESENTATION_TYPE,
} from "./p2p-wasm-causal-combat-presentation-protocol.mjs";
import {
  createP2PPlayerIdentityEnvelope,
  decodeP2PPlayerIdentityEnvelope,
  P2P_IDENTITY_MAX_BYTES,
  P2P_IDENTITY_TYPE,
} from "../../src/p2p-player-identity.js";

export const P2P_WASM_CAUSAL_COMBAT_HELLO_TYPE = "wasm-causal-combat-hello";
export const P2P_WASM_CAUSAL_COMBAT_WELCOME_TYPE = "wasm-causal-combat-welcome";
export const P2P_WASM_CAUSAL_COMBAT_COMMAND_TYPE = "wasm-causal-combat-command";
export const P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_TYPE = "wasm-causal-combat-command-full";
export const P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_PROTOCOL_VERSION = 4;

const encoder = new TextEncoder();
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL_KEYS = ["boost", "jump", "steer", "throttle"];
const FULL_CONTROL_KEYS = ["airRoll", "boost", "drift", "handbrake", "jump", "pitch", "roll", "steer", "throttle", "yaw"];
const COMMAND_KEYS = ["controls", "fire", "targetId"];
const LEGACY_COMMAND_KEYS = ["controls", "fire", "restart", "targetId"];
const HANDSHAKE_KEYS = ["protocolVersion", "roomId", "sequence", "sessionId", "type"];
const COMMAND_MESSAGE_KEYS = ["command", "protocolVersion", "roomId", "sequence", "sessionId", "type"];

function safeResult(accepted, reason, extra = {}) {
  return Object.freeze({ accepted, reason, ...extra });
}

function exactRecord(value, expectedKeys) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const normalized = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      normalized[key] = descriptor.value;
    }
    return normalized;
  } catch {
    return null;
  }
}

function safeContextId(value) {
  return typeof value === "string" && SAFE_ID.test(value);
}

function validSequence(value, { handshake = false } = {}) {
  return Number.isSafeInteger(value)
    && value >= (handshake ? 0 : 1)
    && value <= P2P_WASM_CAUSAL_COMBAT_MAX_SEQUENCE;
}

function normalizeCommand(value, { pilotOnly = false } = {}) {
  const command = exactRecord(value, COMMAND_KEYS) || exactRecord(value, LEGACY_COMMAND_KEYS);
  if (!command) return null;
  const controls = exactRecord(command.controls, CONTROL_KEYS);
  if (!controls
    || !Number.isFinite(controls.throttle) || controls.throttle < -1 || controls.throttle > 1
    || !Number.isFinite(controls.steer) || controls.steer < -1 || controls.steer > 1
    || typeof controls.boost !== "boolean" || typeof controls.jump !== "boolean"
    || typeof command.fire !== "boolean"
    || !(command.targetId === null || P2P_WASM_CAUSAL_COMBAT_CAR_IDS.includes(command.targetId))) return null;
  // A remote pilot must not be able to select itself as a guidance target.
  if (pilotOnly && !(command.targetId === null || command.targetId === "p2p-host")) return null;
  return {
    controls: {
      throttle: controls.throttle,
      steer: controls.steer,
      boost: controls.boost,
      jump: controls.jump,
    },
    fire: command.fire,
    targetId: command.targetId,
  };
}

function normalizeFullCommand(value, { pilotOnly = false } = {}) {
  const command = exactRecord(value, COMMAND_KEYS) || exactRecord(value, LEGACY_COMMAND_KEYS);
  if (!command) return null;
  const controls = exactRecord(command.controls, FULL_CONTROL_KEYS);
  if (!controls
    || !Number.isFinite(controls.throttle) || controls.throttle < -1 || controls.throttle > 1
    || !Number.isFinite(controls.steer) || controls.steer < -1 || controls.steer > 1
    || !Number.isFinite(controls.pitch) || controls.pitch < -1 || controls.pitch > 1
    || !Number.isFinite(controls.yaw) || controls.yaw < -1 || controls.yaw > 1
    || !Number.isFinite(controls.roll) || controls.roll < -1 || controls.roll > 1
    || typeof controls.boost !== "boolean" || typeof controls.jump !== "boolean"
    || typeof controls.drift !== "boolean" || typeof controls.airRoll !== "boolean"
    || typeof controls.handbrake !== "boolean"
    || typeof command.fire !== "boolean"
    || !(command.targetId === null || P2P_WASM_CAUSAL_COMBAT_CAR_IDS.includes(command.targetId))) return null;
  if (pilotOnly && !(command.targetId === null || command.targetId === "p2p-host")) return null;
  return {
    controls: {
      throttle: controls.throttle,
      steer: controls.steer,
      pitch: controls.pitch,
      yaw: controls.yaw,
      roll: controls.roll,
      boost: controls.boost,
      jump: controls.jump,
      drift: controls.drift,
      airRoll: controls.airRoll,
      handbrake: controls.handbrake,
    },
    fire: command.fire,
    targetId: command.targetId,
  };
}

function normalizeHandshake(value, expectedType) {
  const message = exactRecord(value, HANDSHAKE_KEYS);
  if (!message || message.type !== expectedType
    || message.protocolVersion !== P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION
    || !safeContextId(message.roomId) || !safeContextId(message.sessionId)
    || message.sequence !== 0) return null;
  return {
    type: expectedType,
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION,
    roomId: message.roomId,
    sessionId: message.sessionId,
    sequence: 0,
  };
}

function normalizeCommandMessage(value) {
  const message = exactRecord(value, COMMAND_MESSAGE_KEYS);
  if (!message || message.type !== P2P_WASM_CAUSAL_COMBAT_COMMAND_TYPE
    || message.protocolVersion !== P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION
    || !safeContextId(message.roomId) || !safeContextId(message.sessionId)
    || !validSequence(message.sequence)) return null;
  const command = normalizeCommand(message.command, { pilotOnly: true });
  return command ? {
    type: P2P_WASM_CAUSAL_COMBAT_COMMAND_TYPE,
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION,
    roomId: message.roomId,
    sessionId: message.sessionId,
    sequence: message.sequence,
    command,
  } : null;
}

function normalizeFullCommandMessage(value) {
  const message = exactRecord(value, COMMAND_MESSAGE_KEYS);
  if (!message || message.type !== P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_TYPE
    || message.protocolVersion !== P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_PROTOCOL_VERSION
    || !safeContextId(message.roomId) || !safeContextId(message.sessionId)
    || !validSequence(message.sequence)) return null;
  const command = normalizeFullCommand(message.command, { pilotOnly: true });
  return command ? {
    type: P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_TYPE,
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_PROTOCOL_VERSION,
    roomId: message.roomId,
    sessionId: message.sessionId,
    sequence: message.sequence,
    command,
  } : null;
}

function validateContext(message, { roomId, sessionId, expectedType } = {}) {
  if (!message || (expectedType !== undefined && message.type !== expectedType)) return null;
  if (roomId !== undefined && message.roomId !== roomId) return null;
  if (sessionId !== undefined && message.sessionId !== sessionId) return null;
  return message;
}

function parseMessage(text) {
  // The v5 presentation envelope has its own strict 4096-byte cap. Admit it
  // through this framing gate, then let the type-specific decoder fail closed.
  if (typeof text !== "string" || encoder.encode(text).byteLength > Math.max(P2P_WASM_CAUSAL_COMBAT_MAX_BYTES, P2P_WASM_PRESENTATION_MAX_BYTES, P2P_IDENTITY_MAX_BYTES)) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.type === P2P_WASM_CAUSAL_COMBAT_TYPE) {
    try { return decodeP2PWasmCausalCombatEnvelope(JSON.stringify(value)); } catch { return null; }
  }
  if (value.type === P2P_WASM_PRESENTATION_TYPE) {
    try { return decodeP2PWasmCausalCombatPresentationEnvelope(JSON.stringify(value)); } catch { return null; }
  }
  if (value.type === P2P_IDENTITY_TYPE) {
    try {
      const decoded = decodeP2PPlayerIdentityEnvelope(JSON.stringify(value));
      return decoded.ok ? decoded.identity : null;
    } catch { return null; }
  }
  if (value.type === P2P_WASM_CAUSAL_COMBAT_HELLO_TYPE) return normalizeHandshake(value, P2P_WASM_CAUSAL_COMBAT_HELLO_TYPE);
  if (value.type === P2P_WASM_CAUSAL_COMBAT_WELCOME_TYPE) return normalizeHandshake(value, P2P_WASM_CAUSAL_COMBAT_WELCOME_TYPE);
  if (value.type === P2P_WASM_CAUSAL_COMBAT_COMMAND_TYPE) return normalizeCommandMessage(value);
  if (value.type === P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_TYPE) return normalizeFullCommandMessage(value);
  return null;
}

function encodeNormalized(message) {
  const text = JSON.stringify(message);
  if (encoder.encode(text).byteLength > P2P_WASM_CAUSAL_COMBAT_MAX_BYTES) {
    throw new RangeError(`P2P WASM causal combat message exceeds ${P2P_WASM_CAUSAL_COMBAT_MAX_BYTES} UTF-8 bytes.`);
  }
  return text;
}

function createHandshake(type, { roomId, sessionId } = {}) {
  const message = normalizeHandshake({
    type,
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION,
    roomId,
    sessionId,
    sequence: 0,
  }, type);
  if (!message) throw new TypeError("P2P WASM causal combat handshake is invalid.");
  return encodeNormalized(message);
}

export function createP2PWasmCausalCombatHello(context) {
  return createHandshake(P2P_WASM_CAUSAL_COMBAT_HELLO_TYPE, context);
}

export function createP2PWasmCausalCombatWelcome(context) {
  return createHandshake(P2P_WASM_CAUSAL_COMBAT_WELCOME_TYPE, context);
}

export function createP2PWasmCausalCombatCommand({ roomId, sessionId, sequence, command } = {}) {
  const message = normalizeCommandMessage({
    type: P2P_WASM_CAUSAL_COMBAT_COMMAND_TYPE,
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_PROTOCOL_VERSION,
    roomId,
    sessionId,
    sequence,
    command,
  });
  if (!message) throw new TypeError("P2P WASM causal combat command is invalid.");
  return encodeNormalized(message);
}

export function createP2PWasmCausalCombatFullCommand({ roomId, sessionId, sequence, command } = {}) {
  const message = normalizeFullCommandMessage({
    type: P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_TYPE,
    protocolVersion: P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_PROTOCOL_VERSION,
    roomId,
    sessionId,
    sequence,
    command,
  });
  if (!message) throw new TypeError("P2P WASM causal combat full command is invalid.");
  return encodeNormalized(message);
}

/** Decode one message without making a simulation or transport decision. */
export function decodeP2PWasmCausalCombatChannelMessage(text, context = {}) {
  const message = normalizeMessage(parseMessage(text));
  const normalized = validateContext(message, context);
  return normalized
    ? { ok: true, message: normalized }
    : { ok: false, reason: "Mensaje causal P2P WASM no válido." };
}

function validHost(host) {
  return host && typeof host.receivePilotCommand === "function" && typeof host.close === "function";
}

function validContext(roomId, sessionId) {
  try {
    createP2PWasmCausalCombatHello({ roomId, sessionId });
    return true;
  } catch {
    return false;
  }
}

// The host owns simulation authority. A DataChannel/WebRTC implementation can
// supply send(), but this module itself has no WebRTC dependency or side effect.
export class P2PWasmCausalCombatHostChannelSession {
  constructor({ roomId, sessionId, host, send, onPilotCommand, presentation = false, identityName } = {}) {
    if (!validContext(roomId, sessionId) || !validHost(host) || typeof send !== "function"
      || (onPilotCommand !== undefined && typeof onPilotCommand !== "function")) {
      throw new TypeError("P2P WASM causal combat host channel is invalid.");
    }
    if (typeof presentation !== "boolean") throw new TypeError("La opción de presentación causal debe ser booleana.");
    if (presentation && typeof host.presentationSnapshot !== "function") {
      throw new TypeError("El host causal de presentación debe exponer presentationSnapshot().");
    }
    this.roomId = roomId;
    this.sessionId = sessionId;
    this.host = host;
    this.send = send;
    this.onPilotCommand = onPilotCommand;
    this.presentation = presentation;
    this.identityName = identityName;
    this.identityEnabled = typeof identityName === "string";
    this.remoteIdentity = null;
    this.state = "awaiting-hello";
    this.commandSequence = 0;
    this.snapshotSequence = 0;
  }

  receive(text) {
    if (this.state === "closed") return safeResult(false, "La sesión causal del host ya está cerrada.", { close: false });
    const decoded = decodeP2PWasmCausalCombatChannelMessage(text, { roomId: this.roomId, sessionId: this.sessionId });
    if (!decoded.ok) return this.close("Mensaje causal del piloto no válido.");
    const message = decoded.message;
    if (this.state === "awaiting-hello") {
      if (message.type !== P2P_WASM_CAUSAL_COMBAT_HELLO_TYPE) return this.close("El piloto causal debe iniciar con hello.");
      // The transport can synchronously call back into the pilot. Become active
      // before welcome crosses that boundary, as required by ordered channels.
      this.state = "active";
      try {
        this.send(createP2PWasmCausalCombatWelcome(this));
        return safeResult(true, "Welcome causal enviado.", { type: "welcome" });
      } catch {
        return this.close("No se pudo enviar welcome causal al piloto.");
      }
    }
    if (message.type === P2P_IDENTITY_TYPE) {
      if (message.role !== "pilot" || this.remoteIdentity) return this.close("La identidad causal del piloto llegó fuera de orden.");
      this.remoteIdentity = message;
      if (this.identityEnabled) {
        try {
          this.send(createP2PPlayerIdentityEnvelope({ roomId: this.roomId, sessionId: this.sessionId, role: "host", name: this.identityName }));
        } catch {
          return this.close("No se pudo anunciar la identidad causal del host.");
        }
      }
      return safeResult(true, "Identidad causal del piloto recibida.", { type: "identity", identity: message });
    }
    if (message.type !== P2P_WASM_CAUSAL_COMBAT_COMMAND_TYPE
      && message.type !== P2P_WASM_CAUSAL_COMBAT_FULL_COMMAND_TYPE) return this.close("El host causal recibió un mensaje fuera de orden.");
    if (message.sequence !== this.commandSequence + 1) return this.close("El host causal recibió un comando fuera de secuencia.");
    try {
      // Room sessions with a fixed host clock use this branch: the network
      // packet updates intent only, then the clock advances and publishes the
      // next snapshot independently. Standalone channel smoke tests keep the
      // legacy one-command/one-tick path when no callback is supplied.
      const outcome = this.onPilotCommand
        ? this.host.receivePilotCommand({ sequence: message.sequence, ...message.command }, { advance: false })
        : this.host.receivePilotCommand({ sequence: message.sequence, ...message.command });
      if (!outcome?.accepted) return this.close(outcome?.reason || "El host causal rechazó el comando del piloto.");
      this.commandSequence = message.sequence;
      if (this.onPilotCommand) {
        const started = this.onPilotCommand({ sequence: message.sequence, command: message.command });
        if (started?.accepted === false) return this.close(started.reason || "El reloj causal del host no pudo iniciar.");
        return safeResult(true, "Comando causal aceptado; el reloj autoritativo continúa la simulación.", { type: "command" });
      }
      if (!outcome.snapshot) return this.close("El host causal no produjo un snapshot.");
      const authoritativeSnapshot = this.presentation ? this.host.presentationSnapshot() : outcome.snapshot;
      const sequence = ++this.snapshotSequence;
      const snapshotText = this.presentation
        ? createP2PWasmCausalCombatPresentationEnvelope({ roomId: this.roomId, sessionId: this.sessionId, sequence, snapshot: authoritativeSnapshot })
        : createP2PWasmCausalCombatEnvelope({ roomId: this.roomId, sessionId: this.sessionId, sequence, snapshot: authoritativeSnapshot });
      this.send(snapshotText);
      if (this.presentation) {
        const envelope = decodeP2PWasmCausalCombatPresentationEnvelope(snapshotText);
        return safeResult(true, "Snapshot causal de presentación enviado.", { type: "presentation-snapshot", envelope, snapshot: envelope.snapshot });
      }
      return safeResult(true, "Snapshot causal autoritativo enviado.", { type: "snapshot", snapshot: outcome.snapshot });
    } catch {
      return this.close("El host causal no pudo avanzar la simulación.");
    }
  }

  /** Publish one snapshot produced by the independent host clock. */
  publishSnapshot(snapshot) {
    if (this.state !== "active") return safeResult(false, "El canal causal del host aún no está activo.", { close: false });
    try {
      const sequence = this.snapshotSequence + 1;
      const text = this.presentation
        ? createP2PWasmCausalCombatPresentationEnvelope({ roomId: this.roomId, sessionId: this.sessionId, sequence, snapshot })
        : createP2PWasmCausalCombatEnvelope({ roomId: this.roomId, sessionId: this.sessionId, sequence, snapshot });
      this.send(text);
      this.snapshotSequence = sequence;
      if (this.presentation) {
        const envelope = decodeP2PWasmCausalCombatPresentationEnvelope(text);
        return safeResult(true, "Snapshot causal de presentación enviado.", { type: "presentation-snapshot", envelope, snapshot: envelope.snapshot });
      }
      return safeResult(true, "Snapshot causal autoritativo enviado.", { type: "snapshot", snapshot });
    } catch (error) {
      // Preserve a bounded, transport-safe reason for lifecycle diagnostics.
      // The caller never sees SDP, candidates or payload text; it only learns
      // whether the ordered control channel was already closing/closed.
      const detail = typeof error?.message === "string" && error.message.length <= 160
        ? ` ${error.message}`
        : "";
      return this.close(`No se pudo publicar el snapshot causal autoritativo.${detail}`);
    }
  }

  close(reason = "La sesión causal del host se cerró.") {
    if (this.state !== "closed") {
      this.state = "closed";
      try { this.host.close(); } catch { /* The channel still becomes closed. */ }
    }
    return safeResult(false, reason, { close: true });
  }
}

export class P2PWasmCausalCombatPilotChannelSession {
  constructor({ roomId, sessionId, send, presentation = false, identityName } = {}) {
    if (!validContext(roomId, sessionId) || typeof send !== "function") {
      throw new TypeError("P2P WASM causal combat pilot channel is invalid.");
    }
    if (typeof presentation !== "boolean") throw new TypeError("La opción de presentación causal debe ser booleana.");
    this.roomId = roomId;
    this.sessionId = sessionId;
    this.send = send;
    this.presentation = presentation;
    this.identityName = identityName;
    this.identityEnabled = typeof identityName === "string";
    this.remoteIdentity = null;
    this.state = "new";
    this.commandSequence = 0;
    this.snapshotSequence = 0;
    this.lastAcknowledgedCommandSequence = 0;
    this.lastSnapshot = null;
    this.lastPresentationEnvelope = null;
    this.lastSnapshotTick = 0;
    this.ignoredSnapshotCount = 0;
    this.droppedSnapshotCount = 0;
  }

  start() {
    if (this.state !== "new") return safeResult(false, "El piloto causal ya se inició.", { close: false });
    this.state = "awaiting-welcome";
    try {
      this.send(createP2PWasmCausalCombatHello(this));
      return safeResult(true, "Hello causal enviado.", { type: "hello" });
    } catch {
      return this.close("No se pudo enviar hello causal al host.");
    }
  }

  sendCommand(command) {
    if (this.state !== "active") return safeResult(false, "El canal causal aún no está listo para comandos.", { close: false });
    let text;
    try {
      const full = command?.controls && Object.hasOwn(command.controls, "pitch");
      text = (full ? createP2PWasmCausalCombatFullCommand : createP2PWasmCausalCombatCommand)({
        roomId: this.roomId,
        sessionId: this.sessionId,
        sequence: this.commandSequence + 1,
        command,
      });
      // A loopback or direct transport may synchronously send the snapshot
      // while send() is on the stack, so advance the receive boundary first.
      this.commandSequence += 1;
      this.send(text);
      return safeResult(true, "Comando causal enviado.", { type: "command", sequence: this.commandSequence });
    } catch {
      return this.close("No se pudo enviar el comando causal al host.");
    }
  }

  receive(text) {
    if (this.state === "closed") return safeResult(false, "La sesión causal del piloto ya está cerrada.", { close: false });
    const decoded = decodeP2PWasmCausalCombatChannelMessage(text, { roomId: this.roomId, sessionId: this.sessionId });
    if (!decoded.ok) return this.close("Mensaje causal del host no válido.");
    const message = decoded.message;
    if (this.state === "awaiting-welcome") {
      if (message.type !== P2P_WASM_CAUSAL_COMBAT_WELCOME_TYPE) return this.close("El host causal debe responder hello con welcome.");
      this.state = "active";
      if (this.identityEnabled) {
        try {
          this.send(createP2PPlayerIdentityEnvelope({ roomId: this.roomId, sessionId: this.sessionId, role: "pilot", name: this.identityName }));
        } catch {
          return this.close("No se pudo anunciar la identidad causal del piloto.");
        }
      }
      return safeResult(true, "Welcome causal recibido.", { type: "welcome" });
    }
    if (message.type === P2P_IDENTITY_TYPE) {
      if (message.role !== "host" || this.remoteIdentity) return this.close("La identidad causal del host llegó fuera de orden.");
      this.remoteIdentity = message;
      return safeResult(true, "Identidad causal del host recibida.", { type: "identity", identity: message });
    }
    const expectedType = this.presentation ? P2P_WASM_PRESENTATION_TYPE : P2P_WASM_CAUSAL_COMBAT_TYPE;
    if (this.state !== "active" || message.type !== expectedType) {
      return this.close("El piloto causal recibió un mensaje fuera de orden.");
    }
    if (message.snapshot.lastInputSequence > this.commandSequence) {
      return this.close("El piloto causal recibió un snapshot fuera de secuencia.");
    }
    if (message.sequence <= this.snapshotSequence
      || message.snapshot.tick <= this.lastSnapshotTick
      || message.snapshot.lastInputSequence < this.lastAcknowledgedCommandSequence) {
      this.ignoredSnapshotCount += 1;
      return safeResult(true, "Snapshot causal repetido o atrasado ignorado.", {
        type: "snapshot-ignored",
        ignored: true,
        sequence: message.sequence,
      });
    }
    const dropped = Math.max(0, message.sequence - this.snapshotSequence - 1);
    this.snapshotSequence = message.sequence;
    this.droppedSnapshotCount += dropped;
    this.lastAcknowledgedCommandSequence = Math.max(this.lastAcknowledgedCommandSequence, message.snapshot.lastInputSequence);
    this.lastSnapshotTick = message.snapshot.tick;
    this.lastSnapshot = message.snapshot;
    if (this.presentation) {
      this.lastPresentationEnvelope = message;
      return safeResult(true, "Snapshot causal de presentación recibido.", {
        type: "presentation-snapshot",
        envelope: message,
        snapshot: message.snapshot,
        ...(dropped > 0 ? { dropped } : {}),
      });
    }
    return safeResult(true, "Snapshot causal autoritativo recibido.", {
      type: "snapshot",
      snapshot: message.snapshot,
      ...(dropped > 0 ? { dropped } : {}),
    });
  }

  close(reason = "La sesión causal del piloto se cerró.") {
    this.state = "closed";
    return safeResult(false, reason, { close: true });
  }
}
