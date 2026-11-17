import {
  createP2PHello,
  createP2PHostSnapshot,
  createP2PInput,
  createP2PWelcome,
  decodeP2PMessage,
} from "./p2p-session-protocol.js";
import { P2PHostMatch } from "./p2p-host-match.js";

function safeResult(accepted, reason, extra = {}) {
  return Object.freeze({ accepted, reason, ...extra });
}

function validContext(roomId, sessionId) {
  try {
    createP2PHello({ roomId, sessionId });
    return true;
  } catch {
    return false;
  }
}

// This is deliberately transport-agnostic. P2PWebRTCSession owns the browser
// DataChannel; this boundary owns only the strict game-message ordering.
export class P2PHostChannelSession {
  constructor({ roomId, sessionId, send, match = new P2PHostMatch(), advanceOnPilotInput = true } = {}) {
    if (!validContext(roomId, sessionId) || typeof send !== "function"
      || !match || typeof match.receivePilotInput !== "function" || typeof match.advance !== "function"
      || typeof match.setHostInput !== "function" || typeof advanceOnPilotInput !== "boolean") {
      throw new TypeError("Invalid P2P host channel session.");
    }
    this.roomId = roomId;
    this.sessionId = sessionId;
    this.send = send;
    this.match = match;
    this.state = "awaiting-hello";
    this.snapshotSequence = 0;
    this.advanceOnPilotInput = advanceOnPilotInput;
  }

  setHostInput(controls) {
    if (this.state !== "active") return safeResult(false, "El host P2P aún no está listo para controles.", { close: false });
    const outcome = this.match.setHostInput(controls);
    return outcome?.accepted
      ? safeResult(true, "Controles locales del host actualizados.", { type: "host-input" })
      : safeResult(false, outcome?.reason || "Los controles del host no son válidos.", { close: false });
  }

  advance(ticks = 1) {
    if (this.state !== "active") return safeResult(false, "El host P2P aún no puede avanzar la partida.", { close: false });
    if (this.match.lastInputSequence < 1) return safeResult(false, "El host espera el primer input del piloto.", { close: false });
    let snapshot;
    try { snapshot = this.match.advance(ticks); }
    catch { return this.close("El host no pudo avanzar la simulación P2P."); }
    return this.sendSnapshot(snapshot);
  }

  sendSnapshot(snapshot) {
    try {
      const message = createP2PHostSnapshot({
        roomId: this.roomId,
        sessionId: this.sessionId,
        sequence: ++this.snapshotSequence,
        snapshot,
      });
      this.send(JSON.stringify(message));
      return safeResult(true, "Snapshot autoritativo enviado.", { type: "snapshot", snapshot });
    } catch {
      return this.close("No se pudo enviar el snapshot autoritativo.");
    }
  }

  receive(serialized) {
    if (this.state === "closed") return safeResult(false, "La sesión P2P del host ya está cerrada.", { close: false });
    const decoded = decodeP2PMessage(serialized, { roomId: this.roomId, sessionId: this.sessionId });
    if (!decoded.ok) return this.close("Mensaje P2P del piloto no válido.");
    const message = decoded.message;
    if (this.state === "awaiting-hello") {
      if (message.type !== "hello") return this.close("El piloto debe iniciar la sesión P2P con hello.");
      // send() may synchronously induce the pilot's first input. Activate the
      // authority boundary before the welcome crosses that transport boundary.
      this.state = "active";
      try {
        this.send(JSON.stringify(createP2PWelcome(this)));
      } catch {
        return this.close("No se pudo enviar welcome al piloto.");
      }
      return safeResult(true, "Welcome aceptado.", { type: "welcome" });
    }
    if (message.type !== "input") return this.close("El host recibió un mensaje P2P fuera de orden.");
    const outcome = this.match.receivePilotInput(message, { advance: this.advanceOnPilotInput });
    if (!outcome?.accepted) return safeResult(false, outcome?.reason || "El host rechazó el input del piloto.", { close: false, type: "input" });
    if (!this.advanceOnPilotInput) return safeResult(true, "Input del piloto actualizado; el host avanzará en su tick fijo.", { type: "input" });
    return this.sendSnapshot(outcome.snapshot);
  }

  close(reason) {
    this.state = "closed";
    return safeResult(false, reason, { close: true });
  }
}

export class P2PPilotChannelSession {
  constructor({ roomId, sessionId, send } = {}) {
    if (!validContext(roomId, sessionId) || typeof send !== "function") throw new TypeError("Invalid P2P pilot channel session.");
    this.roomId = roomId;
    this.sessionId = sessionId;
    this.send = send;
    this.state = "new";
    this.inputSequence = 0;
    this.snapshotSequence = 0;
    this.lastAcknowledgedInputSequence = 0;
    this.lastSnapshot = null;
  }

  start() {
    if (this.state !== "new") return safeResult(false, "El piloto P2P ya se inició.", { close: false });
    // A local/fake transport may synchronously deliver welcome from send().
    // Move into the receive-ready state before that boundary is crossed.
    this.state = "awaiting-welcome";
    try {
      this.send(JSON.stringify(createP2PHello(this)));
      return safeResult(true, "Hello enviado.", { type: "hello" });
    } catch {
      return this.close("No se pudo enviar hello al host.");
    }
  }

  sendInput(controls) {
    if (this.state !== "active") return safeResult(false, "El canal P2P aún no está listo para controles.", { close: false });
    let message;
    try {
      message = createP2PInput({ roomId: this.roomId, sessionId: this.sessionId, sequence: this.inputSequence + 1, controls });
      // A direct diagnostic transport can synchronously return a snapshot from
      // send(). Advance the local boundary before crossing into that callback.
      this.inputSequence = message.sequence;
      this.send(JSON.stringify(message));
    } catch {
      return this.close("No se pudo enviar el input al host.");
    }
    return safeResult(true, "Input enviado.", { type: "input", sequence: message.sequence });
  }

  receive(serialized) {
    if (this.state === "closed") return safeResult(false, "La sesión P2P del piloto ya está cerrada.", { close: false });
    const decoded = decodeP2PMessage(serialized, { roomId: this.roomId, sessionId: this.sessionId });
    if (!decoded.ok) return this.close("Mensaje P2P del host no válido.");
    const message = decoded.message;
    if (this.state === "awaiting-welcome") {
      if (message.type !== "welcome") return this.close("El host debe responder hello con welcome.");
      this.state = "active";
      return safeResult(true, "Welcome recibido.", { type: "welcome" });
    }
    if (this.state !== "active" || message.type !== "snapshot") return this.close("El piloto recibió un mensaje P2P fuera de orden.");
    if (message.sequence !== this.snapshotSequence + 1
      || message.snapshot.lastInputSequence < this.lastAcknowledgedInputSequence
      || message.snapshot.lastInputSequence > this.inputSequence) {
      return this.close("El piloto recibió un snapshot P2P fuera de secuencia.");
    }
    this.snapshotSequence = message.sequence;
    this.lastAcknowledgedInputSequence = message.snapshot.lastInputSequence;
    this.lastSnapshot = message.snapshot;
    return safeResult(true, "Snapshot autoritativo recibido.", { type: "snapshot", snapshot: message.snapshot });
  }

  close(reason) {
    this.state = "closed";
    return safeResult(false, reason, { close: true });
  }
}
