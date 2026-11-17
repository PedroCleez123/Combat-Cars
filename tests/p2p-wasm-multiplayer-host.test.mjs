import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerCombatHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-host.mjs";
import { createP2PWasmMultiplayerEnvelope, decodeP2PWasmMultiplayerEnvelope } from "../tools/wasm-spike/p2p-wasm-multiplayer-protocol.mjs";

const controls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, boost: false, jump: false, drift: false, airRoll: false, handbrake: false };
const command = targetId => ({ controls, fire: false, targetId });
const playerIds = ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3"];
const identity = { x: 0, y: 0, z: 0, w: 1 };

function ramCar(id, x, z, velocityX = 0) {
  return {
    id,
    position: { x, y: 17, z },
    velocity: { x: velocityX, y: 0, z: 0 },
    orientation: { ...identity },
    localAngularVelocity: { pitch: 0, yaw: 0, roll: 0 },
    grounded: true,
    wheelCount: 4,
    jumps: 2,
    jumpState: "grounded",
    secondJumpWindow: 0,
    dodgeTime: 0,
    dodgeDirection: { forward: 0, side: 0 },
    actionFlags: { hasJumped: false, hasDoubleJumped: false, hasFlipped: false },
    boost: 100,
  };
}

class SweptRamBridge {
  constructor(attackerSlot, victimSlot) {
    this.attackerSlot = attackerSlot;
    this.victimSlot = victimSlot;
    this.deactivationCalls = [];
    this.respawnCalls = [];
    this.tickCalls = [];
  }

  async start() { return { features: { staticRaycast: true } }; }

  async tick(tick, cars) {
    this.tickCalls.push(tick);
    const crossed = tick >= 3;
    return {
      tick,
      cars: cars.map(({ id }) => {
        if (id === this.attackerSlot) return ramCar(id, crossed ? 300 : -300, 0, 2217);
        if (id === this.victimSlot) return ramCar(id, crossed ? -300 : 300, 0);
        // Keep every other roster member well clear of the swept contact.
        return ramCar(id, 1000 + id * 150, 800);
      }),
    };
  }

  async setCombatActive(id, active) {
    this.deactivationCalls.push({ id, active });
    return { tick: this.tickCalls.at(-1) || 0, cars: [] };
  }

  async respawn(id) {
    this.respawnCalls.push(id);
    return { tick: this.tickCalls.at(-1) || 0, cars: [] };
  }

  async shutdown() {}
}

function ramScenario({ mode, count, attackerId = "p2p-host", victimId = "p2p-guest-1" }) {
  const ids = ["p2p-host", ...Array.from({ length: count - 1 }, (_, index) => `p2p-guest-${index + 1}`)];
  const attackerSlot = ids.indexOf(attackerId) + 1;
  const victimSlot = ids.indexOf(victimId) + 1;
  const bridges = [];
  const bridgeFactory = () => {
    const bridge = new SweptRamBridge(attackerSlot, victimSlot);
    bridges.push(bridge);
    return bridge;
  };
  return { ids, bridges, bridgeFactory, options: { mode, playerIds: ids, bridgeFactory } };
}

test("the multi-player WASM host advances one authoritative four-car roster and isolates guest input sequences", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "2v2", playerIds });
  try {
    const first = host.snapshot();
    assert.equal(first.physical.length, 4);
    assert.deepEqual(first.physical.map(car => car.id), playerIds);
    assert.deepEqual(first.physical.map(car => car.team), ["blue", "red", "blue", "red"]);
    assert.equal(host.setCommand("p2p-host", command("p2p-guest-1")).accepted, true);
    assert.equal(host.setCommand("p2p-guest-1", command("p2p-host"), { sequence: 1 }).accepted, true);
    assert.equal(host.setCommand("p2p-guest-2", command("p2p-guest-1"), { sequence: 1 }).accepted, true);
    assert.equal(host.setCommand("p2p-guest-1", command("p2p-host"), { sequence: 1 }).accepted, false);
    const next = await host.advance(1);
    assert.ok(next.tick > first.tick);
    assert.equal(next.combat.cars.length, 4);
    assert.equal(next.lastInputSequence, 1);
    assert.deepEqual(host.metadataSnapshot().players.map(player => player.id), playerIds);
  } finally { host.close(); }
});

