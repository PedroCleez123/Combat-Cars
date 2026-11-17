import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerLobbyHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-host.mjs";
import {
  P2PWasmMultiplayerLobbyGuestChannel,
  P2PWasmMultiplayerLobbyHostChannel,
  createP2PWasmMultiplayerLobbyCommand,
} from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-channel.mjs";

const controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, boost: false, jump: false, drift: false, airRoll: false, handbrake: false };

async function setup(mode = "2v2") {
  const host = await createP2PWasmMultiplayerLobbyHost({ roomId: `room-channel-${mode}`, sessionId: `session-channel-${mode}`, mode, hostName: "Host" });
  const hostWire = new Map();
  const hostSnapshots = [];
  const guestSnapshots = new Map();
  const channel = new P2PWasmMultiplayerLobbyHostChannel({
    roomId: host.roomId, sessionId: host.sessionId, lobbyHost: host,
    send(slot, text) { hostWire.set(slot, text); },
    onSnapshot(snapshot, sequence) { hostSnapshots.push({ snapshot, sequence }); },
  });
  const guests = new Map();
  const addGuest = slot => {
    const id = `p2p-guest-${slot}`;
    const guest = new P2PWasmMultiplayerLobbyGuestChannel({
      roomId: host.roomId, sessionId: host.sessionId, slot, name: `Piloto ${slot}`,
      send(text) { guest._outgoing = text; },
      onSnapshot(snapshot, sequence) { guestSnapshots.set(slot, { snapshot, sequence }); },
    });
    guests.set(slot, guest);
    return guest;
  };
  return { host, channel, hostWire, hostSnapshots, guests, addGuest, guestSnapshots };
}

test("lobby channel exchanges hello, commands, team changes and monotonic snapshots", async () => {
  const state = await setup("2v2");
  try {
    await state.channel.start();
    const guest = state.addGuest(1);
    guest.start();
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, true);
    guest.receive(state.hostWire.get(1));
    assert.equal(state.guestSnapshots.get(1).snapshot.players.length, 2);

    const changed = guest.sendTeam("red");
    assert.equal(changed.accepted, true);
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, true);
    const teamSnapshot = state.hostSnapshots.at(-1).snapshot;
    assert.equal(teamSnapshot.players.find(player => player.id === "p2p-guest-1").team, "red");

    assert.equal(guest.sendCommand({ ...controls, throttle: 1, boost: true }, 1).accepted, true);
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, true);
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, false);
    const advanced = await state.channel.advance(20);
    assert.equal(advanced.accepted, true);
    guest.receive(state.hostWire.get(1));
    const pilot = state.guestSnapshots.get(1).snapshot.players.find(player => player.id === "p2p-guest-1");
    assert.equal(pilot.lastSequence, 1);
    assert.equal(pilot.boost, 100);
    assert.equal(state.hostSnapshots.at(-1).sequence > state.hostSnapshots.at(-2).sequence, true);
  } finally { state.channel.close(); state.host.close(); }
});

test("lobby serializes hello before an immediately following held guest command", async () => {
  const state = await setup("1v1");
  try {
    await state.channel.start();
    const guest = state.addGuest(1);
    guest.start();
    const hello = guest._outgoing;
    const command = createP2PWasmMultiplayerLobbyCommand({
      roomId: state.host.roomId, sessionId: state.host.sessionId, playerId: "p2p-guest-1", sequence: 1,
      controls: { ...controls, throttle: 1, boost: true },
    });
    const [joined, accepted] = await Promise.all([
      state.channel.receive(1, hello),
      state.channel.receive(1, command),
    ]);
    assert.equal(joined.accepted, true);
    assert.equal(accepted.accepted, true);
    const before = state.host.snapshot().players.find(player => player.id === "p2p-guest-1").x;
    const advanced = await state.channel.advance(20);
    assert.equal(advanced.accepted, true);
    assert.notEqual(advanced.snapshot.players.find(player => player.id === "p2p-guest-1").x, before);
  } finally { state.channel.close(); state.host.close(); }
});

