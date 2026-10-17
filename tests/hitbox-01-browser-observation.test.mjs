import assert from "node:assert/strict";
import test from "node:test";
import {
  authoritativeUpY,
  buildHitbox01Report,
  createHitbox01BrowserObservation,
  stepHitbox01BrowserObservation,
} from "../src/hitbox-01-browser-observation.js";

const car = (overrides = {}) => ({
  grounded: true,
  surfaceType: "ground",
  pitch: 0,
  roll: 0,
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  actionSerials: { jump: 0, respawn: 0 },
  ...overrides,
});

const options = { movementBackend: "rocketsim", bridgeRevision: 19, playerCount: 1 };

function confirmRestart(playback) {
  assert.equal(stepHitbox01BrowserObservation(playback, { ...options, now: 0, snapshotTime: 0, car: car() }).restartRequested, true);
  return stepHitbox01BrowserObservation(playback, { ...options, now: .01, snapshotTime: 1, car: car({ actionSerials: { jump: 0, respawn: 1 } }) });
}

test("HITBOX-01 measures the authoritative up vector from a quaternion", () => {
  assert.equal(authoritativeUpY(car()), 1);
  assert.equal(authoritativeUpY(car({ orientation: { x: 1, y: 0, z: 0, w: 0 } })), -1);
  assert.equal(authoritativeUpY(car({ orientation: null, roll: Math.PI })), -1);
});

test("HITBOX-01 requires RocketSim R19 and an isolated pilot before restarting", () => {
  const js = createHitbox01BrowserObservation();
  const manualInput = { throttle: 1, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false };
  const jsResult = stepHitbox01BrowserObservation(js, { now: 0, car: car(), movementBackend: "js", manualInput });
  assert.equal(jsResult.report.outcome, "requires-rocketsim");
  assert.deepEqual(jsResult.input, manualInput, "an incompatible backend leaves the player in control");
  const r13 = createHitbox01BrowserObservation();
  const r13Result = stepHitbox01BrowserObservation(r13, { ...options, bridgeRevision: 13, now: 0, car: car(), manualInput });
  assert.equal(r13Result.report.outcome, "requires-r19");
  assert.deepEqual(r13Result.input, manualInput, "an older bridge leaves the player in control");
  const shared = createHitbox01BrowserObservation();
  const waiting = stepHitbox01BrowserObservation(shared, { ...options, playerCount: 2, now: 0, car: car(), manualInput });
  assert.equal(waiting.phase, "awaiting-solo-player");
  assert.equal(waiting.restartRequested, false);
  assert.deepEqual(waiting.input, manualInput, "a shared session stays playable while HITBOX-01 waits for isolation");
});

test("HITBOX-01 holds jump then rotates only after an authoritative restart", () => {
  const playback = createHitbox01BrowserObservation({ settleSeconds: .01, jumpPulseSeconds: .01 });
  assert.equal(confirmRestart(playback).phase, "settle");
  const launched = stepHitbox01BrowserObservation(playback, { ...options, now: .03, snapshotTime: 2, car: car({ actionSerials: { jump: 0, respawn: 1 } }) });
  assert.equal(launched.phase, "jump");
  assert.equal(launched.input.jump, true);
  const rotating = stepHitbox01BrowserObservation(playback, { ...options, now: .06, snapshotTime: 3, car: car({ grounded: false, surfaceType: "air", actionSerials: { jump: 1, respawn: 1 } }) });
  assert.equal(rotating.phase, "rotate");
  assert.equal(rotating.input.airRoll, true);
  assert.equal(rotating.input.roll, 1);
});

test("HITBOX-01 reports an inverted authoritative ground contact without judging the pixels", () => {
  const playback = createHitbox01BrowserObservation();
  playback.restartRequested = true;
  playback.restartConfirmed = true;
  playback.phase = "rotate";
  playback.phaseStartedAt = 0;
  playback.lastSnapshotToken = "0";
  playback.lastSnapshotAt = 0;
  const inverted = car({ grounded: false, surfaceType: "air", orientation: { x: 1, y: 0, z: 0, w: 0 }, actionSerials: { jump: 1, respawn: 1 } });
  const observing = stepHitbox01BrowserObservation(playback, { ...options, now: .1, snapshotTime: 1, car: inverted });
  assert.equal(observing.phase, "observe-contact");
  assert.equal(observing.report.inversionObserved, true);
  const contacted = stepHitbox01BrowserObservation(playback, {
    ...options,
    now: .2,
    snapshotTime: 2,
    manualInput: { throttle: 1, steer: -.5, jump: false, boost: true, drift: true, airRoll: false, roll: 0, fire: false },
    car: car({
      grounded: false,
      surfaceType: "air",
      orientation: { x: 1, y: 0, z: 0, w: 0 },
      contacts: [{ kind: "air", normal: { x: 0, y: 1, z: 0 }, wheelCount: 0 }],
      actionSerials: { jump: 1, respawn: 1 },
    }),
  });
  assert.equal(contacted.done, true);
  assert.equal(contacted.report.invertedGroundContact, true);
  assert.equal(contacted.report.outcome, "inverted-ground-contact");
  assert.equal(buildHitbox01Report(playback).outcome, "inverted-ground-contact");
  assert.deepEqual(contacted.input, {
    throttle: 1, steer: -.5, jump: false, boost: true, drift: true,
    airRoll: false, roll: 0, fire: false,
  }, "the player regains control after contact; the observation never auto-uprights");
});
