import { ROCKETSIM_FIXED_STEP_HZ, ROCKETSIM_MAX_CARS } from "./rocketsim-protocol.js";
import { combatViewFor, createRocketSimCombatState, ROCKETSIM_COMBAT, stepRocketSimCombat, winnerForRocketSimScore } from "./rocketsim-combat.js";
import { rocketSimCombatBounds } from "./rocketsim-arena-profile.js";

// Keep RocketSim's 2300 UU/s cap in the 56 world-units/s band already used by
// the Three.js camera, HUD and clean arena. The vertical origin is the native
// resting car origin, which maps the physical floor to Arsenal h = 0.
export const ROCKETSIM_PRACTICE_SCALE = 56 / 2300;
export const ROCKETSIM_PRACTICE_REST_HEIGHT = 17;
export const ROCKETSIM_PRACTICE_TICKS_PER_SNAPSHOT = 2;
export const ROCKETSIM_DEFAULT_ARENA = "arsenal-expanded-cornered-practice";
export const ROCKETSIM_PRACTICE_ARENAS = new Set([
  "arsenal-practice",
  "arsenal-curved-practice",
  "arsenal-expanded-curved-practice",
  "arsenal-expanded-cornered-practice",
  "arsenal-expanded-block-practice",
  "arsenal-expanded-ramp-practice",
  "combat-alpha",
  "combat-lineup",
]);

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = value => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};
const roundAngularRate = value => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
};
const wrapAngle = value => ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
const normalizedNormal = (normal, fallback) => {
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < .0001) return fallback;
  return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
};

function emptyInput() {
  return { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false };
}

function vehicleLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ROCKETSIM_MAX_CARS) {
    throw new Error(`La capacidad RocketSim debe estar entre 1 y ${ROCKETSIM_MAX_CARS}.`);
  }
  return limit;
}

function normalizeInput(input = {}) {
  return {
    throttle: clamp(Number(input.throttle) || 0, -1, 1),
    steer: clamp(Number(input.steer) || 0, -1, 1),
    jump: Boolean(input.jump),
    boost: Boolean(input.boost),
    drift: Boolean(input.drift),
    airRoll: Boolean(input.airRoll),
    roll: clamp(Number(input.roll) || 0, -1, 1),
    fire: Boolean(input.fire),
  };
}

function rotateDirection(quaternion, x, y, z) {
  const ix = quaternion.w * x + quaternion.y * z - quaternion.z * y;
  const iy = quaternion.w * y + quaternion.z * x - quaternion.x * z;
  const iz = quaternion.w * z + quaternion.x * y - quaternion.y * x;
  const iw = -quaternion.x * x - quaternion.y * y - quaternion.z * z;
  return {
    x: ix * quaternion.w + iw * -quaternion.x + iy * -quaternion.z - iz * -quaternion.y,
    y: iy * quaternion.w + iw * -quaternion.y + iz * -quaternion.x - ix * -quaternion.z,
    z: iz * quaternion.w + iw * -quaternion.z + ix * -quaternion.y - iy * -quaternion.x,
  };
}

export function rocketsimPositionToArsenal(position) {
  return {
    x: position.x * ROCKETSIM_PRACTICE_SCALE,
    h: (position.y - ROCKETSIM_PRACTICE_REST_HEIGHT) * ROCKETSIM_PRACTICE_SCALE,
    z: position.z * ROCKETSIM_PRACTICE_SCALE,
  };
}

export function rocketsimVelocityToArsenal(velocity) {
  return {
    x: velocity.x * ROCKETSIM_PRACTICE_SCALE,
    y: velocity.y * ROCKETSIM_PRACTICE_SCALE,
    z: velocity.z * ROCKETSIM_PRACTICE_SCALE,
  };
}

function arsenalPositionToRocketSim(position) {
  return {
    x: position.x / ROCKETSIM_PRACTICE_SCALE,
    y: position.h / ROCKETSIM_PRACTICE_SCALE + ROCKETSIM_PRACTICE_REST_HEIGHT,
    z: position.z / ROCKETSIM_PRACTICE_SCALE,
  };
}

