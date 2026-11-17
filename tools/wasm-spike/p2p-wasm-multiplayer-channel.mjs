import { P2PWasmHostClock } from "./p2p-wasm-host-clock.mjs";
import { createP2PWasmMultiplayerEnvelope, decodeP2PWasmMultiplayerEnvelope, P2P_WASM_MULTIPLAYER_PROTOCOL_VERSION } from "./p2p-wasm-multiplayer-protocol.mjs";

const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_KEYS = ["airRoll", "boost", "drift", "handbrake", "jump", "pitch", "roll", "steer", "throttle", "yaw"];
const COMMAND_KEYS = ["controls", "fire", "targetId"];
const LEGACY_COMMAND_KEYS = ["controls", "fire", "restart", "targetId"];
const IDENTITY_KEYS = ["protocolVersion", "type", "name"];
function exact(value, keys) { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const p = Object.getPrototypeOf(value); if (p !== Object.prototype && p !== null) return null; const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, i) => key === expected[i]) ? value : null; }
function normalizeCommand(value) { const command = exact(value, COMMAND_KEYS) || exact(value, LEGACY_COMMAND_KEYS); const controls = command && exact(command.controls, CONTROL_KEYS); if (!controls || ![controls.throttle, controls.steer, controls.pitch, controls.yaw, controls.roll].every(v => Number.isFinite(v) && v >= -1 && v <= 1) || ![controls.airRoll, controls.boost, controls.drift, controls.handbrake, controls.jump].every(v => typeof v === "boolean") || typeof command.fire !== "boolean" || !(command.targetId === null || ID.test(command.targetId))) return null; return { controls: { ...controls }, fire: command.fire, targetId: command.targetId }; }
export function createP2PWasmMultiplayerCommand({ roomId, sessionId, sequence, command } = {}) { const normalized = normalizeCommand(command); if (!ID.test(roomId) || !ID.test(sessionId) || !Number.isSafeInteger(sequence) || sequence < 1 || !normalized) throw new TypeError("El comando WASM multiusuario no es válido."); return JSON.stringify({ protocolVersion: 6, type: "wasm-causal-combat-multiplayer-command", roomId, sessionId, sequence, command: normalized }); }
export function decodeP2PWasmMultiplayerCommand(text, { roomId, sessionId } = {}) { let value; try { value = JSON.parse(text); } catch { return null; } const message = exact(value, ["protocolVersion", "type", "roomId", "sessionId", "sequence", "command"]); const command = message && normalizeCommand(message.command); return message && message.protocolVersion === P2P_WASM_MULTIPLAYER_PROTOCOL_VERSION && message.type === "wasm-causal-combat-multiplayer-command" && message.roomId === roomId && message.sessionId === sessionId && Number.isSafeInteger(message.sequence) && message.sequence >= 1 && command ? { sequence: message.sequence, command } : null; }
export function createP2PWasmMultiplayerIdentity(name) {
  const value = String(name ?? "").replace(/\s+/gu, " ").trim().slice(0, 16);
  if (!value) throw new TypeError("El nombre multiusuario no es válido.");
  return JSON.stringify({ protocolVersion: P2P_WASM_MULTIPLAYER_PROTOCOL_VERSION, type: "wasm-causal-combat-multiplayer-identity", name: value });
}
export function decodeP2PWasmMultiplayerIdentity(text) {
  let value; try { value = JSON.parse(text); } catch { return null; }
  return exact(value, IDENTITY_KEYS) && value.protocolVersion === P2P_WASM_MULTIPLAYER_PROTOCOL_VERSION && value.type === "wasm-causal-combat-multiplayer-identity" && typeof value.name === "string" && value.name.length > 0 && value.name.length <= 16 ? { name: value.name } : null;
}

