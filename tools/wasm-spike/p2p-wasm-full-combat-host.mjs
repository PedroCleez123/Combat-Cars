// P2P-WASM-FULL-01: browser host that reuses the same RocketSimPracticeMatch
// authority as the local game. The old causal host intentionally used a
// two-car diagnostic fixture; this adapter keeps the causal room contract but
// runs the real combat-alpha roster, pickups, curved arena and lifecycle.
import {
  ROCKETSIM_COMBAT,
  combatViewFor,
  createRocketSimCombatState,
} from "../../src/rocketsim-combat.js";
import { combatAlphaMapLayout } from "../../src/combat-alpha-map.js";
import { RocketSimPracticeMatch } from "../../src/rocketsim-practice-match.js";
import { createRocketSimWasmBridge } from "../../src/rocketsim-wasm-backend.js";

const HOST_ID = "p2p-host";
const PILOT_ID = "p2p-pilot";
const CAR_IDS = Object.freeze([HOST_ID, PILOT_ID]);
const IDLE_CONTROLS = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const FULL_IDLE_CONTROLS = Object.freeze({
  throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0,
  boost: false, jump: false, drift: false, airRoll: false, handbrake: false,
});
const COMMAND_KEYS = ["controls", "fire", "targetId"];
const LEGACY_COMMAND_KEYS = ["controls", "fire", "restart", "targetId"];
const CONTROL_KEYS = ["boost", "jump", "steer", "throttle"];
const FULL_CONTROL_KEYS = ["airRoll", "boost", "drift", "handbrake", "jump", "pitch", "roll", "steer", "throttle", "yaw"];
const COMBAT_ALPHA_PICKUP_LAYOUT = combatAlphaMapLayout().pickups;

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function validControls(value) {
  return exactKeys(value, CONTROL_KEYS)
    && Number.isFinite(value.throttle) && value.throttle >= -1 && value.throttle <= 1
    && Number.isFinite(value.steer) && value.steer >= -1 && value.steer <= 1
    && typeof value.boost === "boolean" && typeof value.jump === "boolean";
}

function validFullControls(value) {
  return exactKeys(value, FULL_CONTROL_KEYS)
    && Number.isFinite(value.throttle) && value.throttle >= -1 && value.throttle <= 1
    && Number.isFinite(value.steer) && value.steer >= -1 && value.steer <= 1
    && Number.isFinite(value.pitch) && value.pitch >= -1 && value.pitch <= 1
    && Number.isFinite(value.yaw) && value.yaw >= -1 && value.yaw <= 1
    && Number.isFinite(value.roll) && value.roll >= -1 && value.roll <= 1
    && typeof value.boost === "boolean" && typeof value.jump === "boolean"
    && typeof value.drift === "boolean" && typeof value.airRoll === "boolean"
    && typeof value.handbrake === "boolean";
}

function validTargetId(value) {
  return value === null || CAR_IDS.includes(value);
}

function normalizeCommand(value) {
  if (!(exactKeys(value, COMMAND_KEYS) || exactKeys(value, LEGACY_COMMAND_KEYS))
    || (!validControls(value.controls) && !validFullControls(value.controls))
    || typeof value.fire !== "boolean"
    || !validTargetId(value.targetId)) return null;
  return {
    controls: { ...value.controls },
    fire: value.fire,
    targetId: value.targetId,
  };
}

function cloneRocket(rocket) {
  return {
    id: rocket.id,
    owner: rocket.owner,
    team: rocket.team,
    x: rocket.x,
    z: rocket.z,
    h: rocket.h,
    vx: rocket.vx,
    vz: rocket.vz,
    vh: rocket.vh,
    life: rocket.life,
    // Keep host-internal snapshots aligned with the nullable wire field. The
    // causal adapter also normalizes this value, but direct presentation
    // consumers must see one stable rocket record shape on every launch.
    targetId: rocket.targetId ?? null,
  };
}

function cloneEvent(event) { return { ...event }; }

function physicalCar(car) {
  return {
    id: car.id,
    team: car.team,
    x: car.x,
    z: car.z,
    h: car.h,
    yaw: car.yaw,
    vx: car.velocity?.x || 0,
    vz: car.velocity?.z || 0,
    vh: car.velocity?.y || 0,
  };
}