export function attitudeFromRocketSimOrientation(orientation) {
  const forward = rotateDirection(orientation, 1, 0, 0);
  const up = rotateDirection(orientation, 0, 1, 0);
  const yaw = wrapAngle(Math.atan2(forward.z, forward.x));
  const pitch = -Math.asin(clamp(forward.y, -1, 1));
  const right = { x: -forward.z, y: 0, z: forward.x };
  const rightLength = Math.hypot(right.x, right.z);
  if (rightLength < .0001) return { yaw, pitch, roll: 0, forward };
  right.x /= rightLength;
  right.z /= rightLength;
  const baseUp = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const roll = wrapAngle(Math.atan2(
    up.x * right.x + up.y * right.y + up.z * right.z,
    up.x * baseUp.x + up.y * baseUp.y + up.z * baseUp.z,
  ));
  return { yaw, pitch, roll, forward };
}

function event(text, kind, at) {
  return { text, kind, at: round(at) };
}

// This is intentionally a movement-only match. It implements the small part
// of ArenaMatch consumed by server.mjs and exposes the same snapshot shape to
// Three.js. RocketSim remains the sole authority for every active native car.
export class RocketSimPracticeMatch {
  constructor({ bridgeFactory, ticksPerSnapshot = ROCKETSIM_PRACTICE_TICKS_PER_SNAPSHOT, arena = ROCKETSIM_DEFAULT_ARENA, bridgeLabel = "NATIVE", combat = false, vehicleLimit: configuredVehicleLimit = ROCKETSIM_MAX_CARS } = {}) {
    if (typeof bridgeFactory !== "function") throw new Error("RocketSimPracticeMatch needs bridgeFactory");
    if (!Number.isSafeInteger(ticksPerSnapshot) || ticksPerSnapshot < 1) throw new Error("RocketSim practice ticksPerSnapshot is invalid");
    if (!ROCKETSIM_PRACTICE_ARENAS.has(arena)) throw new Error(`RocketSim practice arena is unsupported: ${arena}`);
    this.bridgeFactory = bridgeFactory;
    this.ticksPerSnapshot = ticksPerSnapshot;
    this.arena = arena;
    this.bridgeLabel = String(bridgeLabel || "NATIVE").toUpperCase();
    this.combat = Boolean(combat);
    this.vehicleLimit = vehicleLimit(configuredVehicleLimit);
    this.combatState = this.combat ? createRocketSimCombatState() : null;
    this.roundWinner = null;
    this.bridge = null;
    this.nativeTick = 0;
    this.time = 0;
    this.humans = new Map();
    this.lastCars = new Map();
    this.nativeIds = [];
    this.events = [];
    this.operation = Promise.resolve();
    this.closed = false;
  }

