// P2P-WASM camera adapter. Camera policy remains owned by src/camera-follow.js;
// this module only translates authoritative presentation state into the
// shared controller's input units and returns its deterministic camera frame.
import {
  cameraFollowInput,
  createCameraFollowState,
  resetCameraFollowState,
  stepCameraFollow,
} from "../../src/camera-follow.js";

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} debe ser finito.`);
  return value;
}

function quaternion(value) {
  if (!value || typeof value !== "object") throw new TypeError("orientation debe ser un quaternion.");
  return { x: finite(value.x, "orientation.x"), y: finite(value.y, "orientation.y"), z: finite(value.z, "orientation.z"), w: finite(value.w, "orientation.w") };
}

function normalizeQuaternion(value) {
  const magnitude = Math.hypot(value.x, value.y, value.z, value.w) || 1;
  return { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude, w: value.w / magnitude };
}

function forwardFromOrientation(value) {
  const q = normalizeQuaternion(quaternion(value));
  const uv = { x: 0, y: q.z, z: -q.y };
  const uuv = { x: q.y * uv.z - q.z * uv.y, y: q.z * uv.x - q.x * uv.z, z: q.x * uv.y - q.y * uv.x };
  return {
    x: 1 + 2 * (q.w * uv.x + uuv.x),
    y: 2 * (q.w * uv.y + uuv.y),
    z: 2 * (q.w * uv.z + uuv.z),
  };
}

function carPosition(car, toScene) {
  return {
    x: toScene(finite(car.x, "car.x")),
    h: toScene(finite(car.h, "car.h")),
    z: toScene(finite(car.z, "car.z")),
  };
}

function carSpeed(car, toScene) {
  const speed = Number.isFinite(car.speed) ? car.speed : Math.hypot(car.vx || 0, car.vh || 0, car.vz || 0);
  return toScene(finite(speed, "car.speed"));
}

function targetFor(targetCar, toScene) {
  if (!targetCar || targetCar.alive === false) return null;
  return { id: targetCar.id ?? null, ...carPosition(targetCar, toScene) };
}

export function createP2PWasmCameraFramingState() {
  return createCameraFollowState();
}

export function resetP2PWasmCameraFramingState(state) {
  resetCameraFollowState(state);
}

/**
 * Step the shared Car Cam/Enemy Cam policy using P2P authoritative telemetry.
 * `toScene` is the one explicit coordinate conversion at the presentation
 * boundary; no camera value is fed back to physics or the network.
 */
export function stepP2PWasmCameraFrame(state, {
  focusCar,
  targetCar = null,
  dt = 1 / 60,
  toScene = value => value,
  cameraVerticalBounds = null,
  cameraHorizontalBounds = null,
  keepFocusInsideBounds = false,
} = {}) {
  if (!state || typeof state !== "object") throw new TypeError("El estado de cámara P2P no es válido.");
  if (!focusCar || typeof focusCar !== "object") throw new TypeError("La cámara P2P necesita un coche local.");
  const position = carPosition(focusCar, toScene);
  const input = cameraFollowInput({
    ...position,
    speed: carSpeed(focusCar, toScene),
    forward: forwardFromOrientation(focusCar.orientation),
    grounded: focusCar.grounded,
    surfaceType: focusCar.surfaceType,
    wallRide: focusCar.wallRide,
    surfaceNormal: focusCar.surfaceNormal || focusCar.worldContact?.normal || focusCar.wheelContact?.normal || null,
    cameraVerticalBounds,
    cameraHorizontalBounds,
    keepFocusInsideBounds,
    followTarget: targetFor(targetCar, toScene),
  });
  const frame = stepCameraFollow(state, input, finite(dt, "dt"));
  const rival = targetFor(targetCar, toScene);
  const rivalDistance = rival ? Math.hypot(rival.x - position.x, rival.h - position.h, rival.z - position.z) : null;
  return Object.freeze({
    ...frame,
    rivalDistance,
    followDistance: Math.hypot(frame.position.x - position.x, frame.position.z - position.z),
    forward: Object.freeze({ x: Math.cos(frame.heading), y: 0, z: Math.sin(frame.heading) }),
  });
}
