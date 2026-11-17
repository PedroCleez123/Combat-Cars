// P2P-WASM-12: isolated host adapter that composes real WASM vehicle state
// with the existing authoritative combat rules. This module is deliberately
// not imported by server.mjs, the public P2P transport, or the renderer.
import {
  combatViewFor,
  createRocketSimCombatState,
  prepareRocketSimGuidance,
  ROCKETSIM_COMBAT,
  stepRocketSimCombat,
  winnerForRocketSimScore,
} from "../../src/rocketsim-combat.js";
import {
  ROCKETSIM_PRACTICE_REST_HEIGHT,
  ROCKETSIM_PRACTICE_SCALE,
  rocketsimPositionToArsenal,
  rocketsimVelocityToArsenal,
} from "../../src/rocketsim-practice-match.js";
import {
  createP2PWasmHostMatch,
  P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
} from "./p2p-wasm-host-match.mjs";

const FIXED_DT = 1 / 60;
const IDLE_CONTROLS = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const COMMAND_KEYS = ["controls", "fire", "targetId"];
const LEGACY_COMMAND_KEYS = ["controls", "fire", "restart", "targetId"];
const CONTROL_KEYS = ["boost", "jump", "steer", "throttle"];
const CAR_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);
const CAR_INDEX_BY_ID = Object.freeze({ "p2p-host": 0, "p2p-pilot": 1 });

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

function validTargetId(value) {
  return value === null || (typeof value === "string" && CAR_IDS.includes(value));
}

function normalizeCommand(value) {
  if (!(exactKeys(value, COMMAND_KEYS) || exactKeys(value, LEGACY_COMMAND_KEYS))
    || !validControls(value.controls)
    || typeof value.fire !== "boolean"
    || !validTargetId(value.targetId)) return null;
  return {
    controls: { ...value.controls },
    fire: value.fire,
    targetId: value.targetId,
  };
}

function orientationFromYaw(yaw) {
  const half = yaw * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

function combatCarFromPhysical(car) {
  const position = rocketsimPositionToArsenal({ x: car.x, y: car.h, z: car.z });
  const velocity = rocketsimVelocityToArsenal({ x: car.vx, y: car.vh, z: car.vz });
  return {
    id: car.id,
    team: car.team,
    name: car.id,
    x: position.x,
    h: position.h,
    z: position.z,
    orientation: orientationFromYaw(car.yaw),
    velocity,
  };
}

function arsenalPositionToRocketSim(position) {
  return {
    x: position.x / ROCKETSIM_PRACTICE_SCALE,
    y: position.h / ROCKETSIM_PRACTICE_SCALE + ROCKETSIM_PRACTICE_REST_HEIGHT,
    z: position.z / ROCKETSIM_PRACTICE_SCALE,
  };
}

function clonePhysicalCar(car) {
  return { ...car };
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
    // The causal wire contract has an explicit nullable targetId. Keep the
    // host snapshot shape identical for straight and guided launches so a
    // presentation consumer cannot observe an optional-key race on fire.
    targetId: rocket.targetId ?? null,
  };
}

function cloneEvent(event) {
  return { ...event };
}

function buildCombatCars(state, physicalCars) {
  return physicalCars.map(car => {
    const view = combatViewFor(state, combatCarFromPhysical(car));
    return {
      id: car.id,
      team: car.team,
      hp: view.hp,
      respawn: view.respawn,
      kills: view.kills,
      deaths: view.deaths,
      rocketCooldown: view.rocketCooldown,
      alive: view.hp > 0 && view.respawn <= 0,
    };
  });
}

function cloneSnapshot(snapshot) {
  return {
    tick: snapshot.tick,
    lastInputSequence: snapshot.lastInputSequence,
    physical: snapshot.physical.map(clonePhysicalCar),
    combat: {
      score: { ...snapshot.combat.score },
      round: { ...snapshot.combat.round },
      cars: snapshot.combat.cars.map(car => ({ ...car })),
      rockets: snapshot.combat.rockets.map(cloneRocket),
      events: snapshot.combat.events.map(cloneEvent),
      eliminated: [...snapshot.combat.eliminated],
      respawns: [...snapshot.combat.respawns],
    },
  };
}

class P2PWasmCombatHostMatch {
  constructor(physical, combatOptions = {}) {
    const { scoreToWin = ROCKETSIM_COMBAT.scoreToWin, ...combatPhysicsOptions } = combatOptions || {};
    if (!Number.isSafeInteger(scoreToWin) || scoreToWin < 1 || scoreToWin > 100) {
      throw new TypeError("P2P WASM combat scoreToWin must be an integer between 1 and 100.");
    }
    this.physical = physical;
    this.combatState = createRocketSimCombatState();
    this.combatOptions = { ...combatPhysicsOptions };
    this.scoreToWin = scoreToWin;
    this.roundWinner = null;
    this.roundSerial = 1;
    this.hostCommand = { controls: { ...IDLE_CONTROLS }, fire: false, targetId: null };
    this.pilotCommand = { controls: { ...IDLE_CONTROLS }, fire: false, targetId: null };
    this.lastInputSequence = 0;
    this.lastSnapshot = null;
    this.closed = false;
  }