test("a reconnecting combat slot is neutralized and accepts a fresh sequence without adding a car", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "1v1", playerIds: ["p2p-host", "p2p-guest-1"] });
  try {
    assert.equal(host.setCommand("p2p-guest-1", { ...command("p2p-host"), controls: { ...controls, throttle: 1 } }, { sequence: 4 }).accepted, true);
    assert.equal(host.setCommand("p2p-guest-1", command("p2p-host"), { sequence: 4 }).accepted, false);
    assert.equal(host.resetPlayerConnection("p2p-guest-1").accepted, true);
    assert.equal(host.setCommand("p2p-guest-1", command("p2p-host"), { sequence: 1 }).accepted, true);
    assert.equal(host.snapshot().physical.length, 2);
    assert.deepEqual(host.metadataSnapshot().players.map(player => player.id), ["p2p-host", "p2p-guest-1"]);
  } finally { host.close(); }
});

test("the multi-player WASM host permits only roster targets and caps the native roster at six", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "ffa", playerIds: ["p2p-host", "p2p-guest-1", "p2p-guest-2"] });
  try {
    const first = host.snapshot();
    assert.deepEqual(Object.keys(first.combat.score).sort(), ["p2p-guest-1", "p2p-guest-2", "p2p-host"]);
    assert.equal(host.setCommand("p2p-guest-1", command("p2p-guest-2"), { sequence: 1 }).accepted, true);
    assert.equal(host.setCommand("p2p-guest-1", command("not-a-player"), { sequence: 2 }).accepted, false);
  } finally { host.close(); }
  await assert.rejects(() => createP2PWasmMultiplayerCombatHost({ mode: "ffa", playerIds: [...playerIds, "p2p-guest-4", "p2p-guest-5", "p2p-guest-6"] }), /entre dos y seis|requiere/i);
});

test("the browser host publishes a timed five-minute-compatible round clock and completes at its deadline", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "ffa", playerIds: ["p2p-host", "p2p-guest-1"], durationSeconds: 1 });
  try {
    assert.equal(host.snapshot().combat.round.durationTicks, 60);
    let snapshot = host.snapshot();
    for (let index = 0; index < 60; index += 1) snapshot = await host.advance(1);
    assert.equal(snapshot.combat.round.state, "complete");
    assert.equal(snapshot.combat.round.remainingTicks, 0);
  } finally { host.close(); }
});

test("legacy restart fields are discarded and never reset the authoritative multi-player round", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "1v1", playerIds: ["p2p-host", "p2p-guest-1"] });
  try {
    const before = host.snapshot();
    const legacy = { ...command("p2p-guest-1"), restart: true };
    assert.equal(host.setCommand("p2p-host", legacy, { sequence: 1 }).accepted, true);
    const after = await host.advance(1);
    assert.equal(after.combat.round.serial, before.combat.round.serial);
    assert.ok(after.tick > before.tick);
    assert.equal(Object.hasOwn(after, "restart"), false);
  } finally { host.close(); }
});

