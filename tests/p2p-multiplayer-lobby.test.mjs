import test from "node:test";
import assert from "node:assert/strict";
import { createP2PLobbyHello, createP2PLobbyState, createP2PLobbyTeamRequest, decodeP2PLobbyMessage, normalizeP2PLobbyPlayerSlots } from "../src/p2p-multiplayer-lobby.js";

test("lobby messages stay bounded and expose only room state needed by the UI", () => {
  assert.deepEqual(decodeP2PLobbyMessage(createP2PLobbyHello("  Ana   P2P ")), { type: "hello", name: "Ana P2P" });
  assert.deepEqual(decodeP2PLobbyMessage(createP2PLobbyTeamRequest("red")), { type: "team", team: "red" });
  const text = createP2PLobbyState({ roomId: "ABCD123456", mode: "2v2", maxPlayers: 4, phase: "lobby", players: [
    { slot: 0, id: "p2p-host", name: "Host", team: "blue" },
    { slot: 1, id: "p2p-guest-1", name: "Guest", team: "red" },
  ] });
  const state = decodeP2PLobbyMessage(text, { roomId: "ABCD123456" });
  assert.equal(state.phase, "lobby");
  assert.equal(state.players.length, 2);
  assert.equal(decodeP2PLobbyMessage(text, { roomId: "OTHER12345" }), null);
});

test("lobby state supports an explicit room-open phase without inventing a mode or teams", () => {
  const text = createP2PLobbyState({ roomId: "ABCD123456", phase: "room-open", mode: null, maxPlayers: 6, players: [
    { slot: 0, id: "p2p-host", name: "Host", team: null },
  ] });
  const state = decodeP2PLobbyMessage(text, { roomId: "ABCD123456" });
  assert.equal(state.phase, "room-open");
  assert.equal(state.mode, null);
  assert.equal(state.players[0].team, null);
});

test("lobby state rejects malformed or oversized player projections", () => {
  const state = { protocolVersion: 1, type: "combat-cars-lobby-state", roomId: "ABCD123456", phase: "lobby", mode: "2v2", maxPlayers: 4, durationSeconds: 300, players: [{ slot: 0, id: "p2p-host", name: "Host", team: "blue" }] };
  assert.equal(decodeP2PLobbyMessage(JSON.stringify({ ...state, players: [{ ...state.players[0], team: "green" }] })), null);
  assert.equal(decodeP2PLobbyMessage(JSON.stringify({ ...state, mode: "hosted" })), null);
});

test("lobby player slots remain tied to signaling identities when native WASM compacts a hole", () => {
  const stable = normalizeP2PLobbyPlayerSlots([
    { slot: 0, id: "p2p-host", name: "Host", team: "blue" },
    { slot: 1, id: "p2p-guest-2", name: "Guest 2", team: "red" },
  ]);
  assert.deepEqual(stable.map(player => player.slot), [0, 2]);
});
