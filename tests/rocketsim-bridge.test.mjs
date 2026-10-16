import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeBridgeInit,
  encodeBridgeCombatActive,
  encodeBridgeRespawn,
  encodeBridgeShutdown,
  encodeBridgeTick,
  encodeBridgeRaycast,
  normalizeBridgeStateFrame,
  normalizeBridgeRaycastFrame,
  parseBridgeLine,
  summarizeBridgeFrame,
} from "../src/rocketsim-protocol.js";
import { ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS } from "../src/rocketsim-backend.js";

test("RocketSim bridge leaves enough startup budget for a Windows watcher restart", () => {
  assert.equal(ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS, 250);
  assert.ok(ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS > 100);
});

test("RocketSim bridge protocol keeps the fixed-step contract", () => {
  const init = JSON.parse(encodeBridgeInit());
  assert.deepEqual(init, {
    type: "init",
    schemaVersion: 1,
    fixedStepHz: 120,
    arena: "clean-six-planes",
    cars: [{ id: 1, team: "blue" }],
  });
  const tick = JSON.parse(encodeBridgeTick(7, [{ id: 1, input: { throttle: 1, steer: -.25, jump: true, roll: .5 } }]));
  assert.equal(tick.type, "tick");
  assert.equal(tick.tick, 7);
  assert.deepEqual(tick.cars[0].input, {
    throttle: 1,
    steer: -.25,
    jump: true,
    boost: false,
    drift: false,
    airRoll: false,
    roll: .5,
  });
  assert.deepEqual(JSON.parse(encodeBridgeShutdown()), { type: "shutdown" });
  assert.deepEqual(JSON.parse(encodeBridgeRespawn(1)), { type: "respawn", id: 1 });
  assert.deepEqual(JSON.parse(encodeBridgeCombatActive(1, false)), { type: "combat-state", id: 1, active: false });
  const raycast = JSON.parse(encodeBridgeRaycast([{ id: 1, from: { x: -10, y: 0, z: 17 }, to: { x: 10, y: 0, z: 17 } }]));
  assert.deepEqual(raycast, { type: "raycast", segments: [{ id: 1, from: { x: -10, y: 0, z: 17 }, to: { x: 10, y: 0, z: 17 } }] });
});

test("RocketSim bridge protocol preserves independent IDs for a multicar tick", () => {
  const init = JSON.parse(encodeBridgeInit({ cars: [{ id: 1, team: "blue" }, { id: 2, team: "red" }] }));
  assert.deepEqual(init.cars, [{ id: 1, team: "blue" }, { id: 2, team: "red" }]);
  const tick = JSON.parse(encodeBridgeTick(1, [
    { id: 2, input: { throttle: -1, steer: .5 } },
    { id: 1, input: { throttle: 1, steer: -.5 } },
  ]));
  assert.deepEqual(tick.cars.map(car => car.id), [2, 1]);
  assert.equal(tick.cars[0].input.throttle, -1);
  assert.equal(tick.cars[1].input.throttle, 1);
  assert.throws(() => encodeBridgeInit({ cars: [{ id: 1, team: "blue" }, { id: 1, team: "red" }] }), /duplicate/);
  assert.throws(() => encodeBridgeTick(1, [{ id: 7, input: {} }]), /invalid/);
  assert.throws(() => encodeBridgeRespawn(7), /invalid/);
  assert.throws(() => encodeBridgeCombatActive(7, false), /invalid/);
  assert.throws(() => encodeBridgeRaycast([{ id: 1, from: { x: 0, y: 0, z: 0 }, to: { x: Infinity, y: 0, z: 0 } }]), /not finite/);
});

test("RocketSim raycast frames normalize finite static hits", () => {
  const frame = normalizeBridgeRaycastFrame({ type: "raycast-state", schemaVersion: 1, tick: 0, hits: [{ id: 1, hit: true, fraction: .5, point: { x: 0, y: 0, z: 17 }, normal: { x: -1, y: 0, z: 0 }, kind: "static" }] });
  assert.equal(frame.hits[0].fraction, .5);
  assert.equal(frame.hits[0].normal.x, -1);
  assert.throws(() => normalizeBridgeRaycastFrame({ type: "raycast-state", schemaVersion: 1, tick: 0, hits: [{ id: 1, hit: false, fraction: 2, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } }] }), /fraction is invalid/);
});

test("RocketSim state is normalized at the Node y-up boundary", () => {
  const frame = normalizeBridgeStateFrame({
    type: "state",
    schemaVersion: 1,
    fixedStepHz: 120,
    tick: 4,
    cars: [{
      id: 1,
      position: { x: 1, y: 2, z: 3 },
      velocity: { x: 4, y: 5, z: 6 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      localAngularVelocity: { pitch: 0, yaw: 0, roll: 0 },
      worldContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
      wheelContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
      grounded: true,
      wheelCount: 4,
      jumps: 2,
      jumpState: "grounded",
      secondJumpWindow: 0,
      dodgeTime: 0,
      dodgeDirection: { forward: 0, side: 0 },
      actionFlags: { hasJumped: false, hasDoubleJumped: false, hasFlipped: false },
      boost: 100,
    }],
  });
  assert.equal(frame.fixedStepHz, 120);
  assert.equal(frame.cars[0].grounded, true);
  assert.equal(frame.cars[0].position.y, 2);
  assert.deepEqual(frame.cars[0].worldContact, { hasContact: true, normal: { x: 0, y: 1, z: 0 } });
  assert.deepEqual(frame.cars[0].wheelContact, { hasContact: true, normal: { x: 0, y: 1, z: 0 } });
  assert.equal(summarizeBridgeFrame(frame), summarizeBridgeFrame(frame));
});

test("RocketSim bridge rejects malformed frames", () => {
  assert.throws(() => parseBridgeLine("{}"), /no type/);
  assert.throws(() => normalizeBridgeStateFrame({ type: "state", schemaVersion: 1, fixedStepHz: 120, tick: 1, cars: {} }), /cars is invalid/);
  assert.throws(() => normalizeBridgeStateFrame({
    type: "state", schemaVersion: 1, fixedStepHz: 120, tick: 1,
    cars: [{ id: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 0 }, jumpState: "airborne" }],
  }), /zero magnitude/);
  assert.throws(() => normalizeBridgeStateFrame({
    type: "state", schemaVersion: 1, fixedStepHz: 120, tick: 1,
    cars: [{ id: 1, position: { x: null, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, jumpState: "airborne" }],
  }), /position.x is not finite/);
});
