// Multiplayer authority for the v2 host-star route. It deliberately reuses
// RocketSimPracticeMatch: this layer maps a bounded P2P roster to the native
// slots, but never simulates, predicts or resolves combat in a browser peer.
import { ROCKETSIM_COMBAT } from "../../src/rocketsim-combat.js";
import { combatAlphaMapLayout } from "../../src/combat-alpha-map.js";
import { createP2PMatchRoster, P2P_MATCH_MAX_PLAYERS, P2P_MATCH_MODES } from "../../src/p2p-room-config.js";
import { RocketSimPracticeMatch } from "../../src/rocketsim-practice-match.js";
import { createRocketSimWasmBridge } from "../../src/rocketsim-wasm-backend.js";

const CONTROL_KEYS = ["airRoll", "boost", "drift", "handbrake", "jump", "pitch", "roll", "steer", "throttle", "yaw"];
const COMMAND_KEYS = ["controls", "fire", "targetId"];
const LEGACY_COMMAND_KEYS = ["controls", "fire", "restart", "targetId"];
const COMBAT_ALPHA_PICKUP_LAYOUT = combatAlphaMapLayout().pickups;

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }

function validCommand(value, allowedTargets) {
  if (!(exact(value, COMMAND_KEYS) || exact(value, LEGACY_COMMAND_KEYS)) || !exact(value.controls, CONTROL_KEYS)
    || ![value.controls.throttle, value.controls.steer, value.controls.pitch, value.controls.yaw, value.controls.roll].every(part => Number.isFinite(part) && part >= -1 && part <= 1)
    || ![value.controls.airRoll, value.controls.boost, value.controls.drift, value.controls.handbrake, value.controls.jump].every(part => typeof part === "boolean")
    || typeof value.fire !== "boolean"
    || !(value.targetId === null || allowedTargets.includes(value.targetId))) return null;
  return {
    controls: { ...value.controls }, fire: value.fire, targetId: value.targetId,
  };
}

function idleCommand() {
  return {
    controls: { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, boost: false, jump: false, drift: false, airRoll: false, handbrake: false },
    fire: false, targetId: null,
  };
}

function physicalCar(car) {
  return { id: car.id, team: car.team, x: car.x, z: car.z, h: car.h, yaw: car.yaw, vx: car.velocity?.x || 0, vz: car.velocity?.z || 0, vh: car.velocity?.y || 0 };
}

function presentationCar(car) {
  const contact = car.contacts?.[0];
  const normal = car.surfaceNormal || { x: 0, y: 1, z: 0 };
  return {
    id: car.id, team: car.team, orientation: { ...car.orientation }, boost: finite(car.boost), grounded: Boolean(car.grounded),
    wheelCount: Number.isInteger(contact?.wheelCount) ? contact.wheelCount : 0, jumps: Number.isInteger(car.jumps) ? car.jumps : 0,
    jumpState: car.jumpState, actionSerials: { ...car.actionSerials }, boosting: Boolean(car.boosting), supersonic: Boolean(car.supersonic), powerslide: Math.max(0, Math.min(1, finite(car.powerslide))),
    angularVelocity: { pitch: finite(car.angularVelocity?.pitch), yaw: finite(car.angularVelocity?.yaw), roll: finite(car.angularVelocity?.roll) },
    wheelContact: { hasContact: Boolean(contact), normal: { x: normal.x, y: normal.y, z: normal.z } },
    worldContact: { hasContact: Array.isArray(car.contacts) && car.contacts.length > 0, normal: { x: normal.x, y: normal.y, z: normal.z } },
  };
}

function timeWinner(score, mode) {
  const entries = Object.entries(score || {});
  if (!entries.length) return null;
  const highest = Math.max(...entries.map(([, value]) => Number(value) || 0));
  const winners = entries.filter(([, value]) => (Number(value) || 0) === highest);
  if (winners.length !== 1) return null;
  return mode === P2P_MATCH_MODES.FREE_FOR_ALL ? winners[0][0] : winners[0][0] === "blue" || winners[0][0] === "red" ? winners[0][0] : null;
}

