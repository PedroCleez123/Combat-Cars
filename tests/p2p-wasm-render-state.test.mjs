import assert from "node:assert/strict";
import test from "node:test";

import { createP2PWasmRenderState } from "../src/p2p-wasm-render-state.js";

function snapshot() {
  return {
    tick: 60, lastInputSequence: 3,
    physical: [
      { id: "p2p-host", team: "blue", x: 10, z: -4, h: 2, yaw: Math.PI / 2, vx: 3, vz: 4, vh: 0 },
      { id: "p2p-pilot", team: "red", x: -10, z: 4, h: 2, yaw: 0, vx: 0, vz: -2, vh: 1 },
    ],
    score: { blue: 1, red: 0 },
    round: { state: "active", scoreToWin: 15, winner: null, serial: 1 },
    cars: [
      { id: "p2p-host", team: "blue", hp: 100, respawn: 0, kills: 1, deaths: 0, rocketCooldown: 0, alive: true },
      { id: "p2p-pilot", team: "red", hp: 35, respawn: 0, kills: 0, deaths: 0, rocketCooldown: .2, alive: true },
    ],
    rockets: [{ id: 1, owner: "p2p-host", team: "blue", x: 11, z: -4, h: 2, vx: 70, vz: 0, vh: 0, life: 1, targetId: "p2p-pilot" }],
    events: [{ kind: "fire", text: "HOST dispara.", at: 1 }],
  };
}

test("causal snapshot maps to a presentation-only combat state", () => {
  const result = createP2PWasmRenderState(snapshot(), { roomId: "room_1", sessionId: "session_1" });
  assert.equal(result.time, 1);
  assert.deepEqual(result.settings, { arena: "combat-alpha", practiceArena: "combat-alpha", movementBackend: "rocketsim", roundState: "active", scoreToWin: 15, roundSerial: 1, humans: 2, vehicleLimit: 2, p2p: true, roomId: "room_1", sessionId: "session_1" });
  assert.equal(result.rules.combat, true);
  assert.equal(result.cars[0].id, "p2p-host");
  assert.equal(result.cars[1].team, "red");
  assert.equal(result.cars[0].speed, 5);
  assert.equal(result.cars[0].forwardSpeed, 4);
  assert.equal(result.cars[0].orientation, undefined, "the contract has no full attitude; do not invent one");
  assert.equal(result.cars[0].grounded, false);
  assert.deepEqual(result.pads, []);
  assert.equal(result.rockets[0].targetId, "p2p-pilot");
});

test("adapter does not mutate the decoded snapshot", () => {
  const input = snapshot();
  const before = structuredClone(input);
  createP2PWasmRenderState(input);
  assert.deepEqual(input, before);
});

test("invalid identity, values, ordering and context are rejected", () => {
  const bad = snapshot();
  bad.physical[1] = { ...bad.physical[1], id: "p2p-host" };
  assert.throws(() => createP2PWasmRenderState(bad), /contrato/);
  const nonFinite = snapshot();
  nonFinite.physical[0] = { ...nonFinite.physical[0], vx: Infinity };
  assert.throws(() => createP2PWasmRenderState(nonFinite), /contrato/);
  assert.throws(() => createP2PWasmRenderState(snapshot(), { roomId: "https://bad" }), /roomId/);
  assert.throws(() => createP2PWasmRenderState(snapshot(), { sessionId: "" }), /sessionId/);
});

test("dead combat cars retain their authoritative respawn state", () => {
  const input = snapshot();
  input.cars[1] = { ...input.cars[1], hp: 0, respawn: 1.5, alive: false, deaths: 1 };
  const result = createP2PWasmRenderState(input);
  assert.equal(result.cars[1].alive, false);
  assert.equal(result.cars[1].respawn, 1.5);
  assert.equal(result.cars[1].deaths, 1);
});
