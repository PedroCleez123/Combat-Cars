import test from "node:test";
import assert from "node:assert/strict";
import { bridgeArenaForInitialCondition, bridgeFrameToCurveSample, createBridgeActionTracker } from "../src/rocketsim-curve-capture.js";

const car = {
  id: 1,
  position: { x: 1.234567, y: 2, z: 3 },
  velocity: { x: 4, y: 5, z: 6 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  localAngularVelocity: { pitch: 7, yaw: 8, roll: 9 },
  grounded: false,
  jumpState: "dodge",
  jumps: 0,
  secondJumpWindow: 1.1,
  dodgeTime: .2,
  dodgeDirection: { forward: .5, side: -.5 },
  actionFlags: { hasJumped: true, hasDoubleJumped: false, hasFlipped: true },
};

test("RocketSim bridge samples use the mobility-curve schema and action edges", () => {
  const tracker = createBridgeActionTracker();
  const first = bridgeFrameToCurveSample({ frame: 12, input: { throttle: 1, jump: true }, car, actionTracker: tracker });
  const second = bridgeFrameToCurveSample({ frame: 13, input: {}, car, actionTracker: tracker });
  assert.deepEqual(first.input, { throttle: 1, steer: 0, jump: true, boost: false, drift: false, airRoll: false, roll: 0 });
  assert.equal(first.time, .1);
  assert.deepEqual(first.state.localAngularVelocity, { pitch: 7, yaw: 8, roll: 9 });
  assert.deepEqual(first.state.actionSerials, { jump: 1, doubleJump: 0, dodge: 1, respawn: 0 });
  assert.deepEqual(second.state.actionSerials, first.state.actionSerials);
});

test("RocketSim bridge curve samples reject a noncanonical car", () => {
  assert.throws(() => bridgeFrameToCurveSample({ frame: 1, input: {}, car: { ...car, id: 2 }, actionTracker: createBridgeActionTracker() }), /car 1/);
});

test("RocketSim bridge maps every canonical initial condition to an explicit profile", () => {
  assert.equal(bridgeArenaForInitialCondition("grounded"), "clean-six-planes");
  assert.equal(bridgeArenaForInitialCondition("airborne"), "air-void");
  assert.equal(bridgeArenaForInitialCondition("second-action-airborne"), "second-action-airborne");
  assert.throws(() => bridgeArenaForInitialCondition("wall"), /Unsupported/);
});
