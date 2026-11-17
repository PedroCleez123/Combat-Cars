// R20/WASM sustained mobility gate: one deterministic tape covers a jump,
// directed dodge, recovery/landing and continued grounded control. A second
// tape keeps the existing clean wall contact contract alive for 360 ticks.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

export const MOBILITY_PARITY_FRAME_COUNT = 360;
export const WALL_HORIZON_FRAME_COUNT = 360;
export const MOBILITY_PARITY_FIXTURE = "combat-alpha-two-blue-cars-mobility-r20";
export const WALL_HORIZON_FIXTURE = "clean-six-planes-one-car-wall-horizon-r20";

// These are deliberately explicit. They are wide enough for the known
// float32/float64 boundary while still catching a changed solver or input
// mapping in the first sustained contact sequence.
export const MOBILITY_PARITY_TOLERANCES = Object.freeze({
  position: 0.1,
  velocity: 0.25,
  orientation: 0.002,
  localAngularVelocity: 0.05,
  scalar: 0.002,
  contactNormal: 0.02,
});
export const WALL_HORIZON_TOLERANCES = Object.freeze({
  position: 0.1,
  velocity: 0.1,
  contactNormal: 0.05,
});

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function mobilityInput(tick) {
  assert(Number.isSafeInteger(tick) && tick >= 1 && tick <= MOBILITY_PARITY_FRAME_COUNT);
  const input = {
    throttle: 0,
    steer: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    jump: false,
    boost: false,
    drift: false,
    airRoll: false,
  };
  // One pressed frame is the same edge sequence used by the local adapter.
  if (tick === 6) input.jump = true;
  if (tick === 30) {
    input.jump = true;
    input.throttle = 1;
  }
  if (tick >= 45) {
    input.throttle = 1;
    input.boost = true;
  }
  if (tick >= 181) input.steer = 0.7;
  // The native bridge composes pitch/yaw from the shared online controls.
  input.pitch = -input.throttle;
  input.yaw = input.airRoll ? 0 : input.steer;
  return input;
}

function neutralInput() {
  return { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, drift: false, airRoll: false };
}

function wallInput(tick) {
  assert(Number.isSafeInteger(tick) && tick >= 1 && tick <= WALL_HORIZON_FRAME_COUNT);
  return { throttle: 1, steer: 0, pitch: -1, yaw: 0, roll: 0, jump: false, boost: true, drift: false, airRoll: false };
}

function jsonVector(values, offset = 0) {
  return { x: finite(values[offset]), y: finite(values[offset + 1]), z: finite(values[offset + 2]) };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function quaternionDistance(left, right) {
  const direct = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z, left.w - right.w);
  const opposite = Math.hypot(left.x + right.x, left.y + right.y, left.z + right.z, left.w + right.w);
  return Math.min(direct, opposite);
}

function normalizeQuaternion(values, offset) {
  const magnitude = Math.hypot(values[offset], values[offset + 1], values[offset + 2], values[offset + 3]);
  if (!Number.isFinite(magnitude) || magnitude < 1e-6) return { x: 0, y: 0, z: 0, w: 1 };
  return {
    x: values[offset] / magnitude,
    y: values[offset + 1] / magnitude,
    z: values[offset + 2] / magnitude,
    w: values[offset + 3] / magnitude,
  };
}

function normalizeNormal(values, offset, hasContact) {
  return {
    hasContact: Boolean(hasContact),
    normal: jsonVector(values, offset),
  };
}

