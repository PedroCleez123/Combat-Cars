// Versioned six-car causal envelope. Pair v3/v5 contracts remain untouched.
export const P2P_WASM_MULTIPLAYER_PROTOCOL_VERSION = 6;
export const P2P_WASM_MULTIPLAYER_TYPE = "wasm-causal-combat-multiplayer";
export const P2P_WASM_MULTIPLAYER_MAX_PLAYERS = 6;
export const P2P_WASM_MULTIPLAYER_MAX_BYTES = 16 * 1024;
const P2P_WASM_MULTIPLAYER_MAX_PADS = 96;
const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const TEAMS = new Set(["blue", "red"]);
const encoder = new TextEncoder();
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]) ? value : null;
}
function number(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function quaternion(value) { const q = record(value, ["x", "y", "z", "w"]); return q && [q.x, q.y, q.z, q.w].every(part => number(part, -1, 1)) && Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < .01 ? { ...q } : null; }
function normalizeScore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length < 1 || keys.length > P2P_WASM_MULTIPLAYER_MAX_PLAYERS
    || keys.some(key => !ID.test(key) || !integer(value[key], 0, 1000000))) return null;
  return Object.fromEntries(keys.sort().map(key => [key, value[key]]));
}
function normalizePads(value) {
  if (!Array.isArray(value) || value.length > P2P_WASM_MULTIPLAYER_MAX_PADS) return null;
  const seen = new Set();
  const pads = value.map(item => {
    const pad = record(item, ["id", "x", "h", "z", "amount", "cooldown", "active"]);
    if (!pad || typeof pad.id !== "string" || !/^pad-[0-9]{1,2}$/u.test(pad.id) || seen.has(pad.id)
      || ![pad.x, pad.h, pad.z].every(part => number(part, -200, 200))
      || !number(pad.amount, 0, 100) || !number(pad.cooldown, 0, 120) || typeof pad.active !== "boolean") return null;
    seen.add(pad.id);
    return { id: pad.id, x: pad.x, h: pad.h, z: pad.z, amount: pad.amount, cooldown: pad.cooldown, active: pad.active };
  });
  return pads.some(pad => pad === null) ? null : pads;
}
function normalizeCar(value) {
  const car = record(value, ["id", "team", "physical", "presentation", "combat"]);
  if (!car || !ID.test(car.id) || !TEAMS.has(car.team)) return null;
  const physical = record(car.physical, ["id", "team", "x", "z", "h", "yaw", "vx", "vz", "vh"]);
  const presentation = record(car.presentation, ["id", "team", "orientation", "boost", "grounded", "wheelCount", "jumps", "jumpState", "actionSerials", "boosting", "supersonic", "powerslide", "angularVelocity", "wheelContact", "worldContact"]);
  const combat = record(car.combat, ["id", "team", "name", "hp", "respawn", "kills", "deaths", "rocketCooldown", "alive"]);
  if (!physical || physical.id !== car.id || physical.team !== car.team || !number(physical.x, -10000, 10000) || !number(physical.h, -10000, 1000) || !number(physical.z, -10000, 10000) || !number(physical.yaw, -Math.PI, Math.PI) || ![physical.vx, physical.vh, physical.vz].every(part => number(part, -1000, 1000))) return null;
  if (!presentation || presentation.id !== car.id || presentation.team !== car.team || !quaternion(presentation.orientation) || !number(presentation.boost, 0, 100) || typeof presentation.grounded !== "boolean" || !integer(presentation.wheelCount, 0, 4) || !integer(presentation.jumps, 0, 2) || typeof presentation.jumpState !== "string" || !record(presentation.actionSerials, ["jump", "doubleJump", "dodge", "respawn"]) || !record(presentation.angularVelocity, ["pitch", "yaw", "roll"]) || !record(presentation.wheelContact, ["hasContact", "normal"]) || !record(presentation.worldContact, ["hasContact", "normal"]) || typeof presentation.boosting !== "boolean" || typeof presentation.supersonic !== "boolean" || !number(presentation.powerslide, 0, 1)) return null;
  if (!combat || combat.id !== car.id || combat.team !== car.team || typeof combat.name !== "string" || combat.name.length < 1 || combat.name.length > 16 || !integer(combat.hp, 0, 100) || !number(combat.respawn, 0, 600) || !integer(combat.kills, 0, 1000000) || !integer(combat.deaths, 0, 1000000) || !number(combat.rocketCooldown, 0, 600) || typeof combat.alive !== "boolean") return null;
  return { id: car.id, team: car.team, physical: { ...physical }, presentation: { ...presentation, orientation: quaternion(presentation.orientation) }, combat: { ...combat } };
}
function normalizeSnapshot(value) {
  const snapshot = record(value, ["tick", "lastInputSequence", "score", "round", "cars", "rockets", "pads", "events"]);
  const score = normalizeScore(snapshot?.score);
  const legacyRound = record(snapshot?.round, ["state", "scoreToWin", "winner", "serial"]);
  const timedRound = record(snapshot?.round, ["state", "scoreToWin", "winner", "serial", "durationTicks", "remainingTicks"]);
  const round = timedRound || legacyRound;
  const timedComplete = timedRound && snapshot.round.remainingTicks === 0;
  if (!snapshot || !score || !integer(snapshot.tick, 1, 100000000) || !integer(snapshot.lastInputSequence, 0, 100000000) || !round || !["active", "complete"].includes(snapshot.round.state) || !integer(snapshot.round.scoreToWin, 1, 1000000) || !integer(snapshot.round.serial, 1, 1000000) || !(snapshot.round.winner === null || ID.test(snapshot.round.winner)) || (timedRound && (!integer(snapshot.round.durationTicks, 1, 216000) || !integer(snapshot.round.remainingTicks, 0, snapshot.round.durationTicks))) || !Array.isArray(snapshot.cars) || snapshot.cars.length < 2 || snapshot.cars.length > P2P_WASM_MULTIPLAYER_MAX_PLAYERS || !Array.isArray(snapshot.rockets) || snapshot.rockets.length > 64 || !Array.isArray(snapshot.events) || snapshot.events.length > 32 || (snapshot.round.state === "active" && snapshot.round.winner !== null) || (snapshot.round.state === "complete" && !timedComplete && (snapshot.round.winner === null || score[snapshot.round.winner] < snapshot.round.scoreToWin))) return null;
  const pads = normalizePads(snapshot.pads);
  if (!pads) return null;
  const cars = snapshot.cars.map(normalizeCar);
  if (cars.some(car => car === null) || new Set(cars.map(car => car.id)).size !== cars.length) return null;
  return { tick: snapshot.tick, lastInputSequence: snapshot.lastInputSequence, score, round: { ...snapshot.round }, cars, rockets: structuredClone(snapshot.rockets), pads: structuredClone(pads), events: structuredClone(snapshot.events) };
}
export function causalMultiplayerSnapshotFromHost(value) {
  const source = record(value, ["tick", "lastInputSequence", "physical", "presentation", "combat", "pads"]);
  const combat = source && record(source.combat, ["score", "round", "cars", "rockets", "events", "eliminated", "respawns"]);
  if (!source || !combat || !Array.isArray(source.physical) || !Array.isArray(source.presentation) || source.physical.length !== source.presentation.length || source.presentation.length !== combat.cars.length) throw new TypeError("El snapshot WASM multijugador no tiene forma de autoridad completa.");
  const physicalById = new Map(source.physical.map(car => [car.id, car])); const presentationById = new Map(source.presentation.map(car => [car.id, car]));
  const cars = combat.cars.map(car => ({ id: car.id, team: car.team, physical: { id: car.id, team: car.team, ...physicalById.get(car.id) }, presentation: { id: car.id, team: car.team, ...presentationById.get(car.id) }, combat: { id: car.id, team: car.team, ...car } }));
  const normalized = normalizeSnapshot({ tick: source.tick, lastInputSequence: source.lastInputSequence, score: combat.score, round: combat.round, cars, rockets: combat.rockets.map(rocket => ({ ...rocket, targetId: rocket.targetId ?? null })), pads: source.pads, events: combat.events });
  if (!normalized) throw new TypeError("El snapshot WASM multijugador está fuera de contrato.");
  return normalized;
}
export function createP2PWasmMultiplayerEnvelope({ roomId, sessionId, sequence, snapshot } = {}) {
  const normalized = causalMultiplayerSnapshotFromHost(snapshot);
  if (!ID.test(roomId) || !ID.test(sessionId) || !integer(sequence, 1, 100000000)) throw new TypeError("El sobre WASM multijugador no es válido.");
  const value = { protocolVersion: P2P_WASM_MULTIPLAYER_PROTOCOL_VERSION, type: P2P_WASM_MULTIPLAYER_TYPE, roomId, sessionId, sequence, snapshot: normalized }; const text = JSON.stringify(value);
  if (encoder.encode(text).byteLength > P2P_WASM_MULTIPLAYER_MAX_BYTES) throw new RangeError("El sobre WASM multijugador supera 16 KiB.");
  return text;
}
export function decodeP2PWasmMultiplayerEnvelope(text) {
  if (typeof text !== "string" || encoder.encode(text).byteLength > P2P_WASM_MULTIPLAYER_MAX_BYTES) throw new TypeError("El sobre WASM multijugador no es un texto acotado.");
  let value; try { value = JSON.parse(text); } catch { throw new SyntaxError("El sobre WASM multijugador no es JSON."); }
  const envelope = record(value, ["protocolVersion", "type", "roomId", "sessionId", "sequence", "snapshot"]);
  const snapshot = envelope && envelope.protocolVersion === P2P_WASM_MULTIPLAYER_PROTOCOL_VERSION && envelope.type === P2P_WASM_MULTIPLAYER_TYPE && ID.test(envelope.roomId) && ID.test(envelope.sessionId) && integer(envelope.sequence, 1, 100000000) ? normalizeSnapshot(envelope.snapshot) : null;
  if (!snapshot) throw new TypeError("El sobre WASM multijugador está fuera de contrato.");
  return { protocolVersion: 6, type: P2P_WASM_MULTIPLAYER_TYPE, roomId: value.roomId, sessionId: value.sessionId, sequence: value.sequence, snapshot };
}
