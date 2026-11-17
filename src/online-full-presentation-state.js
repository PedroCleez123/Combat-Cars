// ONLINE-FULL-PRESENTATION-STATE-01: presentation boundary for the complete
// P2P WASM host snapshot.  The host remains authoritative for every value
// copied below; this module only reshapes an already decoded snapshot for the
// local client and never advances or mutates a simulation.
import {
  causalCombatPresentationFromHost,
  normalizeP2PWasmCausalCombatPresentationEnvelope,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs";
import { attitudeFromRocketSimOrientation } from "./rocketsim-practice-match.js";

export const ONLINE_FULL_PRESENTATION_STATE_VERSION = 1;
export const ONLINE_FULL_PRESENTATION_CAR_IDS = Object.freeze(["p2p-host", "p2p-pilot"]);

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const TOP_LEVEL_KEYS = ["tick", "lastInputSequence", "physical", "presentation", "combat", "pads"];
const REQUIRED_TOP_LEVEL_KEYS = TOP_LEVEL_KEYS.slice(0, 5);
const PAD_KEYS = Object.freeze([
  ["id", "active", "cooldown"],
  ["id", "active", "cooldown", "timer"],
  ["id", "x", "z", "timer"],
]);
const HOST_EVENT_KINDS = new Set(["fire", "hit", "miss", "elimination", "respawn", "winner", "round", "pad"]);

function exactRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function exactArray(value, { min = 0, max = Infinity } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (descriptors.length?.enumerable || descriptors.length?.value !== value.length) return null;
  const entries = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    entries.push(descriptor.value);
  }
  return entries;
}

function finite(value, minimum = -Infinity, maximum = Infinity) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validContext(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new TypeError(`${label} online no es válido.`);
  return value;
}

function validateHostShape(value) {
  const source = exactRecord(value, TOP_LEVEL_KEYS);
  if (!source || source.pads === undefined) {
    const required = exactRecord(value, REQUIRED_TOP_LEVEL_KEYS);
    if (!required) throw new TypeError("El snapshot host completo no cumple la forma versionada.");
    return { ...required, pads: undefined };
  }
  return source;
}

function normalizePads(value) {
  if (value === undefined) return [];
  const entries = exactArray(value, { max: 96 });
  if (!entries) throw new TypeError("Los pads del snapshot host no cumplen la forma versionada.");
  return entries.map((item, index) => {
    const keys = PAD_KEYS.find(candidate => exactRecord(item, candidate));
    if (!keys) throw new TypeError(`El pad host ${index} no cumple la forma versionada.`);
    const pad = exactRecord(item, keys);
    if (!Number.isSafeInteger(pad.id) || pad.id < 0 || (keys.includes("active") && typeof pad.active !== "boolean")) {
      throw new TypeError(`El pad host ${index} no es válido.`);
    }
    if (keys.includes("x") && !finite(pad.x, -10_000, 10_000)) throw new TypeError(`El pad host ${index} no es válido.`);
    if (keys.includes("z") && !finite(pad.z, -10_000, 10_000)) throw new TypeError(`El pad host ${index} no es válido.`);
    if (!finite(pad.cooldown ?? pad.timer, 0, 600) || (keys.includes("timer") && !finite(pad.timer, 0, 600))) {
      throw new TypeError(`El pad host ${index} no es válido.`);
    }
    // Preserve the host record exactly. A future full snapshot must expose
    // the local-client `timer` field explicitly when it wants pad rendering.
    return { ...pad };
  });
}

function normalizeHostEvents(value) {
  const entries = exactArray(value, { max: 8 });
  if (!entries) throw new TypeError("Los eventos del snapshot host no cumplen la forma versionada.");
  return entries.map((item, index) => {
    const event = exactRecord(item, ["kind", "text", "at"]);
    if (!event || !HOST_EVENT_KINDS.has(event.kind) || typeof event.text !== "string"
      || event.text.length > 160 || /[\u0000-\u001F\u007F]/u.test(event.text)
      || !finite(event.at, 0, 600)) throw new TypeError(`El evento host ${index} no es válido.`);
    return { ...event };
  });
}

function contactFor(telemetry) {
  if (telemetry.wheelContact.hasContact) return telemetry.wheelContact;
  if (telemetry.worldContact.hasContact) return telemetry.worldContact;
  return null;
}

function surfaceFor(telemetry) {
  const contact = contactFor(telemetry);
  if (!contact) return telemetry.grounded ? { kind: "ground", contact: null } : { kind: "air", contact: null };
  if (contact.normal.y < -.65) return { kind: "ceiling", contact };
  if (Math.abs(contact.normal.y) < .35) return { kind: "wall", contact };
  return { kind: "ground", contact };
}

function cloneContact(contact) {
  return { hasContact: contact.hasContact, normal: { ...contact.normal } };
}

