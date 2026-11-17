const DEFAULT_TICKS_PER_INPUT = 6;
const HOST_TICK_LIMIT = 10_000_000;
export const P2P_WASM_HOST_DEFAULT_VELOCITY_COMPONENT = 200;
export const P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT = 2500;
const MAX_TICKS_PER_ADVANCE = 120;
const WASM_STEPS_PER_HOST_TICK = 2;
// The first 28 floats are the renderer telemetry ABI. The final 12 are the
// native authority flags/timers used only to project discrete movement state
// and action edges; the compact nine-float snapshot remains unchanged.
const PRESENTATION_FLOATS = 40;
const HOST_CAR = Object.freeze({ id: "p2p-host", team: "blue", wasmIndex: 0 });
const PILOT_CAR = Object.freeze({ id: "p2p-pilot", team: "red", wasmIndex: 1 });
const IDLE_CONTROLS = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const CONTROL_KEYS = ["boost", "jump", "steer", "throttle"];
const WASM_MODULE_URL = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
export const P2P_WASM_HOST_FIXTURES = Object.freeze({
  COMBAT_LINEUP: "combat-lineup",
  COMBAT_ALPHA_PAIR: "combat-alpha-pair",
});
const FIXTURE_INITIALIZERS = Object.freeze({
  [P2P_WASM_HOST_FIXTURES.COMBAT_LINEUP]: "_rs_init_trace_combat_lineup",
  [P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR]: "_rs_init_trace_combat_alpha_pair",
});

export const P2P_WASM_HOST_TICK_SECONDS = 1 / 60;
export const P2P_WASM_STEPS_PER_EXTERNAL_TICK = WASM_STEPS_PER_HOST_TICK;

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
    && Number.isFinite(controls.throttle) && controls.throttle >= -1 && controls.throttle <= 1
    && Number.isFinite(controls.steer) && controls.steer >= -1 && controls.steer <= 1
    && typeof controls.boost === "boolean" && typeof controls.jump === "boolean";
}

function validRayVector(vector) {
  return exactKeys(vector, ["x", "y", "z"])
    && Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
    && Math.abs(vector.x) <= 100_000 && Math.abs(vector.y) <= 100_000 && Math.abs(vector.z) <= 100_000;
}

function validRaySegment(segment) {
  return (exactKeys(segment, ["from", "to"]) || (exactKeys(segment, ["id", "from", "to"])
    && Number.isSafeInteger(segment.id) && segment.id >= 1))
    && validRayVector(segment.from) && validRayVector(segment.to);
}

