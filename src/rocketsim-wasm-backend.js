import { ROCKETSIM_FIXED_STEP_HZ, ROCKETSIM_MAX_CARS } from "./rocketsim-protocol.js";
import { COMBAT_ALPHA_PICKUP_CAPACITY } from "./combat-alpha-map.js";

const PRESENTATION_FLOATS = 40;
const RAYCAST_FLOATS = 8;
const PAD_FLOATS = 3;
// The compatibility pad ABI remains allocated, but combat-alpha deliberately
// publishes an empty pad list now that boost regenerates in native simulation.
const MAX_PADS = Math.max(1, COMBAT_ALPHA_PICKUP_CAPACITY);
const COMBAT_ALPHA = "combat-alpha";

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function requiredCars(cars) {
  if (!Array.isArray(cars) || cars.length < 1 || cars.length > ROCKETSIM_MAX_CARS) {
    throw new Error("RocketSim WASM roster must contain between 1 and 6 cars.");
  }
  const ids = new Set();
  for (const car of cars) {
    if (!Number.isSafeInteger(car?.id) || car.id < 1 || car.id > ROCKETSIM_MAX_CARS || ids.has(car.id)) {
      throw new Error("RocketSim WASM roster contains an invalid or duplicate car id.");
    }
    if (car.team !== "blue" && car.team !== "red") throw new Error("RocketSim WASM roster team is invalid.");
    ids.add(car.id);
  }
  return cars;
}

function requiredTickCars(cars) {
  if (!Array.isArray(cars) || cars.length < 1 || cars.length > ROCKETSIM_MAX_CARS) {
    throw new Error("RocketSim WASM tick roster is invalid.");
  }
  const ids = new Set();
  for (const car of cars) {
    if (!Number.isSafeInteger(car?.id) || car.id < 1 || car.id > ROCKETSIM_MAX_CARS || ids.has(car.id)) {
      throw new Error("RocketSim WASM tick roster contains an invalid or duplicate car id.");
    }
    ids.add(car.id);
  }
  return cars;
}

function inputValue(input, key, fallback = 0) {
  const value = Number(input?.[key]);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : fallback;
}

function moduleFromDefaultImport() {
  const url = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);
  return import(url.href).then(({ default: createRocketSimWasm }) => createRocketSimWasm());
}

function readFloats(module, pointer, count) {
  const values = Array.from(module.HEAPF32.subarray(pointer >>> 2, (pointer >>> 2) + count));
  if (!values.every(Number.isFinite)) throw new Error("RocketSim WASM returned a non-finite snapshot.");
  return values;
}

function jumpState(grounded, jumps) {
  if (grounded) return "grounded";
  if (jumps <= 0) return "double-jump";
  if (jumps === 1) return "first-jump";
  return "airborne";
}

/**
 * In-process WASM adapter with the same boundary as RocketSimBridge.
 *
 * It intentionally owns no WebRTC, renderer, or combat rules. That keeps the
 * first migration slice replaceable: RocketSimPracticeMatch can compare this
 * authority with the native JSONL bridge before the online host is switched.
 */
export class RocketSimWasmBridge {
  constructor({ moduleFactory = moduleFromDefaultImport } = {}) {
    if (typeof moduleFactory !== "function") throw new TypeError("RocketSimWasmBridge needs a moduleFactory.");
    this.moduleFactory = moduleFactory;
    this.module = null;
    this.tickPointer = 0;
    this.statePointer = 0;
    this.raycastPointer = 0;
    this.padCountPointer = 0;
    this.padPointer = 0;
    this.cars = [];
    this.slotById = new Map();
    // Combat lifecycle is authoritative at this adapter boundary. A defeated
    // slot must not receive the player's next controls while its native body
    // is parked at the lifecycle sentinel awaiting respawn.
    this.activeSlots = [];
    this.lastTick = 0;
    this.closed = true;
  }

