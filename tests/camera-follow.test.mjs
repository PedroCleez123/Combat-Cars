import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_FOLLOW_TUNING, cameraFollowInput, createCameraFollowState, resetCameraFollowState, stepCameraFollow } from "../src/camera-follow.js";

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

test("chase framing is closer while keeping the car clear below the camera-to-focus line", () => {
  const target = stepCameraFollow(createCameraFollowState(), car({ x: 1, y: 0, z: 0 }), 1 / 60);
  const horizontalDistance = Math.hypot(target.position.x - 10, target.position.z + 3);
  const verticalDistance = target.position.y - 4;
  const cameraDistance = Math.hypot(horizontalDistance, verticalDistance);
  const previousHorizontalDistance = 12.5 + 28 * .055;
  const previousVerticalDistance = 6.7 + 4 * .35;
  const previousCameraDistance = Math.hypot(previousHorizontalDistance, previousVerticalDistance);

  assert.ok(cameraDistance < previousCameraDistance * .85, "the standard-speed camera is perceptibly closer than the previous framing");
  assert.ok(target.position.y > 4, "the camera remains above the car");
  const focusDistance = Math.hypot(target.focus.x - target.position.x, target.focus.z - target.position.z);
  const carCrossing = horizontalDistance / focusDistance;
  const viewLineHeightAtCar = target.position.y + (target.focus.y - target.position.y) * carCrossing;
  assert.ok(viewLineHeightAtCar > 4 + 2, "the sight line clears the car instead of running through its roof");
  assert.ok(Math.abs(target.position.x - (10 - CAMERA_FOLLOW_TUNING.chaseDistance - 28 * CAMERA_FOLLOW_TUNING.chaseSpeedDistance)) < 1e-12);
  assert.ok(Math.abs(target.focus.x - (10 + CAMERA_FOLLOW_TUNING.lookAhead)) < 1e-12);
  assert.equal(target.positionSmoothing, CAMERA_FOLLOW_TUNING.chasePositionSmoothing);
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

test("camera input preserves authoritative airborne and wall-contact mode", () => {
  const airborne = cameraFollowInput({ x: 1, h: 2, z: 3, forward: { x: 1, y: 0, z: 0 }, grounded: false, surfaceType: "air" });
  const wall = cameraFollowInput({ x: 1, h: 2, z: 3, forward: { x: 1, y: 0, z: 0 }, grounded: false, surfaceType: "wall", wallRide: true });
  assert.equal(stepCameraFollow(createCameraFollowState(), airborne, 1 / 60).mode, "air");
  assert.equal(stepCameraFollow(createCameraFollowState(), wall, 1 / 60).mode, "wall");
});

test("surface-aware camera output follows a wall normal without flipping the horizon", () => {
  const state = createCameraFollowState();
  const floor = stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }, {
    grounded: true,
    surfaceType: "ground",
    surfaceNormal: { x: 0, y: 1, z: 0 },
  }), 1 / 60);
  assert.ok(Math.abs(floor.up.x) < 1e-9 && Math.abs(floor.up.y - 1) < 1e-9 && Math.abs(floor.up.z) < 1e-9);

  const wall = stepCameraFollow(state, car({ x: 0, y: 0, z: 1 }, {
    grounded: true,
    surfaceType: "wall",
    wallRide: true,
    surfaceNormal: { x: -1, y: 0, z: 0 },
  }), 1 / 60);
  assert.ok(Number.isFinite(wall.up.x) && Number.isFinite(wall.up.y) && Number.isFinite(wall.up.z));
  assert.ok(wall.up.x < -0.05, "the wall support normal contributes to the camera up vector");
  assert.ok(wall.up.y > 0, "the horizon transitions through the shortest readable hemisphere");
  assert.ok(Math.abs(wall.up.x) < .9, "one frame cannot roll the view by a full quarter turn");
});

