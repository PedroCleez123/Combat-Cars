// Authoritative RocketSim WASM lobby. It owns only a waiting room: cars can
// move and consume no combat state, while the roster and team/name choices are
// kept on one host and published as the separate lobby protocol.
import { RocketSimPracticeMatch } from "../../src/rocketsim-practice-match.js";
import { createRocketSimWasmBridge } from "../../src/rocketsim-wasm-backend.js";
import {
  P2P_WASM_MULTIPLAYER_LOBBY_MAX_PLAYERS,
  validateP2PWasmMultiplayerLobbySnapshot,
} from "./p2p-wasm-multiplayer-lobby-protocol.mjs";

const MODES = new Set(["1v1", "2v2", "3v3", "ffa"]);
const CAPACITY = Object.freeze({ "1v1": 2, "2v2": 4, "3v3": 6, ffa: 6 });
const TEAM_MODES = new Set(["1v1", "2v2", "3v3"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const PLAYER_ID = /^p2p-[a-z0-9][a-z0-9-]{0,31}$/u;
const CONTROL_KEYS = ["airRoll", "boost", "drift", "handbrake", "jump", "pitch", "roll", "steer", "throttle", "yaw"];

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function cleanName(value) { return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 16); }
function validMode(mode) { return mode === null || (typeof mode === "string" && MODES.has(mode)); }
function capacityFor(_mode) { return P2P_WASM_MULTIPLAYER_LOBBY_MAX_PLAYERS; }
function validTeam(mode, team) { return mode === null || mode === "ffa" ? team === null : team === null || team === "blue" || team === "red"; }

function idleControls() {
  return { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, boost: false, jump: false, drift: false, airRoll: false, handbrake: false };
}
function normalizeControls(value) {
  if (!exact(value, CONTROL_KEYS)) return null;
  const analog = [value.throttle, value.steer, value.pitch, value.yaw, value.roll];
  const digital = [value.airRoll, value.boost, value.drift, value.handbrake, value.jump];
  if (!analog.every(part => Number.isFinite(part) && part >= -1 && part <= 1) || !digital.every(part => typeof part === "boolean")) return null;
  return { throttle: value.throttle, steer: value.steer, pitch: value.pitch, yaw: value.yaw, roll: value.roll, boost: value.boost, jump: value.jump, drift: value.drift, airRoll: value.airRoll, handbrake: value.handbrake };
}
function teamLimit(mode) { return mode === "ffa" ? 0 : CAPACITY[mode] / 2; }

function playerView(player, car, command, sequence) {
  const position = car || {};
  const velocity = position.velocity || { x: 0, y: 0, z: 0 };
  const orientation = position.orientation || { x: 0, y: 0, z: 0, w: 1 };
  const angularVelocity = position.angularVelocity || { pitch: 0, yaw: 0, roll: 0 };
  const contact = position.contacts?.[0];
  const normal = position.surfaceNormal || { x: 0, y: 1, z: 0 };
  return {
    id: player.id, slot: player.slot, name: player.name, team: player.team,
    x: finite(position.x), h: finite(position.h), z: finite(position.z),
    yaw: finite(position.yaw), pitch: finite(position.pitch), roll: finite(position.roll),
    orientation: { x: finite(orientation.x), y: finite(orientation.y), z: finite(orientation.z), w: finite(orientation.w, 1) },
    vx: finite(velocity.x), vh: finite(velocity.y), vz: finite(velocity.z),
    angularVelocity: { pitch: finite(angularVelocity.pitch), yaw: finite(angularVelocity.yaw), roll: finite(angularVelocity.roll) },
    boost: clamp(finite(position.boost), 0, 100), grounded: Boolean(position.grounded),
    wheelCount: Number.isInteger(contact?.wheelCount) ? clamp(contact.wheelCount, 0, 4) : 0,
    jumps: Number.isInteger(position.jumps) ? clamp(position.jumps, 0, 2) : 0,
    jumpState: typeof position.jumpState === "string" ? position.jumpState.slice(0, 32) : "air",
    actionSerials: { jump: position.actionSerials?.jump || 0, doubleJump: position.actionSerials?.doubleJump || 0, dodge: position.actionSerials?.dodge || 0, respawn: position.actionSerials?.respawn || 0 },
    boosting: Boolean(position.boosting), supersonic: Boolean(position.supersonic), powerslide: clamp(finite(position.powerslide), 0, 1),
    wheelContact: { hasContact: Boolean(contact), normal: { x: finite(normal.x), y: finite(normal.y), z: finite(normal.z) } },
    worldContact: { hasContact: Array.isArray(position.contacts) && position.contacts.length > 0, normal: { x: finite(normal.x), y: finite(normal.y), z: finite(normal.z) } },
    lastSequence: sequence,
    // Keep the input out of the wire state; it is only retained by the host.
    _command: command,
  };
}

function withoutPrivateView(player) {
  const { _command, ...publicPlayer } = player;
  return publicPlayer;
}

/**
 * A bounded 1..6 player waiting room. The native match is non-combat and
 * RocketSim is the only movement authority, including its infinite boost ABI.
 */
export class P2PWasmMultiplayerLobbyHost {
  constructor({ roomId = "p2p-lobby", sessionId = "p2p-lobby-session", mode = "1v1", hostId = "p2p-host", hostName, hostTeam = null, initialPlayers = [], initialEnvelopeSequence = 0, bridgeFactory = () => createRocketSimWasmBridge() } = {}) {
    if (!ID.test(roomId) || !ID.test(sessionId) || !validMode(mode) || typeof bridgeFactory !== "function") throw new TypeError("La configuración del lobby WASM no es válida.");
    if (!PLAYER_ID.test(hostId) || cleanName(hostName).length < 1) throw new TypeError("El lobby WASM requiere nombre e identidad del host.");
    if (!Array.isArray(initialPlayers) || initialPlayers.length > capacityFor(mode) - 1) throw new RangeError("El roster inicial del lobby WASM supera su capacidad.");
    this.roomId = roomId; this.sessionId = sessionId; this.mode = mode; this.maxPlayers = capacityFor(mode);
    this.players = new Map(); this.commands = new Map(); this.lastSequenceById = new Map();
    this.tickCount = 0; this.envelopeSequence = Number.isSafeInteger(initialEnvelopeSequence) && initialEnvelopeSequence >= 0 ? initialEnvelopeSequence : 0; this.closed = false;
    this.match = new RocketSimPracticeMatch({ arena: "combat-alpha", combat: false, combatMode: "teams", vehicleLimit: this.maxPlayers, ticksPerSnapshot: 2, bridgeLabel: "WASM-R20-P2P-LOBBY", unlimitedBoost: true, bridgeFactory });
    const normalizedHostTeam = mode === null || mode === "ffa" ? null : (hostTeam ?? "blue");
    this.#insertPlayer({ id: hostId, name: hostName, team: normalizedHostTeam });
    for (const player of initialPlayers) {
      if (!player || typeof player !== "object") throw new TypeError("El jugador inicial del lobby WASM no es válido.");
      let team = player.team ?? null;
      if (mode === null || mode === "ffa") team = null;
      else if (team === null) {
        const blue = [...this.players.values()].filter(candidate => candidate.team === "blue").length;
        const red = [...this.players.values()].filter(candidate => candidate.team === "red").length;
        team = blue < teamLimit(mode) ? "blue" : red < teamLimit(mode) ? "red" : null;
      }
      this.#insertPlayer({ ...player, team });
    }
    this.ready = this.#start();
  }

  #insertPlayer({ id, name, team = null } = {}) {
    if (!PLAYER_ID.test(id) || this.players.has(id) || this.players.size >= this.maxPlayers || cleanName(name).length < 1) throw new TypeError("El jugador del lobby WASM requiere identidad y nombre únicos.");
    if (!validTeam(this.mode, team)) throw new TypeError("El equipo del lobby WASM no es válido para el modo.");
    if (TEAM_MODES.has(this.mode) && team !== null && [...this.players.values()].filter(player => player.team === team).length >= teamLimit(this.mode)) throw new RangeError("El equipo del lobby WASM está lleno.");
    const slot = [...Array(this.maxPlayers).keys()].find(candidate => ![...this.players.values()].some(player => player.slot === candidate));
    const player = { id, slot, name: cleanName(name), team };
    this.players.set(id, player); this.commands.set(id, idleControls()); this.lastSequenceById.set(id, 0);
    return player;
  }

  async #start() {
    for (const player of this.players.values()) {
      if (!this.match.addHuman(player.id, player.name, { team: player.team })) throw new Error("No se pudo crear el roster de lobby nativo.");
    }
    await this.match.start();
    const raw = await this.match.tick();
    this.tickCount = Math.max(1, Math.round(raw.time * 60));
    return this;
  }

  async waitReady() { return this.ready; }

  async addPlayer({ id, name, team = null } = {}) {
    await this.ready;
    if (this.closed) return { accepted: false, reason: "El lobby está cerrado." };
    if (!PLAYER_ID.test(id) || cleanName(name).length < 1 || this.players.has(id) || this.players.size >= this.maxPlayers) return { accepted: false, reason: "Identidad, nombre o capacidad no válidos." };
    if (this.mode === null || this.mode === "ffa") team = null;
    else if (team === null) {
      const blue = [...this.players.values()].filter(player => player.team === "blue").length;
      const red = [...this.players.values()].filter(player => player.team === "red").length;
      team = blue < teamLimit(this.mode) ? "blue" : red < teamLimit(this.mode) ? "red" : null;
    }
    try { this.#insertPlayer({ id, name, team }); } catch (error) { return { accepted: false, reason: error.message }; }
    const player = this.players.get(id);
    this.match.addHuman(id, player.name, { team: player.team });
    await this.match.operation;
    await this.match.tick();
    return { accepted: true, snapshot: this.snapshot() };
  }

  async removePlayer(id) {
    await this.ready;
    if (this.closed || !this.players.has(id)) return { accepted: false, reason: "El piloto no está en el lobby." };
    // A waiting room always has an authority owner; ending that session is a
    // close operation, never an invalid zero-player snapshot.
    if (this.players.size === 1) return { accepted: false, reason: "El host debe permanecer en el lobby." };
    this.players.delete(id); this.commands.delete(id); this.lastSequenceById.delete(id);
    this.match.removeHuman(id); await this.match.operation;
    if (this.players.size) await this.match.tick();
    return { accepted: true, snapshot: this.snapshot() };
  }

  setPlayerName(id, name) {
    if (this.closed || !this.players.has(id) || cleanName(name).length < 1) return false;
    const normalized = cleanName(name); this.players.get(id).name = normalized; this.match.setHumanName(id, normalized); return true;
  }

  setTeam(id, team) {
    if (this.closed || this.mode === null || this.mode === "ffa" || !this.players.has(id) || !validTeam(this.mode, team)) return false;
    if (this.players.get(id).team === team) return true;
    if (team !== null && [...this.players.values()].filter(player => player.team === team).length >= teamLimit(this.mode)) return false;
    this.players.get(id).team = team;
    return true;
  }

  setCommand(id, controls, { sequence = null } = {}) {
    if (this.closed || !this.players.has(id)) return { accepted: false, reason: "El piloto no está en el lobby." };
    const normalized = normalizeControls(controls);
    if (!normalized) return { accepted: false, reason: "Los controles del lobby WASM no son válidos." };
    if (sequence !== null) {
      const last = this.lastSequenceById.get(id) || 0;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= last) return { accepted: false, reason: "La secuencia del piloto debe aumentar estrictamente." };
      this.lastSequenceById.set(id, sequence); this.envelopeSequence = Math.max(this.envelopeSequence, sequence);
    }
    this.commands.set(id, normalized); return { accepted: true };
  }

  async advance(ticks = 1) {
    if (this.closed) throw new Error("El lobby WASM está cerrado.");
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 120) throw new TypeError("Los ticks del lobby WASM no son válidos.");
    await this.ready;
    let raw;
    for (let index = 0; index < ticks; index += 1) {
      for (const [id, controls] of this.commands) this.match.input(id, controls);
      raw = await this.match.tick();
      this.tickCount = Math.max(this.tickCount + 1, Math.round(raw.time * 60));
    }
    return this.#snapshotFromRaw(raw || this.match.snapshot());
  }

  #snapshotFromRaw(raw) {
    const carsById = new Map(raw.cars.map(car => [car.id, car]));
    const players = [...this.players.values()].sort((a, b) => a.slot - b.slot).map(player => withoutPrivateView(playerView(player, carsById.get(player.id), this.commands.get(player.id), this.lastSequenceById.get(player.id) || 0)));
    const snapshot = { roomId: this.roomId, sessionId: this.sessionId, phase: this.mode === null ? "room-open" : "lobby", mode: this.mode, maxPlayers: this.maxPlayers, tick: this.tickCount, players };
    if (!validateP2PWasmMultiplayerLobbySnapshot(snapshot)) throw new Error("El host produjo un snapshot de lobby fuera de contrato.");
    return snapshot;
  }

  snapshot() { return this.#snapshotFromRaw(this.match.snapshot()); }

  nextEnvelopeSequence() { this.envelopeSequence += 1; return this.envelopeSequence; }

  close() { if (!this.closed) { this.closed = true; void this.match.shutdown(); } }
}

export async function createP2PWasmMultiplayerLobbyHost(options = {}) {
  const host = new P2PWasmMultiplayerLobbyHost(options);
  await host.waitReady();
  return host;
}

