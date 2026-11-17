// P2P-WASM-47: deterministic causal tape on the validated combat-alpha pair.
// No position is written by JS: controls go through the causal host only.
import { createP2PWasmCombatHost } from "./p2p-wasm-combat-host.mjs";
import { P2P_WASM_HOST_FIXTURES, P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT } from "./p2p-wasm-host-match.mjs";
import { createCombatAlphaCausalTrace } from "./combat-alpha-causal-trace-contract.mjs";

const IDLE = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const command = (overrides = {}) => ({ controls: { ...IDLE, ...(overrides.controls || {}) }, fire: Boolean(overrides.fire), restart: Boolean(overrides.restart), targetId: overrides.targetId ?? null });

function evidenceFrame(snapshot) {
  return {
    tick: snapshot.tick,
    lastInputSequence: snapshot.lastInputSequence,
    physical: snapshot.physical,
    events: snapshot.combat.events,
    rockets: snapshot.combat.rockets,
  };
}

/** Reproduce the first static interception in the real alpha pair geometry. */
export async function captureCombatAlphaCausalTrace({ hostFactory = createP2PWasmCombatHost } = {}) {
  const host = await hostFactory({
    fixture: P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR,
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  });
  const timeline = [];
  try {
    if (!host.setHostCommand(command({ fire: true })).accepted) throw new Error("No se pudo armar el disparo alpha causal.");
    const first = host.receivePilotCommand({ sequence: 1, ...command() });
    if (!first.accepted || !first.snapshot) throw new Error("El primer tick alpha causal no produjo snapshot.");
    timeline.push(evidenceFrame(first.snapshot));
    if (!host.setHostCommand(command()).accepted) throw new Error("No se pudo liberar el disparo alpha causal.");
    // The enlarged 408-unit long axis puts the diagnostic wall farther from
    // the pair spawn. Keep the same RocketSim projectile lifetime, but allow
    // enough fixed ticks for the real static curve interception to occur.
    for (let sequence = 2; sequence <= 140; sequence += 1) {
      const result = host.receivePilotCommand({ sequence, ...command() });
      if (!result.accepted || !result.snapshot) throw new Error(`El tick alpha causal ${sequence} no produjo snapshot.`);
      timeline.push(evidenceFrame(result.snapshot));
      if (result.snapshot.combat.events.some(event => event.kind === "miss")) break;
    }
    const trace = createCombatAlphaCausalTrace({
      phases: [
        { name: "spawn-and-fire", frame: timeline[0] },
        { name: "static-interception", frame: timeline.at(-1) },
      ],
      timeline,
    });
    return trace;
  } finally {
    host.close();
  }
}

if (process.argv[1] && new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href === import.meta.url) {
  captureCombatAlphaCausalTrace().then(trace => process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
