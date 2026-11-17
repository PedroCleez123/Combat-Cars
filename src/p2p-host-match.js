import { ArenaMatch } from "./simulation.js";

export const P2P_HOST_FIXED_STEP_SECONDS = 1 / 60;
export const P2P_HOST_TICKS_PER_INPUT = 6;
export const P2P_HOST_ID = "p2p-host";
export const P2P_PILOT_ID = "p2p-pilot";

const CONTROL_KEYS = ["boost", "jump", "steer", "throttle"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const IDLE_CONTROLS = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function validControls(controls) {
  return exactKeys(controls, CONTROL_KEYS)
    && Number.isFinite(controls.throttle) && controls.throttle >= 0 && controls.throttle <= 1
    && Number.isFinite(controls.steer) && controls.steer >= -1 && controls.steer <= 1
    && typeof controls.boost === "boolean" && typeof controls.jump === "boolean";
}

function compactCar(car) {
  return {
    id: car.id,
    team: car.team,
    x: car.x,
    z: car.z,
    h: car.h,
    yaw: car.yaw,
    vx: car.velocity.x,
    vz: car.velocity.z,
    vh: car.velocity.y,
  };
}

function toArenaControls(controls) {
  return {
    throttle: controls.throttle,
    steer: controls.steer,
    boost: controls.boost,
    jump: controls.jump,
    drift: false,
    airRoll: false,
    roll: 0,
    fire: false,
  };
}

// ArenaMatch is the only simulation authority in this diagnostic. A fixed
// 60 Hz outer step produces two of its existing 120 Hz physics steps.
export class P2PHostMatch {
  constructor({ seed = 1, ticksPerInput = P2P_HOST_TICKS_PER_INPUT } = {}) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError("P2P host seed is invalid.");
    if (!Number.isSafeInteger(ticksPerInput) || ticksPerInput < 1 || ticksPerInput > 120) {
      throw new TypeError("P2P host ticksPerInput must be between 1 and 120.");
    }
    this.match = new ArenaMatch(seed, { vehicleLimit: 2, botCount: 0, arena: "scrapyard" });
    this.match.addHuman(P2P_HOST_ID, "HOST");
    this.match.addHuman(P2P_PILOT_ID, "PILOTO");
    this.ticksPerInput = ticksPerInput;
    this.lastInputSequence = 0;
    this.hostControls = IDLE_CONTROLS;
    this.pilotControls = IDLE_CONTROLS;
  }

  setHostInput(controls) {
    if (!validControls(controls)) return { accepted: false, reason: "Los controles del host no son válidos." };
    this.hostControls = { ...controls };
    return { accepted: true };
  }

  receivePilotInput({ sequence, controls } = {}, { advance = true } = {}) {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= this.lastInputSequence) {
      return { accepted: false, reason: "La secuencia de input debe ser estrictamente creciente." };
    }
    if (!validControls(controls)) return { accepted: false, reason: "Los controles del piloto no son válidos." };

    this.lastInputSequence = sequence;
    this.pilotControls = { ...controls };
    if (!advance) return { accepted: true, snapshot: null };
    return { accepted: true, snapshot: this.advance(this.ticksPerInput) };
  }

  advance(ticks = 1) {
    if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 120) throw new TypeError("P2P host ticks must be between 1 and 120.");
    this.match.input(P2P_HOST_ID, toArenaControls(this.hostControls));
    this.match.input(P2P_PILOT_ID, toArenaControls(this.pilotControls));
    for (let index = 0; index < ticks; index += 1) this.match.tick(P2P_HOST_FIXED_STEP_SECONDS);
    return this.snapshot();
  }

  snapshot() {
    const source = this.match.snapshot();
    const cars = source.cars.map(compactCar).sort((a, b) => a.id.localeCompare(b.id));
    return {
      tick: this.match.tickCount,
      lastInputSequence: this.lastInputSequence,
      cars,
    };
  }
}