export class P2PWasmMultiplayerHostChannel {
  constructor({ roomId, sessionId, host, slotPlayerIds, send, onSnapshot = () => {}, onIdentity = () => {}, HostClock = P2PWasmHostClock, clockOptions = {} } = {}) {
    if (!ID.test(roomId) || !ID.test(sessionId) || !host || typeof host.setCommand !== "function" || typeof host.advance !== "function" || !(slotPlayerIds instanceof Map) || typeof send !== "function" || typeof onSnapshot !== "function") throw new TypeError("El canal host multiusuario no es válido.");
    if (typeof onIdentity !== "function") throw new TypeError("El observador de identidad multiusuario no es válido.");
    this.roomId = roomId; this.sessionId = sessionId; this.host = host; this.slotPlayerIds = new Map(slotPlayerIds); this.send = send; this.onSnapshot = onSnapshot; this.onIdentity = onIdentity; this.sequence = 0; this.closed = false;
    this.clock = new HostClock({ host, ...clockOptions, onSnapshot: snapshot => this.publish(snapshot), onError: error => { this.error = error; } });
  }
  receive(slot, text) { if (this.closed || !this.slotPlayerIds.has(slot)) return { accepted: false, reason: "La plaza multiusuario no está disponible." }; const identity = decodeP2PWasmMultiplayerIdentity(text); if (identity) { const playerId = this.slotPlayerIds.get(slot); const accepted = typeof this.host.setPlayerName !== "function" || this.host.setPlayerName(playerId, identity.name) !== false; if (accepted) this.onIdentity(slot, identity.name); return accepted ? { accepted: true, identity } : { accepted: false, reason: "No se pudo actualizar la identidad multiusuario." }; } const message = decodeP2PWasmMultiplayerCommand(text, this); if (!message) return { accepted: false, reason: "El comando multiusuario no es válido." }; return this.host.setCommand(this.slotPlayerIds.get(slot), message.command, { sequence: message.sequence }); }
  resetSlotConnection(slot) {
    if (this.closed || !this.slotPlayerIds.has(slot) || typeof this.host.resetPlayerConnection !== "function") {
      return { accepted: false, reason: "La plaza multiusuario no está disponible." };
    }
    return this.host.resetPlayerConnection(this.slotPlayerIds.get(slot));
  }
  publish(snapshot) { if (this.closed) return false; let text; try { text = createP2PWasmMultiplayerEnvelope({ roomId: this.roomId, sessionId: this.sessionId, sequence: ++this.sequence, snapshot }); } catch { return false; } try { this.onSnapshot(snapshot, text); } catch { return false; } for (const slot of this.slotPlayerIds.keys()) { try { this.send(slot, text); } catch { /* A departed guest must not stop snapshots for the remaining roster. */ } } if (snapshot?.combat?.round?.state === "complete") this.clock.stop(); return true; }
  start() { return this.clock.start(); }
  close() { if (!this.closed) { this.closed = true; this.clock.close(); this.host.close?.(); } }
}

export class P2PWasmMultiplayerPilotChannel {
  constructor({ roomId, sessionId, send, onSnapshot = () => {} } = {}) { if (!ID.test(roomId) || !ID.test(sessionId) || typeof send !== "function" || typeof onSnapshot !== "function") throw new TypeError("El canal piloto multiusuario no es válido."); this.roomId = roomId; this.sessionId = sessionId; this.send = send; this.onSnapshot = onSnapshot; this.sequence = 0; this.snapshotSequence = 0; }
  sendIdentity(name) { this.send(createP2PWasmMultiplayerIdentity(name)); return { accepted: true }; }
  sendCommand(command) { const text = createP2PWasmMultiplayerCommand({ roomId: this.roomId, sessionId: this.sessionId, sequence: ++this.sequence, command }); this.send(text); return { accepted: true, sequence: this.sequence }; }
  receive(text) { let envelope; try { envelope = decodeP2PWasmMultiplayerEnvelope(text); } catch { return { accepted: false, reason: "El snapshot multiusuario no es válido." }; } if (envelope.roomId !== this.roomId || envelope.sessionId !== this.sessionId || envelope.sequence <= this.snapshotSequence) return { accepted: false, reason: "El snapshot multiusuario no es actual." }; this.snapshotSequence = envelope.sequence; this.onSnapshot(envelope); return { accepted: true, envelope }; }
}
