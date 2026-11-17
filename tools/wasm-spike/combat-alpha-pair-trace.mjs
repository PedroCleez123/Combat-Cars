// P2P-WASM-17: capture a fixed no-boost tape and lifecycle on the pair fixture.
import {
  COMBAT_ALPHA_PAIR_CONTROL_TAPE,
  COMBAT_ALPHA_PAIR_NEUTRAL_CARS,
  COMBAT_ALPHA_PAIR_PHASES,
  createCombatAlphaPairTrace,
} from "./combat-alpha-pair-trace-contract.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function setWasmFrame(Module, frame) {
  for (const { id, input } of frame) {
    requireCondition(
      Module._rs_set_controls_for_car(id - 1, input.throttle, input.steer, input.jump ? 1 : 0, input.boost ? 1 : 0) === 1,
      `WASM controls failed for car ${id}`,
    );
  }
}

export async function captureWasmCombatAlphaPairTrace() {
  const modulePath = new URL("./build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(modulePath.href);
  const Module = await createRocketSimWasm();
  let tickPtr = 0;
  let statePtr = 0;

  const snapshot = phase => {
    let tick;
    const cars = [];
    for (let index = 0; index < 2; index += 1) {
      requireCondition(Module._rs_snapshot_car(index, tickPtr, statePtr) === 1, `WASM ${phase} snapshot failed for car ${index + 1}`);
      const observedTick = Module.HEAPU32[tickPtr >>> 2];
      if (tick === undefined) tick = observedTick;
      requireCondition(observedTick === tick, `${phase} car snapshots have different ticks`);
      const values = Array.from(Module.HEAPF32.subarray(statePtr >>> 2, (statePtr >>> 2) + 9));
      cars.push({
        id: index + 1,
        index,
        position: values.slice(0, 3),
        velocity: values.slice(3, 6),
        forward: values.slice(6, 9),
        grounded: Module._rs_is_grounded_car(index) === 1,
      });
    }
    return { ...(phase ? { phase } : {}), tick, cars };
  };

  try {
    requireCondition(Module._rs_init_trace_combat_alpha_pair() === 1, "WASM combat-alpha pair fixture should initialize");
    tickPtr = Module._malloc(4);
    statePtr = Module._malloc(9 * Float32Array.BYTES_PER_ELEMENT);
    requireCondition(tickPtr && statePtr, "WASM combat-alpha pair snapshot buffers should allocate");

    setWasmFrame(Module, COMBAT_ALPHA_PAIR_NEUTRAL_CARS);
    requireCondition(Module._rs_step() === 1, "WASM neutral alignment tick failed");
    const initial = snapshot(COMBAT_ALPHA_PAIR_PHASES[0]);
    const phases = [initial];
    const timeline = [];

    for (const frame of COMBAT_ALPHA_PAIR_CONTROL_TAPE) {
      setWasmFrame(Module, frame);
      requireCondition(Module._rs_step() === 1, "WASM combat-alpha pair control tape step failed");
      timeline.push(snapshot());
    }

    requireCondition(Module._rs_set_combat_active_car(1, 0) === 1, "WASM should deactivate combat-alpha pair slot 1");
    phases.push(snapshot(COMBAT_ALPHA_PAIR_PHASES[1]));

    setWasmFrame(Module, COMBAT_ALPHA_PAIR_CONTROL_TAPE[0]);
    requireCondition(Module._rs_step() === 1, "WASM inactive lifecycle step failed");
    phases.push(snapshot(COMBAT_ALPHA_PAIR_PHASES[2]));

    requireCondition(Module._rs_respawn_car(1) === 1, "WASM should respawn combat-alpha pair slot 1");
    phases.push(snapshot(COMBAT_ALPHA_PAIR_PHASES[3]));

    setWasmFrame(Module, COMBAT_ALPHA_PAIR_CONTROL_TAPE[0]);
    requireCondition(Module._rs_step() === 1, "WASM respawn lifecycle step failed");
    phases.push(snapshot(COMBAT_ALPHA_PAIR_PHASES[4]));

    return createCombatAlphaPairTrace("RocketSim WASM combat-alpha pair", { initial, timeline, phases });
  } finally {
    if (statePtr) Module._free(statePtr);
    if (tickPtr) Module._free(tickPtr);
    Module._rs_destroy();
  }
}
