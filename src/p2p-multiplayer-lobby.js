// Small, authenticated-by-the-WebRTC-room lobby protocol. Signaling only
// establishes the peer; these bounded messages carry team selection and the
// host's start decision over the already-open peer channel.
export const P2P_LOBBY_PROTOCOL_VERSION = 1;
export const P2P_LOBBY_DURATION_SECONDS = 300;

const TEAM_VALUES = new Set(["blue", "red"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const MODES = new Set(["1v1", "2v2", "3v3", "ffa"]);
const encoder = new TextEncoder();

/** Keep signaling slots stable when the native WASM roster compacts holes. */
export function p2pSignalingSlotForPlayerId(playerId) {
  if (playerId === "p2p-host") return 0;
  const match = typeof playerId === "string" && playerId.match(/^p2p-guest-([1-5])$/u);
  return match ? Number(match[1]) : null;
}

export function normalizeP2PLobbyPlayerSlots(players) {
  if (!Array.isArray(players)) return [];
  return players.map(player => {
    const signalingSlot = p2pSignalingSlotForPlayerId(player?.id);
    return signalingSlot === null ? { ...player } : { ...player, slot: signalingSlot };
  });
}

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]) ? value : null;
}

function name(value) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 16);
  return normalized || "Piloto";
}

function frame(value) {
  const text = JSON.stringify(value);
  if (encoder.encode(text).byteLength > 8 * 1024) throw new RangeError("El mensaje del lobby supera el límite permitido.");
  return text;
}

export function createP2PLobbyHello(playerName) {
  return frame({ protocolVersion: P2P_LOBBY_PROTOCOL_VERSION, type: "combat-cars-lobby-hello", name: name(playerName) });
}

export function createP2PLobbyTeamRequest(team) {
  if (!TEAM_VALUES.has(team)) throw new TypeError("El equipo del lobby no es válido.");
  return frame({ protocolVersion: P2P_LOBBY_PROTOCOL_VERSION, type: "combat-cars-lobby-team", team });
}

export function createP2PLobbyState({ roomId, phase = "team-selection", mode, maxPlayers, players, durationSeconds = P2P_LOBBY_DURATION_SECONDS } = {}) {
  const roomOpen = phase === "room-open";
  if (!ID.test(roomId) || (!roomOpen && !MODES.has(mode)) || (roomOpen && mode !== null) || !Number.isSafeInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 6 || !["room-open", "team-selection", "lobby", "starting", "playing"].includes(phase) || !Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600 || !Array.isArray(players) || players.length < 1 || players.length > maxPlayers) throw new TypeError("El estado del lobby no es válido.");
  const normalized = players.map(player => {
    if (!player || !Number.isSafeInteger(player.slot) || player.slot < 0 || player.slot > 5 || typeof player.id !== "string" || !ID.test(player.id) || typeof player.team !== "string" && player.team !== null) throw new TypeError("Un piloto del lobby no es válido.");
    if (roomOpen && player.team !== null) throw new TypeError("Una sala abierta aún no admite equipos.");
    if (player.team !== null && !TEAM_VALUES.has(player.team)) throw new TypeError("Un equipo del lobby no es válido.");
    return { slot: player.slot, id: player.id, name: name(player.name), team: player.team };
  });
  return frame({ protocolVersion: P2P_LOBBY_PROTOCOL_VERSION, type: "combat-cars-lobby-state", roomId, phase, mode, maxPlayers, durationSeconds, players: normalized });
}

export function decodeP2PLobbyMessage(text, { roomId = null } = {}) {
  if (typeof text !== "string" || encoder.encode(text).byteLength > 8 * 1024) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (value?.protocolVersion !== P2P_LOBBY_PROTOCOL_VERSION || typeof value.type !== "string") return null;
  if (value.type === "combat-cars-lobby-hello") {
    const message = exact(value, ["protocolVersion", "type", "name"]);
    return message ? { type: "hello", name: name(message.name) } : null;
  }
  if (value.type === "combat-cars-lobby-team") {
    const message = exact(value, ["protocolVersion", "type", "team"]);
    return message && TEAM_VALUES.has(message.team) ? { type: "team", team: message.team } : null;
  }
  if (value.type !== "combat-cars-lobby-state") return null;
  const message = exact(value, ["protocolVersion", "type", "roomId", "phase", "mode", "maxPlayers", "durationSeconds", "players"]);
  const roomOpen = message?.phase === "room-open";
  if (!message || (roomId !== null && message.roomId !== roomId) || !ID.test(message.roomId) || (!roomOpen && !MODES.has(message.mode)) || (roomOpen && message.mode !== null) || !["room-open", "team-selection", "lobby", "starting", "playing"].includes(message.phase) || !Number.isSafeInteger(message.maxPlayers) || message.maxPlayers < 2 || message.maxPlayers > 6 || !Number.isSafeInteger(message.durationSeconds) || message.durationSeconds < 1 || message.durationSeconds > 3600 || !Array.isArray(message.players) || message.players.length < 1 || message.players.length > message.maxPlayers) return null;
  const players = message.players.map(player => {
    if (!player || !Number.isSafeInteger(player.slot) || player.slot < 0 || player.slot > 5 || typeof player.id !== "string" || !ID.test(player.id) || typeof player.name !== "string" || player.name.length < 1 || player.name.length > 16 || (roomOpen ? player.team !== null : !(player.team === null || TEAM_VALUES.has(player.team)))) return null;
    return { slot: player.slot, id: player.id, name: player.name, team: player.team };
  });
  if (players.some(player => player === null) || new Set(players.map(player => player.id)).size !== players.length) return null;
  return { type: "state", roomId: message.roomId, phase: message.phase, mode: message.mode, maxPlayers: message.maxPlayers, durationSeconds: message.durationSeconds, players };
}
