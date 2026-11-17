import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerCombatHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-host.mjs";
import { P2PWasmMultiplayerHostChannel, P2PWasmMultiplayerPilotChannel } from "../tools/wasm-spike/p2p-wasm-multiplayer-channel.mjs";

const command = targetId => ({ controls: { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, boost: false, jump: false, drift: false, airRoll: false, handbrake: false }, fire: false, targetId });
class Scheduler { setInterval(fn) { this.fn = fn; return 1; } clearInterval() {} }

test("host-star causal channel accepts each guest's own sequence and broadcasts one v6 authoritative snapshot", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "2v2", playerIds: ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3"] });
  const received = []; let channel;
  const guest = new P2PWasmMultiplayerPilotChannel({ roomId: "room_multi", sessionId: "session_multi", send: text => channel.receive(1, text), onSnapshot: envelope => received.push(envelope) });
  channel = new P2PWasmMultiplayerHostChannel({ roomId: "room_multi", sessionId: "session_multi", host, slotPlayerIds: new Map([[1, "p2p-guest-1"], [2, "p2p-guest-2"], [3, "p2p-guest-3"]]), send: (slot, text) => { if (slot === 1) guest.receive(text); }, clockOptions: { scheduler: new Scheduler() } });
  try { assert.equal(guest.sendCommand(command("p2p-host")).accepted, true); const result = await channel.clock.step(); assert.equal(result.accepted, true); assert.equal(received.length, 1); assert.equal(received[0].snapshot.cars.length, 4); assert.equal(guest.receive(JSON.stringify(received[0])).accepted, false); } finally { channel.close(); }
});

test("guest identity reaches the WASM host and is published in the authoritative roster", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "2v2", playerIds: ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3"], names: { "p2p-host": "Anfitrión" } });
  let channel;
  const guest = new P2PWasmMultiplayerPilotChannel({ roomId: "room_names", sessionId: "session_names", send: text => channel.receive(1, text) });
  channel = new P2PWasmMultiplayerHostChannel({ roomId: "room_names", sessionId: "session_names", host, slotPlayerIds: new Map([[1, "p2p-guest-1"], [2, "p2p-guest-2"], [3, "p2p-guest-3"]]), send: () => {}, clockOptions: { scheduler: new Scheduler() } });
  try {
    assert.equal(guest.sendIdentity("  Andrea   P2P ").accepted, true);
    await channel.clock.step();
    const cars = host.snapshot().combat.cars;
    assert.equal(cars.find(car => car.id === "p2p-host").name, "Anfitrión");
    assert.equal(cars.find(car => car.id === "p2p-guest-1").name, "Andrea P2P");
  } finally { channel.close(); }
});

test("host channel resets a reconnecting slot without changing its roster mapping", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "1v1", playerIds: ["p2p-host", "p2p-guest-1"] });
  const channel = new P2PWasmMultiplayerHostChannel({
    roomId: "room_reset", sessionId: "session_reset", host,
    slotPlayerIds: new Map([[1, "p2p-guest-1"]]), send: () => {},
    clockOptions: { scheduler: new Scheduler() },
  });
  try {
    assert.equal(channel.resetSlotConnection(1).accepted, true);
    assert.equal(channel.resetSlotConnection(1).accepted, true);
    assert.equal(channel.resetSlotConnection(2).accepted, false);
    assert.deepEqual([...channel.slotPlayerIds.entries()], [[1, "p2p-guest-1"]]);
  } finally { channel.close(); }
});
