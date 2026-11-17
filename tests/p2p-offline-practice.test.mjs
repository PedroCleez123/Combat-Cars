import test from "node:test";
import assert from "node:assert/strict";
import { createP2POfflinePracticePresentationState } from "../src/p2p-offline-practice.js";

const snapshot = Object.freeze({
  tick: 3,
  physical: [{ id: "p2p-host", x: 4, h: 2, z: -3, yaw: .5, vx: 8, vh: 1, vz: -2 }],
  presentation: [{ id: "p2p-host", orientation: { x: 0, y: .1, z: 0, w: .995 }, boost: 100, jumps: 2, grounded: true, boosting: true, supersonic: false, powerslide: 0, jumpState: "grounded", actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 }, wheelCount: 4, wheelContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } }, worldContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } }, angularVelocity: { pitch: 0, yaw: 0, roll: 0 } }],
  combat: { cars: [{ id: "p2p-host", hp: 100, respawn: 0, alive: true }] },
});

test("offline practice projects one authoritative local WASM car with infinite boost", () => {
  const state = createP2POfflinePracticePresentationState(snapshot);
  assert.equal(state.settings.offlinePractice, true);
  assert.equal(state.rules.unlimitedBoost, true);
  assert.equal(state.cars.length, 1);
  assert.equal(state.cars[0].boost, 100);
  assert.equal(state.cars[0].surfaceType, "ground");
  assert.equal(state.cars[0].name, "TÚ");
});

test("offline practice rejects a two-car or malformed snapshot instead of inventing a local arena", () => {
  assert.throws(() => createP2POfflinePracticePresentationState({ ...snapshot, physical: [] }), TypeError);
  assert.throws(() => createP2POfflinePracticePresentationState({ ...snapshot, tick: 0 }), TypeError);
});