test("surface-aware camera returns smoothly to world up after leaving a wall", () => {
  const state = createCameraFollowState();
  stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }, {
    grounded: true,
    surfaceType: "wall",
    wallRide: true,
    surfaceNormal: { x: -1, y: 0, z: 0 },
  }), 1 / 60);
  const air = stepCameraFollow(state, car({ x: 1, y: 0, z: 0 }, {
    grounded: false,
    surfaceType: "air",
    surfaceNormal: null,
  }), 1 / 60);
  assert.ok(air.up.y > 0, "air recovery remains in the readable hemisphere");
  assert.ok(Math.abs(air.up.x) < .9, "air recovery avoids a horizon flip");
  assert.ok(air.up.x > -0.85, "air recovery moves back toward world up");
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
  assert.deepEqual(state, {
    initialized: false,
    heading: 0,
    up: { x: 0, y: 1, z: 0 },
    enemyBlend: 0,
    lastTargetHeading: 0,
    lastTarget: null,
  });
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

test("Enemy Cam keeps Car-Cam framing while it turns the local rig toward a rival", () => {
  const state = createCameraFollowState();
  const local = car({ x: 1, y: 0, z: 0 }, { grounded: true, surfaceType: "ground" });
  const carCam = stepCameraFollow(state, local, 1 / 60);
  const lockedInput = cameraFollowInput({
    ...local,
    followTarget: { id: "red-a", x: 10, h: 5, z: 37 },
  });
  const firstLocked = stepCameraFollow(state, lockedInput, 1 / 60);
  assert.equal(firstLocked.focusMode, "enemy");
  assert.equal(firstLocked.targetId, "red-a");
  assert.ok(firstLocked.heading > carCam.heading, "entry turns toward the rival");
  assert.ok(firstLocked.enemyBlend > 0 && firstLocked.enemyBlend < 1, "entry is a transition rather than an instant camera replacement");
  assert.ok(firstLocked.heading < Math.PI / 2, "entry does not snap to the rival bearing");
  assert.equal(firstLocked.fov, carCam.fov, "a target lock does not change the projection or apparent zoom");
  assert.equal(firstLocked.focusSmoothing, carCam.focusSmoothing, "lock entry retains the Car-Cam focus response");
  assert.ok(Math.hypot(firstLocked.position.x - carCam.position.x, firstLocked.position.z - carCam.position.z) < 1, "the first frame only begins a bounded pivot around the local car");
  assert.ok(Math.hypot(firstLocked.focus.x - carCam.focus.x, firstLocked.focus.z - carCam.focus.z) < .5, "the local focus moves continuously with that pivot");

  let enemyCam = firstLocked;
  for (let frame = 0; frame < 240; frame += 1) enemyCam = stepCameraFollow(state, lockedInput, 1 / 60);
  assert.ok(enemyCam.enemyBlend > .999, "the mode settles after the controlled transition");
  assert.ok(Math.abs(enemyCam.heading - Math.PI / 2) < .002, "the presentation heading reaches the rival bearing");
  assert.ok(Math.abs(enemyCam.focus.x - local.x) < .08);
  assert.ok(Math.abs(enemyCam.focus.z - (local.z + CAMERA_FOLLOW_TUNING.lookAhead)) < .08, "the settled focus remains on the local Car-Cam rig instead of extending to the rival");
  assert.equal(enemyCam.fov, carCam.fov, "settled Enemy Cam keeps the exact same FOV as Car Cam at the same speed");
  assert.equal(enemyCam.focusSmoothing, carCam.focusSmoothing, "settled Enemy Cam keeps the same focus smoothing as Car Cam");
  const enemyBoomLength = Math.hypot(enemyCam.position.x - local.x, enemyCam.position.z - local.z);
  const carBoomLength = Math.hypot(carCam.position.x - local.x, carCam.position.z - local.z);
  assert.ok(Math.abs(enemyBoomLength - carBoomLength) < 1e-12, "both modes preserve the same local boom length");
  assert.ok(Math.abs(Math.hypot(enemyCam.direction.x, enemyCam.direction.y, enemyCam.direction.z) - 1) < 1e-12, "controller returns a normalised direction");
  assert.deepEqual(enemyCam.up, { x: 0, y: 1, z: 0 }, "wall/air readability retains Arsenal's level horizon");

  const boomX = enemyCam.position.x - local.x;
  const boomZ = enemyCam.position.z - local.z;
  const aimX = enemyCam.focus.x - local.x;
  const aimZ = enemyCam.focus.z - local.z;
  assert.ok(Math.abs(boomX * aimZ - boomZ * aimX) < 1e-9, "camera, local car, and enemy-facing focus remain on one horizontal axis");
  assert.ok(boomX * aimX + boomZ * aimZ < 0, "the boom stays on the opposite side of the local car from the rival");
});

