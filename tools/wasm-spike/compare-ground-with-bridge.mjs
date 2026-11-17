import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { captureWasmCleanGroundTrace } from "./ground-trace.mjs";
import {
  GROUND_TRACE_FIXED_STEP_HZ,
  GROUND_TRACE_FIXTURE,
  GROUND_TRACE_FRAME_COUNT,
  GROUND_TRACE_SCHEMA_VERSION,
  groundTraceInput,
  normalizeGroundNativeSnapshot,
  compareGroundTraces,
} from "./ground-trace-contract.mjs";

async function captureNative(executable) {
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    await bridge.start({ arena: "clean-six-planes", cars: [{ id: 1, team: "blue" }] });
    const samples = [];
    for (let tick = 1; tick <= GROUND_TRACE_FRAME_COUNT; tick += 1) {
      const input = groundTraceInput(tick);
      const frame = await bridge.tick(tick, [{ id: 1, input }]);
      assert.equal(frame.tick, tick);
      const car = frame.cars[0];
      samples.push(normalizeGroundNativeSnapshot(tick, input, car));
    }
    return { schemaVersion: GROUND_TRACE_SCHEMA_VERSION, fixture: GROUND_TRACE_FIXTURE, fixedStepHz: GROUND_TRACE_FIXED_STEP_HZ, source: "RocketSim native bridge clean six planes", samples };
  } finally {
    await bridge.shutdown();
  }
}

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo R20 existente");
  process.exitCode = 2;
} else {
  const [wasm, native] = await Promise.all([captureWasmCleanGroundTrace(), captureNative(executable)]);
  const report = compareGroundTraces(wasm, native);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