function normalizeWasmAuthority(tick, values, bodyContact, bodyNormal) {
  return {
    tick,
    state: {
      // The presentation ABI is already Arsenal's x/y/z (Y-up) basis.
      position: jsonVector(values, 0),
      velocity: jsonVector(values, 3),
      orientation: normalizeQuaternion(values, 6),
      boost: finite(values[10]),
      grounded: values[11] === 1,
      wheelCount: Math.round(finite(values[12])),
      jumps: Math.round(finite(values[13])),
      localAngularVelocity: { pitch: finite(values[17]), yaw: finite(values[18]), roll: finite(values[19]) },
      wheelContact: normalizeNormal(values, 21, values[20] === 1),
      worldContact: normalizeNormal(values, 25, values[24] === 1),
      actionFlags: {
        hasJumped: values[28] === 1,
        hasDoubleJumped: values[29] === 1,
        hasFlipped: values[30] === 1,
      },
      secondJumpWindow: finite(values[31]),
      dodgeTime: finite(values[32]),
      dodgeDirection: { forward: finite(values[33]), side: finite(values[34]) },
      isJumping: values[35] === 1,
      isFlipping: values[36] === 1,
      airTime: finite(values[37]),
      airTimeSinceJump: finite(values[38]),
      jumpTime: finite(values[39]),
    },
    bodyContact: {
      hasContact: bodyContact === true,
      normal: jsonVector(bodyNormal),
    },
  };
}

function normalizeNativeCar(tick, car) {
  return {
    tick,
    state: {
      position: car.position,
      velocity: car.velocity,
      orientation: car.orientation,
      boost: car.boost,
      grounded: car.grounded,
      wheelCount: car.wheelCount,
      jumps: car.jumps,
      localAngularVelocity: car.localAngularVelocity,
      wheelContact: car.wheelContact,
      worldContact: car.worldContact,
      actionFlags: car.actionFlags,
      secondJumpWindow: car.secondJumpWindow,
      dodgeTime: car.dodgeTime,
      dodgeDirection: car.dodgeDirection,
    },
    bodyContact: {
      hasContact: car.worldContact?.hasContact === true,
      normal: car.worldContact?.normal || { x: 0, y: 0, z: 0 },
    },
  };
}

