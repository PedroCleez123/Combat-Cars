// Transport adapter for the RocketSim WASM waiting lobby.  This file owns the
// wire messages only; WebRTC is supplied later through send/receive callbacks.
// The combat v6 channel is intentionally not reused here: a waiting lobby has
// no score, rockets, health or round state.
import {
  P2P_WASM_MULTIPLAYER_LOBBY_MAX_BYTES,
  createP2PWasmMultiplayerLobbyEnvelope,
  decodeP2PWasmMultiplayerLobbyEnvelope,
} from "./p2p-wasm-multiplayer-lobby-protocol.mjs";

export const P2P_WASM_MULTIPLAYER_LOBBY_CHANNEL_VERSION = 1;
export const P2P_WASM_MULTIPLAYER_LOBBY_CHANNEL_TYPE = "wasm-lobby-message";

const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const PLAYER_ID = /^p2p-[a-z0-9][a-z0-9-]{0,31}$/u;
const CONTROL_KEYS = ["airRoll", "boost", "drift", "handbrake", "jump", "pitch", "roll", "steer", "throttle", "yaw"];
const encoder = new TextEncoder();

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function normalizedName(value) { return String(value ?? "").replace(/\s+/gu, " ").trim(); }
function cleanName(value) { return normalizedName(value).slice(0, 16); }
function validName(value) { const normalized = normalizedName(value); return typeof value === "string" && normalized.length >= 1 && normalized.length <= 16; }
function validRoom(value) { return ID.test(value); }
function validSlot(value) { return integer(value, 1, 5); }
function validTeam(value) { return value === null || value === "blue" || value === "red"; }

function normalizeControls(value) {
  if (!exact(value, CONTROL_KEYS)) return null;
  const analog = [value.throttle, value.steer, value.pitch, value.yaw, value.roll];
  const digital = [value.airRoll, value.boost, value.drift, value.handbrake, value.jump];
  if (!analog.every(part => Number.isFinite(part) && part >= -1 && part <= 1)) return null;
  if (!digital.every(part => typeof part === "boolean")) return null;
  return {
    throttle: value.throttle, steer: value.steer, pitch: value.pitch, yaw: value.yaw,
    roll: value.roll, boost: value.boost, jump: value.jump, drift: value.drift,
    airRoll: value.airRoll, handbrake: value.handbrake,
  };
}

function parseMessage(text) {
  if (typeof text !== "string" || encoder.encode(text).byteLength > P2P_WASM_MULTIPLAYER_LOBBY_MAX_BYTES) throw new TypeError("El mensaje del lobby WASM supera el límite.");
  let value;
  try { value = JSON.parse(text); } catch { throw new SyntaxError("El mensaje del lobby WASM no es JSON."); }
  if (!value || typeof value !== "object" || value.protocolVersion !== P2P_WASM_MULTIPLAYER_LOBBY_CHANNEL_VERSION || value.type !== P2P_WASM_MULTIPLAYER_LOBBY_CHANNEL_TYPE) throw new TypeError("El mensaje del lobby WASM no es compatible.");
  if (value.message === "hello") {
    if (!exact(value, ["protocolVersion", "type", "message", "roomId", "sessionId", "playerId", "name"]) || !validRoom(value.roomId) || !validRoom(value.sessionId) || !PLAYER_ID.test(value.playerId) || !validName(value.name)) throw new TypeError("El hello del lobby WASM no es válido.");
    return { ...value, name: cleanName(value.name) };
  }
  if (value.message === "team") {
    if (!exact(value, ["protocolVersion", "type", "message", "roomId", "sessionId", "playerId", "team"]) || !validRoom(value.roomId) || !validRoom(value.sessionId) || !PLAYER_ID.test(value.playerId) || !validTeam(value.team)) throw new TypeError("El equipo del lobby WASM no es válido.");
    return value;
  }
  if (value.message === "command") {
    if (!exact(value, ["protocolVersion", "type", "message", "roomId", "sessionId", "playerId", "sequence", "controls"]) || !validRoom(value.roomId) || !validRoom(value.sessionId) || !PLAYER_ID.test(value.playerId) || !integer(value.sequence, 1, 100000000)) throw new TypeError("El comando del lobby WASM no es válido.");
    const controls = normalizeControls(value.controls);
    if (!controls) throw new TypeError("Los controles del lobby WASM no son válidos.");
    return { ...value, controls };
  }
  if (value.message === "leave") {
    if (!exact(value, ["protocolVersion", "type", "message", "roomId", "sessionId", "playerId"]) || !validRoom(value.roomId) || !validRoom(value.sessionId) || !PLAYER_ID.test(value.playerId)) throw new TypeError("La salida del lobby WASM no es válida.");
    return value;
  }
  throw new TypeError("El tipo de mensaje del lobby WASM no es válido.");
}