for (const scenario of [
  { mode: "1v1", count: 2 },
  { mode: "2v2", count: 4 },
  { mode: "3v3", count: 6 },
  { mode: "ffa", count: 6 },
]) {
  test(`a swept high-speed rival ram survives the authoritative ${scenario.mode} ${scenario.count}-player host and v6 snapshot exactly once`, async () => {
    const { ids, bridges, options } = ramScenario(scenario);
    const host = await createP2PWasmMultiplayerCombatHost(options);
    try {
      const snapshot = await host.advance(1);
      const attacker = snapshot.combat.cars.find(car => car.id === "p2p-host");
      const victim = snapshot.combat.cars.find(car => car.id === "p2p-guest-1");

      assert.equal(attacker.kills, 1);
      assert.equal(victim.deaths, 1);
      assert.ok(victim.respawn > 0);
      assert.equal(victim.alive, false);
      assert.deepEqual(bridges[0].deactivationCalls, [{ id: 2, active: false }]);
      assert.equal(snapshot.combat.cars.length, scenario.count);

      if (scenario.mode === "ffa") {
        assert.equal(snapshot.combat.score["p2p-host"], 1);
        assert.equal(snapshot.combat.score["p2p-guest-1"], 0);
      } else {
        assert.equal(snapshot.combat.score.blue, 1);
        assert.equal(snapshot.combat.score.red, 0);
      }

      const text = createP2PWasmMultiplayerEnvelope({
        roomId: "room-c4",
        sessionId: "session-c4",
        sequence: 1,
        snapshot,
      });
      const envelope = decodeP2PWasmMultiplayerEnvelope(text);
      const remoteAttacker = envelope.snapshot.cars.find(car => car.id === "p2p-host");
      const remoteVictim = envelope.snapshot.cars.find(car => car.id === "p2p-guest-1");
      assert.equal(envelope.protocolVersion, 6);
      assert.equal(remoteAttacker.combat.kills, 1);
      assert.equal(remoteVictim.combat.deaths, 1);
      assert.ok(remoteVictim.combat.respawn > 0);
      assert.equal(remoteVictim.combat.alive, false);
      assert.deepEqual(envelope.snapshot.score, snapshot.combat.score);

      const next = await host.advance(1);
      assert.equal(next.combat.cars.find(car => car.id === "p2p-host").kills, 1, "the next native samples cannot award the same kill again");
      assert.equal(next.combat.cars.find(car => car.id === "p2p-guest-1").deaths, 1);
      assert.deepEqual(bridges[0].deactivationCalls, [{ id: 2, active: false }]);

      let respawned = next;
      for (let ticks = 0; ticks < 150 && respawned.combat.cars.find(car => car.id === "p2p-guest-1").respawn > 0; ticks += 1) {
        respawned = await host.advance(1);
      }
      const returnedVictim = respawned.combat.cars.find(car => car.id === "p2p-guest-1");
      assert.equal(returnedVictim.deaths, 1);
      assert.equal(returnedVictim.respawn, 0);
      assert.equal(returnedVictim.alive, true);
      assert.equal(returnedVictim.hp, 100);
      assert.equal(respawned.presentation.find(car => car.id === "p2p-guest-1").actionSerials.respawn, 1);
      assert.deepEqual(bridges[0].respawnCalls, [2]);
      const returnedEnvelope = decodeP2PWasmMultiplayerEnvelope(createP2PWasmMultiplayerEnvelope({
        roomId: "room-c4",
        sessionId: "session-c4",
        sequence: 2,
        snapshot: respawned,
      }));
      const returnedRemoteVictim = returnedEnvelope.snapshot.cars.find(car => car.id === "p2p-guest-1");
      assert.equal(returnedRemoteVictim.combat.deaths, 1);
      assert.equal(returnedRemoteVictim.combat.alive, true);
      assert.equal(returnedRemoteVictim.presentation.actionSerials.respawn, 1);
      assert.equal(respawned.combat.cars.find(car => car.id === "p2p-host").kills, 1);
    } finally { host.close(); }
  });
}

test("a swept collision between same-team cars in 2v2 does not eliminate or score either ally", async () => {
  const { bridges, options } = ramScenario({ mode: "2v2", count: 4, victimId: "p2p-guest-2" });
  const host = await createP2PWasmMultiplayerCombatHost(options);
  try {
    const snapshot = await host.advance(1);
    const attacker = snapshot.combat.cars.find(car => car.id === "p2p-host");
    const ally = snapshot.combat.cars.find(car => car.id === "p2p-guest-2");
    assert.equal(attacker.team, ally.team);
    assert.equal(attacker.kills, 0);
    assert.equal(ally.deaths, 0);
    assert.equal(ally.respawn, 0);
    assert.equal(snapshot.combat.score.blue, 0);
    assert.equal(snapshot.combat.score.red, 0);
    assert.deepEqual(bridges[0].deactivationCalls, []);
  } finally { host.close(); }
});