function bounded(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function binary(value) {
  return value === 0 || value === 1;
}

function validUnitVector(x, y, z) {
  const length = Math.hypot(x, y, z);
  return bounded(length, 0, 1.001);
}

function jumpStateFromAuthority({ grounded, hasJumped, hasDoubleJumped, hasFlipped, isJumping, isFlipping }) {
  if (grounded) return "grounded";
  if (isFlipping && hasFlipped) return "dodge";
  if (isJumping) return "first-jump";
  if (hasDoubleJumped) return "double-jump";
  return "airborne";
}

function createActionTracker() {
  const previousFlags = { hasJumped: false, hasDoubleJumped: false, hasFlipped: false };
  const serials = { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 };
  return {
    observe(flags) {
      if (flags.hasJumped && !previousFlags.hasJumped) serials.jump += 1;
      if (flags.hasDoubleJumped && !previousFlags.hasDoubleJumped) serials.doubleJump += 1;
      if (flags.hasFlipped && !previousFlags.hasFlipped) serials.dodge += 1;
      Object.assign(previousFlags, flags);
      return { ...serials };
    },
    respawn() {
      previousFlags.hasJumped = false;
      previousFlags.hasDoubleJumped = false;
      previousFlags.hasFlipped = false;
      serials.respawn += 1;
      return { ...serials };
    },
  };
}

function validBufferRange(pointer, byteLength, heapBytes) {
  return Number.isSafeInteger(pointer) && pointer > 0 && pointer % 4 === 0
    && Number.isSafeInteger(byteLength) && byteLength > 0
    && Number.isSafeInteger(heapBytes) && pointer + byteLength <= heapBytes;
}

function assertAllocatedBuffers(module, tickPointer, statePointer) {
  const heapBytes = module.HEAPF32.byteLength;
  if (!validBufferRange(tickPointer, 4, heapBytes)
    || !validBufferRange(statePointer, PRESENTATION_FLOATS * Float32Array.BYTES_PER_ELEMENT, heapBytes)) {
    throw new Error("RocketSim WASM P2P snapshot buffers are outside aligned linear memory.");
  }
  const tickEnd = tickPointer + 4;
  const stateEnd = statePointer + PRESENTATION_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  if (tickPointer < stateEnd && statePointer < tickEnd) {
    throw new Error("RocketSim WASM P2P snapshot buffers overlap.");
  }
}

function loadRocketSimWasm() {
  return import(WASM_MODULE_URL.href).then(({ default: createRocketSimWasm }) => createRocketSimWasm());
}

function normalizeFixture(fixture) {
  if (fixture === undefined) return P2P_WASM_HOST_FIXTURES.COMBAT_LINEUP;
  if (typeof fixture !== "string" || !Object.hasOwn(FIXTURE_INITIALIZERS, fixture)) {
    throw new TypeError("P2P WASM host fixture must be combat-lineup or combat-alpha-pair.");
  }
  return fixture;
}

function assertModuleContract(module, fixture) {
  const initializer = FIXTURE_INITIALIZERS[fixture];
  const requiredFunctions = [
    "_malloc", "_free", initializer, "_rs_destroy",
    "_rs_set_controls_for_car", "_rs_step", "_rs_snapshot_car",
  ];
  if (!module || requiredFunctions.some(name => typeof module[name] !== "function")
    || !(module.HEAPU32 instanceof Uint32Array)
    || !(module.HEAPF32 instanceof Float32Array)) {
    throw new TypeError("RocketSim WASM module does not expose the P2P host ABI.");
  }
}

function assertSnapshotCar(car, maxVelocityComponent, active) {
  // A defeated body stays in the native simulation until the combat adapter
  // respawns it. RocketSim legitimately evolves it after the Z-up lifecycle
  // sentinel (including recovery motion beneath the floor). Permit the wider
  // height span only when the adapter itself marked the slot inactive; active
  // cars keep the tighter normal height envelope and arbitrary WASM output
  // cannot widen it.
  const ranges = active ? [
    [car.x, -10_000, 10_000], [car.z, -10_000, 10_000], [car.h, -100, 1_000],
    [car.yaw, -Math.PI, Math.PI],
    [car.vx, -maxVelocityComponent, maxVelocityComponent],
    [car.vz, -maxVelocityComponent, maxVelocityComponent],
    [car.vh, -maxVelocityComponent, maxVelocityComponent],
  ] : [
    [car.x, -10_000, 10_000], [car.z, -10_000, 10_000], [car.h, -10_000, 1_000],
    [car.yaw, -Math.PI, Math.PI],
    [car.vx, -maxVelocityComponent, maxVelocityComponent],
    [car.vz, -maxVelocityComponent, maxVelocityComponent],
    [car.vh, -maxVelocityComponent, maxVelocityComponent],
  ];
  if (ranges.some(([value, minimum, maximum]) => !Number.isFinite(value) || value < minimum || value > maximum)) {
    throw new RangeError(`RocketSim WASM snapshot for ${car.id} exceeds the P2P snapshot contract: ${JSON.stringify(car)}.`);
  }
}

class P2PWasmHostMatch {
  constructor(module, tickPointer, statePointer, ticksPerInput, maxVelocityComponent, fixture) {
    this.module = module;
    this.tickPointer = tickPointer;
    this.statePointer = statePointer;
    this.ticksPerInput = ticksPerInput;
    this.maxVelocityComponent = maxVelocityComponent;
    this.fixture = fixture;
    this.tick = 0;
    this.wasmTick = 0;
    this.lastInputSequence = 0;
    this.hostControls = { ...IDLE_CONTROLS };
    this.pilotControls = { ...IDLE_CONTROLS };
    // Lifecycle is owned by the combat adapter, but the physical host keeps
    // the same active/inactive state so a defeated body cannot keep moving
    // while its logical combat state is waiting for respawn.
    this.activeSlots = [true, true];
    this.actionTrackers = [createActionTracker(), createActionTracker()];
    this.closed = false;
    this.initialized = true;
  }

  setHostInput(controls) {
    if (this.closed) return { accepted: false, reason: "RocketSim WASM host match is closed." };
    if (!validControls(controls)) return { accepted: false, reason: "Los controles del host no son válidos." };
    this.hostControls = { ...controls };
    return { accepted: true };
  }

  setPilotInput(controls) {
    if (this.closed) return { accepted: false, reason: "RocketSim WASM host match is closed." };
    if (!validControls(controls)) return { accepted: false, reason: "Los controles del piloto no son válidos." };
    this.pilotControls = { ...controls };
    return { accepted: true };
  }

  receivePilotInput({ sequence, controls } = {}, { advance = true } = {}) {
    if (this.closed) return { accepted: false, reason: "RocketSim WASM host match is closed." };
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= this.lastInputSequence) {
      return { accepted: false, reason: "La secuencia de input debe ser estrictamente creciente." };
    }
    if (!validControls(controls) || typeof advance !== "boolean") {
      return { accepted: false, reason: "Los controles del piloto no son válidos." };
    }

    this.lastInputSequence = sequence;
    this.pilotControls = { ...controls };
    if (!advance) return { accepted: true, snapshot: null };
    return { accepted: true, snapshot: this.advance(this.ticksPerInput) };
  }

  advance(ticks = 1) {
    if (this.closed) throw new Error("RocketSim WASM host match is closed.");
    try {
      if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > MAX_TICKS_PER_ADVANCE) {
        throw new TypeError(`P2P WASM host ticks must be between 1 and ${MAX_TICKS_PER_ADVANCE}.`);
      }
      if (this.lastInputSequence < 1) throw new Error("RocketSim WASM host match needs a pilot input before it can advance.");
      if (this.tick + ticks > HOST_TICK_LIMIT) throw new RangeError("P2P WASM host tick limit exceeded.");
      for (let externalTick = 0; externalTick < ticks; externalTick += 1) {
        this.setWasmControls(0, this.hostControls);
        this.setWasmControls(1, this.pilotControls);
        for (let fixedStep = 0; fixedStep < WASM_STEPS_PER_HOST_TICK; fixedStep += 1) {
          if (this.module._rs_step() !== 1) throw new Error("RocketSim WASM step failed.");
          this.wasmTick += 1;
        }
        this.tick += 1;
      }
      return this.readSnapshot();
    } catch (error) {
      this.failAndThrow(error);
    }
  }

  snapshot() {
    if (this.closed) throw new Error("RocketSim WASM host match is closed.");
    try {
      return this.readSnapshot();
    } catch (error) {
      this.failAndThrow(error);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const cleanupErrors = [];
    for (const pointerName of ["statePointer", "tickPointer"]) {
      const pointer = this[pointerName];
      this[pointerName] = 0;
      if (!pointer) continue;
      try { this.module._free(pointer); } catch (error) { cleanupErrors.push(error); }
    }
    if (this.initialized) {
      this.initialized = false;
      try { this.module._rs_destroy(); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "RocketSim WASM host cleanup failed.");
  }

  cleanup() {
    return this.close();
  }

  hasCombatLifecycle() {
    return typeof this.module._rs_set_combat_active_car === "function"
      && typeof this.module._rs_respawn_car === "function";
  }

  setCombatActive(index, active) {
    if (this.closed) throw new Error("RocketSim WASM host match is closed.");
    if (!Number.isSafeInteger(index) || index < 0 || index > 1 || typeof active !== "boolean") {
      throw new TypeError("RocketSim WASM lifecycle calls require a car index and boolean active state.");
    }
    if (!this.hasCombatLifecycle()) {
      throw new Error("RocketSim WASM module does not expose the combat lifecycle ABI.");
    }
    if (this.module._rs_set_combat_active_car(index, Number(active)) !== 1) {
      throw new Error(`RocketSim WASM rejected the active state for car ${index}.`);
    }
    this.activeSlots[index] = active;
    return this.readSnapshot();
  }

  respawn(index) {
    if (this.closed) throw new Error("RocketSim WASM host match is closed.");
    if (!Number.isSafeInteger(index) || index < 0 || index > 1) {
      throw new TypeError("RocketSim WASM respawn requires a valid car index.");
    }
    if (!this.hasCombatLifecycle()) {
      throw new Error("RocketSim WASM module does not expose the combat lifecycle ABI.");
    }
    if (this.module._rs_respawn_car(index) !== 1) {
      throw new Error(`RocketSim WASM rejected the respawn for car ${index}.`);
    }
    this.activeSlots[index] = true;
    this.actionTrackers[index].respawn();
    return this.readSnapshot();
  }

  hasStaticRaycast() {
    return typeof this.module._rs_raycast_static === "function";
  }

  hasPresentationSnapshot() {
    return typeof this.module._rs_snapshot_car_authority === "function";
  }

  readPresentationCar(car, expectedWasmTick) {
    if (!this.hasPresentationSnapshot()) return null;
    if (this.module._rs_snapshot_car_authority(car.wasmIndex, this.tickPointer, this.statePointer) !== 1) {
      throw new Error(`RocketSim presentation snapshot failed for car ${car.id}.`);
    }
    const observedWasmTick = this.module.HEAPU32[this.tickPointer >>> 2];
    if (observedWasmTick !== expectedWasmTick) {
      throw new Error(`RocketSim presentation tick mismatch for car ${car.id}: expected ${expectedWasmTick}, received ${observedWasmTick}.`);
    }
    const values = this.module.HEAPF32.subarray(this.statePointer >>> 2, (this.statePointer >>> 2) + PRESENTATION_FLOATS);
    if (![...values].every(Number.isFinite)) throw new RangeError(`RocketSim presentation snapshot for ${car.id} is not finite.`);
    const position = { x: values[0], y: values[1], z: values[2] };
    const velocity = { x: values[3], y: values[4], z: values[5] };
    const quaternion = { x: values[6], y: values[7], z: values[8], w: values[9] };
    const norm = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    if (!(norm > 0.999 && norm < 1.001)) throw new RangeError(`RocketSim presentation orientation for ${car.id} is not normalized.`);
    if (!bounded(values[10], 0, 100) || !binary(values[11])
      || !Number.isInteger(values[12]) || !bounded(values[12], 0, 4)
      || !Number.isInteger(values[13]) || !bounded(values[13], 0, 2)
      || !binary(values[14]) || !binary(values[15]) || !bounded(values[16], 0, 1)
      || ![values[17], values[18], values[19]].every(value => bounded(value, -1000, 1000))
      || !binary(values[20]) || !validUnitVector(values[21], values[22], values[23])
      || !binary(values[24]) || !validUnitVector(values[25], values[26], values[27])
      || ![values[28], values[29], values[30], values[35], values[36]].every(binary)) {
      throw new RangeError(`RocketSim presentation telemetry for ${car.id} is outside its contract.`);
    }
    const actionFlags = {
      hasJumped: values[28] === 1,
      hasDoubleJumped: values[29] === 1,
      hasFlipped: values[30] === 1,
    };
    const grounded = values[11] === 1;
    return {
      id: car.id,
      team: car.team,
      // The extended ABI uses Arsenal Y-up coordinates for this redundant
      // pose. presentationSnapshot() cross-checks it against the compact
      // pose before exposing the versioned telemetry envelope.
      position,
      velocity,
      orientation: quaternion,
      boost: values[10],
      grounded,
      wheelCount: values[12],
      jumps: values[13],
      jumpState: jumpStateFromAuthority({
        grounded,
        ...actionFlags,
        isJumping: values[35] === 1,
        isFlipping: values[36] === 1,
      }),
      // Action counters are derived exclusively from native state transitions
      // at the host boundary. They are presentation metadata, never input or
      // a source of simulation authority.
      actionSerials: this.actionTrackers[car.wasmIndex].observe(actionFlags),
      boosting: values[14] === 1,
      supersonic: values[15] === 1,
      powerslide: values[16],
      angularVelocity: { pitch: values[17], yaw: values[18], roll: values[19] },
      wheelContact: {
        hasContact: values[20] === 1,
        normal: { x: values[21], y: values[22], z: values[23] },
      },
      worldContact: {
        hasContact: values[24] === 1,
        normal: { x: values[25], y: values[26], z: values[27] },
      },
    };
  }

  raycastStatic(segment) {
    if (this.closed) throw new Error("RocketSim WASM host match is closed.");
    if (!validRaySegment(segment)) throw new TypeError("RocketSim WASM static ray segment is invalid.");
    if (!this.hasStaticRaycast()) throw new Error("RocketSim WASM module does not expose the static raycast ABI.");
    const accepted = this.module._rs_raycast_static(
      segment.from.x, segment.from.y, segment.from.z,
      segment.to.x, segment.to.y, segment.to.z,
      this.statePointer,
    );
    if (accepted !== 1) throw new Error("RocketSim WASM static raycast failed.");
    const values = this.module.HEAPF32.subarray(this.statePointer >>> 2, (this.statePointer >>> 2) + 8);
    if (![...values].every(Number.isFinite) || ![0, 1].includes(values[0]) || values[1] < 0 || values[1] > 1) {
      throw new RangeError("RocketSim WASM static raycast returned an invalid result.");
    }
    return {
      hit: values[0] === 1,
      fraction: values[1],
      point: { x: values[2], y: values[3], z: values[4] },
      normal: { x: values[5], y: values[6], z: values[7] },
      kind: "static",
    };
  }

  setWasmControls(index, controls) {
    const appliedControls = this.activeSlots[index] ? controls : IDLE_CONTROLS;
    // Keep the four-field diagnostic contract, but use the extended ABI when
    // the module provides it. This is the first compatibility seam for the
    // full local input model: pitch/yaw/roll/handbrake are preserved instead
    // of being discarded at the WASM boundary. Older fixture binaries still
    // work through the legacy entrypoint.
    const accepted = typeof this.module._rs_set_controls_for_car_full === "function"
      ? this.module._rs_set_controls_for_car_full(
        index,
        appliedControls.throttle,
        appliedControls.steer,
        Number.isFinite(appliedControls.pitch) ? appliedControls.pitch : -appliedControls.throttle,
        Number.isFinite(appliedControls.yaw) ? appliedControls.yaw : (appliedControls.airRoll ? 0 : appliedControls.steer),
        Number.isFinite(appliedControls.roll) ? appliedControls.roll : 0,
        Number(appliedControls.jump),
        Number(appliedControls.boost),
        Number(Boolean(appliedControls.drift || appliedControls.handbrake)),
      )
      : this.module._rs_set_controls_for_car(
        index,
        appliedControls.throttle,
        appliedControls.steer,
        Number(appliedControls.jump),
        Number(appliedControls.boost),
      );
    if (accepted !== 1) throw new Error(`RocketSim WASM rejected controls for car ${index}.`);
  }

  readSnapshot() {
    const cars = [HOST_CAR, PILOT_CAR].map(car => {
      if (this.module._rs_snapshot_car(car.wasmIndex, this.tickPointer, this.statePointer) !== 1) {
        throw new Error(`RocketSim WASM snapshot failed for car ${car.id}.`);
      }
      const observedWasmTick = this.module.HEAPU32[this.tickPointer >>> 2];
      if (observedWasmTick !== this.wasmTick) {
        throw new Error(`RocketSim WASM tick mismatch for car ${car.id}: expected ${this.wasmTick}, received ${observedWasmTick}.`);
      }
      const values = this.module.HEAPF32.subarray(this.statePointer >>> 2, (this.statePointer >>> 2) + 9);
      // RocketSim exposes native Z-up vectors as [x, lateralY, heightZ].
      // The P2P diagnostic contract deliberately uses Arsenal's public
      // Y-up naming: { x, z: lateral, h: height }.  Do this conversion here,
      // at the only native-to-host boundary, before all gameplay adapters.
      const mapped = {
        id: car.id,
        team: car.team,
        x: values[0],
        z: values[1],
        h: values[2],
        yaw: Math.atan2(values[7], values[6]),
        vx: values[3],
        vz: values[4],
        vh: values[5],
      };
      assertSnapshotCar(mapped, this.maxVelocityComponent, this.activeSlots[car.wasmIndex]);
      return mapped;
    });

    if (this.tick < 1 || this.tick > HOST_TICK_LIMIT || this.lastInputSequence < 1) {
      throw new Error("RocketSim WASM snapshot is outside the P2P session timeline.");
    }
    return { tick: this.tick, lastInputSequence: this.lastInputSequence, cars };
  }

  /**
   * Read the extended telemetry without changing the compact host contract.
   * ONLINE-PROTOCOL-02B must opt into this method explicitly before putting
   * these fields on a versioned wire envelope.
   */
  presentationSnapshot() {
    if (this.closed) throw new Error("RocketSim WASM host match is closed.");
    try {
      if (!this.hasPresentationSnapshot()) {
        throw new Error("RocketSim WASM module does not expose the presentation snapshot ABI.");
      }
      const compact = this.readSnapshot();
      const extended = [HOST_CAR, PILOT_CAR].map(car => this.readPresentationCar(car, this.wasmTick));
      const compactById = new Map(compact.cars.map(car => [car.id, car]));
      for (const car of extended) {
        const physical = compactById.get(car.id);
        if (!physical
          || car.position.x !== physical.x || car.position.y !== physical.h || car.position.z !== physical.z
          || car.velocity.x !== physical.vx || car.velocity.y !== physical.vh || car.velocity.z !== physical.vz) {
          throw new Error(`RocketSim presentation pose for ${car.id} disagrees with the compact authoritative pose.`);
        }
      }
      return {
        tick: compact.tick,
        lastInputSequence: compact.lastInputSequence,
        cars: compact.cars,
        // Pose is intentionally omitted here: it is already authoritative in
        // the compact v1 snapshot. Only genuinely new renderer telemetry is
        // eligible for the separate v5 presentation envelope.
        presentation: extended.map(({ position: _position, velocity: _velocity, ...telemetry }) => telemetry),
      };
    } catch (error) {
      this.failAndThrow(error);
    }
  }

  failAndThrow(error) {
    try { this.close(); } catch { /* Preserve the simulation failure while still attempting every release. */ }
    throw error instanceof Error ? error : new Error("RocketSim WASM host match failed.", { cause: error });
  }
}

/**
 * Create an explicitly selected isolated WASM match before constructing a
 * P2PHostChannelSession, which requires its match interface synchronously.
 * `moduleFactory` is an injection point for lifecycle/contract tests.
 */
export async function createP2PWasmHostMatch({
  moduleFactory = loadRocketSimWasm,
  ticksPerInput = DEFAULT_TICKS_PER_INPUT,
  maxVelocityComponent = P2P_WASM_HOST_DEFAULT_VELOCITY_COMPONENT,
  fixture,
} = {}) {
  const normalizedFixture = normalizeFixture(fixture);
  if (typeof moduleFactory !== "function") throw new TypeError("RocketSim WASM moduleFactory must be a function.");
  if (!Number.isSafeInteger(ticksPerInput) || ticksPerInput < 1 || ticksPerInput > MAX_TICKS_PER_ADVANCE) {
    throw new TypeError(`P2P WASM ticksPerInput must be between 1 and ${MAX_TICKS_PER_ADVANCE}.`);
  }
  if (!Number.isSafeInteger(maxVelocityComponent)
    || maxVelocityComponent < P2P_WASM_HOST_DEFAULT_VELOCITY_COMPONENT
    || maxVelocityComponent > P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT) {
    throw new TypeError(`P2P WASM maxVelocityComponent must be between ${P2P_WASM_HOST_DEFAULT_VELOCITY_COMPONENT} and ${P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT}.`);
  }

  const module = await moduleFactory();
  let tickPointer = 0;
  let statePointer = 0;
  let initAttempted = false;
  let initialized = false;
  try {
    assertModuleContract(module, normalizedFixture);
    initAttempted = true;
    const initializer = FIXTURE_INITIALIZERS[normalizedFixture];
    if (module[initializer]() !== 1) {
      throw new Error(`RocketSim WASM ${normalizedFixture} fixture failed to initialize.`);
    }
    initialized = true;
    tickPointer = module._malloc(4);
    statePointer = module._malloc(PRESENTATION_FLOATS * Float32Array.BYTES_PER_ELEMENT);
    assertAllocatedBuffers(module, tickPointer, statePointer);
    return new P2PWasmHostMatch(module, tickPointer, statePointer, ticksPerInput, maxVelocityComponent, normalizedFixture);
  } catch (error) {
    const releasedPointers = new Set();
    for (const pointer of [statePointer, tickPointer]) {
      if (Number.isSafeInteger(pointer) && pointer > 0 && !releasedPointers.has(pointer)) {
        releasedPointers.add(pointer);
        try { module._free(pointer); } catch { /* Continue releasing the single-owned module. */ }
      }
    }
    if ((initialized || initAttempted) && typeof module?._rs_destroy === "function") {
      try { module._rs_destroy(); } catch { /* Preserve the initialization or allocation error. */ }
    }
    throw error;
  }
}