  setHostCommand(command) {
    if (this.closed) return { accepted: false, reason: "P2P WASM combat host is closed." };
    const normalized = normalizeCommand(command);
    if (!normalized) return { accepted: false, reason: "Los comandos del host no son válidos." };
    this.hostCommand = normalized;
    return { accepted: true };
  }

  collectStaticRocketHits(cars) {
    prepareRocketSimGuidance(this.combatState, cars, FIXED_DT);
    const staticHits = new Map();
    for (const rocket of this.combatState.rockets) {
      const from = arsenalPositionToRocketSim({ x: rocket.x, h: rocket.h, z: rocket.z });
      const to = arsenalPositionToRocketSim({
        x: rocket.x + rocket.vx * FIXED_DT,
        h: rocket.h + rocket.vh * FIXED_DT,
        z: rocket.z + rocket.vz * FIXED_DT,
      });
      staticHits.set(rocket.id, this.physical.raycastStatic({ from, to }));
    }
    return staticHits;
  }

  receivePilotCommand({ sequence, ...command } = {}, { advance = true } = {}) {
    if (this.closed) return { accepted: false, reason: "P2P WASM combat host is closed." };
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= this.lastInputSequence) {
      return { accepted: false, reason: "La secuencia del piloto debe ser estrictamente creciente." };
    }
    const normalized = normalizeCommand(command);
    if (!normalized || typeof advance !== "boolean") {
      return { accepted: false, reason: "Los comandos del piloto no son válidos." };
    }
    this.lastInputSequence = sequence;
    this.pilotCommand = normalized;
    try {
      this.physical.setHostInput(this.hostCommand.controls);
      const outcome = this.physical.receivePilotInput({
        sequence,
        controls: this.pilotCommand.controls,
      }, { advance: false });
      if (!outcome.accepted) throw new Error(outcome.reason || "El host WASM rechazó el input del piloto.");
      if (!advance) return { accepted: true, snapshot: null };
      return { accepted: true, snapshot: this.advance(1) };
    } catch (error) {
      this.failAndThrow(error);
    }
  }

  /**
   * Advance the authoritative match independently from network input.
   * `receivePilotCommand()` only replaces the latest pilot intent; this method
   * is owned by the fixed host clock and is the sole path that advances the
   * physical and combat timelines after a command has been accepted.
   */
  advance(ticks = 1) {
    if (this.closed) throw new Error("P2P WASM combat host is closed.");
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 120) {
      throw new TypeError("P2P WASM combat host ticks must be between 1 and 120.");
    }
    if (this.lastInputSequence < 1) {
      throw new Error("P2P WASM combat host needs a pilot command before it can advance.");
    }
    try {
      let latestSnapshot = null;
      for (let externalTick = 0; externalTick < ticks; externalTick += 1) {
        this.physical.setHostInput(this.hostCommand.controls);
        const physical = this.physical.advance(1);
        const cars = physical.cars.map(combatCarFromPhysical);
      const inputs = new Map([
        [this.hostCommandId(), { fire: this.hostCommand.fire, targetId: this.hostCommand.targetId }],
        [this.pilotCommandId(), { fire: this.pilotCommand.fire, targetId: this.pilotCommand.targetId }],
      ]);
      let combat;
      if (this.roundWinner) {
        // Keep the physical tick monotonic for the causal clock, but freeze
        // combat scoring, projectiles and events after the authoritative result.
        combat = {
          score: { ...this.combatState.score },
          rockets: [],
          events: [],
          eliminated: [],
          respawns: [],
        };
      } else {
        const staticHits = this.collectStaticRocketHits(cars);
        combat = stepRocketSimCombat(this.combatState, cars, FIXED_DT, inputs, {
          ...this.combatOptions,
          staticHits,
          guidancePrepared: true,
        });
        const winner = winnerForRocketSimScore(combat.score, this.scoreToWin);
        if (winner) {
          this.roundWinner = winner;
          this.combatState.rockets = [];
          const winnerEvent = {
            kind: "winner",
            text: `${winner === "blue" ? "AZUL" : "ROJO"} GANA LA RONDA · PULSA R PARA OTRA RONDA`,
            at: Math.round(this.combatState.time * 100) / 100,
          };
          this.combatState.events.push(winnerEvent);
          combat = { ...combat, rockets: [], events: [...combat.events, winnerEvent] };
        }
      }
      // Combat remains authoritative for timing; the WASM adapter owns the
      // physical body. Apply both transitions before publishing a snapshot so
      // a logical kill cannot leave an active body behind.
      let publishedPhysical = physical;
      for (const id of combat.eliminated) {
        const index = CAR_INDEX_BY_ID[id];
        if (index === undefined) throw new Error(`Unknown P2P combat elimination id: ${id}.`);
        publishedPhysical = this.physical.setCombatActive(index, false);
      }
      for (const id of combat.respawns) {
        const index = CAR_INDEX_BY_ID[id];
        if (index === undefined) throw new Error(`Unknown P2P combat respawn id: ${id}.`);
        publishedPhysical = this.physical.respawn(index);
      }
      this.lastSnapshot = {
        tick: publishedPhysical.tick,
        lastInputSequence: publishedPhysical.lastInputSequence,
        physical: publishedPhysical.cars.map(clonePhysicalCar),
        combat: {
          score: { ...combat.score },
          round: {
            state: this.roundWinner ? "complete" : "active",
            scoreToWin: this.scoreToWin,
            winner: this.roundWinner,
            serial: this.roundSerial,
          },
          cars: buildCombatCars(this.combatState, publishedPhysical.cars),
          rockets: combat.rockets.map(cloneRocket),
          events: combat.events.map(cloneEvent),
          eliminated: [...combat.eliminated],
          respawns: [...combat.respawns],
        },
      };
        // Fire is an edge-triggered intent. Consume it after one authoritative
        // tick so a delayed input packet cannot spawn repeated rockets.
        this.hostCommand = { ...this.hostCommand, fire: false };
        this.pilotCommand = { ...this.pilotCommand, fire: false };
        latestSnapshot = this.lastSnapshot;
      }
      return cloneSnapshot(latestSnapshot);
    } catch (error) {
      this.failAndThrow(error);
    }
  }

  hostCommandId() { return "p2p-host"; }
  pilotCommandId() { return "p2p-pilot"; }

  snapshot() {
    if (this.closed) throw new Error("P2P WASM combat host is closed.");
    if (!this.lastSnapshot) throw new Error("P2P WASM combat host needs a pilot command before snapshot.");
    return cloneSnapshot(this.lastSnapshot);
  }

  /**
   * Return the compact combat snapshot plus native presentation telemetry.
   * This is intentionally separate from snapshot() until ONLINE-PROTOCOL-02B
   * defines and versions the extended wire envelope.
   */
  presentationSnapshot() {
    if (this.closed) throw new Error("P2P WASM combat host is closed.");
    if (!this.lastSnapshot) throw new Error("P2P WASM combat host needs a pilot command before snapshot.");
    try {
      const physical = this.physical.presentationSnapshot();
      if (physical.tick !== this.lastSnapshot.tick || physical.lastInputSequence !== this.lastSnapshot.lastInputSequence) {
        throw new Error("P2P WASM presentation telemetry is outside the combat timeline.");
      }
      return {
        tick: physical.tick,
        lastInputSequence: physical.lastInputSequence,
        physical: physical.cars.map(clonePhysicalCar),
        presentation: physical.presentation.map(car => structuredClone(car)),
        combat: {
          score: { ...this.lastSnapshot.combat.score },
          round: { ...this.lastSnapshot.combat.round },
          cars: this.lastSnapshot.combat.cars.map(car => ({ ...car })),
          rockets: this.lastSnapshot.combat.rockets.map(cloneRocket),
          events: this.lastSnapshot.combat.events.map(cloneEvent),
          eliminated: [...this.lastSnapshot.combat.eliminated],
          respawns: [...this.lastSnapshot.combat.respawns],
        },
      };
    } catch (error) {
      this.failAndThrow(error);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.physical.close();
  }

  cleanup() { return this.close(); }

  failAndThrow(error) {
    try { this.close(); } catch { /* preserve the simulation error */ }
    throw error instanceof Error ? error : new Error("P2P WASM combat host failed.", { cause: error });
  }
}

