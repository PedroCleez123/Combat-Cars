import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_FOLLOW_TUNING, createCameraFollowState, resetCameraFollowState, stepCameraFollow } from "../src/camera-follow.js";

const car = (forward, overrides = {}) => ({ x: 10, h: 4, z: -3, speed: 28, forward, ...overrides });

test("air roll does not rotate the camera horizon or move its focus sideways", () => {
  const state = createCameraFollowState();
  const level = stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }), 1 / 60);
  // A pure roll changes the chassis up/right vectors, not its forward vector.
  const rolled = stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }), 1 / 60);
  assert.equal(rolled.heading, level.heading);
  assert.deepEqual(rolled.position, level.position);
  assert.deepEqual(rolled.focus, level.focus);
});

test("near-vertical flips keep the previous heading and bound a later heading change", () => {
  const state = createCameraFollowState();
  stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }), 1 / 120);
  const vertical = stepCameraFollow(state, car({ x: .1, y: .995, z: .1 }), 1 / 120);
  assert.equal(vertical.heading, 0);
  const reversed = stepCameraFollow(state, car({ x: -1, y: 0, z: 0 }), 1 / 120);
  assert.ok(Math.abs(reversed.heading) <= CAMERA_FOLLOW_TUNING.headingRate / 120 + 1e-12);
});

test("air and wall follow modes slow heading and target response without tilting the horizon", () => {
  const state = createCameraFollowState();
  stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }, { surfaceType: "ground" }), 1 / 60);
  const airborne = stepCameraFollow(state, car({ x: 0, y: .7, z: 1 }, { surfaceType: "air", grounded: false }), 1 / 60);
  const onWall = stepCameraFollow(state, car({ x: -1, y: .2, z: 0 }, { surfaceType: "wall", wallRide: true, grounded: false }), 1 / 60);
  assert.equal(airborne.mode, "air");
  assert.equal(onWall.mode, "wall");
  assert.ok(airborne.headingRate < CAMERA_FOLLOW_TUNING.headingRate);
  assert.ok(onWall.headingRate < airborne.headingRate);
  assert.ok(onWall.positionSmoothing < airborne.positionSmoothing);
  assert.ok(onWall.focusSmoothing < airborne.focusSmoothing);
  assert.ok(Math.abs(onWall.heading - airborne.heading) <= CAMERA_FOLLOW_TUNING.wallHeadingRate / 60 + 1e-12);
});

test("a wall climb keeps the chase camera below the clean-practice ceiling", () => {
  const state = createCameraFollowState();
  stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }), 1 / 60);
  const climbing = stepCameraFollow(state, car({ x: .02, y: .999, z: 0 }, { x: 61, h: 23, cameraVerticalBounds: {
    minPositionY: 2.8, maxPositionY: 21.2, minFocusY: .8, maxFocusY: 22.2,
  } }), 1 / 60);
  assert.equal(climbing.heading, 0, "vertical forward retains the prior horizontal heading");
  assert.equal(climbing.position.y, 21.2);
  assert.equal(climbing.focus.y, 22.2);
  assert.ok(climbing.position.x < 61, "the camera remains behind the wall-climbing car");
});

test("pitch can bias the look height without importing roll into the camera target", () => {
  const up = stepCameraFollow(createCameraFollowState(), car({ x: 1, y: 1, z: 0 }));
  const down = stepCameraFollow(createCameraFollowState(), car({ x: 1, y: -1, z: 0 }));
  assert.ok(up.focus.y > down.focus.y);
  assert.ok(up.focus.y <= 4 + CAMERA_FOLLOW_TUNING.lookHeight + .75);
  assert.ok(down.focus.y >= 4 + CAMERA_FOLLOW_TUNING.lookHeight - .45);
});

test("camera follow can reset its heading at a respawn or connection boundary", () => {
  const state = createCameraFollowState();
  stepCameraFollow(state, car({ x: 0, y: 0, z: 1 }), 1 / 120);
  assert.notEqual(state.heading, 0);
  resetCameraFollowState(state);
  assert.deepEqual(state, { initialized: false, heading: 0 });
  const respawned = stepCameraFollow(state, car({ x: -1, y: 0, z: 0 }), 1 / 120);
  assert.ok(Math.abs(respawned.heading - Math.PI) < 1e-12);
});

test("cornered arena keeps the camera heading continuous from floor to wall", () => {
  const state = createCameraFollowState();
  const dt = 1 / 60;
  const floor = stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }, { surfaceType: "ground", grounded: true }), dt);
  const corner = stepCameraFollow(state, car({ x: .707, y: .35, z: .707 }, { surfaceType: "ground", grounded: true }), dt);
  const wall = stepCameraFollow(state, car({ x: 0, y: .707, z: 1 }, { surfaceType: "wall", wallRide: true, grounded: true }), dt);
  assert.equal(corner.mode, "ground", "the shallow corner remains a grounded follow mode");
  assert.equal(wall.mode, "wall");
  assert.ok(Math.abs(corner.heading - floor.heading) <= CAMERA_FOLLOW_TUNING.headingRate * dt + 1e-12);
  assert.ok(Math.abs(wall.heading - corner.heading) <= CAMERA_FOLLOW_TUNING.wallHeadingRate * dt + 1e-12);
  assert.ok(Number.isFinite(wall.position.x) && Number.isFinite(wall.position.y) && Number.isFinite(wall.position.z));
  assert.ok(Number.isFinite(wall.focus.x) && Number.isFinite(wall.focus.y) && Number.isFinite(wall.focus.z));
});
