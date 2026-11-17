// P2P-WASM-29/31: presentation-only adapter for the causal combat snapshot.
// It never predicts, integrates, sends input, or mutates the authoritative
// WASM state. The renderer can consume the returned shape like a sampled
// server snapshot while the online transport remains a separate boundary.

import { SNAPSHOT_INTERPOLATION_DELAY, SnapshotInterpolator } from "./snapshot-interpolation.js";

export const P2P_WASM_RENDER_CAR_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);

const nowSeconds = () => (typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000);

const TEAMS = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
const EVENT_KINDS = new Set(["fire", "hit", "miss", "elimination", "respawn", "winner", "round", "pad"]);
const PHYSICAL_KEYS = ["id", "team", "x", "z", "h", "yaw", "vx", "vz", "vh"];
const COMBAT_KEYS = ["id", "team", "hp", "respawn", "kills", "deaths", "rocketCooldown", "alive"];
const ROCKET_KEYS = ["id", "owner", "team", "x", "z", "h", "vx", "vz", "vh", "life", "targetId"];
const EVENT_KEYS = ["kind", "text", "at"];

function exactRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function exactArray(value, length) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1 || !ownKeys.includes("length")) return null;
  return Array.from({ length }, (_, index) => Object.hasOwn(value, index) ? value[index] : undefined);
}

function finite(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function nonNegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }

function validPhysical(value, expectedId) {
  const physical = exactRecord(value, PHYSICAL_KEYS);
  if (!physical || physical.id !== expectedId || physical.team !== TEAMS[expectedId]) return null;
  if (!finite(physical.x, -10_000, 10_000) || !finite(physical.z, -10_000, 10_000)
    || !finite(physical.h, -10_000, 1_000) || !finite(physical.yaw, -Math.PI, Math.PI)
    || !finite(physical.vx, -2_500, 2_500) || !finite(physical.vz, -2_500, 2_500)
    || !finite(physical.vh, -2_500, 2_500)) return null;
  return Object.fromEntries(PHYSICAL_KEYS.map(key => [key, physical[key]]));
}

function validCombat(value, expectedId) {
  const combat = exactRecord(value, COMBAT_KEYS);
  if (!combat || combat.id !== expectedId || combat.team !== TEAMS[expectedId]) return null;
  if (!nonNegativeInteger(combat.hp) || combat.hp > 100 || !finite(combat.respawn, 0, 600)
    || !nonNegativeInteger(combat.kills) || !nonNegativeInteger(combat.deaths)
    || !finite(combat.rocketCooldown, 0, 600) || typeof combat.alive !== "boolean"
    || (combat.alive ? combat.hp <= 0 || combat.respawn !== 0 : combat.hp !== 0 || combat.respawn <= 0)) return null;
  return Object.fromEntries(COMBAT_KEYS.map(key => [key, combat[key]]));
}

function validRocket(value) {
  const rocket = exactRecord(value, ROCKET_KEYS);
  if (!rocket || !Number.isSafeInteger(rocket.id) || rocket.id < 1
    || !P2P_WASM_RENDER_CAR_IDS.includes(rocket.owner) || rocket.team !== TEAMS[rocket.owner]
    || (rocket.targetId !== null && !P2P_WASM_RENDER_CAR_IDS.includes(rocket.targetId))) return null;
  if (!finite(rocket.x, -10_000, 10_000) || !finite(rocket.z, -10_000, 10_000)
    || !finite(rocket.h, -100, 1_000) || !finite(rocket.vx, -2_500, 2_500)
    || !finite(rocket.vz, -2_500, 2_500) || !finite(rocket.vh, -2_500, 2_500)
    || !finite(rocket.life, 0, 600)) return null;
  return Object.fromEntries(ROCKET_KEYS.map(key => [key, rocket[key]]));
}

function validEvent(value) {
  const event = exactRecord(value, EVENT_KEYS);
  if (!event || !EVENT_KINDS.has(event.kind) || typeof event.text !== "string"
    || event.text.length > 160 || /[\u0000-\u001F\u007F]/u.test(event.text)
    || !finite(event.at, 0, 600)) return null;
  return Object.fromEntries(EVENT_KEYS.map(key => [key, event[key]]));
}

function normalizeSnapshot(value) {
  const snapshot = exactRecord(value, ["tick", "lastInputSequence", "physical", "score", "round", "cars", "rockets", "events"]);
  if (!snapshot || !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 1
    || !Number.isSafeInteger(snapshot.lastInputSequence) || snapshot.lastInputSequence < 1) return null;
  const physicalInput = exactArray(snapshot.physical, 2);
  const carsInput = exactArray(snapshot.cars, 2);
  if (!physicalInput || !carsInput || !Array.isArray(snapshot.rockets) || snapshot.rockets.length > 16
    || !Array.isArray(snapshot.events) || snapshot.events.length > 8) return null;
  const score = exactRecord(snapshot.score, ["blue", "red"]);
  const round = exactRecord(snapshot.round, ["state", "scoreToWin", "winner", "serial"]);
  if (!score || !nonNegativeInteger(score.blue) || !nonNegativeInteger(score.red)
    || !round || (round.state !== "active" && round.state !== "complete")
    || !Number.isSafeInteger(round.scoreToWin) || round.scoreToWin < 1 || round.scoreToWin > 100
    || !Number.isSafeInteger(round.serial) || round.serial < 1 || round.serial > 1_000_000
    || !(round.winner === null || round.winner === "blue" || round.winner === "red")
    || (round.state === "active" && round.winner !== null)
    || (round.state === "complete" && (!round.winner || score[round.winner] < round.scoreToWin))) return null;
  const physical = P2P_WASM_RENDER_CAR_IDS.map((id, index) => validPhysical(physicalInput[index], id));
  const cars = P2P_WASM_RENDER_CAR_IDS.map((id, index) => validCombat(carsInput[index], id));
  const rockets = snapshot.rockets.map(validRocket);
  const events = snapshot.events.map(validEvent);
  if (physical.some(value => value === null) || cars.some(value => value === null)
    || rockets.some(value => value === null) || events.some(value => value === null)) return null;
  const ids = new Set();
  if (rockets.some(rocket => ids.has(rocket.id) || !ids.add(rocket.id))) return null;
  return { tick: snapshot.tick, lastInputSequence: snapshot.lastInputSequence, physical, score: { blue: score.blue, red: score.red }, round: { state: round.state, scoreToWin: round.scoreToWin, winner: round.winner, serial: round.serial }, cars, rockets, events };
}

