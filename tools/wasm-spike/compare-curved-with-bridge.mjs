import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { captureWasmCurvedTrace } from "./curved-trace.mjs";
import {
  CURVED_TRACE_FIXED_STEP_HZ,
  CURVED_TRACE_FIXTURE,
  CURVED_TRACE_FRAME_COUNT,
  CURVED_TRACE_GEOMETRY,
  CURVED_TRACE_SCHEMA_VERSION,
  curvedTraceInput,
  normalizeCurvedNativeSnapshot,
  compareCurvedTraces,
} from "./curved-trace-contract.mjs";

export class NativeCurvedBridgeUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NativeCurvedBridgeUnavailableError";
  }
}

function hasBridgeFile(executable) {
  try { return Boolean(executable && existsSync(executable) && statSync(executable).isFile()); }
  catch { return false; }
}

export async function captureNativeCurvedTrace(executable) {
  if (!hasBridgeFile(executable)) {
    throw new NativeCurvedBridgeUnavailableError("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  }
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    try {
      await bridge.start({ arena: "arsenal-curved-practice", cars: [{ id: 1, team: "blue" }] });
    } catch (cause) {
      throw new NativeCurvedBridgeUnavailableError(`Native curved bridge could not initialize: ${cause?.message || cause}`, { cause });
    }
    const samples = [];
    for (let tick = 1; tick <= CURVED_TRACE_FRAME_COUNT; tick += 1) {
      const input = curvedTraceInput(tick);
      const frame = await bridge.tick(tick, [{ id: 1, input }]);
      assert.equal(frame.tick, tick);
      samples.push(normalizeCurvedNativeSnapshot(tick, input, frame.cars[0]));
    }
    return {
      schemaVersion: CURVED_TRACE_SCHEMA_VERSION,
      fixture: CURVED_TRACE_FIXTURE,
      fixedStepHz: CURVED_TRACE_FIXED_STEP_HZ,
      geometry: CURVED_TRACE_GEOMETRY,
      source: "RocketSim R20 native bridge arsenal-curved-practice +X quarter-pipe",
      samples,
    };
  } finally {
    await bridge.shutdown();
  }
}

export async function compareCurvedTracesWithBridge(executable, { wasmTrace } = {}) {
  const [wasm, native] = await Promise.all([
    wasmTrace ? Promise.resolve(wasmTrace) : captureWasmCurvedTrace(),
    captureNativeCurvedTrace(executable),
  ]);
  return { wasm, native, report: compareCurvedTraces(wasm, native) };
}

export async function runCurvedBridgeComparison(executable = process.env.ROCKETSIM_BRIDGE_EXE) {
  if (!hasBridgeFile(executable)) {
    console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo RocketSim R20 existente");
    return 2;
  }
  const { report } = await compareCurvedTracesWithBridge(executable);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  try {
    process.exitCode = await runCurvedBridgeComparison();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}

