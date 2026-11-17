import { existsSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { captureWasmWallTrace } from "./wall-trace.mjs";
import {
  WALL_TRACE_FIXED_STEP_HZ,
  WALL_TRACE_FIXTURE,
  WALL_TRACE_FRAME_COUNT,
  WALL_TRACE_SCHEMA_VERSION,
  compareWallTraces,
  normalizeWallNativeSnapshot,
  wallTraceInput,
} from "./wall-trace-contract.mjs";

export class NativeWallBridgeUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NativeWallBridgeUnavailableError";
  }
}

function hasBridgeFile(executable) {
  try { return Boolean(executable && existsSync(executable) && statSync(executable).isFile()); }
  catch { return false; }
}

export async function captureNativeWallTrace(executable) {
  if (!hasBridgeFile(executable)) {
    throw new NativeWallBridgeUnavailableError("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  }
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    try {
      await bridge.start({ arena: "clean-six-planes", cars: [{ id: 1, team: "blue" }] });
    } catch (cause) {
      throw new NativeWallBridgeUnavailableError(`Native wall bridge could not initialize: ${cause?.message || cause}`, { cause });
    }
    const samples = [];
    for (let tick = 1; tick <= WALL_TRACE_FRAME_COUNT; tick += 1) {
      const input = wallTraceInput(tick);
      const frame = await bridge.tick(tick, [{ id: 1, input }]);
      assert.equal(frame.tick, tick);
      samples.push(normalizeWallNativeSnapshot(tick, input, frame.cars[0]));
    }
    return { schemaVersion: WALL_TRACE_SCHEMA_VERSION, fixture: WALL_TRACE_FIXTURE, fixedStepHz: WALL_TRACE_FIXED_STEP_HZ, source: "RocketSim R20 native bridge clean six planes", samples };
  } finally {
    await bridge.shutdown();
  }
}

export async function compareWallTracesWithBridge(executable, { wasmTrace } = {}) {
  const [wasm, native] = await Promise.all([
    wasmTrace ? Promise.resolve(wasmTrace) : captureWasmWallTrace(),
    captureNativeWallTrace(executable),
  ]);
  return { wasm, native, report: compareWallTraces(wasm, native) };
}

export async function runWallBridgeComparison(executable = process.env.ROCKETSIM_BRIDGE_EXE) {
  if (!hasBridgeFile(executable)) {
    console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo RocketSim R20 existente");
    return 2;
  }
  const { report } = await compareWallTracesWithBridge(executable);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  try {
    process.exitCode = await runWallBridgeComparison();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
