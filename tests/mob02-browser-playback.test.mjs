import assert from "node:assert/strict";
import test from "node:test";
import {
  createMob02BrowserPlayback,
  isMob02StableWallSupport,
  isMob02WallSupport,
  stepMob02BrowserPlayback,
} from "../src/mob02-browser-playback.js";

const floor = { grounded: true, wallRide: false, surfaceType: "ground", speed: 0, contacts: [{ wheelCount: 4 }] };
const wall = (speed = 42) => ({ grounded: true, wallRide: true, surfaceType: "wall", speed, contacts: [{ wheelCount: 2 }] });
const air = { grounded: false, wallRide: false, surfaceType: "air", speed: 30, contacts: [{ wheelCount: 0 }] };

test("MOB-02 starts with one restart request, drives to wall, then settles neutral", () => {
  const playback = createMob02BrowserPlayback();

  const first = stepMob02BrowserPlayback(playback, { now: 0, car: floor });
  assert.equal(first.restartRequested, true);
  assert.deepEqual(first.input, { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

  const drive = stepMob02BrowserPlayback(playback, { now: .02, car: floor });
  assert.equal(drive.phase, "drive");
  assert.equal(drive.restartRequested, false);
  assert.equal(drive.input.throttle, 1);
  assert.equal(drive.input.boost, true);

  const settling = stepMob02BrowserPlayback(playback, { now: 1, car: wall(64) });
  assert.equal(settling.phase, "settle");
  assert.deepEqual(settling.input, { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

  const stable = stepMob02BrowserPlayback(playback, { now: 1.1, car: wall(47.9) });
  assert.equal(stable.phase, "jump");
  assert.equal(stable.input.jump, true);
  assert.equal(stable.input.boost, false);
});

test("MOB-02 keeps the jump pulse for 0.09 seconds and then air-controls", () => {
  const playback = createMob02BrowserPlayback();
  stepMob02BrowserPlayback(playback, { now: 0, car: floor });
  stepMob02BrowserPlayback(playback, { now: .1, car: wall(40) });
  const jump = stepMob02BrowserPlayback(playback, { now: .2, car: wall(40) });
  assert.equal(jump.phase, "jump");
  assert.equal(jump.input.jump, true);

  const stillJumping = stepMob02BrowserPlayback(playback, { now: .289, car: air });
  assert.equal(stillJumping.phase, "jump");
  assert.equal(stillJumping.input.jump, true);

  const aerial = stepMob02BrowserPlayback(playback, { now: .29, car: air });
  assert.equal(aerial.phase, "aerial");
  assert.deepEqual(aerial.input, { throttle: -1, steer: 1, jump: false, boost: true, drift: false, airRoll: true, roll: 1, fire: false });
});

test("MOB-02 aerial lasts about 0.36 seconds, recovers, and finishes on floor", () => {
  const playback = createMob02BrowserPlayback();
  stepMob02BrowserPlayback(playback, { now: 0, car: floor });
  stepMob02BrowserPlayback(playback, { now: .1, car: wall(40) });
  stepMob02BrowserPlayback(playback, { now: .2, car: wall(40) });
  stepMob02BrowserPlayback(playback, { now: .29, car: air });

  const aerial = stepMob02BrowserPlayback(playback, { now: .5, car: air });
  assert.equal(aerial.phase, "aerial");
  const recover = stepMob02BrowserPlayback(playback, { now: .65, car: air });
  assert.equal(recover.phase, "recover");
  assert.equal(recover.input.throttle, 0);

  const done = stepMob02BrowserPlayback(playback, { now: .66, car: floor });
  assert.equal(done.phase, "done");
  assert.equal(done.done, true);
  assert.deepEqual(done.input, recover.input);
  const after = stepMob02BrowserPlayback(playback, { now: 2, car: floor });
  assert.equal(after.done, true);
  assert.equal(after.restartRequested, false);
});

test("MOB-02 bounds recovery when RocketSim settles on the chassis", () => {
  const playback = createMob02BrowserPlayback({ recoverySeconds: .2 });
  stepMob02BrowserPlayback(playback, { now: 0, car: floor });
  stepMob02BrowserPlayback(playback, { now: .1, car: wall(40) });
  stepMob02BrowserPlayback(playback, { now: .2, car: wall(40) });
  stepMob02BrowserPlayback(playback, { now: .29, car: air });
  stepMob02BrowserPlayback(playback, { now: .65, car: air });
  const result = stepMob02BrowserPlayback(playback, { now: .86, car: air });
  assert.equal(result.done, true);
  assert.equal(result.recoveryResult, "no-wheel-support");
});

test("MOB-02 wall predicates require authoritative support and settle speed", () => {
  assert.equal(isMob02WallSupport(wall(60)), true);
  assert.equal(isMob02WallSupport({ ...wall(), contacts: [{ wheelCount: 0 }] }), false);
  assert.equal(isMob02StableWallSupport(wall(47.99)), true);
  assert.equal(isMob02StableWallSupport(wall(48)), false);
  assert.equal(isMob02StableWallSupport(wall(47), 50), true);
  assert.equal(isMob02WallSupport({ ...wall(), surfaceType: "ground" }), false);
});