function presentationCar(car) {
  const wheelContact = car.contacts?.[0];
  const surfaceNormal = car.surfaceNormal || { x: 0, y: 1, z: 0 };
  return {
    id: car.id,
    team: car.team,
    orientation: { ...car.orientation },
    boost: Number(car.boost) || 0,
    grounded: Boolean(car.grounded),
    wheelCount: Number.isInteger(wheelContact?.wheelCount) ? wheelContact.wheelCount : 0,
    jumps: Number.isInteger(car.jumps) ? car.jumps : 0,
    // RocketSimPracticeMatch already tracks these values from the native
    // action flags. Copy them verbatim at the host boundary; the presentation
    // path must never infer movement events from pose or input intent.
    jumpState: car.jumpState,
    actionSerials: { ...car.actionSerials },
    boosting: Boolean(car.boosting),
    supersonic: Boolean(car.supersonic),
    powerslide: Math.max(0, Math.min(1, Number(car.powerslide) || 0)),
    angularVelocity: {
      pitch: Number(car.angularVelocity?.pitch) || 0,
      yaw: Number(car.angularVelocity?.yaw) || 0,
      roll: Number(car.angularVelocity?.roll) || 0,
    },
    wheelContact: {
      hasContact: Boolean(wheelContact),
      normal: { x: surfaceNormal.x, y: surfaceNormal.y, z: surfaceNormal.z },
    },
    worldContact: {
      hasContact: Array.isArray(car.contacts) && car.contacts.length > 0,
      normal: { x: surfaceNormal.x, y: surfaceNormal.y, z: surfaceNormal.z },
    },
  };
}

function convertSnapshot(snapshot, lastInputSequence, roundSerial) {
  const cars = snapshot.cars.filter(car => CAR_IDS.includes(car.id));
  const combatCars = cars.map(car => ({
    id: car.id,
    team: car.team,
    hp: car.hp,
    respawn: car.respawn,
    kills: car.kills,
    deaths: car.deaths,
    rocketCooldown: car.rocketCooldown,
    alive: car.hp > 0 && car.respawn <= 0,
  }));
  const winner = snapshot.winner === "blue" ? "blue" : snapshot.winner === "red" ? "red" : null;
  const state = winner
    ? "complete"
    : snapshot.settings?.roundState === "waiting" ? "waiting" : "active";
  const tick = Math.max(1, Math.round(snapshot.time * 60));
  return {
    tick,
    lastInputSequence,
    physical: cars.map(physicalCar),
    presentation: cars.map(presentationCar),
    combat: {
      score: { ...snapshot.score },
      round: { state, scoreToWin: ROCKETSIM_COMBAT.scoreToWin, winner, serial: roundSerial },
      cars: combatCars,
      rockets: snapshot.rockets.map(cloneRocket),
      events: snapshot.events.map(cloneEvent),
      eliminated: [],
      respawns: [],
    },
    // Keep the host-internal full snapshot ready for the shared presentation
    // adapter. The current v5 wire envelope still omits pads deliberately;
    // this field is preserved locally until that transport contract is
    // versioned to carry it.
    pads: Array.isArray(snapshot.pads) ? snapshot.pads.map(pad => ({ ...pad })) : [],
  };
}

export class P2PFullWasmCombatHost {
  constructor({ bridgeFactory = () => createRocketSimWasmBridge(), scoreToWin = ROCKETSIM_COMBAT.scoreToWin, warmup = false } = {}) {
    if (typeof bridgeFactory !== "function") throw new TypeError("El host WASM completo necesita bridgeFactory.");
    if (!Number.isSafeInteger(scoreToWin) || scoreToWin < 1 || scoreToWin > 100) throw new TypeError("scoreToWin no es válido.");
    this.bridgeFactory = bridgeFactory;
    this.scoreToWin = scoreToWin;
    this.match = new RocketSimPracticeMatch({
      arena: "combat-alpha",
      combat: true,
      vehicleLimit: 2,
      ticksPerSnapshot: 2,
      bridgeLabel: "WASM-R20-FULL",
      bridgeFactory: this.bridgeFactory,
      warmup: Boolean(warmup),
    });
    this.hostCommand = { controls: { ...FULL_IDLE_CONTROLS }, fire: false, targetId: PILOT_ID };
    this.pilotCommand = { controls: { ...FULL_IDLE_CONTROLS }, fire: false, targetId: HOST_ID };
    this.lastInputSequence = 0;
    this.roundSerial = 1;
    this.lastSnapshot = null;
    this.closed = false;
    this.warmup = Boolean(warmup);
    this.ready = this.#start();
  }