  async start({ arena = COMBAT_ALPHA, cars = [], lobby = false } = {}) {
    if (!this.closed) throw new Error("RocketSim WASM bridge is already running.");
    if (arena !== COMBAT_ALPHA) throw new Error(`RocketSim WASM migration currently supports only ${COMBAT_ALPHA}.`);
    const roster = requiredCars(cars);
    const module = await this.moduleFactory();
    const required = ["_malloc", "_free", "_rs_destroy", "_rs_step", "_rs_snapshot_car_authority", "_rs_snapshot_combat_pads", "_rs_raycast_static", "_rs_contain_car", "_rs_set_authority_rules"];
    if (!module || required.some(name => typeof module[name] !== "function")
      || typeof module._rs_set_controls_for_car_full !== "function"
      || typeof module._rs_init_combat_alpha_roster !== "function"
      || typeof module._rs_boost_regeneration_contract !== "function"
      || !(module.HEAPU32 instanceof Uint32Array)
      || !(module.HEAPF32 instanceof Float32Array)) {
      try { module?._rs_destroy?.(); } catch { /* Best effort during failed startup. */ }
      throw new Error("RocketSim WASM module does not expose the full migration ABI.");
    }
    this.module = module;
    this.closed = false;
    try {
      if (module._rs_init_combat_alpha_roster(roster.length) !== 1) throw new Error("RocketSim WASM combat-alpha roster failed to initialize.");
      if (module._rs_set_authority_rules(1) !== 1) throw new Error("RocketSim WASM authority rules could not be configured.");
      if (module._rs_boost_regeneration_contract() !== 1) throw new Error("RocketSim WASM boost regeneration contract is unavailable.");
      this.tickPointer = module._malloc(4);
      this.statePointer = module._malloc(PRESENTATION_FLOATS * Float32Array.BYTES_PER_ELEMENT);
      this.raycastPointer = module._malloc(RAYCAST_FLOATS * Float32Array.BYTES_PER_ELEMENT);
      this.padCountPointer = module._malloc(4);
      this.padPointer = module._malloc(MAX_PADS * PAD_FLOATS * Float32Array.BYTES_PER_ELEMENT);
      if (!this.tickPointer || !this.statePointer || !this.raycastPointer || !this.padCountPointer || !this.padPointer) throw new Error("RocketSim WASM bridge could not allocate ABI buffers.");
      this.cars = roster.map(car => ({ id: car.id, team: car.team }));
      this.slotById = new Map(this.cars.map((car, index) => [car.id, index]));
      this.activeSlots = this.cars.map(() => true);
      this.lastTick = 0;
      return {
        type: "ready",
        schemaVersion: 1,
        fixedStepHz: ROCKETSIM_FIXED_STEP_HZ,
        arena,
        cars: this.cars.map(car => ({ ...car })),
        features: { staticRaycast: true, combatLifecycle: true, lobbyContainment: true, lobbyRules: Boolean(lobby), nativeDemos: false, presentationSnapshot: true, fullControls: true, authoritativeBoostRefill: typeof module._rs_refill_car_boost === "function", authoritativeBoostRegeneration: true },
      };
    } catch (error) {
      await this.shutdown();
      throw error;
    }
  }