function carState(physical, telemetry, combat) {
  const speed = Math.hypot(physical.vx, physical.vz, physical.vh);
  const forwardSpeed = physical.vx * Math.cos(physical.yaw) + physical.vz * Math.sin(physical.yaw);
  // Reuse the local RocketSim quaternion-to-attitude policy. The renderer
  // already consumes the authoritative quaternion; these Euler values only
  // keep the HUD and diagnostics aligned with src/client.js.
  const attitude = attitudeFromRocketSimOrientation(telemetry.orientation);
  const surface = surfaceFor(telemetry);
  const contact = surface.contact;
  const normalVelocity = contact
    ? physical.vx * contact.normal.x + physical.vh * contact.normal.y + physical.vz * contact.normal.z
    : null;
  const contacts = contact ? [{
    kind: surface.kind,
    normal: { ...contact.normal },
    point: { x: physical.x, y: physical.h, z: physical.z },
    wheelCount: telemetry.wheelCount,
    normalVelocity,
    separation: 0,
  }] : [];
  return {
    id: physical.id,
    team: physical.team,
    // Host snapshots intentionally have no player names. These labels are
    // presentation-only and keep the local HUD readable without gameplay data.
    name: physical.id === "p2p-host" ? "HOST" : "PILOTO",
    x: physical.x,
    z: physical.z,
    h: physical.h,
    yaw: physical.yaw,
    pitch: attitude.pitch,
    roll: attitude.roll,
    orientation: { ...telemetry.orientation },
    vx: physical.vx,
    vz: physical.vz,
    vh: physical.vh,
    velocity: { x: physical.vx, y: physical.vh, z: physical.vz },
    speed,
    forwardSpeed,
    hp: combat.hp,
    respawn: combat.respawn,
    kills: combat.kills,
    deaths: combat.deaths,
    rocketCooldown: combat.rocketCooldown,
    alive: combat.alive,
    boost: telemetry.boost,
    jumps: telemetry.jumps,
    grounded: telemetry.grounded,
    boosting: telemetry.boosting,
    supersonic: telemetry.supersonic,
    powerslide: telemetry.powerslide,
    angularVelocity: { ...telemetry.angularVelocity },
    wheelCount: telemetry.wheelCount,
    wheelContact: cloneContact(telemetry.wheelContact),
    worldContact: cloneContact(telemetry.worldContact),
    surfaceType: surface.kind,
    surfaceNormal: contact ? { ...contact.normal } : null,
    contacts,
    wallRide: surface.kind === "wall",
    ceilingContact: surface.kind === "ceiling",
    steer: 0,
    // RocketSim owns both the discrete mobility state and the edge serials.
    // Keep them as presentation data; this adapter never derives or advances
    // movement from the remote pose.
    jumpState: telemetry.jumpState,
    actionSerials: { ...telemetry.actionSerials },
  };
}

function cloneRocket(rocket) { return { ...rocket }; }
function cloneEvent(event) { return { ...event }; }

/**
 * Adapt one complete, already-decoded host snapshot to the local client's
 * presentation state. The input is a host-internal shape, never a wire
 * envelope; all validation is fail-closed and no source object is mutated.
 */
export function createOnlineFullPresentationState(snapshot, { roomId, sessionId } = {}) {
  const source = validateHostShape(snapshot);
  const boundRoomId = validContext(roomId, "roomId");
  const boundSessionId = validContext(sessionId, "sessionId");
  // Combat-alpha has retired floor pads in favour of host-authoritative boost
  // regeneration. Ignore any stale pad records from an older peer instead of
  // letting a mixed-version session reintroduce visual or audio pickups.
  const pads = [];
  const events = normalizeHostEvents(source.combat.events)
    .filter((event) => event.kind !== "pad");
  const bridgeCombat = { ...source.combat, events };
  const withoutPads = { tick: source.tick, lastInputSequence: source.lastInputSequence, physical: source.physical, presentation: source.presentation, combat: bridgeCombat };
  let normalized;
  try {
    normalized = causalCombatPresentationFromHost(withoutPads);
  } catch (error) {
    throw new TypeError(`El snapshot host completo no cumple la forma versionada: ${error.message}`);
  }
  const physical = normalized.snapshot.physical;
  const combatCars = normalized.snapshot.cars;
  const cars = physical.map((car, index) => carState(car, normalized.presentation[index], combatCars[index]));
  const round = normalized.snapshot.round;
  return {
    time: normalized.snapshot.tick / 60,
    score: { ...normalized.snapshot.score },
    winner: round.winner,
    settings: {
      // The full WASM host is bound to the combat-alpha arena. Keep the
      // public presentation state on that concrete arena id; "calibration"
      // is a local diagnostic label and has no shared visual profile.
      arena: "combat-alpha",
      practiceArena: "combat-alpha",
      humans: cars.length,
      bots: 0,
      vehicleLimit: cars.length,
      profile: "COMBATE ROCKETSIM",
      movementBackend: "rocketsim",
      roundState: round.state,
      scoreToWin: round.scoreToWin,
      roundSerial: round.serial,
      onlineFullPresentationStateVersion: ONLINE_FULL_PRESENTATION_STATE_VERSION,
      p2p: true,
      roomId: boundRoomId,
      sessionId: boundSessionId,
    },
    rules: {
      pads: false,
      combat: true,
      unlimitedBoost: false,
      ramps: false,
      covers: false,
      scoreToWin: round.scoreToWin,
    },
    cars,
    rockets: normalized.snapshot.rockets.map(cloneRocket),
    pads,
    events: events.map(cloneEvent),
    inputAcknowledged: normalized.snapshot.lastInputSequence,
  };
}

/**
 * Use the same adapter after the v5 presentation envelope has crossed the
 * network. The envelope is already strictly decoded; this helper only
 * reconstructs the host-internal boundary expected above and never restores
 * authority that was not present on the wire. Pads remain empty until a
 * versioned envelope carries them explicitly.
 */
export function createOnlineFullPresentationStateFromEnvelope(envelope, context = {}) {
  const normalized = normalizeP2PWasmCausalCombatPresentationEnvelope(envelope);
  if (!normalized) throw new TypeError("El sobre causal de presentación no cumple el contrato versionado.");
  const { snapshot, presentation } = normalized;
  return createOnlineFullPresentationState({
    tick: snapshot.tick,
    lastInputSequence: snapshot.lastInputSequence,
    physical: snapshot.physical,
    presentation,
    combat: {
      score: snapshot.score,
      round: snapshot.round,
      cars: snapshot.cars,
      rockets: snapshot.rockets,
      events: snapshot.events,
      eliminated: [],
      respawns: [],
    },
  }, context);
}