test("Enemy Cam releases to Car Cam through the same transition without retaining a gameplay target", () => {
  const state = createCameraFollowState();
  const local = car({ x: 1, y: 0, z: 0 }, { grounded: true, surfaceType: "ground" });
  const target = cameraFollowInput({
    ...local,
    followTarget: { id: "red-a", x: 10, h: 5, z: 37 },
  });
  for (let frame = 0; frame < 180; frame += 1) stepCameraFollow(state, target, 1 / 60);
  const beforeRelease = state.heading;
  const released = stepCameraFollow(state, local, 1 / 60);
  assert.equal(released.focusMode, "enemy-transition");
  assert.equal(released.targetId, null);
  assert.ok(released.enemyBlend > 0 && released.enemyBlend < 1, "release decays instead of snapping behind the car");
  assert.ok(Math.abs(released.heading - beforeRelease) <= CAMERA_FOLLOW_TUNING.headingRate / 60 + 1e-12, "release keeps the heading rate bounded");
  assert.equal(released.fov, CAMERA_FOLLOW_TUNING.carBaseFov + 28 / CAMERA_FOLLOW_TUNING.fovSpeedCap * CAMERA_FOLLOW_TUNING.carSpeedFov, "release does not apply a target-mode zoom");
  let carCam = released;
  for (let frame = 0; frame < 300; frame += 1) carCam = stepCameraFollow(state, local, 1 / 60);
  assert.equal(carCam.focusMode, "car");
  assert.equal(state.enemyBlend, 0, "the visual transition clears its retained target");
  assert.equal(state.lastTarget, null, "no stale rival survives after the presentation release");
  assert.ok(Math.abs(state.heading) < 1e-12, "the presentation returns to the vehicle heading after release");
  assert.equal(carCam.fov, CAMERA_FOLLOW_TUNING.carBaseFov + 28 / CAMERA_FOLLOW_TUNING.fovSpeedCap * CAMERA_FOLLOW_TUNING.carSpeedFov);
});

test("near an arena wall the camera shortens its boom along the chase line instead of hitting an old inner rectangle", () => {
  const target = stepCameraFollow(createCameraFollowState(), cameraFollowInput({
    x: 85, h: 4, z: 0, speed: 28, forward: { x: -1, y: 0, z: 0 },
    grounded: true, surfaceType: "ground",
    cameraHorizontalBounds: { minX: -86.5, maxX: 86.5, minZ: -66.5, maxZ: 66.5 },
  }), 1 / 60);
  assert.equal(target.position.x, 86.5);
  assert.ok(target.position.z >= -66.5 && target.position.z <= 66.5);
  assert.ok(target.position.x > 69, "combat-alpha no longer uses the obsolete 69-unit inner wall clamp");
});

test("near a wall the look-ahead stays inside the arena so the car remains readable", () => {
  const bounds = { minX: -86.5, maxX: 86.5, minZ: -66.5, maxZ: 66.5 };
  const target = stepCameraFollow(createCameraFollowState(), cameraFollowInput({
    x: 85, h: 4, z: 0, speed: 28, forward: { x: 1, y: 0, z: 0 },
    grounded: true, surfaceType: "ground", cameraHorizontalBounds: bounds,
    keepFocusInsideBounds: true,
  }), 1 / 60);
  assert.equal(target.focus.x, bounds.maxX);
  assert.ok(target.focus.z >= bounds.minZ && target.focus.z <= bounds.maxZ);
});

test("the local camera keeps its existing unrestricted look-ahead by default", () => {
  const target = stepCameraFollow(createCameraFollowState(), cameraFollowInput({
    x: 85, h: 4, z: 0, speed: 28, forward: { x: 1, y: 0, z: 0 },
    grounded: true, surfaceType: "ground",
    cameraHorizontalBounds: { minX: -86.5, maxX: 86.5, minZ: -66.5, maxZ: 66.5 },
  }), 1 / 60);
  assert.ok(target.focus.x > 86.5, "local Car Cam retains its established forward look-ahead");
});