function convertSnapshot(snapshot, lastInputSequence, roundSerial, roster, { scoreToWin = ROCKETSIM_COMBAT.scoreToWin, durationTicks = null, startedAtTick = 1, mode = roster.mode } = {}) {
  const carsById = new Map(snapshot.cars.map(car => [car.id, car]));
  const cars = roster.players.map(player => carsById.get(player.id)).filter(Boolean);
  const tick = Math.max(1, Math.round(snapshot.time * 60));
  const remainingTicks = Number.isSafeInteger(durationTicks)
    ? Math.max(0, durationTicks - Math.max(0, tick - startedAtTick))
    : null;
  const timeComplete = remainingTicks === 0;
  const winner = timeComplete ? timeWinner(snapshot.score, mode) : (typeof snapshot.winner === "string" ? snapshot.winner : null);
  const pads = Array.isArray(snapshot.pads) ? snapshot.pads.flatMap(pad => {
    const descriptor = COMBAT_ALPHA_PICKUP_LAYOUT[pad.id];
    return descriptor ? [{ id: `pad-${pad.id}`, x: descriptor.x, h: 0, z: descriptor.z, amount: descriptor.amount, cooldown: finite(pad.cooldown), active: pad.active === true }] : [];
  }) : [];
  return {
    tick,
    lastInputSequence,
    physical: cars.map(physicalCar),
    presentation: cars.map(presentationCar),
    combat: {
      score: { ...snapshot.score },
      round: {
        state: winner || timeComplete ? "complete" : "active",
        scoreToWin,
        winner,
        serial: roundSerial,
        ...(Number.isSafeInteger(durationTicks) ? { durationTicks, remainingTicks } : {}),
      },
      cars: cars.map(car => ({ id: car.id, team: car.team, name: car.name, hp: car.hp, respawn: car.respawn, kills: car.kills, deaths: car.deaths, rocketCooldown: car.rocketCooldown, alive: car.hp > 0 && car.respawn <= 0 })),
      rockets: snapshot.rockets.map(rocket => ({ ...rocket, targetId: rocket.targetId ?? null })),
      events: snapshot.events.map(event => ({ ...event })), eliminated: [], respawns: [],
    },
    pads,
  };
}

/**
 * One browser-hosted, authoritative RocketSim combat roster (2–6 humans).
 * A guest's strictly increasing sequence is tracked independently, while the
 * published snapshot exposes only the highest accepted input sequence.
 */
export class P2PWasmMultiplayerCombatHost {
  constructor({ mode = "ffa", playerIds, names = {}, teamsByPlayerId = null, bridgeFactory = () => createRocketSimWasmBridge(), scoreToWin = 1000000, durationSeconds = 300 } = {}) {
    if (typeof bridgeFactory !== "function" || !Number.isSafeInteger(scoreToWin) || scoreToWin < 1 || scoreToWin > 1000000 || !Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) throw new TypeError("La configuración del host WASM multiusuario no es válida.");
    this.roster = createP2PMatchRoster({ mode, playerIds, teamsByPlayerId });
    if (this.roster.players.length < 2 || this.roster.players.length > P2P_MATCH_MAX_PLAYERS) throw new RangeError("El roster WASM multiusuario debe tener entre dos y seis pilotos.");
    this.names = names && typeof names === "object" && !Array.isArray(names) ? names : {};
    this.durationTicks = durationSeconds * 60;
    this.scoreToWin = scoreToWin;
    this.match = new RocketSimPracticeMatch({ arena: "combat-alpha", combat: true, combatMode: mode === P2P_MATCH_MODES.FREE_FOR_ALL ? "ffa" : "teams", vehicleLimit: this.roster.players.length, ticksPerSnapshot: 2, bridgeLabel: "WASM-R20-P2P-MULTI", bridgeFactory, scoreToWin });
    this.commands = new Map(this.roster.players.map(player => [player.id, idleCommand()]));
    this.lastSequenceById = new Map(this.roster.players.map(player => [player.id, 0]));
    this.lastInputSequence = 0;
    this.roundSerial = 1;
    this.lastSnapshot = null;
    this.startedAtTick = null;
    this.closed = false;
    this.ready = this.#start();
  }

