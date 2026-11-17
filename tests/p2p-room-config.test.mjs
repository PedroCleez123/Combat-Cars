import test from "node:test";
import assert from "node:assert/strict";
import {
  P2P_MATCH_MAX_PLAYERS,
  P2P_MATCH_MODES,
  createP2PMatchRoster,
  isP2PMatchMode,
  p2pMatchPlayerRange,
} from "../src/p2p-room-config.js";

test("P2P match modes expose bounded player ranges", () => {
  assert.equal(P2P_MATCH_MAX_PLAYERS, 6);
  assert.deepEqual(p2pMatchPlayerRange(P2P_MATCH_MODES.DUEL_1V1), { min: 2, max: 2 });
  assert.deepEqual(p2pMatchPlayerRange(P2P_MATCH_MODES.TEAMS_2V2), { min: 4, max: 4 });
  assert.deepEqual(p2pMatchPlayerRange(P2P_MATCH_MODES.TEAMS_3V3), { min: 6, max: 6 });
  assert.deepEqual(p2pMatchPlayerRange(P2P_MATCH_MODES.FREE_FOR_ALL), { min: 2, max: 6 });
  assert.equal(isP2PMatchMode("hosted"), false);
  assert.equal(p2pMatchPlayerRange("hosted"), null);
});

test("team rosters assign deterministic host, seats, teams and legal targets", () => {
  const roster = createP2PMatchRoster({
    mode: P2P_MATCH_MODES.TEAMS_3V3,
    playerIds: ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3", "p2p-guest-4", "p2p-guest-5"],
  });
  assert.deepEqual(roster.players.map(({ id, index, role, team }) => ({ id, index, role, team })), [
    { id: "p2p-host", index: 0, role: "host", team: "blue" },
    { id: "p2p-guest-1", index: 1, role: "guest", team: "red" },
    { id: "p2p-guest-2", index: 2, role: "guest", team: "blue" },
    { id: "p2p-guest-3", index: 3, role: "guest", team: "red" },
    { id: "p2p-guest-4", index: 4, role: "guest", team: "blue" },
    { id: "p2p-guest-5", index: 5, role: "guest", team: "red" },
  ]);
  assert.deepEqual(roster.targetsByPlayerId["p2p-host"], ["p2p-guest-1", "p2p-guest-3", "p2p-guest-5"]);
  assert.deepEqual(roster.targetsByPlayerId["p2p-guest-1"], ["p2p-host", "p2p-guest-2", "p2p-guest-4"]);
  assert.equal(roster.playerById.get("p2p-guest-4").team, "blue");
});

test("FFA rosters allow every other player as a target and cap at six", () => {
  const ids = ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3", "p2p-guest-4", "p2p-guest-5"];
  const roster = createP2PMatchRoster({ mode: P2P_MATCH_MODES.FREE_FOR_ALL, playerIds: ids });
  assert.equal(roster.players.every((player) => player.team === null), true);
  assert.deepEqual(roster.targetsByPlayerId["p2p-host"], ids.slice(1));
  assert.throws(() => createP2PMatchRoster({ mode: P2P_MATCH_MODES.TEAMS_2V2, playerIds: ids.slice(0, 2) }), RangeError);
  assert.throws(() => createP2PMatchRoster({ mode: P2P_MATCH_MODES.FREE_FOR_ALL, playerIds: [...ids, "p2p-guest-6"] }), RangeError);
});

test("roster validation rejects duplicate or unsafe player identities", () => {
  assert.throws(() => createP2PMatchRoster({ mode: P2P_MATCH_MODES.DUEL_1V1, playerIds: ["p2p-host", "p2p-host"] }), TypeError);
  assert.throws(() => createP2PMatchRoster({ mode: P2P_MATCH_MODES.DUEL_1V1, playerIds: ["host", "p2p-pilot"] }), TypeError);
});

test("team selections are accepted only when the final roster is balanced", () => {
  const ids = ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3"];
  const roster = createP2PMatchRoster({ mode: P2P_MATCH_MODES.TEAMS_2V2, playerIds: ids, teamsByPlayerId: {
    "p2p-host": "red", "p2p-guest-1": "red", "p2p-guest-2": "blue", "p2p-guest-3": "blue",
  } });
  assert.deepEqual(roster.players.map(player => player.team), ["red", "red", "blue", "blue"]);
  assert.throws(() => createP2PMatchRoster({ mode: P2P_MATCH_MODES.TEAMS_2V2, playerIds: ids, teamsByPlayerId: {
    "p2p-host": "blue", "p2p-guest-1": "blue", "p2p-guest-2": "blue", "p2p-guest-3": "red",
  } }), RangeError);
});
