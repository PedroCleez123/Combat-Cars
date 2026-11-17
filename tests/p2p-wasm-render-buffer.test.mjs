import test from "node:test";
import assert from "node:assert/strict";
import { P2PWasmRenderBuffer, createP2PWasmRenderState } from "../src/p2p-wasm-render-state.js";

function snapshot(tick, x = tick, lastInputSequence = tick) {
  const physical = [
    { id: "p2p-host", team: "blue", x, z: 0, h: 1, yaw: 0, vx: 1, vz: 0, vh: 0 },
    { id: "p2p-pilot", team: "red", x: -x, z: 0, h: 1, yaw: Math.PI, vx: -1, vz: 0, vh: 0 },
  ];
  const cars = [
    { id: "p2p-host", team: "blue", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
    { id: "p2p-pilot", team: "red", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
  ];
  return { tick, lastInputSequence, physical, score: { blue: 0, red: 0 }, round: { state: "active", scoreToWin: 15, winner: null, serial: 1 }, cars, rockets: [], events: [] };
}

test("causal presentation buffer adapts and interpolates monotonically", () => {
  const buffer = new P2PWasmRenderBuffer({ roomId: "room", sessionId: "session", delay: 0, now: () => 0 });
  const first = buffer.push(snapshot(1, 0), 0);
  const second = buffer.push(snapshot(2, 2), 1 / 60);
  assert.equal(first.settings.p2p, true);
  assert.equal(second.time, 2 / 60);
  const sampled = buffer.sample(1 / 120);
  assert.equal(sampled.settings.arena, "combat-alpha");
  assert.ok(sampled.cars[0].x >= 0 && sampled.cars[0].x <= 2);
});

test("causal presentation buffer rejects stale ticks and never mutates input", () => {
  const input = snapshot(1, 3);
  const copy = structuredClone(input);
  const buffer = new P2PWasmRenderBuffer({ roomId: "room", sessionId: "session" });
  buffer.push(input, 0);
  assert.deepEqual(input, copy);
  assert.throws(() => buffer.push(input, 1 / 60), /tick repetido o atrasado/);
});

test("causal presentation buffer closes and resets deterministically", () => {
  const buffer = new P2PWasmRenderBuffer({ roomId: "room", sessionId: "session" });
  buffer.push(snapshot(1), 0);
  buffer.close();
  assert.equal(buffer.sample(0), null);
  assert.equal(buffer.push(snapshot(2), 1), null);
  buffer.reset();
  assert.equal(buffer.closed, true);
});

test("adapter remains independently usable for renderer integration", () => {
  const state = createP2PWasmRenderState(snapshot(1), { roomId: "room", sessionId: "session" });
  assert.deepEqual(state.settings, {
    arena: "combat-alpha", practiceArena: "combat-alpha", movementBackend: "rocketsim",
    roundState: "active", scoreToWin: 15, roundSerial: 1, humans: 2, vehicleLimit: 2, p2p: true,
    roomId: "room", sessionId: "session",
  });
});
