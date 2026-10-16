import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMobAir01Report,
  createMobAir01BrowserPlayback,
  stepMobAir01BrowserPlayback,
} from "../src/mob-air-01-browser-playback.js";

const car = (overrides = {}) => ({
  grounded: true,
  surfaceType: "ground",
  jumpState: "grounded",
  speed: 0,
  actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 },
  ...overrides,
});

function confirmRestart(playback, now = .01) {
  stepMobAir01BrowserPlayback(playback, { now: 0, car: car() });
  return stepMobAir01BrowserPlayback(playback, { now, car: car({ actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 } }) });
}

test("MOB-AIR-01 emits a held first jump then a released input", () => {
  const playback = createMobAir01BrowserPlayback({ settleSeconds: .1 });
  assert.equal(stepMobAir01BrowserPlayback(playback, { now: 0, car: car() }).restartRequested, true);
  assert.equal(confirmRestart(playback).phase, "settle");
  assert.equal(stepMobAir01BrowserPlayback(playback, { now: .12, car: car({ actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 } }) }).phase, "first-jump");
  assert.equal(stepMobAir01BrowserPlayback(playback, { now: .13, car: car({ jumpState: "first-jump", grounded: false, actionSerials: { jump: 1, doubleJump: 0, dodge: 0, respawn: 1 } }) }).input.jump, true);
  assert.equal(stepMobAir01BrowserPlayback(playback, { now: .23, car: car({ jumpState: "first-jump", grounded: false, actionSerials: { jump: 1, doubleJump: 0, dodge: 0, respawn: 1 } }) }).phase, "release");
  assert.equal(stepMobAir01BrowserPlayback(playback, { now: .25, car: car({ jumpState: "first-jump", grounded: false, actionSerials: { jump: 1, doubleJump: 0, dodge: 0, respawn: 1 } }) }).input.jump, false);
});

test("MOB-AIR-01 uses WASD direction on the second jump and air roll afterwards", () => {
  const playback = createMobAir01BrowserPlayback({ settleSeconds: 0, firstJumpSeconds: .01, releaseSeconds: .01, directedJumpSeconds: .02, airControlSeconds: .1 });
  confirmRestart(playback);
  stepMobAir01BrowserPlayback(playback, { now: .02, car: car({ actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 } }) });
  stepMobAir01BrowserPlayback(playback, { now: .03, car: car({ grounded: false, jumpState: "first-jump", actionSerials: { jump: 1, doubleJump: 0, dodge: 0, respawn: 1 } }) });
  stepMobAir01BrowserPlayback(playback, { now: .05, car: car({ grounded: false, jumpState: "first-jump", actionSerials: { jump: 1, doubleJump: 0, dodge: 0, respawn: 1 } }) });
  const directed = stepMobAir01BrowserPlayback(playback, { now: .06, car: car({ grounded: false, jumpState: "dodge", actionSerials: { jump: 1, doubleJump: 0, dodge: 1, respawn: 1 } }) });
  assert.equal(directed.phase, "directed-second-jump");
  assert.equal(directed.input.jump, true);
  assert.equal(directed.input.throttle, 1);
  assert.equal(directed.input.steer, 1);
  const air = stepMobAir01BrowserPlayback(playback, { now: .09, car: car({ grounded: false, jumpState: "dodge", actionSerials: { jump: 1, doubleJump: 0, dodge: 1, respawn: 1 } }) });
  assert.equal(air.phase, "air-control");
  assert.equal(air.input.airRoll, true);
  assert.equal(air.input.boost, true);
});

test("MOB-AIR-01 report records native action serials and recovery", () => {
  const playback = createMobAir01BrowserPlayback();
  playback.phase = "done";
  playback.done = true;
  playback.recoveryResult = "wheel-support";
  playback.observed = { airborne: true, firstJump: true, doubleJump: true, dodge: true, maxSpeed: 42, lastJumpState: "grounded", lastSurface: "ground", finalCar: null };
  assert.deepEqual(buildMobAir01Report(playback), {
    phase: "done", dodgeDirection: "diagonal", done: true, restartConfirmed: false, firstJumpObserved: true, directedSecondJumpObserved: true,
    dodgeObserved: true, airborneObserved: true, recovered: true, recoveryResult: "wheel-support",
    maxSpeed: 42, lastJumpState: "grounded", lastSurface: "ground",
  });
});

test("MOB-AIR-01 marks a landing without action serials as incomplete evidence", () => {
  const playback = createMobAir01BrowserPlayback();
  playback.phase = "recover";
  playback.phaseStartedAt = 0;
  playback.restartRequested = true;
  playback.restartConfirmed = true;
  playback.observed = { airborne: false, firstJump: false, doubleJump: false, dodge: false, maxSpeed: 0, lastJumpState: "grounded", lastSurface: "ground", finalCar: null };
  const result = stepMobAir01BrowserPlayback(playback, { now: .1, snapshotTime: 1, car: car() });
  assert.equal(result.done, true);
  assert.equal(result.report.recoveryResult, "actions-missing");
  assert.equal(result.report.recovered, false);
});

