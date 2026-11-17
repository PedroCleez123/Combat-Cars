import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerLobbyHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-host.mjs";
import { createP2PCausalInput, p2pLobbyControlsFromCommand } from "../src/p2p-causal-input.js";

const controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, boost: false, jump: false, drift: false, airRoll: false, handbrake: false };
const player = (index, team = null) => ({ id: `p2p-guest-${index}`, name: `Piloto ${index}`, ...(team === null ? {} : { team }) });

function inputTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    fire(type, event) { listeners.get(type)?.(event); },
  };
}

test("lobby host starts bounded 1/2/4/6 rosters on RocketSim WASM", async () => {
  const cases = [
    { mode: "1v1", initialPlayers: [], expected: 1 },
    { mode: "2v2", initialPlayers: [player(1)], expected: 2 },
    { mode: "2v2", initialPlayers: [player(1), player(2), player(3)], expected: 4 },
    { mode: "3v3", initialPlayers: [player(1), player(2), player(3), player(4), player(5)], expected: 6 },
  ];
  for (const entry of cases) {
    const host = await createP2PWasmMultiplayerLobbyHost({ roomId: `room-${entry.expected}`, sessionId: `session-${entry.expected}`, mode: entry.mode, hostName: "Host", initialPlayers: entry.initialPlayers });
    try {
      const snapshot = host.snapshot();
      assert.equal(snapshot.phase, "lobby");
      assert.equal(snapshot.players.length, entry.expected);
      assert.equal(snapshot.players.every(pilot => pilot.boost === 100), true);
      assert.equal(Object.hasOwn(snapshot, "score"), false);
      assert.equal(Object.hasOwn(snapshot, "rockets"), false);
    } finally { host.close(); }
  }
});

test("lobby host preserves the promoted player's team when rebuilding the room", async () => {
  const host = await createP2PWasmMultiplayerLobbyHost({ mode: "2v2", hostName: "Sucesor", hostTeam: "red", initialPlayers: [player(2, "blue")] });
  try {
    assert.equal(host.snapshot().players.find(pilot => pilot.id === "p2p-host").team, "red");
  } finally { host.close(); }
});

test("lobby roster supports live add/remove/replacement and team capacity", async () => {
  const host = await createP2PWasmMultiplayerLobbyHost({ mode: "2v2", hostName: "Host" });
  try {
    assert.equal((await host.addPlayer({ ...player(1), team: "red" })).accepted, true);
    assert.equal((await host.addPlayer({ ...player(2), team: "blue" })).accepted, true);
    assert.equal((await host.addPlayer({ ...player(3), team: "red" })).accepted, true);
    assert.equal((await host.addPlayer({ ...player(4), team: "blue" })).accepted, false);
    const before = host.snapshot();
    assert.equal(before.players.length, 4);
    assert.equal((await host.removePlayer("p2p-guest-1")).accepted, true);
    assert.equal((await host.addPlayer({ ...player(4), team: "red" })).accepted, true);
    assert.deepEqual(host.snapshot().players.map(pilot => pilot.id).sort(), ["p2p-guest-2", "p2p-guest-3", "p2p-guest-4", "p2p-host"].sort());
    assert.equal((await host.removePlayer("p2p-guest-2")).accepted, true);
    assert.equal(host.setTeam("p2p-guest-4", "blue"), true);
    assert.equal(host.snapshot().players.find(pilot => pilot.id === "p2p-guest-4").team, "blue");
  } finally { host.close(); }
});

test("lobby commands have independent sequences, move native cars and refill every boost", async () => {
  const host = await createP2PWasmMultiplayerLobbyHost({ mode: "1v1", hostName: "Host", initialPlayers: [player(1, "red")] });
  try {
    const initial = host.snapshot();
    const accepted = host.setCommand("p2p-host", { ...controls, throttle: 1, boost: true }, { sequence: 1 });
    assert.equal(accepted.accepted, true);
    assert.equal(host.setCommand("p2p-host", controls, { sequence: 1 }).accepted, false);
    assert.equal(host.setCommand("p2p-guest-1", controls, { sequence: 1 }).accepted, true);
    const next = await host.advance(30);
    const moved = next.players.find(pilot => pilot.id === "p2p-host");
    assert.notEqual(moved.x, initial.players.find(pilot => pilot.id === "p2p-host").x);
    assert.equal(moved.boost, 100);
    assert.equal(next.players.find(pilot => pilot.id === "p2p-guest-1").boost, 100);
    assert.equal(next.players.every(pilot => pilot.lastSequence === 1), true);
    assert.equal(Object.hasOwn(next, "score"), false);
    assert.equal(Object.hasOwn(next, "rockets"), false);
  } finally { host.close(); }
});

test("causal lobby input unwraps movement and actions before the host advances the car", async () => {
  const host = await createP2PWasmMultiplayerLobbyHost({ mode: "1v1", hostName: "Host", initialPlayers: [player(1, "red")] });
  const events = inputTarget();
  const input = createP2PCausalInput({ eventTarget: events, fullControls: true });
  try {
    const initial = host.snapshot().players.find(pilot => pilot.id === "p2p-host");
    events.fire("keydown", { key: "w", code: "KeyW", target: { tagName: "body" } });
    events.fire("keydown", { key: "d", code: "KeyD", target: { tagName: "body" } });
    events.fire("mousedown", { button: 0, target: { tagName: "body" } });
    events.fire("mousedown", { button: 2, target: { tagName: "body" } });
    const command = p2pLobbyControlsFromCommand(input.nextCommand("host"));
    assert.equal(command.throttle, 1);
    assert.equal(command.steer, 1);
    assert.equal(command.boost, true);
    assert.equal(command.jump, true);
    assert.equal(host.setCommand("p2p-host", command, { sequence: 1 }).accepted, true);
    const next = await host.advance(30);
    const moved = next.players.find(pilot => pilot.id === "p2p-host");
    assert.notEqual(moved.x, initial.x);
    assert.equal(moved.lastSequence, 1);
  } finally {
    input.destroy();
    host.close();
  }
});

