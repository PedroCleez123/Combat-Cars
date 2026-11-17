// Test-only phase-aligned comparison against the native R20 bridge.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import {
  compareLifecycleTraces,
  createLifecycleTrace,
  LIFECYCLE_TRACE_PHASES,
  normalizeNativeLifecycleCar,
} from "./lifecycle-trace-contract.mjs";
import { captureWasmLifecycleTrace } from "./lifecycle-trace.mjs";

export class NativeLifecycleBridgeUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NativeLifecycleBridgeUnavailableError";
  }
}

// A bridge file that exists but answers with an incompatible ready/error frame
// must fail the gate.  Only an actual process-not-found condition is an
// environmental omission that may be skipped by the optional native test.
export class NativeLifecycleBridgeContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NativeLifecycleBridgeContractError";
  }
}

function hasErrorCode(error, code) {
  const seen = new Set();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current.code === code) return true;
    current = current.cause;
  }
  return false;
}

export function isNativeLifecycleBridgeUnavailable(error) {
  return hasErrorCode(error, "ENOENT");
}

export function wrapNativeLifecycleStartError(cause) {
  if (isNativeLifecycleBridgeUnavailable(cause)) {
    return new NativeLifecycleBridgeUnavailableError(
      `Native R20 combat-lineup bridge is unavailable: ${cause?.message || cause}`,
      { cause },
    );
  }
  return new NativeLifecycleBridgeContractError(
    `Native R20 combat-lineup bridge violated its startup contract: ${cause?.message || cause}`,
    { cause },
  );
}

function hasBridgeFile(executable) {
  try { return Boolean(executable && existsSync(executable) && statSync(executable).isFile()); }
  catch { return false; }
}

function neutralCars() {
  return [1, 2].map(id => ({ id, input: { throttle: 0, steer: 0, jump: false, boost: false } }));
}

function normalizeNativeFrame(phase, frame) {
  assert.equal(frame.cars.length, 2, `R20 ${phase} should contain both configured cars`);
  const cars = [1, 2].map(id => {
    const car = frame.cars.find(candidate => candidate.id === id);
    assert.ok(car, `R20 ${phase} should contain car id ${id}`);
    return normalizeNativeLifecycleCar(car);
  });
  return { phase, tick: frame.tick, cars };
}

export async function captureNativeLifecycleTrace(executable) {
  if (!hasBridgeFile(executable)) {
    throw new NativeLifecycleBridgeUnavailableError("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  }
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000, startupTimeoutMs: 3000 });
  try {
    try {
      await bridge.start({
        arena: "combat-lineup",
        cars: [{ id: 1, team: "blue" }, { id: 2, team: "blue" }],
      });
    } catch (cause) {
      throw wrapNativeLifecycleStartError(cause);
    }

    // The R20 bridge exposes physical snapshots only in state responses, so a
    // neutral tick supplies the initial sample. The comparator aligns by phase
    // and intentionally ignores this timeline offset versus WASM tick zero.
    const samples = [];
    const initial = await bridge.tick(1, neutralCars());
    samples.push(normalizeNativeFrame(LIFECYCLE_TRACE_PHASES[0], initial));

    const inactive = await bridge.setCombatActive(2, false);
    samples.push(normalizeNativeFrame(LIFECYCLE_TRACE_PHASES[1], inactive));

    const inactiveStep = await bridge.tick(2, neutralCars());
    samples.push(normalizeNativeFrame(LIFECYCLE_TRACE_PHASES[2], inactiveStep));

    const respawned = await bridge.respawn(2);
    samples.push(normalizeNativeFrame(LIFECYCLE_TRACE_PHASES[3], respawned));

    const respawnStep = await bridge.tick(3, neutralCars());
    samples.push(normalizeNativeFrame(LIFECYCLE_TRACE_PHASES[4], respawnStep));
    return createLifecycleTrace("RocketSim R20 native bridge", samples);
  } finally {
    await bridge.shutdown();
  }
}

export async function compareLifecycleTracesWithBridge(executable, { wasmTrace } = {}) {
  const wasm = wasmTrace ?? await captureWasmLifecycleTrace();
  const native = await captureNativeLifecycleTrace(executable);
  return { wasm, native, report: compareLifecycleTraces(wasm, native) };
}

export async function runLifecycleBridgeComparison(executable = process.env.ROCKETSIM_BRIDGE_EXE) {
  if (!hasBridgeFile(executable)) {
    console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo RocketSim R20 existente");
    return 2;
  }
  const { report } = await compareLifecycleTracesWithBridge(executable);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  try {
    process.exitCode = await runLifecycleBridgeComparison();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