  async #start() {
    for (const player of this.roster.players) {
      if (!this.match.addHuman(player.id, this.names[player.id] || (player.role === "host" ? "HOST" : `PILOTO ${player.index + 1}`), { team: player.team })) throw new Error("No se pudo crear el roster nativo multiusuario.");
    }
    await this.match.start();
    // The match must advance once before every joined native car has a pose.
    const first = await this.match.tick();
    this.startedAtTick = Math.max(1, Math.round(first.time * 60));
    this.lastSnapshot = convertSnapshot(first, this.lastInputSequence, this.roundSerial, this.roster, { scoreToWin: this.scoreToWin, durationTicks: this.durationTicks, startedAtTick: this.startedAtTick });
    return this;
  }

  async waitReady() { return this.ready; }

  setCommand(playerId, command, { sequence = null } = {}) {
    if (this.closed || !this.roster.playerById.has(playerId)) return { accepted: false, reason: "El piloto multiusuario no está disponible." };
    const allowedTargets = this.roster.targetsByPlayerId[playerId];
    const normalized = validCommand(command, allowedTargets);
    if (!normalized) return { accepted: false, reason: "El comando multiusuario no es válido para ese roster." };
    if (sequence !== null) {
      const last = this.lastSequenceById.get(playerId) || 0;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= last) return { accepted: false, reason: "La secuencia del piloto debe aumentar estrictamente." };
      this.lastSequenceById.set(playerId, sequence);
      this.lastInputSequence = Math.max(this.lastInputSequence, sequence);
    }
    this.commands.set(playerId, normalized);
    return { accepted: true };
  }

  resetPlayerConnection(playerId) {
    if (this.closed || !this.roster.playerById.has(playerId)) {
      return { accepted: false, reason: "El piloto multiusuario no está disponible." };
    }
    this.commands.set(playerId, idleCommand());
    this.lastSequenceById.set(playerId, 0);
    return { accepted: true };
  }

  setPlayerName(playerId, name) {
    if (this.closed || !this.roster.playerById.has(playerId)) return false;
    const player = this.roster.playerById.get(playerId);
    const normalized = String(name ?? "").replace(/\s+/gu, " ").trim().slice(0, 16) || `PILOTO ${player.index + 1}`;
    this.names[playerId] = normalized;
    this.match.setHumanName?.(playerId, normalized);
    return true;
  }

  async advance(ticks = 1) {
    if (this.closed) throw new Error("El host WASM multiusuario está cerrado.");
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 120) throw new TypeError("Los ticks multiusuario no son válidos.");
    await this.ready;
    let snapshot = this.lastSnapshot;
    for (let index = 0; index < ticks; index += 1) {
      for (const player of this.roster.players) {
        const command = this.commands.get(player.id) || idleCommand();
        this.match.input(player.id, { ...command.controls, fire: command.fire, targetId: command.targetId });
      }
      const raw = await this.match.tick();
      if (this.startedAtTick === null) this.startedAtTick = Math.max(1, Math.round(raw.time * 60));
      snapshot = convertSnapshot(raw, this.lastInputSequence, this.roundSerial, this.roster, { scoreToWin: this.scoreToWin, durationTicks: this.durationTicks, startedAtTick: this.startedAtTick });
      this.lastSnapshot = snapshot;
      for (const [id, command] of this.commands) this.commands.set(id, { ...command, fire: false });
    }
    return structuredClone(snapshot);
  }

  snapshot() { if (!this.lastSnapshot) throw new Error("El host WASM multiusuario aún no tiene snapshot."); return structuredClone(this.lastSnapshot); }
  presentationSnapshot() { return this.snapshot(); }

  metadataSnapshot() {
    const snapshot = this.snapshot();
    return {
      tick: snapshot.tick,
      players: this.roster.players.map(player => ({ id: player.id, team: player.team, name: this.names[player.id] || (player.role === "host" ? "HOST" : `PILOTO ${player.index + 1}`) })),
      pads: snapshot.pads.map(pad => ({ ...pad })),
    };
  }

  close() { if (!this.closed) { this.closed = true; void this.match.shutdown(); } }
}

export async function createP2PWasmMultiplayerCombatHost(options = {}) {
  const host = new P2PWasmMultiplayerCombatHost(options);
  await host.waitReady();
  return host;
}
