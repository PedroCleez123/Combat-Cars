import { normalizeCurveInput } from "./rocketsim-curve-capture.js";

// The LAN server publishes one snapshot after two authoritative 120 Hz
// RocketSim ticks. These scenarios deliberately express their inputs at that
// published cadence. A direct bridge runner repeats each input for exactly two
// native ticks, so a LAN trace can be compared to native behaviour without
// pretending that a 60 Hz packet stream is the original 120 Hz curve suite.
export const MOBILITY_LAN_CURVE_SNAPSHOT_HZ = 60;
export const MOBILITY_LAN_CURVE_NATIVE_TICKS_PER_SNAPSHOT = 2;
export const MOBILITY_LAN_CURVE_ARENA = "arsenal-expanded-cornered-practice";
export const MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS = 72;

const hold = (snapshots, input, id) => ({ snapshots, input, id });
const neutral = (snapshots, id) => hold(snapshots, {}, id);

const secondAction = input => [
  // Each pulse lasts two native ticks because the normal LAN server applies a
  // packet to its next 60 Hz snapshot, then keeps it for both native ticks.
  hold(1, { jump: true }, "first-jump"),
  neutral(5, "release"),
  hold(1, { jump: true, ...input }, "directed-second-jump"),
  neutral(65, "recovery"),
];

export const MOBILITY_LAN_CURVE_SCENARIOS = Object.freeze([
  {
    id: "dodge-side",
    traceKey: "dodgeSide",
    purpose: "Dodge lateral a través del servidor LAN a 60 Hz.",
    phases: secondAction({ steer: 1 }),
  },
  {
    id: "dodge-diagonal-roll",
    traceKey: "dodgeDiagonalRoll",
    purpose: "Dodge diagonal con roll a través del servidor LAN a 60 Hz.",
    phases: secondAction({ throttle: 1, steer: 1, roll: 1 }),
  },
]);

function normalizedPhase(phase, index) {
  return {
    id: phase.id || `phase-${index + 1}`,
    snapshots: phase.snapshots,
    nativeTicks: phase.snapshots * MOBILITY_LAN_CURVE_NATIVE_TICKS_PER_SNAPSHOT,
    input: normalizeCurveInput(phase.input || {}),
  };
}

export function mobilityLanCurveManifest() {
  return {
    version: 1,
    arena: MOBILITY_LAN_CURVE_ARENA,
    snapshotHz: MOBILITY_LAN_CURVE_SNAPSHOT_HZ,
    nativeFixedStepHz: MOBILITY_LAN_CURVE_SNAPSHOT_HZ * MOBILITY_LAN_CURVE_NATIVE_TICKS_PER_SNAPSHOT,
    nativeTicksPerSnapshot: MOBILITY_LAN_CURVE_NATIVE_TICKS_PER_SNAPSHOT,
    durationSnapshots: MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS,
    scenarios: MOBILITY_LAN_CURVE_SCENARIOS.map(scenario => ({
      id: scenario.id,
      traceKey: scenario.traceKey,
      purpose: scenario.purpose,
      phases: scenario.phases.map(normalizedPhase),
    })),
  };
}

export function mobilityLanCurveScenario(id) {
  const scenario = MOBILITY_LAN_CURVE_SCENARIOS.find(candidate => candidate.id === id);
  if (!scenario) throw new Error(`Escenario LAN de movilidad no soportado: ${id}`);
  return scenario;
}

export function mobilityLanCurveInputAtSnapshot(scenarioOrId, snapshotIndex) {
  const scenario = typeof scenarioOrId === "string" ? mobilityLanCurveScenario(scenarioOrId) : scenarioOrId;
  if (!scenario || !Array.isArray(scenario.phases)) throw new Error("El escenario LAN de movilidad no es válido");
  if (!Number.isSafeInteger(snapshotIndex) || snapshotIndex < 0) throw new Error("El índice de snapshot LAN no es válido");
  let cursor = 0;
  for (const phase of scenario.phases) {
    const end = cursor + phase.snapshots;
    if (snapshotIndex < end) return normalizeCurveInput(phase.input || {});
    cursor = end;
  }
  return null;
}

export function assertMobilityLanCurveScenario(scenario) {
  const snapshots = scenario?.phases?.reduce((total, phase) => total + phase.snapshots, 0);
  if (snapshots !== MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS) {
    throw new Error(`${scenario?.id || "unknown"} tiene ${snapshots} snapshots, se esperaban ${MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS}`);
  }
  return scenario;
}
