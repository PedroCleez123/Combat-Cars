import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { captureWasmCarContactTrace } from "./car-contact-trace.mjs";
import {
  CAR_CONTACT_TRACE_FIXED_STEP_HZ,
  CAR_CONTACT_TRACE_FIXTURE,
  CAR_CONTACT_TRACE_FRAME_COUNT,
  CAR_CONTACT_TRACE_SCHEMA_VERSION,
  carContactTraceInputs,
  compareCarContactTraces,
  normalizeCarContactNativeSnapshot,
} from "./car-contact-trace-contract.mjs";

export class NativeCarContactBridgeUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NativeCarContactBridgeUnavailableError";
  }
}

function hasBridgeFile(executable) {
  try { return Boolean(executable && existsSync(executable) && statSync(executable).isFile()); }
  catch { return false; }
}

export async function captureNativeCarContactTrace(executable) {
  if (!hasBridgeFile(executable)) {
    throw new NativeCarContactBridgeUnavailableError("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  }
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    try {
      await bridge.start({
        arena: "combat-lineup",
        cars: [{ id: 1, team: "blue" }, { id: 2, team: "blue" }],
      });
    } catch (cause) {
      throw new NativeCarContactBridgeUnavailableError(`Native R20 combat-lineup bridge could not initialize: ${cause?.message || cause}`, { cause });
    }
    const samples = [];
    for (let tick = 1; tick <= CAR_CONTACT_TRACE_FRAME_COUNT; tick += 1) {
      const inputs = carContactTraceInputs(tick);
      const frame = await bridge.tick(tick, inputs.map(({ id, ...input }) => ({ id, input })));
      assert.equal(frame.tick, tick);
      samples.push(normalizeCarContactNativeSnapshot(tick, inputs, frame.cars));
    }
    return {
      schemaVersion: CAR_CONTACT_TRACE_SCHEMA_VERSION,
      fixture: CAR_CONTACT_TRACE_FIXTURE,
      fixedStepHz: CAR_CONTACT_TRACE_FIXED_STEP_HZ,
      source: "RocketSim R20 native combat-lineup bridge",
      samples,
    };
  } finally {
    await bridge.shutdown();
  }
}

export async function compareCarContactTracesWithBridge(executable, { wasmTrace } = {}) {
  const [wasm, native] = await Promise.all([
    wasmTrace ? Promise.resolve(wasmTrace) : captureWasmCarContactTrace(),
    captureNativeCarContactTrace(executable),
  ]);
  return { wasm, native, report: compareCarContactTraces(wasm, native) };
}

export async function runCarContactBridgeComparison(executable = process.env.ROCKETSIM_BRIDGE_EXE) {
  if (!hasBridgeFile(executable)) {
    console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo RocketSim R20 existente");
    return 2;
  }
  const { report } = await compareCarContactTracesWithBridge(executable);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  try {
    process.exitCode = await runCarContactBridgeComparison();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