test("MOB-AIR-02 exposes front and side dodge inputs without changing the solver", () => {
  const front = createMobAir01BrowserPlayback({ dodgeDirection: "front" });
  const side = createMobAir01BrowserPlayback({ dodgeDirection: "side" });
  assert.equal(front.dodgeDirection, "front");
  assert.equal(side.dodgeDirection, "side");
  assert.equal(buildMobAir01Report(front).dodgeDirection, "front");
  assert.equal(buildMobAir01Report(side).dodgeDirection, "side");
});

test("MOB-AIR-01 treats a directed dodge as the directed second action", () => {
  const playback = createMobAir01BrowserPlayback();
  playback.phase = "done";
  playback.done = true;
  playback.observed = { airborne: true, firstJump: true, doubleJump: false, dodge: true, maxSpeed: 1, lastJumpState: "dodge", lastSurface: "air", finalCar: null };
  assert.equal(buildMobAir01Report(playback).directedSecondJumpObserved, true);
});

test("MOB-AIR-01 waits for an authoritative respawn before sending jump input", () => {
  const playback = createMobAir01BrowserPlayback({ restartTimeoutSeconds: .1 });
  const first = stepMobAir01BrowserPlayback(playback, { now: 0, car: car() });
  assert.equal(first.phase, "awaiting-restart");
  assert.equal(first.restartRequested, true);
  assert.equal(stepMobAir01BrowserPlayback(playback, { now: .05, car: car() }).input.jump, false);
  const timedOut = stepMobAir01BrowserPlayback(playback, { now: .11, car: car() });
  assert.equal(timedOut.done, true);
  assert.equal(timedOut.report.recoveryResult, "restart-unconfirmed");
});

test("MOB-AIR-01 waits for its local authoritative car before requesting a restart", () => {
  const playback = createMobAir01BrowserPlayback();
  const pending = stepMobAir01BrowserPlayback(playback, { now: 0, car: null });
  assert.equal(pending.restartRequested, false);
  assert.equal(playback.restartRequested, false);
  const ready = stepMobAir01BrowserPlayback(playback, { now: .1, car: car() });
  assert.equal(ready.restartRequested, true);
  assert.equal(playback.phase, "awaiting-restart");
});

test("MOB-AIR-01 waits for one pilot before it can restart a shared match", () => {
  const playback = createMobAir01BrowserPlayback();
  const shared = stepMobAir01BrowserPlayback(playback, { now: 0, playerCount: 2, car: car() });
  assert.equal(shared.phase, "awaiting-solo-player");
  assert.equal(shared.restartRequested, false);
  const ready = stepMobAir01BrowserPlayback(playback, { now: .1, playerCount: 1, car: car() });
  assert.equal(ready.restartRequested, true);
  assert.equal(ready.phase, "awaiting-restart");
});

test("MOB-AIR-01 stops cleanly if another pilot joins mid-campaign", () => {
  const playback = createMobAir01BrowserPlayback();
  stepMobAir01BrowserPlayback(playback, { now: 0, playerCount: 1, car: car() });
  const stopped = stepMobAir01BrowserPlayback(playback, { now: .1, playerCount: 2, car: car() });
  assert.equal(stopped.done, true);
  assert.equal(stopped.report.recoveryResult, "session-not-isolated");
  assert.equal(stopped.input.jump, false);
});

test("MOB-AIR-01 holds its current input and reports a stalled authoritative snapshot", () => {
  const playback = createMobAir01BrowserPlayback({ settleSeconds: .001, snapshotStallSeconds: .1 });
  stepMobAir01BrowserPlayback(playback, { now: 0, snapshotTime: 0, car: car() });
  stepMobAir01BrowserPlayback(playback, { now: .01, snapshotTime: 1, car: car({ actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 } }) });
  const firstJump = stepMobAir01BrowserPlayback(playback, { now: .02, snapshotTime: 2, car: car({ actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 } }) });
  assert.equal(firstJump.phase, "first-jump");
  const held = stepMobAir01BrowserPlayback(playback, { now: .03, snapshotTime: 2, car: car({ actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 } }) });
  assert.equal(held.phase, "first-jump");
  assert.equal(held.input.jump, true);
  const stalled = stepMobAir01BrowserPlayback(playback, { now: .13, snapshotTime: 2, car: car({ actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 } }) });
  assert.equal(stalled.done, true);
  assert.equal(stalled.report.recoveryResult, "snapshot-stalled");
});
