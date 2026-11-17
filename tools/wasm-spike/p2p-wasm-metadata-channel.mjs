// ONLINE-METADATA-01: presentation-only side-channel contract.
// Transport integration is deliberately deferred until both peers negotiate
// this capability. The causal presentation channel remains unchanged.
import { normalizeP2PPlayerName } from "../../src/p2p-player-identity.js";

export const P2P_WASM_METADATA_PROTOCOL_VERSION = 1;
export const P2P_WASM_METADATA_TYPE = "wasm-causal-combat-metadata";
// The optional metadata channel remains bounded for compatibility, but the
// current combat-alpha host sends an empty pad list because boost regenerates.
export const P2P_WASM_METADATA_MAX_BYTES = 8192;
export const P2P_WASM_METADATA_MAX_PADS = 96;

const encoder = new TextEncoder();
const IDS = Object.freeze(["p2p-host", "p2p-pilot"]);
const TEAMS = Object.freeze({ "p2p-host": "blue", "p2p-pilot": "red" });
const TOP_KEYS = ["protocolVersion", "type", "roomId", "sessionId", "sequence", "players", "pads"];
const PLAYER_KEYS = ["id", "team", "name"];
const PAD_KEYS = ["id", "x", "h", "z", "amount", "cooldown", "active"];
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/u;

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) return null;
  const out = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    out[key] = descriptor.value;
  }
  return out;
}

function finite(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function context(value) { return typeof value === "string" && SAFE_ID.test(value); }

function players(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const normalized = IDS.map((id, index) => {
    const input = exact(value[index], PLAYER_KEYS);
    if (!input || input.id !== id || input.team !== TEAMS[id]) return null;
    const fallback = index === 0 ? "HOST" : "PILOTO";
    const name = normalizeP2PPlayerName(input.name, fallback);
    return name && name !== fallback || input.name === fallback ? { id, team: input.team, name } : null;
  });
  return normalized.some(player => !player) ? null : normalized;
}

function pads(value) {
  if (!Array.isArray(value) || value.length > P2P_WASM_METADATA_MAX_PADS) return null;
  const seen = new Set();
  return value.map(item => {
    const input = exact(item, PAD_KEYS);
    if (!input || !SAFE_ID.test(input.id) || seen.has(input.id) || ![input.x, input.h, input.z].every(part => finite(part, -200, 200))
      || !finite(input.amount, 0, 100) || !finite(input.cooldown, 0, 120) || typeof input.active !== "boolean") return null;
    seen.add(input.id);
    return { id: input.id, x: input.x, h: input.h, z: input.z, amount: input.amount, cooldown: input.cooldown, active: input.active };
  }).some(pad => !pad) ? null : value.map(item => ({ ...item }));
}

function normalize(value) {
  const input = exact(value, TOP_KEYS);
  if (!input || input.protocolVersion !== P2P_WASM_METADATA_PROTOCOL_VERSION || input.type !== P2P_WASM_METADATA_TYPE
    || !context(input.roomId) || !context(input.sessionId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || input.sequence > 10_000_000) return null;
  const normalizedPlayers = players(input.players);
  const normalizedPads = pads(input.pads);
  return normalizedPlayers && normalizedPads ? Object.freeze({ protocolVersion: 1, type: P2P_WASM_METADATA_TYPE, roomId: input.roomId, sessionId: input.sessionId, sequence: input.sequence, players: Object.freeze(normalizedPlayers), pads: Object.freeze(normalizedPads) }) : null;
}

export function createP2PWasmMetadataEnvelope({ roomId, sessionId, sequence, players: playerList, pads: padList } = {}) {
  const normalized = normalize({ protocolVersion: 1, type: P2P_WASM_METADATA_TYPE, roomId, sessionId, sequence, players: playerList, pads: padList });
  if (!normalized) throw new TypeError("P2P WASM metadata fuera del contrato versionado.");
  const text = JSON.stringify(normalized);
  if (encoder.encode(text).byteLength > P2P_WASM_METADATA_MAX_BYTES) throw new RangeError("P2P WASM metadata supera el límite de bytes.");
  return text;
}

export function decodeP2PWasmMetadataEnvelope(text) {
  if (typeof text !== "string" || encoder.encode(text).byteLength > P2P_WASM_METADATA_MAX_BYTES) throw new TypeError("P2P WASM metadata no es válida.");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new SyntaxError("P2P WASM metadata no es JSON válido."); }
  const normalized = normalize(parsed);
  if (!normalized) throw new TypeError("P2P WASM metadata fuera del contrato versionado.");
  return normalized;
}

export function validateP2PWasmMetadataEnvelope(value) { return Boolean(normalize(value)); }