function message(fields) {
  const value = { protocolVersion: P2P_WASM_MULTIPLAYER_LOBBY_CHANNEL_VERSION, type: P2P_WASM_MULTIPLAYER_LOBBY_CHANNEL_TYPE, ...fields };
  const text = JSON.stringify(value);
  if (encoder.encode(text).byteLength > P2P_WASM_MULTIPLAYER_LOBBY_MAX_BYTES) throw new RangeError("El mensaje del lobby WASM supera el límite.");
  // Parse before sending so the constructor and wire path share the same
  // exact-key checks. This also prevents accidental private fields.
  parseMessage(text);
  return text;
}

function result(accepted, reason = null, extra = {}) { return { accepted, ...(reason ? { reason } : {}), ...extra }; }

export function createP2PWasmMultiplayerLobbyHello({ roomId, sessionId, playerId, name } = {}) {
  if (!validRoom(roomId) || !validRoom(sessionId) || !PLAYER_ID.test(playerId) || !validName(name)) throw new TypeError("El hello del lobby WASM requiere sala, identidad y nombre.");
  return message({ message: "hello", roomId, sessionId, playerId, name: cleanName(name) });
}
export function createP2PWasmMultiplayerLobbyTeam({ roomId, sessionId, playerId, team } = {}) {
  if (!validRoom(roomId) || !validRoom(sessionId) || !PLAYER_ID.test(playerId) || !validTeam(team)) throw new TypeError("El equipo del lobby WASM no es válido.");
  return message({ message: "team", roomId, sessionId, playerId, team });
}
export function createP2PWasmMultiplayerLobbyCommand({ roomId, sessionId, playerId, sequence, controls } = {}) {
  if (!validRoom(roomId) || !validRoom(sessionId) || !PLAYER_ID.test(playerId) || !integer(sequence, 1, 100000000) || !normalizeControls(controls)) throw new TypeError("El comando del lobby WASM no es válido.");
  return message({ message: "command", roomId, sessionId, playerId, sequence, controls: normalizeControls(controls) });
}
export function createP2PWasmMultiplayerLobbyLeave({ roomId, sessionId, playerId } = {}) {
  if (!validRoom(roomId) || !validRoom(sessionId) || !PLAYER_ID.test(playerId)) throw new TypeError("La salida del lobby WASM no es válida.");
  return message({ message: "leave", roomId, sessionId, playerId });
}
export function decodeP2PWasmMultiplayerLobbyMessage(text) { return parseMessage(text); }

