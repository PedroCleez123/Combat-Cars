// The lobby contract is deliberately independent from the v6 causal-combat
// protocol. A lobby carries movement and roster presentation only: there is
// no score, projectile, health or combat state to accidentally render.
export const P2P_WASM_MULTIPLAYER_LOBBY_PROTOCOL_VERSION = 1;
export const P2P_WASM_MULTIPLAYER_LOBBY_TYPE = "wasm-lobby-multiplayer";
export const P2P_WASM_MULTIPLAYER_LOBBY_MAX_PLAYERS = 6;
export const P2P_WASM_MULTIPLAYER_LOBBY_MAX_BYTES = 16 * 1024;

const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const MODES = new Set(["1v1", "2v2", "3v3", "ffa"]);
const CAPACITY = Object.freeze({ "1v1": 2, "2v2": 4, "3v3": 6, ffa: 6 });
const TEAMS = new Set(["blue", "red"]);
const encoder = new TextEncoder();
const PLAYER_KEYS = [
  "id", "slot", "name", "team", "x", "h", "z", "yaw", "pitch", "roll", "orientation",
  "vx", "vh", "vz", "angularVelocity", "boost", "grounded", "wheelCount", "jumps", "jumpState",
  "actionSerials", "boosting", "supersonic", "powerslide", "wheelContact", "worldContact", "lastSequence",
];

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function number(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function quaternion(value) {
  if (!exact(value, ["x", "y", "z", "w"]) || ![value.x, value.y, value.z, value.w].every(part => number(part, -1, 1))) return null;
  return Math.abs(Math.hypot(value.x, value.y, value.z, value.w) - 1) < .02 ? { ...value } : null;
}
function normal(value) {
  return exact(value, ["x", "y", "z"]) && [value.x, value.y, value.z].every(part => number(part, -1, 1)) ? { ...value } : null;
}
function contact(value) {
  return exact(value, ["hasContact", "normal"]) && typeof value.hasContact === "boolean" && normal(value.normal) ? { hasContact: value.hasContact, normal: { ...value.normal } } : null;
}
function validLobbyCapacity(mode, maxPlayers) {
  return Number.isSafeInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= P2P_WASM_MULTIPLAYER_LOBBY_MAX_PLAYERS
    && (mode === null ? maxPlayers === P2P_WASM_MULTIPLAYER_LOBBY_MAX_PLAYERS : MODES.has(mode));
}

function normalizePlayer(value, mode) {
  if (!exact(value, PLAYER_KEYS) || !ID.test(value.id) || !integer(value.slot, 0, P2P_WASM_MULTIPLAYER_LOBBY_MAX_PLAYERS - 1)
    || typeof value.name !== "string" || value.name.length < 1 || value.name.length > 16
    || (mode === null || mode === "ffa" ? value.team !== null : !(value.team === null || TEAMS.has(value.team)))
    || ![value.x, value.h, value.z].every(part => number(part, -10000, 10000))
    || ![value.yaw, value.pitch, value.roll].every(part => number(part, -Math.PI, Math.PI))
    || !quaternion(value.orientation)
    || ![value.vx, value.vh, value.vz].every(part => number(part, -1000, 1000))
    || !exact(value.angularVelocity, ["pitch", "yaw", "roll"]) || ![value.angularVelocity.pitch, value.angularVelocity.yaw, value.angularVelocity.roll].every(part => number(part, -1000, 1000))
    || !number(value.boost, 0, 100) || typeof value.grounded !== "boolean" || !integer(value.wheelCount, 0, 4)
    || !integer(value.jumps, 0, 2) || typeof value.jumpState !== "string" || value.jumpState.length > 32
    || !exact(value.actionSerials, ["jump", "doubleJump", "dodge", "respawn"])
    || Object.values(value.actionSerials).some(part => !integer(part, 0, 100000000))
    || typeof value.boosting !== "boolean" || typeof value.supersonic !== "boolean" || !number(value.powerslide, 0, 1)
    || !contact(value.wheelContact) || !contact(value.worldContact) || !integer(value.lastSequence, 0, 100000000)) return null;
  return {
    ...value,
    orientation: { ...value.orientation },
    angularVelocity: { ...value.angularVelocity },
    actionSerials: { ...value.actionSerials },
    wheelContact: contact(value.wheelContact), worldContact: contact(value.worldContact),
  };
}

function normalizeSnapshot(value) {
  const keys = ["roomId", "sessionId", "phase", "mode", "maxPlayers", "tick", "players"];
  const roomOpen = value?.phase === "room-open";
  const validShape = roomOpen
    ? value.mode === null && value.maxPlayers === P2P_WASM_MULTIPLAYER_LOBBY_MAX_PLAYERS
    : value.phase === "lobby" && validLobbyCapacity(value.mode, value.maxPlayers);
  if (!exact(value, keys) || !ID.test(value.roomId) || !ID.test(value.sessionId) || !validShape
    || !integer(value.tick, 1, 100000000)
    || !Array.isArray(value.players) || value.players.length < 1 || value.players.length > value.maxPlayers) return null;
  const players = value.players.map(player => normalizePlayer(player, value.mode));
  if (players.some(player => player === null) || new Set(players.map(player => player.id)).size !== players.length
    || new Set(players.map(player => player.slot)).size !== players.length) return null;
  return { roomId: value.roomId, sessionId: value.sessionId, phase: value.phase, mode: value.mode, maxPlayers: value.maxPlayers, tick: value.tick, players };
}

/** Strip an authority host snapshot down to the lobby wire contract. */
export function lobbySnapshotFromHost(value) {
  const normalized = normalizeSnapshot(value);
  if (!normalized) throw new TypeError("El snapshot del lobby WASM está fuera de contrato.");
  return structuredClone(normalized);
}

export function createP2PWasmMultiplayerLobbyEnvelope({ roomId, sessionId, sequence, snapshot } = {}) {
  if (!ID.test(roomId) || !ID.test(sessionId) || !integer(sequence, 1, 100000000)) throw new TypeError("El sobre del lobby WASM no es válido.");
  const normalized = lobbySnapshotFromHost(snapshot);
  if (normalized.roomId !== roomId || normalized.sessionId !== sessionId) throw new TypeError("La sesión del lobby no coincide con el sobre.");
  const value = { protocolVersion: P2P_WASM_MULTIPLAYER_LOBBY_PROTOCOL_VERSION, type: P2P_WASM_MULTIPLAYER_LOBBY_TYPE, roomId, sessionId, sequence, snapshot: normalized };
  const text = JSON.stringify(value);
  if (encoder.encode(text).byteLength > P2P_WASM_MULTIPLAYER_LOBBY_MAX_BYTES) throw new RangeError("El sobre del lobby WASM supera 16 KiB.");
  return text;
}

export function decodeP2PWasmMultiplayerLobbyEnvelope(text) {
  if (typeof text !== "string" || encoder.encode(text).byteLength > P2P_WASM_MULTIPLAYER_LOBBY_MAX_BYTES) throw new TypeError("El sobre del lobby WASM no es un texto acotado.");
  let value; try { value = JSON.parse(text); } catch { throw new SyntaxError("El sobre del lobby WASM no es JSON."); }
  if (!exact(value, ["protocolVersion", "type", "roomId", "sessionId", "sequence", "snapshot"])
    || value.protocolVersion !== P2P_WASM_MULTIPLAYER_LOBBY_PROTOCOL_VERSION || value.type !== P2P_WASM_MULTIPLAYER_LOBBY_TYPE
    || !ID.test(value.roomId) || !ID.test(value.sessionId) || !integer(value.sequence, 1, 100000000)) throw new TypeError("El sobre del lobby WASM está fuera de contrato.");
  const snapshot = lobbySnapshotFromHost(value.snapshot);
  if (snapshot.roomId !== value.roomId || snapshot.sessionId !== value.sessionId) throw new TypeError("La sesión del lobby no coincide con el snapshot.");
  return { protocolVersion: P2P_WASM_MULTIPLAYER_LOBBY_PROTOCOL_VERSION, type: value.type, roomId: value.roomId, sessionId: value.sessionId, sequence: value.sequence, snapshot };
}

export function validateP2PWasmMultiplayerLobbySnapshot(value) {
  return Boolean(normalizeSnapshot(value));
}

