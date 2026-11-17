import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS,
  MOBILITY_LAN_CURVE_SCENARIOS,
  assertMobilityLanCurveScenario,
  mobilityLanCurveInputAtSnapshot,
  mobilityLanCurveManifest,
} from "../src/mobility-lan-curve-contract.js";
import { lanStateToCurveSample } from "../src/mobility-lan-curve-capture.js";

test("LAN mobility curve scenarios use explicit packet cadence and fit 1.2 seconds", () => {
  const manifest = mobilityLanCurveManifest();
  assert.equal(manifest.snapshotHz, 60);
  assert.equal(manifest.nativeFixedStepHz, 120);
  assert.equal(manifest.nativeTicksPerSnapshot, 2);
  assert.equal(manifest.durationSnapshots, 72);
  assert.deepEqual(manifest.scenarios.map(scenario => scenario.id), ["dodge-side", "dodge-diagonal-roll"]);
  for (const scenario of MOBILITY_LAN_CURVE_SCENARIOS) {
    assert.equal(assertMobilityLanCurveScenario(scenario), scenario);
    assert.equal(scenario.phases.reduce((total, phase) => total + phase.snapshots, 0), MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS);
  }
  assert.deepEqual(mobilityLanCurveInputAtSnapshot("dodge-side", 0), { throttle: 0, steer: 0, jump: true, boost: false, drift: false, airRoll: false, roll: 0 });
  assert.deepEqual(mobilityLanCurveInputAtSnapshot("dodge-side", 6), { throttle: 0, steer: 1, jump: true, boost: false, drift: false, airRoll: false, roll: 0 });
  assert.equal(mobilityLanCurveInputAtSnapshot("dodge-side", 72), null);
});

test("authoritative LAN car state is converted without recreating physics", () => {
  const sample = lanStateToCurveSample({
    frame: 1,
    time: 0.5,
    input: { steer: 1, jump: true },
    car: {
      x: 1.23456, h: 2.34567, z: 3.45678,
      velocity: { x: 4, y: 5, z: 6 },
      angularVelocity: { pitch: 7, yaw: 8, roll: 9 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      grounded: false, jumpState: "dodge", jumps: 0,
      jumpWindowRemaining: 1.1, dodgeRemaining: .2,
      dodgeDirection: { forward: 0, side: 1 },
      actionSerials: { jump: 1, doubleJump: 0, dodge: 1, respawn: 1 },
    },
  });
  assert.equal(sample.time, .5);
  assert.deepEqual(sample.input, { throttle: 0, steer: 1, jump: true, boost: false, drift: false, airRoll: false, roll: 0 });
  assert.deepEqual(sample.state.position, { x: 1.2346, y: 2.3457, z: 3.4568 });
  assert.deepEqual(sample.state.actionSerials, { jump: 1, doubleJump: 0, dodge: 1, respawn: 1 });
});
