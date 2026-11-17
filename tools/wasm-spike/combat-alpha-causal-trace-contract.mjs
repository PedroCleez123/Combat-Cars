// P2P-WASM-47: compact evidence contract for the causal combat-alpha pair.
// It records only authoritative snapshots and events; it is not a gameplay
// protocol and never replaces the host's simulation.

export const COMBAT_ALPHA_CAUSAL_TRACE_SCHEMA_VERSION = 1;
export const COMBAT_ALPHA_CAUSAL_TRACE_FIXTURE = "combat-alpha-pair-causal-r1";
export const COMBAT_ALPHA_CAUSAL_TRACE_FIXED_STEP_HZ = 60;
export const COMBAT_ALPHA_CAUSAL_TRACE_CAR_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);
export const COMBAT_ALPHA_CAUSAL_STATIC_INTERCEPTION_TEXT = "COHETE INTERCEPTADO";

const TEAMS = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
const EVENT_KINDS = new Set(["fire", "hit", "miss", "elimination", "respawn"]);

function record(value) { return value && typeof value === "object" && !Array.isArray(value); }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }

function normalizePhysical(value, id) {
  if (!record(value) || value.id !== id || value.team !== TEAMS[id]) throw new TypeError(`La pose causal alpha no coincide con ${id}.`);
  for (const key of ["x", "z", "h", "yaw", "vx", "vz", "vh"]) {
    if (!finite(value[key])) throw new TypeError(`La pose causal alpha no es finita: ${id}.${key}.`);
  }
  return Object.freeze({ id, team: TEAMS[id], x: value.x, z: value.z, h: value.h, yaw: value.yaw, vx: value.vx, vz: value.vz, vh: value.vh });
}

function normalizeFrame(value) {
  if (!record(value) || !Number.isSafeInteger(value.tick) || value.tick < 1
    || !Number.isSafeInteger(value.lastInputSequence) || value.lastInputSequence < 1
    || !Array.isArray(value.physical) || value.physical.length !== 2
    || !Array.isArray(value.events) || !Array.isArray(value.rockets)) {
    throw new TypeError("La muestra causal alpha no cumple el contrato de frame.");
  }
  const physical = COMBAT_ALPHA_CAUSAL_TRACE_CAR_IDS.map((id, index) => normalizePhysical(value.physical[index], id));
  const events = value.events.map(event => {
    if (!record(event) || !EVENT_KINDS.has(event.kind) || typeof event.text !== "string" || !finite(event.at)) {
      throw new TypeError("El evento causal alpha no cumple el contrato.");
    }
    return Object.freeze({ kind: event.kind, text: event.text, at: event.at });
  });
  return Object.freeze({ tick: value.tick, lastInputSequence: value.lastInputSequence, physical, events, rocketCount: value.rockets.length });
}

/** Build and validate a deterministic alpha causal trace from authoritative frames. */
export function createCombatAlphaCausalTrace({ source = "RocketSim WASM causal combat-alpha pair", phases, timeline } = {}) {
  if (typeof source !== "string" || source.length < 1 || source.length > 160
    || !Array.isArray(phases) || phases.length !== 2 || !Array.isArray(timeline) || timeline.length < 2) {
    throw new TypeError("La traza causal alpha necesita fuente, dos fases y una línea temporal.");
  }
  const normalizedPhases = phases.map(phase => {
    if (!record(phase) || typeof phase.name !== "string" || phase.name.length < 1 || !record(phase.frame)) {
      throw new TypeError("La fase causal alpha no es válida.");
    }
    return Object.freeze({ name: phase.name, frame: normalizeFrame(phase.frame) });
  });
  const normalizedTimeline = timeline.map(normalizeFrame);
  for (let index = 1; index < normalizedTimeline.length; index += 1) {
    if (normalizedTimeline[index].tick !== normalizedTimeline[index - 1].tick + 1) {
      throw new RangeError("La línea temporal causal alpha debe avanzar exactamente un tick.");
    }
  }
  if (normalizedPhases[0].frame.tick !== normalizedTimeline[0].tick
    || normalizedPhases[1].frame.tick !== normalizedTimeline.at(-1).tick) {
    throw new RangeError("Las fases causal alpha deben coincidir con los extremos de la línea temporal.");
  }
  if (!normalizedPhases[0].frame.events.some(event => event.kind === "fire")) {
    throw new RangeError("La fase inicial causal alpha debe observar el lanzamiento autoritativo.");
  }
  if (!normalizedPhases[1].frame.events.some(event => event.kind === "miss" && event.text === COMBAT_ALPHA_CAUSAL_STATIC_INTERCEPTION_TEXT)) {
    throw new RangeError("La fase final causal alpha debe observar una intercepción estática autoritativa.");
  }
  return Object.freeze({
    schemaVersion: COMBAT_ALPHA_CAUSAL_TRACE_SCHEMA_VERSION,
    fixture: COMBAT_ALPHA_CAUSAL_TRACE_FIXTURE,
    fixedStepHz: COMBAT_ALPHA_CAUSAL_TRACE_FIXED_STEP_HZ,
    source,
    phases: Object.freeze(normalizedPhases),
    timeline: Object.freeze(normalizedTimeline),
  });
}

export function assertCombatAlphaCausalTrace(trace) {
  if (!record(trace) || trace.schemaVersion !== COMBAT_ALPHA_CAUSAL_TRACE_SCHEMA_VERSION
    || trace.fixture !== COMBAT_ALPHA_CAUSAL_TRACE_FIXTURE
    || trace.fixedStepHz !== COMBAT_ALPHA_CAUSAL_TRACE_FIXED_STEP_HZ) {
    throw new TypeError("La traza causal alpha tiene una versión o fixture inesperada.");
  }
  return createCombatAlphaCausalTrace(trace);
}