  async tick(tick, cars) {
    this.#assertOpen();
    if (!Number.isSafeInteger(tick) || tick !== this.lastTick + 1) throw new Error("RocketSim WASM tick must advance by one.");
    requiredTickCars(cars);
    if (cars.length !== this.cars.length || cars.some((car, index) => car.id !== this.cars[index].id)) {
      throw new Error("RocketSim WASM tick roster does not match the configured cars.");
    }
    for (const car of cars) {
      const slot = this.slotById.get(car.id);
      const input = this.activeSlots[slot]
        ? (car.input || {})
        : { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0 };
      const accepted = this.module._rs_set_controls_for_car_full(
        slot,
        inputValue(input, "throttle"),
        inputValue(input, "steer"),
        inputValue(input, "pitch", -inputValue(input, "throttle")),
        inputValue(input, "yaw", input.airRoll ? 0 : inputValue(input, "steer")),
        inputValue(input, "roll"),
        Number(Boolean(input.jump)),
        Number(Boolean(input.boost)),
        Number(Boolean(input.drift || input.handbrake)),
      );
      if (accepted !== 1) throw new Error(`RocketSim WASM rejected controls for car ${car.id}.`);
    }
    if (this.module._rs_step() !== 1) throw new Error("RocketSim WASM step failed.");
    const frames = this.cars.map(car => this.#readCar(car, tick));
    this.lastTick = tick;
    return { type: "state", schemaVersion: 1, fixedStepHz: ROCKETSIM_FIXED_STEP_HZ, tick, cars: frames, pads: this.#readPads() };
  }

  async raycast(segments) {
    this.#assertOpen();
    if (!Array.isArray(segments) || segments.length < 1 || segments.length > 32) throw new Error("RocketSim WASM raycast segments are invalid.");
    const hits = segments.map(segment => {
      if (!Number.isSafeInteger(segment?.id) || segment.id < 1) throw new Error("RocketSim WASM raycast id is invalid.");
      const { from, to } = segment;
      const accepted = this.module._rs_raycast_static(from.x, from.y, from.z, to.x, to.y, to.z, this.raycastPointer);
      if (accepted !== 1) throw new Error(`RocketSim WASM raycast failed for ${segment.id}.`);
      const values = readFloats(this.module, this.raycastPointer, RAYCAST_FLOATS);
      return {
        id: segment.id,
        hit: values[0] === 1,
        fraction: Math.max(0, Math.min(1, values[1])),
        point: { x: values[2], y: values[3], z: values[4] },
        normal: { x: values[5], y: values[6], z: values[7] },
        kind: "static",
      };
    });
    return { type: "raycast-state", schemaVersion: 1, tick: this.lastTick, hits };
  }

  async respawn(id) {
    this.#assertOpen();
    if (!Number.isSafeInteger(id) || !this.cars.some(car => car.id === id)) throw new Error("RocketSim WASM respawn id is invalid.");
    const slot = this.slotById.get(id);
    if (this.module._rs_respawn_car(slot) !== 1) throw new Error(`RocketSim WASM rejected respawn for car ${id}.`);
    this.activeSlots[slot] = true;
    return this.#stateFrame();
  }

  async contain(id) {
    this.#assertOpen();
    if (!Number.isSafeInteger(id) || !this.cars.some(car => car.id === id)) throw new Error("RocketSim WASM containment id is invalid.");
    const slot = this.slotById.get(id);
    if (this.module._rs_contain_car(slot) !== 1) throw new Error(`RocketSim WASM rejected containment for car ${id}.`);
    return this.#stateFrame();
  }

  async setCombatActive(id, active) {
    this.#assertOpen();
    if (!Number.isSafeInteger(id) || !this.cars.some(car => car.id === id) || typeof active !== "boolean") throw new Error("RocketSim WASM combat lifecycle request is invalid.");
    const slot = this.slotById.get(id);
    if (this.module._rs_set_combat_active_car(slot, Number(active)) !== 1) throw new Error(`RocketSim WASM rejected active state for car ${id}.`);
    this.activeSlots[slot] = active;
    return this.#stateFrame();
  }

  async refillBoost(id) {
    this.#assertOpen();
    if (!Number.isSafeInteger(id) || !this.cars.some(car => car.id === id)) throw new Error("RocketSim WASM boost refill id is invalid.");
    if (typeof this.module._rs_refill_car_boost !== "function") throw new Error("RocketSim WASM module does not expose the authoritative boost refill ABI.");
    const slot = this.slotById.get(id);
    if (this.module._rs_refill_car_boost(slot) !== 1) throw new Error(`RocketSim WASM rejected the boost refill for car ${id}.`);
    return this.#stateFrame();
  }

  async shutdown() {
    if (this.closed) return;
    const module = this.module;
    this.closed = true;
    this.module = null;
    this.cars = [];
    this.slotById.clear();
    this.activeSlots = [];
    this.lastTick = 0;
    for (const key of ["padPointer", "padCountPointer", "raycastPointer", "statePointer", "tickPointer"]) {
      const pointer = this[key];
      this[key] = 0;
      if (pointer) {
        try { module._free(pointer); } catch { /* Continue releasing every owned pointer. */ }
      }
    }
    try { module?._rs_destroy?.(); } catch { /* Cleanup is idempotent and best effort. */ }
  }

  #stateFrame() {
    return { type: "state", schemaVersion: 1, fixedStepHz: ROCKETSIM_FIXED_STEP_HZ, tick: this.lastTick, cars: this.cars.map(car => this.#readCar(car)), pads: this.#readPads() };
  }

  #readPads() {
    if (this.module._rs_snapshot_combat_pads(this.padCountPointer, this.padPointer) !== 1) {
      throw new Error("RocketSim WASM pickup snapshot failed.");
    }
    const count = this.module.HEAPU32[this.padCountPointer >>> 2];
    if (!Number.isSafeInteger(count) || count > MAX_PADS) throw new Error("RocketSim WASM pickup count is invalid.");
    const values = readFloats(this.module, this.padPointer, count * PAD_FLOATS);
    return Array.from({ length: count }, (_, id) => ({
      id,
      active: values[id * PAD_FLOATS] === 1,
      cooldown: Math.max(0, values[id * PAD_FLOATS + 1]),
    }));
  }

  #readCar(car, expectedTick = this.lastTick) {
    if (this.module._rs_snapshot_car_authority(this.slotById.get(car.id), this.tickPointer, this.statePointer) !== 1) {
      throw new Error(`RocketSim WASM snapshot failed for car ${car.id}.`);
    }
    const observedTick = this.module.HEAPU32[this.tickPointer >>> 2];
    if (observedTick !== expectedTick) throw new Error(`RocketSim WASM snapshot tick mismatch: expected ${expectedTick}, received ${observedTick}.`);
    const values = readFloats(this.module, this.statePointer, PRESENTATION_FLOATS);
    const jumps = Math.max(0, Math.min(2, Math.round(values[13])));
    const grounded = values[11] === 1;
    const hasJumped = values[28] === 1;
    const hasDoubleJumped = values[29] === 1;
    const hasFlipped = values[30] === 1;
    const isJumping = values[35] === 1;
    const isFlipping = values[36] === 1;
    return {
      id: car.id,
      position: { x: values[0], y: values[1], z: values[2] },
      velocity: { x: values[3], y: values[4], z: values[5] },
      orientation: { x: values[6], y: values[7], z: values[8], w: values[9] },
      angularVelocity: { x: values[17], y: values[18], z: values[19] },
      localAngularVelocity: { pitch: values[17], yaw: values[18], roll: values[19] },
      worldContact: { hasContact: values[24] === 1, normal: { x: values[25], y: values[26], z: values[27] } },
      wheelContact: { hasContact: values[20] === 1, normal: { x: values[21], y: values[22], z: values[23] } },
      grounded,
      wheelCount: Math.max(0, Math.round(values[12])),
      jumps,
      jumpState: grounded ? "grounded" : isFlipping && hasFlipped ? "dodge" : isJumping ? "first-jump" : hasDoubleJumped ? "double-jump" : "airborne",
      secondJumpWindow: Math.max(0, values[31]),
      dodgeTime: Math.max(0, values[32]),
      dodgeDirection: { forward: values[33], side: values[34] },
      actionFlags: { hasJumped, hasDoubleJumped, hasFlipped },
      boost: Math.max(0, values[10]),
    };
  }

  #assertOpen() {
    if (this.closed || !this.module) throw new Error("RocketSim WASM bridge is not running.");
  }
}

export function createRocketSimWasmBridge(options) {
  return new RocketSimWasmBridge(options);
}

