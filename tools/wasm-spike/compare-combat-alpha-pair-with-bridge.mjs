// P2P-WASM-17: phase-aligned comparison with the native R20 combat-alpha bridge.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { normalizeNativeLifecycleCar } from "./lifecycle-trace-contract.mjs";
import {
  COMBAT_ALPHA_PAIR_CONTROL_TAPE,
  COMBAT_ALPHA_PAIR_NEUTRAL_CARS,
  COMBAT_ALPHA_PAIR_PHASES,
  compareCombatAlphaPairTraces,
  createCombatAlphaPairTrace,
} from "./combat-alpha-pair-trace-contract.mjs";
import { captureWasmCombatAlphaPairTrace } from "./combat-alpha-pair-trace.mjs";

export class NativeCombatAlphaPairBridgeUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NativeCombatAlphaPairBridgeUnavailableError";
  }
}

export class NativeCombatAlphaPairBridgeContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NativeCombatAlphaPairBridgeContractError";
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

export function isNativeCombatAlphaPairBridgeUnavailable(error) {
  return hasErrorCode(error, "ENOENT");
}

function hasBridgeFile(executable) {
  try { return Boolean(executable && existsSync(executable) && statSync(executable).isFile()); }
  catch { return false; }
}

function normalizeNativeFrame(phase, frame) {
  assert.equal(frame.cars.length, 2, `R20 ${phase} should contain both configured cars`);
  const cars = [1, 2].map(id => {
    const car = frame.cars.find(candidate => candidate.id === id);
    assert.ok(car, `R20 ${phase} should contain car id ${id}`);
    return normalizeNativeLifecycleCar(car);
  });
  return { ...(phase ? { phase } : {}), tick: frame.tick, cars };
}

export async function captureNativeCombatAlphaPairTrace(executable) {
  if (!hasBridgeFile(executable)) {
    throw new NativeCombatAlphaPairBridgeUnavailableError("ROCKETSIM_BRIDGE_EXE does not name an existing bridge file");
  }
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 2000, startupTimeoutMs: 3000 });
  try {
    try {
      // `ready` is intentionally not treated as a physical state snapshot.
      await bridge.start({
        arena: "combat-alpha",
        cars: [{ id: 1, team: "blue" }, { id: 2, team: "blue" }],
      });
    } catch (cause) {
      if (isNativeCombatAlphaPairBridgeUnavailable(cause)) {
        throw new NativeCombatAlphaPairBridgeUnavailableError(
          `Native R20 combat-alpha bridge is unavailable: ${cause?.message || cause}`,
          { cause },
        );
      }
      throw new NativeCombatAlphaPairBridgeContractError(
        `Native R20 combat-alpha bridge violated its startup contract: ${cause?.message || cause}`,
        { cause },
      );
    }

    // R20 publishes car states in tick responses. This neutral frame aligns
    // the first physical snapshot with WASM after exactly one external tick.
    const initial = normalizeNativeFrame(COMBAT_ALPHA_PAIR_PHASES[0], await bridge.tick(1, COMBAT_ALPHA_PAIR_NEUTRAL_CARS));
    const timeline = [];
    for (let index = 0; index < COMBAT_ALPHA_PAIR_CONTROL_TAPE.length; index += 1) {
      timeline.push(normalizeNativeFrame(null, await bridge.tick(index + 2, COMBAT_ALPHA_PAIR_CONTROL_TAPE[index])));
    }

    const phases = [initial];
    phases.push(normalizeNativeFrame(COMBAT_ALPHA_PAIR_PHASES[1], await bridge.setCombatActive(2, false)));
    phases.push(normalizeNativeFrame(COMBAT_ALPHA_PAIR_PHASES[2], await bridge.tick(62, COMBAT_ALPHA_PAIR_CONTROL_TAPE[0])));
    phases.push(normalizeNativeFrame(COMBAT_ALPHA_PAIR_PHASES[3], await bridge.respawn(2)));
    phases.push(normalizeNativeFrame(COMBAT_ALPHA_PAIR_PHASES[4], await bridge.tick(63, COMBAT_ALPHA_PAIR_CONTROL_TAPE[0])));
    return createCombatAlphaPairTrace("RocketSim R20 native combat-alpha pair", { initial, timeline, phases });
  } finally {
    await bridge.shutdown();
  }
}

export async function compareCombatAlphaPairWithBridge(executable, { wasmTrace } = {}) {
  const wasm = wasmTrace ?? await captureWasmCombatAlphaPairTrace();
  const native = await captureNativeCombatAlphaPairTrace(executable);
  return { wasm, native, report: compareCombatAlphaPairTraces(wasm, native) };
}

export async function runCombatAlphaPairBridgeComparison(executable = process.env.ROCKETSIM_BRIDGE_EXE) {
  if (!hasBridgeFile(executable)) {
    console.error("ROCKETSIM_BRIDGE_EXE debe apuntar al bridge nativo RocketSim R20 existente");
    return 2;
  }
  const { report } = await compareCombatAlphaPairWithBridge(executable);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  try {
    process.exitCode = await runCombatAlphaPairBridgeComparison();
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}