  async start() {
    return this.#queue(async () => {
      if (this.bridge) throw new Error("RocketSim practice is already started");
      await this.#startBridge();
      this.events = [event(`${this.#sessionLabel()} LISTA`, "round", this.time)];
      return this.snapshot();
    });
  }

  addHuman(id, name = "PILOTO") {
    if (this.humans.has(id) || this.humans.size >= this.vehicleLimit) return null;
    const used = new Set([...this.humans.values()].map(human => human.nativeId));
    const nativeId = [1, 2, 3, 4, 5, 6].find(candidate => !used.has(candidate));
    const blueCount = [...this.humans.values()].filter(human => human.team === "blue").length;
    const redCount = [...this.humans.values()].filter(human => human.team === "red").length;
    const team = blueCount <= redCount ? "blue" : "red";
    const human = {
      id,
      nativeId,
      name: String(name).slice(0, 16) || "PILOTO",
      team,
      inputState: emptyInput(),
      previousGrounded: true,
      previousFlags: { hasJumped: false, hasDoubleJumped: false, hasFlipped: false },
      actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 },
      lastCar: null,
      lastLanding: null,
    };
    this.humans.set(id, human);
    this.events.push(event(`${human.name} entra en ${this.#sessionLabel()} (${team.toUpperCase()}).`, "join", this.time));
    // The initial bridge has one inert slot so the server can start before the
    // first hello. Every later join queues a roster check, including a hello
    // received while a previous rebuild has temporarily detached `bridge`.
    // The check is idempotent, so the first pilot simply retains that slot.
    if (this.nativeIds.length) void this.#queue(() => this.#syncNativeRoster());
    return { id, team };
  }

  removeHuman(id) {
    const human = this.humans.get(id);
    if (!human) return;
    this.events.push(event(`${human.name} ha salido de la práctica.`, "leave", this.time));
    this.humans.delete(id);
    this.lastCars.delete(human.nativeId);
    // RocketSim validates the complete ID vector on every tick. When the last
    // human leaves a roster such as [2], the next idle tick uses its canonical
    // inert slot [1]. Rebuild before that tick so both sides agree on [1].
    if (this.nativeIds.length) void this.#queue(() => this.#syncNativeRoster());
  }

  input(id, input) {
    const human = this.humans.get(id);
    if (human) human.inputState = normalizeInput(input);
  }

  configure(settings = {}) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("La configuración RocketSim no es válida.");
    if (!Object.hasOwn(settings, "vehicleLimit")) throw new Error("RocketSim requiere una capacidad de pilotos.");
    if (Object.hasOwn(settings, "botCount") && Number(settings.botCount) !== 0) throw new Error("Los bots RocketSim todavía no están disponibles.");
    const nextLimit = vehicleLimit(settings.vehicleLimit);
    if (nextLimit < this.humans.size) throw new Error("La capacidad no puede ser inferior a los pilotos conectados.");
    if (nextLimit === this.vehicleLimit) return this.snapshot();
    this.vehicleLimit = nextLimit;
    this.events.push(event(`CAPACIDAD ROCKETSIM: ${nextLimit} PILOTOS`, "round", this.time));
    return this.snapshot();
  }

  restart() {
    return this.#queue(async () => {
      this.#assertOpen();
      const oldBridge = this.bridge;
      this.bridge = null;
      // A failed roster rebuild can already have detached the bridge. Restart
      // must still be able to create a fresh sidecar in that state.
      if (oldBridge) await oldBridge.shutdown();
      this.nativeTick = 0;
      this.time = 0;
      this.lastCars.clear();
      if (this.combat) this.combatState = createRocketSimCombatState();
      this.roundWinner = null;
      for (const human of this.humans.values()) {
        human.lastCar = null;
        human.lastLanding = null;
        human.previousGrounded = true;
        human.previousFlags = { hasJumped: false, hasDoubleJumped: false, hasFlipped: false };
        human.actionSerials = { jump: 0, doubleJump: 0, dodge: 0, respawn: human.actionSerials.respawn + 1 };
      }
      await this.#startBridge();
      this.events = [event(`${this.#sessionLabel()} REINICIADO`, "round", this.time)];
      return this.snapshot();
    });
  }

  tick() {
    return this.#queue(async () => {
      this.#assertOpen();
      if (!this.bridge) throw new Error("RocketSim practice is not started");
      // Both fixed steps in one published snapshot must observe the same
      // input. A later WebSocket packet belongs to the next snapshot rather
      // than creating a state that never existed at native 120 Hz.
      const snapshotInputs = [...this.humans.values()].map(human => {
        const { fire, ...physicsInput } = human.inputState;
        return { id: human.nativeId, input: this.combat ? physicsInput : { ...physicsInput, fire } };
      });
      const nativeCars = snapshotInputs.length ? snapshotInputs : [{ id: 1, input: emptyInput() }];
      for (let index = 0; index < this.ticksPerSnapshot; index += 1) {
        this.nativeTick += 1;
        const frame = await this.bridge.tick(this.nativeTick, nativeCars);
        const expectedIds = new Set(nativeCars.map(car => car.id));
        const receivedIds = new Set(frame.cars.map(car => car.id));
        if (frame.tick !== this.nativeTick || frame.cars.length !== expectedIds.size || receivedIds.size !== expectedIds.size || frame.cars.some(car => !expectedIds.has(car.id))) {
          throw new Error("RocketSim practice received an invalid native tick");
        }
        for (const car of frame.cars) this.#acceptNativeCar(car);
        if (this.combat && this.#combatRoundState() === "active") await this.#advanceCombat();
      }
      this.time += this.ticksPerSnapshot / ROCKETSIM_FIXED_STEP_HZ;
      return this.snapshot();
    });
  }

  shutdown() {
    return this.#queue(async () => {
      if (this.closed) return;
      this.closed = true;
      const bridge = this.bridge;
      this.bridge = null;
      if (bridge) await bridge.shutdown();
    });
  }

  snapshot() {
    const cars = [...this.humans.values()]
      .sort((a, b) => a.nativeId - b.nativeId)
      .filter(human => human.lastCar)
      .map(human => this.#carView(human, human.lastCar));
    return {
      time: round(this.time),
      score: this.combat ? { ...this.combatState.score } : { blue: 0, red: 0 },
      winner: this.roundWinner || (this.combat ? winnerForRocketSimScore(this.combatState.score) : null),
      settings: {
        vehicleLimit: this.vehicleLimit,
        botCount: 0,
        arena: "calibration",
        practiceArena: this.arena,
        bridgeLabel: this.bridgeLabel,
        humans: this.humans.size,
        bots: 0,
        profile: this.combat ? "COMBATE ROCKETSIM" : "PRÁCTICA ROCKETSIM",
        movementBackend: "rocketsim",
        roundState: this.combat ? this.#combatRoundState() : "practice",
        scoreToWin: this.combat ? ROCKETSIM_COMBAT.scoreToWin : 0,
      },
      rules: { pads: false, combat: this.combat, unlimitedBoost: false, ramps: false, covers: false, scoreToWin: this.combat ? ROCKETSIM_COMBAT.scoreToWin : 0 },
      cars,
      rockets: this.combat ? this.combatState.rockets.map(rocket => ({ ...rocket })) : [],
      pads: [],
      events: this.events.slice(-4),
    };
  }

  async #startBridge() {
    const bridge = this.bridgeFactory();
    const cars = this.#nativeRoster();
    const ready = await bridge.start({ arena: this.arena, cars });
    if (this.combat && (!ready || ready.features?.staticRaycast !== true)) {
      await bridge.shutdown();
      throw new Error("RocketSim combat requires the static raycast bridge capability");
    }
    this.bridge = bridge;
    this.nativeIds = cars.map(car => car.id);
  }

  #acceptNativeCar(car) {
    const human = [...this.humans.values()].find(candidate => candidate.nativeId === car.id);
    if (!human) return;
    const flags = car.actionFlags;
    if (flags.hasJumped && !human.previousFlags.hasJumped) human.actionSerials.jump += 1;
    if (flags.hasDoubleJumped && !human.previousFlags.hasDoubleJumped) human.actionSerials.doubleJump += 1;
    if (flags.hasFlipped && !human.previousFlags.hasFlipped) human.actionSerials.dodge += 1;
    if (car.grounded && !human.previousGrounded) {
      const attitude = attitudeFromRocketSimOrientation(car.orientation);
      human.lastLanding = {
        frame: this.nativeTick,
        pitch: attitude.pitch,
        roll: attitude.roll,
        pitchRate: car.localAngularVelocity.pitch,
        rollRate: car.localAngularVelocity.roll,
        normalSpeed: car.velocity.y * ROCKETSIM_PRACTICE_SCALE,
      };
    }
    human.previousFlags = { ...flags };
    human.previousGrounded = car.grounded;
    human.lastCar = car;
    this.lastCars.set(car.id, car);
  }

  #carView(human, car) {
    const position = rocketsimPositionToArsenal(car.position);
    const velocity = rocketsimVelocityToArsenal(car.velocity);
    const attitude = attitudeFromRocketSimOrientation(car.orientation);
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const forwardSpeed = velocity.x * attitude.forward.x + velocity.y * attitude.forward.y + velocity.z * attitude.forward.z;
    const grounding = car.grounded;
    const surfaceNormal = normalizedNormal(
      car.wheelContact?.hasContact ? car.wheelContact.normal
        : car.worldContact?.hasContact ? car.worldContact.normal : { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    const wallContact = Math.abs(surfaceNormal.y) < .35;
    const ceilingContact = surfaceNormal.y < -.65;
    const surfaceType = wallContact ? "wall" : ceilingContact ? "ceiling" : grounding ? "ground" : "air";
    const combat = this.combat ? combatViewFor(this.combatState, human) : { hp: 100, respawn: 0, kills: 0, deaths: 0 };
    return {
      id: human.id,
      name: human.name,
      team: human.team,
      bot: false,
      x: round(position.x), z: round(position.z), h: round(position.h),
      yaw: round(attitude.yaw), pitch: round(attitude.pitch), roll: round(attitude.roll),
      orientation: { ...car.orientation },
      angularVelocity: {
        pitch: roundAngularRate(car.localAngularVelocity.pitch),
        yaw: roundAngularRate(car.localAngularVelocity.yaw),
        roll: roundAngularRate(car.localAngularVelocity.roll),
      },
      impactSerial: 0,
      impactSpin: 0,
      actionSerials: { ...human.actionSerials },
      speed: round(speed),
      velocity: { x: round(velocity.x), y: round(velocity.y), z: round(velocity.z) },
      forwardSpeed: round(forwardSpeed),
      steer: human.inputState.steer,
      powerslide: human.inputState.drift ? 1 : 0,
      grounded: grounding,
      surfaceNormal,
      contacts: (grounding || car.worldContact?.hasContact) ? [{ kind: surfaceType, normal: surfaceNormal, point: { x: round(position.x), y: round(position.h), z: round(position.z) }, wheelCount: car.wheelCount, normalVelocity: round(velocity.x * surfaceNormal.x + velocity.y * surfaceNormal.y + velocity.z * surfaceNormal.z), separation: 0 }] : [],
      wheels: [],
      surfaceType,
      jumpState: car.jumpState,
      jumpHoldRemaining: 0,
      jumpHeldFor: 0,
      jumpWindowRemaining: round(car.secondJumpWindow),
      dodging: car.jumpState === "dodge",
      dodgeRemaining: round(car.dodgeTime),
      dodgePitchLockRemaining: 0,
      dodgeCancelling: false,
      dodgeDirection: { forward: round(car.dodgeDirection.forward), side: round(car.dodgeDirection.side) },
      lastLanding: human.lastLanding ? {
        frame: human.lastLanding.frame,
        pitch: round(human.lastLanding.pitch), roll: round(human.lastLanding.roll),
        pitchRate: roundAngularRate(human.lastLanding.pitchRate), rollRate: roundAngularRate(human.lastLanding.rollRate), normalSpeed: round(human.lastLanding.normalSpeed),
      } : null,
      supersonic: speed > 53,
      hp: combat.hp,
      boost: round(car.boost),
      jumps: car.jumps,
      respawn: combat.respawn,
      kills: combat.kills,
      deaths: combat.deaths,
      boosting: human.inputState.boost && car.boost > 0,
      wallNormal: wallContact ? { x: round(surfaceNormal.x), z: round(surfaceNormal.z) } : { x: 0, z: 0 },
      wallRide: wallContact,
      ceilingContact,
    };
  }

  #queue(operation) {
    const next = this.operation.then(operation, operation);
    this.operation = next.catch(() => {});
    return next;
  }

  #sessionLabel() {
    return this.combat ? "COMBATE ROCKETSIM" : "PRÁCTICA ROCKETSIM";
  }

  #nativeRoster() {
    const humans = [...this.humans.values()].sort((a, b) => a.nativeId - b.nativeId);
    return humans.length
      ? humans.map(human => ({ id: human.nativeId, team: human.team }))
      : [{ id: 1, team: "blue" }];
  }

  async #syncNativeRoster() {
    this.#assertOpen();
    const roster = this.#nativeRoster();
    const ids = roster.map(car => car.id);
    if (ids.length === this.nativeIds.length && ids.every((id, index) => id === this.nativeIds[index])) return;
    const oldBridge = this.bridge;
    this.bridge = null;
    // A bridge timeout can detach the sidecar before this queued roster
    // update executes. Restart/recovery will create the replacement.
    if (oldBridge) await oldBridge.shutdown();
    this.nativeTick = 0;
    this.lastCars.clear();
    if (this.combat) this.combatState = createRocketSimCombatState();
    this.roundWinner = null;
    for (const human of this.humans.values()) {
      human.lastCar = null;
      human.lastLanding = null;
      human.previousGrounded = true;
      human.previousFlags = { hasJumped: false, hasDoubleJumped: false, hasFlipped: false };
      human.actionSerials.respawn += 1;
    }
    await this.#startBridge();
    this.events.push(event("PLAZAS ROCKETSIM ACTUALIZADAS; SPAWN REINICIADO", "round", this.time));
  }

  async #advanceCombat() {
    const cars = [...this.humans.values()]
      .filter(human => human.lastCar)
      .map(human => {
        const native = human.lastCar;
        const position = rocketsimPositionToArsenal(native.position);
        return {
          id: human.id,
          nativeId: human.nativeId,
          name: human.name,
          team: human.team,
          x: position.x,
          h: position.h,
          z: position.z,
          velocity: rocketsimVelocityToArsenal(native.velocity),
          orientation: native.orientation,
        };
      });
    const inputs = new Map([...this.humans.values()].map(human => [human.id, human.inputState]));
    const dt = 1 / ROCKETSIM_FIXED_STEP_HZ;
    const staticHits = new Map();
    if (this.combatState.rockets.length) {
      const segments = this.combatState.rockets.map(rocket => {
        const start = arsenalPositionToRocketSim({ x: rocket.x, h: rocket.h, z: rocket.z });
        const end = arsenalPositionToRocketSim({
          x: rocket.x + rocket.vx * dt,
          h: rocket.h + rocket.vh * dt,
          z: rocket.z + rocket.vz * dt,
        });
        return { id: rocket.id, from: start, to: end };
      });
      const frame = await this.bridge.raycast(segments);
      for (const hit of frame.hits) staticHits.set(hit.id, hit);
    }
    const result = stepRocketSimCombat(this.combatState, cars, dt, inputs, {
      staticHits,
      ...(rocketSimCombatBounds(this.arena) || {}),
    });
    this.events.push(...result.events);
    for (const id of result.eliminated) {
      const human = this.humans.get(id);
      if (!human) continue;
      const frame = await this.bridge.setCombatActive(human.nativeId, false);
      for (const car of frame.cars) this.#acceptNativeCar(car);
    }
    for (const id of result.respawns) {
      const human = this.humans.get(id);
      if (!human) continue;
      const frame = await this.bridge.respawn(human.nativeId);
      for (const car of frame.cars) this.#acceptNativeCar(car);
      human.actionSerials.respawn += 1;
    }
    const winner = winnerForRocketSimScore(result.score);
    if (winner) {
      this.roundWinner = winner;
      this.combatState.rockets = [];
      this.events.push(event(`${winner === "blue" ? "AZUL" : "ROJO"} GANA LA RONDA · PULSA R PARA REINICIAR`, "winner", this.time));
    }
  }

  #combatRoundState() {
    if (!this.combat) return "practice";
    if (this.roundWinner || winnerForRocketSimScore(this.combatState.score)) return "complete";
    return this.humans.size < 2 ? "waiting" : "active";
  }

  #assertOpen() {
    if (this.closed) throw new Error("RocketSim practice is closed");
  }
}