  async #start() {
    this.match.addHuman(HOST_ID, "HOST");
    if (!this.warmup) this.match.addHuman(PILOT_ID, "PILOTO");
    await this.match.start();
    this.lastSnapshot = convertSnapshot(this.match.snapshot(), this.lastInputSequence, this.roundSerial);
    return this;
  }

  async waitReady() { return this.ready; }

  /**
   * Promote a solo warm-up to the authoritative two-car combat roster. The
   * bridge is rebuilt by the match in one queued operation, so no snapshot
   * from the one-car topology can leak into the active round.
   */
  async promoteToCombat(name = "PILOTO") {
    if (this.closed) return { accepted: false, reason: "El host WASM completo está cerrado." };
    await this.ready;
    if (!this.warmup) return { accepted: false, reason: "El host WASM ya está en combate 1v1." };
    if (this.match.addHuman(PILOT_ID, name) === null) return { accepted: false, reason: "No se pudo añadir el piloto al roster WASM." };
    this.warmup = false;
    this.match.warmup = false;
    this.roundSerial += 1;
    // addHuman() queues the native roster rebuild. The following tick waits for
    // that queue and publishes the first two-car frame without resetting the
    // active simulation through a user-visible restart path.
    this.lastSnapshot = convertSnapshot(await this.match.tick(), this.lastInputSequence, this.roundSerial);
    return { accepted: true, snapshot: this.snapshot() };
  }

  setHostCommand(command) {
    if (this.closed) return { accepted: false, reason: "El host WASM completo está cerrado." };
    const normalized = normalizeCommand(command);
    if (!normalized) return { accepted: false, reason: "Los comandos del host no son válidos." };
    this.hostCommand = normalized;
    return { accepted: true };
  }

  receivePilotCommand({ sequence, ...command } = {}, { advance = true } = {}) {
    if (this.closed) return { accepted: false, reason: "El host WASM completo está cerrado." };
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= this.lastInputSequence) {
      return { accepted: false, reason: "La secuencia del piloto debe ser estrictamente creciente." };
    }
    const normalized = normalizeCommand(command);
    if (!normalized || typeof advance !== "boolean") return { accepted: false, reason: "Los comandos del piloto no son válidos." };
    this.lastInputSequence = sequence;
    this.pilotCommand = normalized;
    this.match.input(HOST_ID, { ...this.hostCommand.controls, fire: this.hostCommand.fire, targetId: this.hostCommand.targetId });
    this.match.input(PILOT_ID, { ...normalized.controls, fire: normalized.fire, targetId: normalized.targetId });
    if (!advance) return { accepted: true, snapshot: null };
    return this.advance(1).then(snapshot => ({ accepted: true, snapshot }));
  }

  async advance(ticks = 1) {
    if (this.closed) throw new Error("El host WASM completo está cerrado.");
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 120) throw new TypeError("Los ticks del host WASM completo no son válidos.");
    await this.ready;
    let snapshot = this.lastSnapshot;
    for (let index = 0; index < ticks; index += 1) {
      this.match.input(HOST_ID, { ...this.hostCommand.controls, fire: this.hostCommand.fire, targetId: this.hostCommand.targetId });
      this.match.input(PILOT_ID, { ...this.pilotCommand.controls, fire: this.pilotCommand.fire, targetId: this.pilotCommand.targetId });
      snapshot = convertSnapshot(await this.match.tick(), this.lastInputSequence, this.roundSerial);
      this.lastSnapshot = snapshot;
      this.hostCommand = { ...this.hostCommand, fire: false };
      this.pilotCommand = { ...this.pilotCommand, fire: false };
    }
    return structuredClone(snapshot);
  }

  snapshot() {
    if (!this.lastSnapshot) throw new Error("El host WASM completo aún no tiene snapshot.");
    return structuredClone(this.lastSnapshot);
  }

  presentationSnapshot() { return this.snapshot(); }

  /**
   * Bounded presentation-only metadata. RocketSim's pickup ABI intentionally
   * returns only lifecycle state (id/active/cooldown); coordinates and amount
   * come from the shared combat-alpha map and never influence simulation.
   */
  metadataSnapshot() {
    const snapshot = this.snapshot();
    return {
      tick: snapshot.tick,
      players: [
        { id: HOST_ID, team: "blue", name: "HOST" },
        { id: PILOT_ID, team: "red", name: "PILOTO" },
      ],
      pads: snapshot.pads.flatMap(pad => {
        const descriptor = COMBAT_ALPHA_PICKUP_LAYOUT[pad.id];
        if (!descriptor) return [];
        return [{
          id: `pad-${pad.id}`,
          x: descriptor.x,
          h: 0,
          z: descriptor.z,
          amount: descriptor.amount,
          cooldown: pad.cooldown,
          active: pad.active,
        }];
      }),
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    void this.match.shutdown();
  }
}

export async function createP2PFullWasmCombatHost(options = {}) {
  const host = new P2PFullWasmCombatHost(options);
  await host.waitReady();
  return host;
}

