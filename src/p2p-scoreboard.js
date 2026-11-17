// Presentation-only scoreboard projection. The caller must pass a state that
// has already been decoded and validated by the authoritative P2P adapter.
// This module never changes score or combat state and never creates DOM.
import { normalizeP2PPlayerName } from "./p2p-player-identity.js";

const MAX_PLAYERS = 6;
const TEAM_MODES = Object.freeze({ 2: "1v1", 4: "2v2", 6: "3v3" });
const TEAM_NAMES = Object.freeze({ blue: "AZUL", red: "ROJO" });

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPoints(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

function freezeRow(car, index, namesById = {}) {
  if (!record(car) || typeof car.id !== "string" || !car.id.trim()) return null;
  const suppliedName = typeof namesById?.[car.id] === "string" ? namesById[car.id] : car.name;
  const fallback = car.id === "p2p-host" ? "HOST" : `PILOTO ${index + 1}`;
  const name = typeof suppliedName === "string" && suppliedName.trim()
    ? normalizeP2PPlayerName(suppliedName, fallback)
    : fallback;
  const kills = car.kills ?? car.score ?? car.points;
  const deaths = car.deaths ?? 0;
  if (!validPoints(kills) || !validPoints(deaths)) return null;
  return Object.freeze({ id: car.id, name, kills, deaths, points: kills, team: car.team ?? null, rosterIndex: index });
}

function resolveMode(state, count, ffa) {
  const settings = state.settings || {};
  const rules = state.rules || {};
  const declared = [state.mode, settings.mode, settings.gameMode, settings.matchMode, rules.mode, rules.matchMode]
    .filter(value => typeof value === "string" && value.length > 0)
    .map(value => value.toLowerCase())
    .filter(value => value !== "teams");
  if (new Set(declared).size > 1) return null;
  const mode = declared[0] || (ffa ? "ffa" : TEAM_MODES[count]);
  if (mode === "ffa") return ffa ? "ffa" : null;
  if (mode === "1v1" || mode === "2v2" || mode === "3v3") {
    return !ffa && TEAM_MODES[count] === mode ? mode : null;
  }
  return null;
}

/**
 * Create an immutable scoreboard view-model from an authoritative P2P render
 * state. Returns `null` when the state is incomplete or inconsistent, so the
 * HUD can keep its last valid model instead of displaying invented scores.
 *
 * Team rows use each car's authoritative kills as the individual points and
 * derive team totals from those rows. FFA uses each car's authoritative kills
 * as points. The aggregate score map is retained only as a validation input;
 * it is never allowed to invent a row or override kills/deaths.
 * `namesById` may contain already validated player identity metadata.
 */
export function createP2PScoreboardModel(state, { namesById = {} } = {}) {
  if (!record(state) || !Array.isArray(state.cars) || state.cars.length < 2 || state.cars.length > MAX_PLAYERS
    || !record(state.score) || !record(namesById)) return null;
  const ids = new Set();
  const cars = [];
  for (let index = 0; index < state.cars.length; index += 1) {
    const car = state.cars[index];
    if (!record(car) || typeof car.id !== "string" || ids.has(car.id)) return null;
    ids.add(car.id);
    const candidate = { ...car };
    const row = freezeRow(candidate, index, namesById);
    if (!row) return null;
    cars.push(row);
  }

  const hasTeamScores = validPoints(state.score.blue) && validPoints(state.score.red);
  const ffa = state.rules?.freeForAll === true
    || state.settings?.matchMode === "ffa"
    || state.mode === "ffa"
    || (!hasTeamScores && cars.every(car => car.team === null || car.team === undefined));
  const mode = resolveMode(state, cars.length, ffa);
  if (!mode) return null;

  if (ffa) {
    const rows = cars;
    rows.sort((left, right) => right.points - left.points || left.rosterIndex - right.rosterIndex);
    return Object.freeze({ mode, kind: "ffa", rows: Object.freeze(rows), groups: Object.freeze([]) });
  }

  if (!hasTeamScores || cars.some(car => car.team !== "blue" && car.team !== "red")) return null;
  const blue = cars.filter(car => car.team === "blue");
  const red = cars.filter(car => car.team === "red");
  if (blue.length !== red.length || blue.length < 1 || blue.length > 3) return null;
  const groups = [
    Object.freeze({ team: "blue", label: TEAM_NAMES.blue, points: blue.reduce((sum, row) => sum + row.kills, 0), rows: Object.freeze(blue) }),
    Object.freeze({ team: "red", label: TEAM_NAMES.red, points: red.reduce((sum, row) => sum + row.kills, 0), rows: Object.freeze(red) }),
  ];
  return Object.freeze({ mode, kind: "teams", rows: Object.freeze(cars), groups: Object.freeze(groups) });
}

/** Keep the waiting-room roster separate from the gameplay scoreboard. */
export function shouldShowP2PScoreboard(state, model) {
  if (!model || !record(state)) return false;
  if (state.settings?.lobby === true || state.settings?.roundState === "lobby") return false;
  return state.settings?.roundState === "active" || state.settings?.roundState === "complete";
}