/**
 * Create a causal combat host. The underlying physical adapter advances one
 * fixed external tick per `advance()` call; pilot commands only replace the
 * latest controls, so transport cadence cannot silently become the simulation
 * timeline.
 */
export async function createP2PWasmCombatHost({
  moduleFactory,
  // Combat is an isolated diagnostic path. It must preserve real RocketSim
  // acceleration/impact samples instead of inheriting the deliberately
  // narrow P2P-WASM-07 transport smoke bound.
  maxVelocityComponent = P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  combatOptions = {},
  fixture,
} = {}) {
  const physical = await createP2PWasmHostMatch({ moduleFactory, ticksPerInput: 1, maxVelocityComponent, fixture });
  if (!physical.hasCombatLifecycle()) {
    physical.close();
    throw new Error("P2P-WASM-12 requires the combat lifecycle ABI before composing the host.");
  }
  if (!physical.hasStaticRaycast()) {
    physical.close();
    throw new Error("P2P-WASM-14 requires the static raycast ABI before composing the host.");
  }
  return new P2PWasmCombatHostMatch(physical, combatOptions);
}

export const P2P_WASM_COMBAT_FIXED_DT = FIXED_DT;
export const P2P_WASM_COMBAT_CAR_IDS = CAR_IDS;
export { normalizeCommand as normalizeP2PWasmCombatCommand };

