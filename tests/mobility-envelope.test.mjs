import assert from "node:assert/strict";
import test from "node:test";
import { runMobilityEnvelope } from "../src/mobility-probes.js";

test("the CAL-04 mobility envelope is deterministic and completes every measured manoeuvre", () => {
  const first = runMobilityEnvelope();
  const second = runMobilityEnvelope();
  assert.deepEqual(second, first);
  assert.equal(first.fixedStepHz, 120);
  assert.equal(first.profile, "calibration");

  assert.equal(first.ground.boostReachedSupersonic, true);
  assert.equal(first.ground.gripQuarterTurn.reached, true);
  assert.equal(first.ground.powerslideQuarterTurn.reached, true);
  assert.equal(first.ground.powerslideQuarterTurn.recovered, true);
  assert.ok(first.ground.powerslideQuarterTurn.seconds < first.ground.gripQuarterTurn.seconds,
    "powerslide must turn the chassis sooner than grip steering in this envelope");
  assert.ok(first.ground.powerslideQuarterTurn.effectiveRadius < first.ground.gripQuarterTurn.effectiveRadius,
    "powerslide must draw a tighter arc than grip steering in this envelope");
  // This manoeuvre holds throttle through the turn. It should tolerate the
  // small, measured motor gain while still rejecting an implausible speed
  // jump caused by a steering/contact regression.
  assert.ok(first.ground.gripQuarterTurn.speedRetention > 0 && first.ground.gripQuarterTurn.speedRetention <= 1.15);
  assert.ok(first.ground.powerslideQuarterTurn.speedRetention > 0 && first.ground.powerslideQuarterTurn.speedRetention <= 1.1);
  for (const band of Object.values(first.ground.speedBands)) {
    for (const turn of Object.values(band)) {
      assert.equal(turn.reached, true, "each speed-band trajectory must complete 45 degrees");
      assert.ok(turn.effectiveRadius > 0);
      assert.ok(turn.exitSpeed > 0);
      assert.ok(turn.peakSpeed >= turn.entrySpeed);
    }
    assert.ok(band.powerslide.effectiveRadius < band.grip.effectiveRadius,
      "powerslide must remain tighter than grip steering at each speed band");
    assert.ok(band.gripBoost.peakSpeed >= band.grip.peakSpeed,
      "boost must not slow a grip trajectory");
  }

  assert.equal(first.actions.landedWithTwoJumps, true);
  assert.equal(first.actions.dodgeCommitted, true);
  assert.ok(first.actions.heldJumpApex > 1);
  assert.ok(first.actions.forwardDodgeDistanceAt0175Seconds > 1);
  assert.equal(first.actions.secondJump.verticalDouble.committedDoubleJump, true);
  assert.equal(first.actions.secondJump.forwardDodge.committedDodge, true);
  assert.equal(first.actions.secondJump.sideDodge.committedDodge, true);
  assert.equal(first.actions.secondJump.directedLiftBelowVertical, true);
  assert.equal(first.actions.secondJump.levelDirectionsMatch, true);
  assert.ok(first.actions.secondJump.forwardDodge.initialVerticalVelocityDelta <= 0,
    "a directed dodge must not add a vertical impulse");
  assert.ok(first.actions.secondJump.sideDodge.initialVerticalVelocityDelta <= 0,
    "a side dodge must not add a vertical impulse");

  for (const axis of Object.values(first.air)) {
    assert.equal(axis.quarterTurnReached, true, `${axis.label} must reach a quarter turn`);
    assert.equal(axis.releaseSettled, true, `${axis.label} must settle after release`);
    assert.equal(axis.reverseReached, true, `${axis.label} must cross neutral after reversal`);
    assert.ok(axis.quarterTurnSeconds > 0 && axis.quarterTurnSeconds < 1.5);
    assert.ok(axis.releaseToNeutralSeconds > 0 && axis.releaseToNeutralSeconds < 1.5);
    assert.ok(axis.reverseToNeutralSeconds > 0 && axis.reverseToNeutralSeconds < 1.5);
  }
});