/** Build a presentation-only state from one already-decoded causal snapshot. */
export function createP2PWasmRenderState(input, { roomId = null, sessionId = null } = {}) {
  const snapshot = normalizeSnapshot(input);
  if (!snapshot) throw new TypeError("El snapshot causal WASM no cumple el contrato de presentación.");
  if (roomId !== null && (typeof roomId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(roomId))) throw new TypeError("roomId causal no válido.");
  if (sessionId !== null && (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(sessionId))) throw new TypeError("sessionId causal no válido.");

  const cars = snapshot.physical.map((physical, index) => {
    const combat = snapshot.cars[index];
    const speed = Math.hypot(physical.vx, physical.vz, physical.vh);
    const forwardSpeed = physical.vx * Math.cos(physical.yaw) + physical.vz * Math.sin(physical.yaw);
    return {
      id: physical.id, team: physical.team, name: physical.id === "p2p-host" ? "HOST" : "PILOTO",
      x: physical.x, z: physical.z, h: physical.h, yaw: physical.yaw, pitch: 0, roll: 0,
      vx: physical.vx, vz: physical.vz, vh: physical.vh,
      velocity: { x: physical.vx, y: physical.vh, z: physical.vz },
      speed, forwardSpeed, hp: combat.hp, respawn: combat.respawn,
      kills: combat.kills, deaths: combat.deaths, rocketCooldown: combat.rocketCooldown,
      alive: combat.alive, boost: 0, jumps: 0, grounded: false, surfaceType: "air", wallRide: false,
      boosting: false, powerslide: 0, supersonic: false,
      angularVelocity: { pitch: 0, yaw: 0, roll: 0 },
      actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: combat.deaths },
    };
  });
  const settings = { arena: "combat-alpha", practiceArena: "combat-alpha", movementBackend: "rocketsim", roundState: snapshot.round.state, scoreToWin: snapshot.round.scoreToWin, roundSerial: snapshot.round.serial, humans: 2, vehicleLimit: 2, p2p: true };
  if (roomId !== null) settings.roomId = roomId;
  if (sessionId !== null) settings.sessionId = sessionId;
  return {
    time: snapshot.tick / 60,
    settings,
    rules: { combat: true, scoreToWin: snapshot.round.scoreToWin },
    winner: snapshot.round.winner,
    score: snapshot.score,
    cars,
    rockets: snapshot.rockets,
    pads: [],
    events: snapshot.events,
    inputAcknowledged: snapshot.lastInputSequence,
  };
}

/**
 * Presentation-only causal snapshot buffer.
 *
 * This is deliberately not a game session: it accepts already-authoritative
 * snapshots, adapts them, and samples the same bounded interpolation policy
 * used by the LAN renderer. It never sends commands, predicts movement,
 * advances RocketSim/WASM, or mutates the received snapshot.
 */
export class P2PWasmRenderBuffer {
  constructor({ roomId = null, sessionId = null, delay = SNAPSHOT_INTERPOLATION_DELAY, now = nowSeconds } = {}) {
    if (typeof now !== "function" || !Number.isFinite(delay) || delay < 0 || delay > 1) {
      throw new TypeError("La configuración del buffer causal de presentación no es válida.");
    }
    this.roomId = roomId;
    this.sessionId = sessionId;
    this.now = now;
    this.interpolator = new SnapshotInterpolator(delay);
    this.lastTick = 0;
    this.closed = false;
  }

  push(snapshot, receivedAt = this.now()) {
    if (this.closed) return null;
    if (!Number.isFinite(receivedAt) || receivedAt < 0) throw new TypeError("receivedAt causal no es válido.");
    const state = createP2PWasmRenderState(snapshot, { roomId: this.roomId, sessionId: this.sessionId });
    const tick = Math.round(state.time * 60);
    if (tick <= this.lastTick) throw new RangeError("El buffer causal recibió un tick repetido o atrasado.");
    this.lastTick = tick;
    this.interpolator.push(state, receivedAt);
    return state;
  }

  sample(at = this.now()) {
    if (!Number.isFinite(at) || at < 0) throw new TypeError("El instante de muestra causal no es válido.");
    return this.closed ? null : this.interpolator.sample(at);
  }

  reset() {
    this.interpolator.reset();
    this.lastTick = 0;
    return this;
  }

  close() {
    if (this.closed) return this;
    this.closed = true;
    this.interpolator.reset();
    this.lastTick = 0;
    return this;
  }
}
