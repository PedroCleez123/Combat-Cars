import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { captureWasmAirVoidTrace } from "./trace.mjs";
import {
  WASM_TRACE_FIXED_STEP_HZ,
  WASM_TRACE_FIXTURE,
  WASM_TRACE_FRAME_COUNT,
  WASM_TRACE_SCHEMA_VERSION,
  airVoidTraceInput,
  compareAirVoidTraces,
  forwardFromBridgeOrientation,
} from "./trace-contract.mjs";

function bridgeSample(frame, input, car) {
  return {
    tick: frame,
    input,
    state: {
      position: car.position,
      velocity: car.velocity,
      forward: forwardFromBridgeOrientation(car.orientation),
    },
  };
}

async function captureNativeAirVoidTrace(executable) {
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    await bridge.start({ arena: "air-void", cars: [{ id: 1, team: "blue" }] });
    const samples = [];
    for (let tick = 1; tick <= WASM_TRACE_FRAME_COUNT; tick += 1) {
      const input = airVoidTraceInput(tick);
      const state = await bridge.tick(tick, [{ id: 1, input }]);
      assert.equal(state.tick, tick, "native bridge trace tick should advance once");
      samples.push(bridgeSample(tick, input, state.cars[0]));
    }
    return {
      schemaVersion: WASM_TRACE_SCHEMA_VERSION,
      fixture: WASM_TRACE_FIXTURE,
      fixedStepHz: WASM_TRACE_FIXED_STEP_HZ,
      source: "RocketSim native bridge air-void trace",
      samples,
    };
  } finally {
    await bridge.shutdown();
  }
}

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo R20 existente");
  process.exitCode = 2;
} else {
  const [wasmTrace, nativeTrace] = await Promise.all([captureWasmAirVoidTrace(), captureNativeAirVoidTrace(executable)]);
  const report = compareAirVoidTraces(wasmTrace, nativeTrace);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