test("guest waits for its authoritative lobby snapshot before sending controls", async () => {
  const state = await setup("1v1");
  try {
    await state.channel.start();
    const guest = state.addGuest(1);
    guest.start();
    assert.equal(guest.sendCommand(controls, 1).accepted, false);
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, true);
    assert.equal(guest.receive(state.hostWire.get(1)).accepted, true);
    assert.equal(guest.isReadyForCommands(), true);
    assert.equal(guest.sendCommand(controls, 1).accepted, true);
  } finally { state.channel.close(); state.host.close(); }
});

test("lobby channel propagates leave and refuses duplicate or foreign slots", async () => {
  const state = await setup("2v2");
  try {
    await state.channel.start();
    const guest = state.addGuest(1);
    guest.start();
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, true);
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, false);
    assert.equal((await state.channel.receive(2, guest._outgoing)).accepted, false);
    const leave = guest.leave();
    assert.equal(leave.accepted, true);
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, true);
    assert.equal(state.hostSnapshots.at(-1).snapshot.players.some(player => player.id === "p2p-guest-1"), false);
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, false);
  } finally { state.channel.close(); state.host.close(); }
});

test("lobby channel supports six-player 3v3 and keeps FFA team null", async () => {
  for (const mode of ["3v3", "ffa"]) {
    const state = await setup(mode);
    try {
      await state.channel.start();
      for (let slot = 1; slot <= 5; slot += 1) {
        const guest = state.addGuest(slot);
        guest.start();
        assert.equal((await state.channel.receive(slot, guest._outgoing)).accepted, true);
      }
      const snapshot = state.hostSnapshots.at(-1).snapshot;
      assert.equal(snapshot.players.length, 6);
      if (mode === "ffa") assert.equal(snapshot.players.every(player => player.team === null), true);
      else assert.equal(snapshot.players.every(player => player.team === "blue" || player.team === "red"), true);
    } finally { state.channel.close(); state.host.close(); }
  }
});

test("lobby channel rejects replay, combat fields, foreign sessions and oversized messages", async () => {
  const state = await setup("1v1");
  try {
    await state.channel.start();
    const guest = state.addGuest(1);
    guest.start();
    assert.equal((await state.channel.receive(1, guest._outgoing)).accepted, true);
    const wire = state.hostWire.get(1);
    assert.equal(guest.receive(wire).accepted, true);
    assert.equal(guest.receive(wire).accepted, false);
    assert.equal((await state.channel.receive(1, createP2PWasmMultiplayerLobbyCommand({ roomId: "foreign", sessionId: state.host.sessionId, playerId: "p2p-guest-1", sequence: 1, controls }))).accepted, false);
    assert.equal((await state.channel.receive(1, `${guest._outgoing.slice(0, -1)},"score":{}}`)).accepted, false);
    assert.equal((await state.channel.receive(1, "x".repeat(16 * 1024 + 1))).accepted, false);
  } finally { state.channel.close(); state.host.close(); }
});

test("guest channel requires a bounded non-empty name", () => {
  assert.throws(() => new P2PWasmMultiplayerLobbyGuestChannel({ roomId: "room", sessionId: "session", slot: 1, name: "", send() {} }), /nombre/i);
  assert.throws(() => new P2PWasmMultiplayerLobbyGuestChannel({ roomId: "room", sessionId: "session", slot: 1, name: "x".repeat(17), send() {} }), /nombre/i);
});

test("guest channel can be discarded during host migration without announcing a leave", () => {
  const sent = [];
  const guest = new P2PWasmMultiplayerLobbyGuestChannel({ roomId: "room", sessionId: "session", slot: 1, name: "Piloto", send: text => sent.push(text) });
  guest.start();
  assert.equal(sent.length, 1);
  assert.equal(guest.close({ announceLeave: false }).accepted, true);
  assert.equal(sent.length, 1);
  assert.equal(guest.sendTeam("red").accepted, false);
});

