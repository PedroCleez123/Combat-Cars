import assert from "node:assert/strict";
import test from "node:test";
import { SnapshotInterpolator, interpolateState, slerpQuaternion } from "../src/snapshot-interpolation.js";

const snapshot = (time, car = {}) => ({
  time, settings: { arena: "calibration" },
  cars: [{ id: "pilot", x: 0, h: 0, z: 0, respawn: 0, orientation: { x: 0, y: 0, z: 0, w: 1 }, ...car }]
});

test("snapshot interpolation blends a continuous car pose and uses the quaternion short arc", () => {
  const first = snapshot(1);
  const second = snapshot(1.1, { x: 10, h: 4, z: -2, orientation: { x: 0, y: -Math.SQRT1_2, z: 0, w: -Math.SQRT1_2 } });
  const blended = interpolateState(first, second, .5).cars[0];
  assert.equal(blended.x, 5); assert.equal(blended.h, 2); assert.equal(blended.z, -1);
  const headingX = 1 - 2 * (blended.orientation.y ** 2 + blended.orientation.z ** 2);
  assert.ok(Math.abs(headingX - Math.SQRT1_2) < .001, `expected a 45° short-arc turn, got forward X=${headingX}`);
  assert.ok(Math.abs(Math.hypot(...Object.values(blended.orientation)) - 1) < 1e-12);
});

test("snapshot interpolation preserves discontinuities such as respawn and teleports", () => {
  const first = snapshot(1);
  const respawn = snapshot(1.1, { x: 40, h: 0, respawn: 1.2 });
  assert.equal(interpolateState(first, respawn, .5).cars[0].x, 40);
  const teleport = snapshot(1.1, { x: 20 });
  assert.equal(interpolateState(first, teleport, .5).cars[0].x, 20);
});

test("the temporal buffer advances from packet arrival, resets on a match discontinuity, and never extrapolates", () => {
  const buffer = new SnapshotInterpolator(.05);
  buffer.push(snapshot(1), 10);
  buffer.push(snapshot(1.1, { x: 10 }), 10.1);
  assert.equal(buffer.sample(10.1).cars[0].x, 5);
  assert.equal(buffer.sample(10.15).cars[0].x, 10, "render time advances toward the newest state between packets");
  buffer.push(snapshot(1.2, { x: 20 }), 10.2);
  assert.ok(Math.abs(buffer.sample(10.2).cars[0].x - 15) < 1e-10);
  assert.equal(buffer.sample(11).cars[0].x, 20, "a stalled connection freezes on the newest state");
  buffer.push(snapshot(.01, { x: 80 }), 11.1);
  assert.equal(buffer.sample(11.1).cars[0].x, 80, "a reset must not blend a previous round into a new one");
});

test("slerp normalizes a near-identical pair", () => {
  const result = slerpQuaternion({ x: 0, y: 0, z: 0, w: 2 }, { x: 0, y: 0, z: 0, w: 3 }, .5);
  assert.deepEqual(result, { x: 0, y: 0, z: 0, w: 1 });
});
