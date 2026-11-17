// The public lobby remains opt-in and separate from the LAN/game renderer.
// Never read an endpoint from the page URL: this reviewed origin is the only
// signaling service the published Combat Cars lobby may contact.
export const P2P_SIGNAL_ORIGIN = "https://combat-cars-signal.combat-cars-pedro.workers.dev";

// The public beta currently boots the 1v1 transport, but every later
// multi-peer layer must agree on one bounded match vocabulary. Keep this
// contract next to the reviewed signaling configuration so a UI cannot invent
// a capacity that the causal host does not understand.
export const P2P_MATCH_MAX_PLAYERS = 6;
export const P2P_MATCH_MODES = Object.freeze({
  DUEL_1V1: "1v1",
  TEAMS_2V2: "2v2",
  TEAMS_3V3: "3v3",
  FREE_FOR_ALL: "ffa",
});

const MATCH_MODE_PLAYER_RANGES = Object.freeze({
  [P2P_MATCH_MODES.DUEL_1V1]: Object.freeze({ min: 2, max: 2 }),
  [P2P_MATCH_MODES.TEAMS_2V2]: Object.freeze({ min: 4, max: 4 }),
  [P2P_MATCH_MODES.TEAMS_3V3]: Object.freeze({ min: 6, max: 6 }),
  [P2P_MATCH_MODES.FREE_FOR_ALL]: Object.freeze({ min: 2, max: P2P_MATCH_MAX_PLAYERS }),
});

const MATCH_ID_PATTERN = /^p2p-[a-z0-9][a-z0-9-]{0,31}$/u;

export function isP2PMatchMode(value) {
  return typeof value === "string" && Object.values(P2P_MATCH_MODES).includes(value);
}

export function p2pMatchPlayerRange(mode) {
  if (!isP2PMatchMode(mode)) return null;
  return MATCH_MODE_PLAYER_RANGES[mode];
}

function freezeRosterPlayer(player) {
  return Object.freeze({ ...player });
}

/**
 * Build the deterministic roster shared by the future host-star transport,
 * target lock and presentation state. This is deliberately a pure contract:
 * it does not open sockets or claim that the current 1v1 session supports
 * multiple WebRTC peers yet.
 */
export function createP2PMatchRoster({ mode, playerIds, teamsByPlayerId = null } = {}) {
  const range = p2pMatchPlayerRange(mode);
  if (!range) throw new TypeError("El modo de partida P2P no es válido.");
  if (!Array.isArray(playerIds) || playerIds.length < range.min || playerIds.length > range.max) {
    throw new RangeError(`El modo ${mode} requiere entre ${range.min} y ${range.max} jugadores.`);
  }
  const ids = playerIds.map((id) => {
    if (typeof id !== "string" || !MATCH_ID_PATTERN.test(id)) {
      throw new TypeError("La identidad de jugador P2P no es válida.");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new TypeError("Las identidades P2P deben ser únicas.");

  const teamMode = mode !== P2P_MATCH_MODES.FREE_FOR_ALL;
  let assignedTeams = null;
  if (teamMode && teamsByPlayerId !== null) {
    if (!teamsByPlayerId || typeof teamsByPlayerId !== "object" || Array.isArray(teamsByPlayerId)) {
      throw new TypeError("La selección de equipos P2P no es válida.");
    }
    const keys = Object.keys(teamsByPlayerId).sort();
    const expected = [...ids].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
      || Object.values(teamsByPlayerId).some(team => team !== "blue" && team !== "red")) {
      throw new TypeError("La selección de equipos P2P debe cubrir todo el roster.");
    }
    const blue = ids.filter(id => teamsByPlayerId[id] === "blue").length;
    const red = ids.length - blue;
    if (blue !== red) throw new RangeError("Los equipos P2P deben tener el mismo número de pilotos.");
    assignedTeams = teamsByPlayerId;
  } else if (!teamMode && teamsByPlayerId !== null) {
    throw new TypeError("El modo todos contra todos no admite equipos.");
  }
  const players = ids.map((id, index) => freezeRosterPlayer({
    id,
    index,
    role: index === 0 ? "host" : "guest",
    team: teamMode ? (assignedTeams ? assignedTeams[id] : (index % 2 === 0 ? "blue" : "red")) : null,
  }));
  const byId = new Map(players.map((player) => [player.id, player]));
  const targetsByPlayerId = Object.fromEntries(players.map((player) => [
    player.id,
    Object.freeze(players
      .filter((candidate) => candidate.id !== player.id
        && (!teamMode || candidate.team !== player.team))
      .map((candidate) => candidate.id)),
  ]));

  return Object.freeze({
    mode,
    maxPlayers: range.max,
    players: Object.freeze(players),
    targetsByPlayerId: Object.freeze(targetsByPlayerId),
    playerById: byId,
  });
}

// Public STUN endpoints provide candidate discovery for the direct browser
// path. Keep this list static and credential-free: TURN credentials are
// intentionally out of scope for the direct beta and must never be supplied
// by a page URL.
export const P2P_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: "stun:stun.cloudflare.com:3478" }),
  Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
  Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
]);

// Values surfaced to the lobby/beta are a deliberately bounded projection of
// RTCPeerConnection.iceConnectionState. Candidate strings and addresses never
// cross that boundary.
export const P2P_ICE_CONNECTION_STATES = Object.freeze([
  "new",
  "checking",
  "connected",
  "completed",
  "failed",
  "disconnected",
  "closed",
]);

export function isP2PIceConnectionState(value) {
  return typeof value === "string" && P2P_ICE_CONNECTION_STATES.includes(value);
}

export function normalizeSignalOrigin(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