async function createWasmModule(query) {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?${query}=${Date.now()}`);
  return createRocketSimWasm();
}

export async function captureWasmMobilityParityTrace() {
  const Module = await createWasmModule("mobility-parity");
  assert.equal(Module._rs_init_trace_combat_alpha_pair(), 1, "WASM pair fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(40 * Float32Array.BYTES_PER_ELEMENT);
  assert.ok(tickPtr && statePtr, "WASM authority buffers should allocate");
  try {
    const samples = [];
    for (let tick = 1; tick <= MOBILITY_PARITY_FRAME_COUNT; tick += 1) {
      const input = mobilityInput(tick);
      const neutral = neutralInput();
      assert.equal(Module._rs_set_controls_for_car_full(0, input.throttle, input.steer, input.pitch, input.yaw, input.roll, input.jump ? 1 : 0, input.boost ? 1 : 0, 0), 1);
      assert.equal(Module._rs_set_controls_for_car_full(1, neutral.throttle, neutral.steer, neutral.pitch, neutral.yaw, neutral.roll, 0, 0, 0), 1);
      assert.equal(Module._rs_step(), 1);
      assert.equal(Module._rs_snapshot_car_authority(0, tickPtr, statePtr), 1);
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 40));
      const bodyContactPtr = Module._malloc(4);
      const bodyNormalPtr = Module._malloc(3 * Float32Array.BYTES_PER_ELEMENT);
      try {
        assert.equal(Module._rs_body_contact_car(0, bodyContactPtr, bodyNormalPtr), 1);
        samples.push({
          input,
          ...normalizeWasmAuthority(Module.HEAPU32[tickPtr >>> 2], values, Module.HEAPU32[bodyContactPtr >>> 2] === 1,
            Array.from(Module.HEAPF32.subarray(bodyNormalPtr >>> 2, (bodyNormalPtr >>> 2) + 3))),
        });
      } finally {
        Module._free(bodyNormalPtr);
        Module._free(bodyContactPtr);
      }
    }
    return { fixture: MOBILITY_PARITY_FIXTURE, fixedStepHz: 120, source: "RocketSim WASM", samples };
  } finally {
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}

export async function captureNativeMobilityParityTrace(executable) {
  if (!executable || !existsSync(executable) || !statSync(executable).isFile()) {
    throw new Error("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  }
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 2000, startupTimeoutMs: 3000 });
  try {
    await bridge.start({ arena: "combat-alpha", cars: [{ id: 1, team: "blue" }, { id: 2, team: "blue" }] });
    const samples = [];
    for (let tick = 1; tick <= MOBILITY_PARITY_FRAME_COUNT; tick += 1) {
      const input = mobilityInput(tick);
      const frame = await bridge.tick(tick, [
        { id: 1, input },
        { id: 2, input: neutralInput() },
      ]);
      assert.equal(frame.tick, tick);
      samples.push({ input, ...normalizeNativeCar(frame.tick, frame.cars.find(car => car.id === 1)) });
    }
    return { fixture: MOBILITY_PARITY_FIXTURE, fixedStepHz: 120, source: "RocketSim R20 native bridge", samples };
  } finally {
    await bridge.shutdown();
  }
}

export async function captureWasmWallHorizonTrace() {
  const Module = await createWasmModule("wall-horizon");
  assert.equal(Module._rs_init_trace_clean_wall_contact(), 1, "WASM wall fixture should initialize");
  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(40 * Float32Array.BYTES_PER_ELEMENT);
  const bodyContactPtr = Module._malloc(4);
  const bodyNormalPtr = Module._malloc(3 * Float32Array.BYTES_PER_ELEMENT);
  assert.ok(tickPtr && statePtr && bodyContactPtr && bodyNormalPtr, "WASM wall buffers should allocate");
  try {
    const samples = [];
    for (let tick = 1; tick <= WALL_HORIZON_FRAME_COUNT; tick += 1) {
      const input = wallInput(tick);
      assert.equal(Module._rs_set_controls(input.throttle, input.steer, 0, 1), 1);
      assert.equal(Module._rs_step(), 1);
      assert.equal(Module._rs_snapshot_car_authority(0, tickPtr, statePtr), 1);
      assert.equal(Module._rs_body_contact_car(0, bodyContactPtr, bodyNormalPtr), 1);
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 40));
      const bodyNormal = Array.from(Module.HEAPF32.subarray(bodyNormalPtr >>> 2, (bodyNormalPtr >>> 2) + 3));
      samples.push({ input, ...normalizeWasmAuthority(Module.HEAPU32[tickPtr >>> 2], values, Module.HEAPU32[bodyContactPtr >>> 2] === 1, bodyNormal) });
    }
    return { fixture: WALL_HORIZON_FIXTURE, fixedStepHz: 120, source: "RocketSim WASM", samples };
  } finally {
    Module._free(bodyNormalPtr);
    Module._free(bodyContactPtr);
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}

export async function captureNativeWallHorizonTrace(executable) {
  if (!executable || !existsSync(executable) || !statSync(executable).isFile()) {
    throw new Error("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  }
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 2000, startupTimeoutMs: 3000 });
  try {
    await bridge.start({ arena: "clean-six-planes", cars: [{ id: 1, team: "blue" }] });
    const samples = [];
    for (let tick = 1; tick <= WALL_HORIZON_FRAME_COUNT; tick += 1) {
      const input = wallInput(tick);
      const frame = await bridge.tick(tick, [{ id: 1, input }]);
      assert.equal(frame.tick, tick);
      samples.push({ input, ...normalizeNativeCar(frame.tick, frame.cars[0]) });
    }
    return { fixture: WALL_HORIZON_FIXTURE, fixedStepHz: 120, source: "RocketSim R20 native bridge", samples };
  } finally {
    await bridge.shutdown();
  }
}

function compareCommonState(wasm, native, tolerances, label, report) {
  const position = distance(wasm.state.position, native.state.position);
  const velocity = distance(wasm.state.velocity, native.state.velocity);
  const orientation = quaternionDistance(wasm.state.orientation, native.state.orientation);
  const localAngularVelocity = Math.hypot(
    wasm.state.localAngularVelocity.pitch - native.state.localAngularVelocity.pitch,
    wasm.state.localAngularVelocity.yaw - native.state.localAngularVelocity.yaw,
    wasm.state.localAngularVelocity.roll - native.state.localAngularVelocity.roll,
  );
  report.maximum.position = Math.max(report.maximum.position, position);
  report.maximum.velocity = Math.max(report.maximum.velocity, velocity);
  report.maximum.orientation = Math.max(report.maximum.orientation, orientation);
  report.maximum.localAngularVelocity = Math.max(report.maximum.localAngularVelocity, localAngularVelocity);
  if (position > tolerances.position) report.mismatches.push(`${label} position ${position.toFixed(6)} UU`);
  if (velocity > tolerances.velocity) report.mismatches.push(`${label} velocity ${velocity.toFixed(6)} UU/s`);
  if (orientation > tolerances.orientation) report.mismatches.push(`${label} orientation ${orientation.toFixed(6)}`);
  if (localAngularVelocity > tolerances.localAngularVelocity) report.mismatches.push(`${label} local angular ${localAngularVelocity.toFixed(6)}`);
  if (wasm.state.grounded !== native.state.grounded) report.mismatches.push(`${label} grounded differs`);
  if (wasm.state.wheelCount !== native.state.wheelCount) report.mismatches.push(`${label} wheel count differs`);
  if (wasm.state.actionFlags.hasJumped !== native.state.actionFlags.hasJumped
    || wasm.state.actionFlags.hasDoubleJumped !== native.state.actionFlags.hasDoubleJumped
    || wasm.state.actionFlags.hasFlipped !== native.state.actionFlags.hasFlipped) {
    report.mismatches.push(`${label} action flags differ`);
  }
  for (const [key, actual, expected] of [
    ["boost", wasm.state.boost, native.state.boost],
    ["secondJumpWindow", wasm.state.secondJumpWindow, native.state.secondJumpWindow],
    ["dodgeTime", wasm.state.dodgeTime, native.state.dodgeTime],
    ["dodgeForward", wasm.state.dodgeDirection.forward, native.state.dodgeDirection.forward],
    ["dodgeSide", wasm.state.dodgeDirection.side, native.state.dodgeDirection.side],
  ]) {
    const delta = Math.abs(actual - expected);
    if (delta > tolerances.scalar) report.mismatches.push(`${label} ${key} ${delta.toFixed(6)}`);
  }
  for (const key of ["worldContact", "wheelContact"]) {
    if (wasm.state[key].hasContact !== native.state[key].hasContact) report.mismatches.push(`${label} ${key} differs`);
    if (wasm.state[key].hasContact) {
      const normal = distance(wasm.state[key].normal, native.state[key].normal);
      report.maximum[`${key}Normal`] = Math.max(report.maximum[`${key}Normal`] || 0, normal);
      if (normal > tolerances.contactNormal) report.mismatches.push(`${label} ${key} normal ${normal.toFixed(6)}`);
    }
  }
}

export function compareMobilityParityTraces(wasmTrace, nativeTrace, tolerances = MOBILITY_PARITY_TOLERANCES) {
  assert.equal(wasmTrace.fixture, MOBILITY_PARITY_FIXTURE);
  assert.equal(nativeTrace.fixture, MOBILITY_PARITY_FIXTURE);
  assert.equal(wasmTrace.samples.length, MOBILITY_PARITY_FRAME_COUNT);
  assert.equal(nativeTrace.samples.length, MOBILITY_PARITY_FRAME_COUNT);
  const report = {
    ok: false,
    fixture: MOBILITY_PARITY_FIXTURE,
    frames: MOBILITY_PARITY_FRAME_COUNT,
    tolerances,
    maximum: { position: 0, velocity: 0, orientation: 0, localAngularVelocity: 0 },
    mismatches: [],
    transitions: [],
  };
  let previousGrounded = true;
  let previousFlipped = false;
  for (let index = 0; index < MOBILITY_PARITY_FRAME_COUNT; index += 1) {
    const wasm = wasmTrace.samples[index];
    const native = nativeTrace.samples[index];
    assert.deepEqual(wasm.input, native.input, `mobility input differs at tick ${index + 1}`);
    compareCommonState(wasm, native, tolerances, `tick ${index + 1}`, report);
    if (wasm.state.grounded !== previousGrounded || wasm.state.actionFlags.hasFlipped !== previousFlipped) {
      report.transitions.push({ tick: index + 1, grounded: wasm.state.grounded, hasFlipped: wasm.state.actionFlags.hasFlipped });
    }
    previousGrounded = wasm.state.grounded;
    previousFlipped = wasm.state.actionFlags.hasFlipped;
  }
  const dodge = wasmTrace.samples.find(sample => sample.state.actionFlags.hasFlipped);
  const landing = wasmTrace.samples.find((sample, index) => index > 0 && sample.state.grounded && !wasmTrace.samples[index - 1].state.grounded);
  if (!dodge) report.mismatches.push("dodge edge was not observed");
  if (!landing) report.mismatches.push("landing edge was not observed");
  report.dodgeTick = dodge?.tick ?? null;
  report.landingTick = landing?.tick ?? null;
  report.ok = report.mismatches.length === 0;
  return report;
}

export function compareWallHorizonTraces(wasmTrace, nativeTrace, tolerances = WALL_HORIZON_TOLERANCES) {
  assert.equal(wasmTrace.fixture, WALL_HORIZON_FIXTURE);
  assert.equal(nativeTrace.fixture, WALL_HORIZON_FIXTURE);
  assert.equal(wasmTrace.samples.length, WALL_HORIZON_FRAME_COUNT);
  assert.equal(nativeTrace.samples.length, WALL_HORIZON_FRAME_COUNT);
  const report = {
    ok: false,
    fixture: WALL_HORIZON_FIXTURE,
    frames: WALL_HORIZON_FRAME_COUNT,
    tolerances,
    maximum: { position: 0, velocity: 0, contactNormal: 0 },
    mismatches: [],
    firstContactTick: null,
  };
  for (let index = 0; index < WALL_HORIZON_FRAME_COUNT; index += 1) {
    const wasm = wasmTrace.samples[index];
    const native = nativeTrace.samples[index];
    assert.deepEqual(wasm.input, native.input, `wall input differs at tick ${index + 1}`);
    const position = distance(wasm.state.position, native.state.position);
    const velocity = distance(wasm.state.velocity, native.state.velocity);
    report.maximum.position = Math.max(report.maximum.position, position);
    report.maximum.velocity = Math.max(report.maximum.velocity, velocity);
    if (position > tolerances.position) report.mismatches.push(`tick ${index + 1} position ${position.toFixed(6)} UU`);
    if (velocity > tolerances.velocity) report.mismatches.push(`tick ${index + 1} velocity ${velocity.toFixed(6)} UU/s`);
    if (wasm.bodyContact.hasContact !== native.bodyContact.hasContact || wasm.state.grounded !== native.state.grounded) {
      report.mismatches.push(`tick ${index + 1} wall contact state differs`);
    }
    if (wasm.bodyContact.hasContact) {
      const normal = distance(wasm.bodyContact.normal, native.bodyContact.normal);
      report.maximum.contactNormal = Math.max(report.maximum.contactNormal, normal);
      if (normal > tolerances.contactNormal) report.mismatches.push(`tick ${index + 1} contact normal ${normal.toFixed(6)}`);
      if (report.firstContactTick === null) report.firstContactTick = index + 1;
    }
  }
  if (report.firstContactTick === null) report.mismatches.push("wall contact was not observed");
  report.ok = report.mismatches.length === 0;
  return report;
}