export class P2PWasmMultiplayerLobbyHostChannel {
  constructor({ roomId, sessionId, lobbyHost, send, onSnapshot = () => {}, joinedSlots = [], allowKnownHello = false } = {}) {
    if (!validRoom(roomId) || !validRoom(sessionId) || !lobbyHost || typeof lobbyHost.snapshot !== "function" || typeof lobbyHost.addPlayer !== "function" || typeof lobbyHost.removePlayer !== "function" || typeof lobbyHost.setTeam !== "function" || typeof lobbyHost.setPlayerName !== "function" || typeof lobbyHost.setCommand !== "function" || typeof lobbyHost.advance !== "function" || typeof lobbyHost.nextEnvelopeSequence !== "function" || typeof send !== "function" || typeof onSnapshot !== "function") throw new TypeError("El canal host del lobby WASM no es válido.");
    if (!Array.isArray(joinedSlots) || joinedSlots.some(slot => !validSlot(slot)) || new Set(joinedSlots).size !== joinedSlots.length) throw new TypeError("Las plazas iniciales del lobby WASM no son válidas.");
    this.roomId = roomId; this.sessionId = sessionId; this.lobbyHost = lobbyHost; this.send = send; this.onSnapshot = onSnapshot; this.started = false; this.closed = false; this.joinedSlots = new Set(joinedSlots); this.allowKnownHello = allowKnownHello === true; this.receiveTail = Promise.resolve();
  }
  async start() { if (this.closed) return result(false, "El canal está cerrado."); if (this.started) return result(true); this.started = true; return this.#publish(); }
  async receive(slot, text) {
    // Data channels preserve wire order, but this handler performs async
    // native-roster work for `hello`. Serialize deliveries too, otherwise a
    // command arriving immediately after hello can observe an unjoined slot
    // and be discarded permanently while its key is already held.
    const queued = this.receiveTail.then(() => this.#receive(slot, text), () => this.#receive(slot, text));
    this.receiveTail = queued.catch(() => {});
    return queued;
  }
  async #receive(slot, text) {
    if (this.closed) return result(false, "El canal está cerrado.");
    if (!validSlot(slot)) return result(false, "La plaza del lobby no es válida.");
    let parsed; try { parsed = parseMessage(text); } catch (error) { return result(false, error instanceof Error ? error.message : "Mensaje inválido."); }
    if (parsed.roomId !== this.roomId || parsed.sessionId !== this.sessionId) return result(false, "La sala del lobby no coincide.");
    const expectedId = `p2p-guest-${slot}`;
    if (parsed.playerId !== expectedId) return result(false, "La identidad no corresponde con la plaza.");
    if (parsed.message === "hello") {
      const current = this.lobbyHost.snapshot().players.find(player => player.id === expectedId);
      if (this.joinedSlots.has(slot)) {
        if (!this.allowKnownHello) return result(false, "El piloto ya está conectado.");
        if (current) this.lobbyHost.setPlayerName(expectedId, parsed.name);
        return this.#publish();
      }
      const accepted = current ? this.lobbyHost.setPlayerName(expectedId, parsed.name) : (await this.lobbyHost.addPlayer({ id: expectedId, name: parsed.name })).accepted;
      if (!accepted) return result(false, "No se pudo añadir al piloto.");
      this.joinedSlots.add(slot);
      return this.#publish();
    }
    if (!this.joinedSlots.has(slot)) return result(false, "El piloto aún no ha enviado hello.");
    if (parsed.message === "team") {
      if (!this.lobbyHost.setTeam(expectedId, parsed.team)) return result(false, "No se pudo cambiar el equipo.");
      return this.#publish();
    }
    if (parsed.message === "command") return this.lobbyHost.setCommand(expectedId, parsed.controls, { sequence: parsed.sequence });
    if (parsed.message === "leave") {
      this.joinedSlots.delete(slot);
      const removed = await this.lobbyHost.removePlayer(expectedId);
      if (!removed.accepted) return result(false, removed.reason || "No se pudo retirar al piloto.");
      return this.#publish();
    }
    return result(false, "Mensaje inválido.");
  }
  async advance(ticks = 1) { if (this.closed) return result(false, "El canal está cerrado."); const snapshot = await this.lobbyHost.advance(ticks); return this.#publish(snapshot); }
  async #publish(snapshot = this.lobbyHost.snapshot()) {
    const sequence = this.lobbyHost.nextEnvelopeSequence();
    const wire = createP2PWasmMultiplayerLobbyEnvelope({ roomId: this.roomId, sessionId: this.sessionId, sequence, snapshot });
    for (const slot of this.joinedSlots) { try { this.send(slot, wire); } catch { /* A closed peer is removed by the WebRTC owner. */ } }
    try { this.onSnapshot(structuredClone(snapshot), sequence); } catch { /* Presentation observers are isolated. */ }
    return result(true, null, { snapshot: structuredClone(snapshot), sequence, wire });
  }
  close() { if (this.closed) return; this.closed = true; this.joinedSlots.clear(); }
}

export class P2PWasmMultiplayerLobbyGuestChannel {
  constructor({ roomId, sessionId, slot, playerId = `p2p-guest-${slot}`, name, send, onSnapshot = () => {} } = {}) {
    if (!validRoom(roomId) || !validRoom(sessionId) || !validSlot(slot) || playerId !== `p2p-guest-${slot}` || typeof send !== "function" || typeof onSnapshot !== "function") throw new TypeError("El canal guest del lobby WASM requiere plaza e identidad válidas.");
    if (!validName(name)) throw new TypeError("El canal guest del lobby WASM requiere un nombre obligatorio de 1 a 16 caracteres.");
    this.roomId = roomId; this.sessionId = sessionId; this.slot = slot; this.playerId = playerId; this.name = cleanName(name); this.send = send; this.onSnapshot = onSnapshot; this.started = false; this.closed = false; this.joined = false; this.lastEnvelopeSequence = 0;
  }
  start() { if (this.closed) return result(false, "El canal está cerrado."); if (!this.started) { this.started = true; this.send(createP2PWasmMultiplayerLobbyHello({ roomId: this.roomId, sessionId: this.sessionId, playerId: this.playerId, name: this.name })); } return result(true); }
  isReadyForCommands() { return this.joined && !this.closed; }
  sendCommand(controls, sequence) { if (this.closed) return result(false, "El canal está cerrado."); if (!this.joined) return result(false, "El lobby aún no ha confirmado tu plaza."); try { const wire = createP2PWasmMultiplayerLobbyCommand({ roomId: this.roomId, sessionId: this.sessionId, playerId: this.playerId, sequence, controls }); this.send(wire); return result(true, null, { wire }); } catch (error) { return result(false, error instanceof Error ? error.message : "Comando inválido."); } }
  sendTeam(team) { if (this.closed) return result(false, "El canal está cerrado."); try { const wire = createP2PWasmMultiplayerLobbyTeam({ roomId: this.roomId, sessionId: this.sessionId, playerId: this.playerId, team }); this.send(wire); return result(true, null, { wire }); } catch (error) { return result(false, error instanceof Error ? error.message : "Equipo inválido."); } }
  leave() { if (this.closed) return result(true); this.closed = true; try { const wire = createP2PWasmMultiplayerLobbyLeave({ roomId: this.roomId, sessionId: this.sessionId, playerId: this.playerId }); this.send(wire); return result(true, null, { wire }); } catch (error) { return result(false, error instanceof Error ? error.message : "No se pudo salir."); } }
  close({ announceLeave = true } = {}) { return announceLeave ? this.leave() : (this.closed = true, result(true)); }
  receive(text) {
    if (this.closed) return result(false, "El canal está cerrado.");
    let envelope; try { envelope = decodeP2PWasmMultiplayerLobbyEnvelope(text); } catch (error) { return result(false, error instanceof Error ? error.message : "Snapshot inválido."); }
    if (envelope.roomId !== this.roomId || envelope.sessionId !== this.sessionId) return result(false, "La sala del lobby no coincide.");
    if (envelope.sequence <= this.lastEnvelopeSequence) return result(false, "El snapshot del lobby ya fue recibido.");
    this.lastEnvelopeSequence = envelope.sequence;
    this.joined = this.joined || envelope.snapshot.players.some(player => player.id === this.playerId);
    try { this.onSnapshot(structuredClone(envelope.snapshot), envelope.sequence); } catch { /* Presentation observers are isolated. */ }
    return result(true, null, { snapshot: envelope.snapshot, sequence: envelope.sequence });
  }
}

