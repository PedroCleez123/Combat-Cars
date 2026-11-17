import { normalizeWasmTraceSnapshot } from "./trace-contract.mjs";

// Public combat-alpha units converted to RocketSim internal units. The arena
// profile is the authority for these numbers (src/rocketsim-arena-profile.js).
export const COMBAT_ALPHA_CONTACT_SCALE = 56 / 2300;
export const COMBAT_ALPHA_CONTACT_BOUNDS = Object.freeze({
  halfWidthUnits: 132,
  halfDepthUnits: 204,
  heightUnits: 108,
  curveRadiusUnits: 30,
});

export const COMBAT_ALPHA_CONTACT_SCENARIOS = Object.freeze({
  wall: Object.freeze({ fixture: "combat-alpha-contact-wall-r1", ticks: 900 }),
  rampDescent: Object.freeze({ fixture: "combat-alpha-contact-ramp-descent-r1", ticks: 600 }),
  rampJump: Object.freeze({ fixture: "combat-alpha-contact-ramp-jump-r1", ticks: 1200 }),
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function toPublicNormal(nativeNormal) {
  if (!Array.isArray(nativeNormal) || nativeNormal.length !== 3 || !nativeNormal.every(Number.isFinite)) {
    throw new Error("combat-alpha contact normal is invalid");
  }
  // RocketSim is z-up; the public bridge contract is y-up.
  return { x: nativeNormal[0], y: nativeNormal[2], z: nativeNormal[1] };
}

async function captureScenario(scenario, sampleInput) {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?combat-alpha-contact=${scenario.fixture}-${Date.now()}`);
  const Module = await createRocketSimWasm();
  const initializer = scenario.fixture.includes("wall")
    ? "_rs_init_trace_combat_alpha_wall"
    : "_rs_init_trace_combat_alpha_ramp";
  requireCondition(Module[initializer]() === 1, `WASM ${scenario.fixture} fixture should initialize`);

  const tickPtr = Module._malloc(4);
  const statePtr = Module._malloc(9 * 4);
  const wheelContactPtr = Module._malloc(4);
  const wheelCountPtr = Module._malloc(4);
  const wheelNormalPtr = Module._malloc(3 * 4);
  const bodyContactPtr = Module._malloc(4);
  const bodyNormalPtr = Module._malloc(3 * 4);
  requireCondition([tickPtr, statePtr, wheelContactPtr, wheelCountPtr, wheelNormalPtr, bodyContactPtr, bodyNormalPtr].every(Boolean),
    "WASM combat-alpha contact buffers should allocate");

  try {
    const samples = [];
    for (let iteration = 0; iteration < scenario.ticks; iteration += 1) {
      const previous = samples.at(-1);
      const input = sampleInput(iteration + 1, previous);
      requireCondition(Module._rs_set_controls(input.throttle, input.steer, Number(input.jump), Number(input.boost)) === 1,
        `WASM ${scenario.fixture} controls were rejected at tick ${iteration + 1}`);
      requireCondition(Module._rs_step() === 1, `WASM ${scenario.fixture} step failed at tick ${iteration + 1}`);
      requireCondition(Module._rs_snapshot(tickPtr, statePtr) === 1, `WASM ${scenario.fixture} snapshot failed at tick ${iteration + 1}`);
      requireCondition(Module._rs_wheel_contact_car(0, wheelContactPtr, wheelCountPtr, wheelNormalPtr) === 1,
        `WASM ${scenario.fixture} wheel telemetry failed at tick ${iteration + 1}`);
      requireCondition(Module._rs_body_contact_car(0, bodyContactPtr, bodyNormalPtr) === 1,
        `WASM ${scenario.fixture} body telemetry failed at tick ${iteration + 1}`);

      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      const wheelCount = Module.HEAPU32[wheelCountPtr >>> 2];
      const wheelNormal = Array.from(Module.HEAPF32.subarray(wheelNormalPtr >>> 2, (wheelNormalPtr >>> 2) + 3));
      const bodyNormal = Array.from(Module.HEAPF32.subarray(bodyNormalPtr >>> 2, (bodyNormalPtr >>> 2) + 3));
      samples.push({
        tick: Module.HEAPU32[tickPtr >>> 2],
        input,
        grounded: Module._rs_is_grounded_car(0) === 1,
        wheelCount,
        support: { hasContact: Module.HEAPU32[wheelContactPtr >>> 2] === 1, normal: toPublicNormal(wheelNormal) },
        body: {
          hasContact: Module.HEAPU32[bodyContactPtr >>> 2] === 1,
          normal: toPublicNormal(bodyNormal),
        },
        state: normalizeWasmTraceSnapshot(Module.HEAPU32[tickPtr >>> 2], values).state,
      });
    }
    return {
      schemaVersion: 1,
      fixture: scenario.fixture,
      fixedStepHz: 120,
      scale: COMBAT_ALPHA_CONTACT_SCALE,
      source: "RocketSim WASM combat-alpha expanded shell",
      samples,
    };
  } finally {
    Module._free(bodyNormalPtr);
    Module._free(bodyContactPtr);
    Module._free(wheelNormalPtr);
    Module._free(wheelCountPtr);
    Module._free(wheelContactPtr);
    Module._free(statePtr);
    Module._free(tickPtr);
    Module._rs_destroy();
  }
}

export async function captureWasmCombatAlphaWallTrace() {
  return captureScenario(COMBAT_ALPHA_CONTACT_SCENARIOS.wall, () => ({ throttle: 1, steer: 0, jump: false, boost: true }));
}

export async function captureWasmCombatAlphaRampJumpTrace() {
  return captureScenario(COMBAT_ALPHA_CONTACT_SCENARIOS.rampJump, tick => ({
    throttle: 1,
    steer: 0,
    jump: false,
    boost: tick <= 80,
  }));
}

export async function captureWasmCombatAlphaRampDescentTrace() {
  let phase = "climb";
  return captureScenario(COMBAT_ALPHA_CONTACT_SCENARIOS.rampDescent, (tick, previous) => {
    const xUnits = (previous?.state.position.x ?? -40 / COMBAT_ALPHA_CONTACT_SCALE) * COMBAT_ALPHA_CONTACT_SCALE;
    if (phase === "climb" && xUnits >= 4) phase = "descend";
    if (phase === "descend" && xUnits <= -8) phase = "settle";
    return {
      throttle: phase === "climb" ? 1 : phase === "descend" ? -1 : 0,
      steer: 0,
      jump: false,
      boost: false,
    };
  });
}
