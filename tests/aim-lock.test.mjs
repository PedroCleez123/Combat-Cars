import assert from "node:assert/strict";
import test from "node:test";
import { chooseAimTarget, computeAimDirection, createAimLockState, toggleAimLock, updateAimLock } from "../src/aim-lock.js";

const cars = [{ id: "red-a", hp: 100, respawn: 0 }, { id: "red-b", hp: 100, respawn: 0 }];

test("aim lock selects the best eligible centered target and ignores hidden candidates", () => {
  assert.equal(chooseAimTarget([
    { id: "red-a", eligible: false, screenDistance: 0, distance: 3 },
    { id: "red-b", eligible: true, screenDistance: .2, distance: 80 },
    { id: "red-c", eligible: true, screenDistance: .05, distance: 88 },
  ]), "red-c");
});

test("aim lock persists its id while the live target is offscreen", () => {
  const lock = createAimLockState();
  toggleAimLock(lock, [{ id: "red-a", eligible: true }], 1);
  updateAimLock(lock, [{ id: "red-b", eligible: true }], cars, 2);
  assert.equal(lock.targetId, "red-a");
  assert.equal(lock.valid, true);
  assert.equal(lock.offscreen, true);
  updateAimLock(lock, [], cars, 300);
  assert.equal(lock.targetId, "red-a");
  assert.equal(lock.valid, true);
});

test("a press cycles visible candidates and an empty visible set cancels", () => {
  const lock = createAimLockState();
  const candidates = [
    { id: "red-a", eligible: true, screenDistance: .1 },
    { id: "red-b", eligible: true, screenDistance: .2 },
  ];
  toggleAimLock(lock, candidates, 0);
  assert.equal(lock.targetId, "red-a");
  toggleAimLock(lock, candidates, 1);
  assert.equal(lock.targetId, "red-b");
  toggleAimLock(lock, [], 2);
  assert.equal(lock.targetId, null);
});

test("dead, respawning or disappeared targets lose immediately; reacquisition needs a press", () => {
  const lock = createAimLockState();
  toggleAimLock(lock, [{ id: "red-a", eligible: true }], 0);
  updateAimLock(lock, [], [{ id: "red-a", hp: 0, respawn: 0 }], .1);
  assert.equal(lock.targetId, null);
  toggleAimLock(lock, [{ id: "red-a", eligible: true }], .2);
  updateAimLock(lock, [], [], .3);
  assert.equal(lock.targetId, null);
});

test("offscreen direction points to a stable viewport edge", () => {
  const direction = computeAimDirection({ x: 2, y: .25, z: 0 });
  assert.equal(direction.visible, false);
  assert.equal(direction.offscreen, true);
  assert.ok(direction.edgeX > 0);
  assert.ok(direction.edgeY > 0);
  assert.ok(Number.isFinite(direction.angle));
});
