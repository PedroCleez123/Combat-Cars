// Camera follow is deliberately separate from vehicle attitude. The car can
// roll freely in the air while the player view keeps a readable horizon.
//
// Soccer Car's recovered controller is stateful: it consumes the local pose,
// movement/contact state, a Ball-Cam boolean and a target, then returns
// position, direction, up and FOV. Enemy Cam mirrors that *contract* with the
// locked rival replacing the ball. The original WASM curve is not available,
// so the calibrated response below is intentionally an Arsenal implementation,
// not a claim of byte-for-byte Soccer Car behaviour.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const wrapAngle = value => {
  let wrapped = (value + Math.PI) % (Math.PI * 2);
  if (wrapped < 0) wrapped += Math.PI * 2;
  return wrapped - Math.PI;
};
const lerpAngle = (from, to, amount) => from + wrapAngle(to - from) * amount;
const smoothingFactor = (rate, dt) => 1 - Math.exp(-rate * clamp(dt, 0, .05));

export const CAMERA_FOLLOW_TUNING = Object.freeze({
  horizontalForwardDeadzone: .35,
  headingRate: 6,
  airHeadingRate: 2.8,
  wallHeadingRate: 2.35,
  lookAhead: 4.5,
  lookHeight: .85,
  lookPitchInfluence: 1.2,
  chaseDistance: 9.5,
  chaseSpeedDistance: .045,
  chaseHeight: 5.8,
  chaseCarHeightScale: .3,
  chasePositionSmoothing: 7.5,
  focusSmoothing: 10,
  airChasePositionSmoothing: 4.4,
  airFocusSmoothing: 5.8,
  wallChasePositionSmoothing: 3.8,
  wallFocusSmoothing: 4.9,
  // Rocket Arena's camera contract carries the support normal through its
  // view kernel. Combat Cars keeps the same signal at the presentation
  // boundary and eases it into the horizon instead of snapping the Three.js
  // camera to the vehicle quaternion. The blend is deliberately partial so
  // a wall ride remains readable rather than rotating the screen 90 degrees.
  groundUpInfluence: .42,
  wallUpInfluence: .68,
  surfaceUpSmoothing: 7.5,
  airUpSmoothing: 6.5,

  // Static evidence from the recovered Soccer Car wrapper. Its world scale is
  // different, so distance/height are not copied, but the relationship between
  // stiffness and transition speed gives Enemy Cam a stateful acquisition and
  // release instead of a one-frame aim pivot.
  soccerCarReferenceStiffness: .35,
  soccerCarReferenceTransitionSpeed: 1,
  // Enemy Cam rotates into its tracked heading over a short, readable blend.
  // Its framing never changes: this is deliberately a direction transition,
  // not a second, wider chase-camera preset.
  enemyTransitionRate: 1 / .45,
  enemyAirTransitionScale: .68,
  enemyWallTransitionScale: .56,

  // Projection is a property of velocity, not the selected camera mode. A
  // different Enemy-Cam FOV reads as a zoom/jump even when the boom itself is
  // moving smoothly, and makes the local car change apparent size on toggle.
  carBaseFov: 61,
  carSpeedFov: 12,
  fovSpeedCap: 65,
});

export function createCameraFollowState() {
  return {
    initialized: false,
    heading: 0,
    up: { x: 0, y: 1, z: 0 },
    enemyBlend: 0,
    lastTargetHeading: 0,
    lastTarget: null,
  };
}

export function resetCameraFollowState(state) {
  state.initialized = false;
  state.heading = 0;
  state.up = { x: 0, y: 1, z: 0 };
  state.enemyBlend = 0;
  state.lastTargetHeading = 0;
  state.lastTarget = null;
}

// Keep the client-to-camera boundary explicit. Presentation consumes the
// authoritative contact classification but never feeds camera decisions back
// into RocketSim.
export function cameraFollowInput({ x, h, z, speed, forward, grounded, surfaceType, wallRide, surfaceNormal, lookX = 0, lookY = 0, cameraVerticalBounds, cameraHorizontalBounds, keepFocusInsideBounds = false, followTarget } = {}) {
  return {
    x, h, z, speed, forward,
    grounded: grounded === true,
    surfaceType: typeof surfaceType === "string" ? surfaceType : "air",
    wallRide: wallRide === true,
    surfaceNormal: surfaceNormal && [surfaceNormal.x, surfaceNormal.y, surfaceNormal.z].every(Number.isFinite)
      ? { x: surfaceNormal.x, y: surfaceNormal.y, z: surfaceNormal.z }
      : null,
    // These are presentation-only swivel axes matching Rocket Arena's
    // `lookX`/`lookY` camera inputs. They are intentionally not part of the
    // causal command or network contract.
    lookX: Number.isFinite(lookX) ? clamp(lookX, -1, 1) : 0,
    lookY: Number.isFinite(lookY) ? clamp(lookY, -1, 1) : 0,
    cameraVerticalBounds,
    cameraHorizontalBounds,
    keepFocusInsideBounds: keepFocusInsideBounds === true,
    // This is a client presentation target resolved from the interpolated
    // snapshot. It is never returned to RocketSim or the network protocol.
    followTarget: followTarget && Number.isFinite(followTarget.x) && Number.isFinite(followTarget.h) && Number.isFinite(followTarget.z)
      ? { id: followTarget.id ?? null, x: followTarget.x, h: followTarget.h, z: followTarget.z }
      : null,
  };
}

function headingFromForward(forward, fallback) {
  const length = Math.hypot(forward.x, forward.z);
  if (length < CAMERA_FOLLOW_TUNING.horizontalForwardDeadzone) return fallback;
  return Math.atan2(forward.z, forward.x);
}

function headingFromTarget(car, target, fallback) {
  const deltaX = target.x - car.x;
  const deltaZ = target.z - car.z;
  if (Math.hypot(deltaX, deltaZ) < CAMERA_FOLLOW_TUNING.horizontalForwardDeadzone) return fallback;
  return Math.atan2(deltaZ, deltaX);
}

function followMode(car) {
  if (car.surfaceType === "wall" || car.wallRide) return "wall";
  if (car.surfaceType === "air" || car.grounded === false) return "air";
  return "ground";
}

function responseForMode(mode) {
  const tuning = CAMERA_FOLLOW_TUNING;
  if (mode === "wall") return {
    headingRate: tuning.wallHeadingRate,
    positionSmoothing: tuning.wallChasePositionSmoothing,
    focusSmoothing: tuning.wallFocusSmoothing,
    enemyTransitionScale: tuning.enemyWallTransitionScale,
  };
  if (mode === "air") return {
    headingRate: tuning.airHeadingRate,
    positionSmoothing: tuning.airChasePositionSmoothing,
    focusSmoothing: tuning.airFocusSmoothing,
    enemyTransitionScale: tuning.enemyAirTransitionScale,
  };
  return {
    headingRate: tuning.headingRate,
    positionSmoothing: tuning.chasePositionSmoothing,
    focusSmoothing: tuning.focusSmoothing,
    enemyTransitionScale: 1,
  };
}

function clampChasePositionToBounds(position, car, bounds) {
  const minX = Number(bounds?.minX), maxX = Number(bounds?.maxX);
  const minZ = Number(bounds?.minZ), maxZ = Number(bounds?.maxZ);
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) return position;

  // Treat the camera as a boom anchored on the car. When that boom would pass
  // through an arena boundary, shorten it along its current line rather than
  // independently clamping X/Z. The latter creates the visible "wall hit"
  // where the camera appears to slide or stop against an invisible rectangle.
  const anchorX = clamp(car.x, minX, maxX);
  const anchorZ = clamp(car.z, minZ, maxZ);
  const deltaX = position.x - anchorX;
  const deltaZ = position.z - anchorZ;
  let extent = 1;
  if (deltaX > 0) extent = Math.min(extent, (maxX - anchorX) / deltaX);
  if (deltaX < 0) extent = Math.min(extent, (minX - anchorX) / deltaX);
  if (deltaZ > 0) extent = Math.min(extent, (maxZ - anchorZ) / deltaZ);
  if (deltaZ < 0) extent = Math.min(extent, (minZ - anchorZ) / deltaZ);
  const safeExtent = clamp(extent, 0, 1);
  return {
    ...position,
    x: anchorX + deltaX * safeExtent,
    z: anchorZ + deltaZ * safeExtent,
  };
}

// Keep the look target inside the same presentation volume as the camera
// boom.  When a car is close to a wall and still points into it, an
// unrestricted look-ahead aims through the wall; the car then drifts to the
// edge of the frame or disappears behind the shell even though its pose is
// valid.  Clamping only the presentation focus preserves the authoritative
// pose and keeps the local and online camera contract deterministic.
function clampFocusToBounds(focus, bounds) {
  const minX = Number(bounds?.minX), maxX = Number(bounds?.maxX);
  const minZ = Number(bounds?.minZ), maxZ = Number(bounds?.maxZ);
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) return focus;
  return {
    ...focus,
    x: clamp(focus.x, minX, maxX),
    z: clamp(focus.z, minZ, maxZ),
  };
}

function targetFocus(carFocus, state, hasEnemyLock) {
  const target = state.lastTarget;
  const blend = state.enemyBlend;
  if (!target || blend < .0001) return { focus: carFocus, targetId: null, focusMode: "car" };
  // Keep the focus point on the local camera rig. Enemy Cam changes `heading`
  // toward the rival, so this focus ray still points at the locked player, but
  // it remains the same look-ahead distance and height as Car Cam. That keeps
  // the local vehicle in the same screen composition and avoids an apparent
  // boom extension when toggling modes.
  return {
    focus: carFocus,
    targetId: hasEnemyLock ? target.id ?? null : null,
    focusMode: hasEnemyLock ? "enemy" : "enemy-transition",
  };
}

function fovFor(speed) {
  const tuning = CAMERA_FOLLOW_TUNING;
  const speedFraction = clamp((Number(speed) || 0) / tuning.fovSpeedCap, 0, 1);
  return tuning.carBaseFov + speedFraction * tuning.carSpeedFov;
}

function directionBetween(position, focus) {
  const x = focus.x - position.x;
  const y = focus.y - position.y;
  const z = focus.z - position.z;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

const WORLD_UP = Object.freeze({ x: 0, y: 1, z: 0 });

function normalizeVector(value) {
  const length = Math.hypot(value?.x || 0, value?.y || 0, value?.z || 0);
  if (!Number.isFinite(length) || length < .2) return null;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function dotVector(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

function scaleAndAdd(a, b, amount) {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount, z: a.z + (b.z - a.z) * amount };
}

function supportUpTarget(car, mode, previousUp) {
  if (mode === "air") return WORLD_UP;
  let normal = normalizeVector(car.surfaceNormal);
  if (!normal) return WORLD_UP;
  // Contact normals are expected to point into the playable volume. If a
  // legacy snapshot supplies the opposite direction, choose the hemisphere
  // nearest the current camera up so a single bad frame cannot invert the
  // view.
  if (dotVector(normal, previousUp) < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  const influence = mode === "wall" ? CAMERA_FOLLOW_TUNING.wallUpInfluence : CAMERA_FOLLOW_TUNING.groundUpInfluence;
  return normalizeVector(scaleAndAdd(WORLD_UP, normal, influence)) || WORLD_UP;
}

function smoothUp(state, car, mode, dt) {
  const target = supportUpTarget(car, mode, state.up || WORLD_UP);
  const rate = mode === "air" ? CAMERA_FOLLOW_TUNING.airUpSmoothing : CAMERA_FOLLOW_TUNING.surfaceUpSmoothing;
  const amount = smoothingFactor(rate, dt);
  const next = normalizeVector(scaleAndAdd(state.up || WORLD_UP, target, amount)) || WORLD_UP;
  state.up = next;
  return next;
}

// Return camera targets, not a Three.js object. This keeps the policy
// deterministic and testable without a browser or a renderer.
export function stepCameraFollow(state, car, dt) {
  const tuning = CAMERA_FOLLOW_TUNING;
  const mode = followMode(car);
  const forward = car.forward || { x: 1, y: 0, z: 0 };
  const vehicleHeading = headingFromForward(forward, state.heading);
  const hasEnemyLock = Boolean(car.followTarget);
  const liveTargetHeading = hasEnemyLock
    ? headingFromTarget(car, car.followTarget, vehicleHeading)
    : state.lastTargetHeading;
  const response = responseForMode(mode);
  const up = smoothUp(state, car, mode, dt);

  if (!state.initialized) {
    // Even if a target is already locked (for example after a respawn), enter
    // from the Car-Cam composition and acquire it through the same transition.
    state.heading = vehicleHeading;
    state.lastTargetHeading = liveTargetHeading;
    state.initialized = true;
  }
  if (hasEnemyLock) {
    state.lastTargetHeading = liveTargetHeading;
    state.lastTarget = { ...car.followTarget };
  }

  const targetBlend = hasEnemyLock ? 1 : 0;
  state.enemyBlend = lerp(
    state.enemyBlend,
    targetBlend,
    smoothingFactor(tuning.enemyTransitionRate * response.enemyTransitionScale, dt),
  );
  if (!hasEnemyLock && state.enemyBlend < .0001) {
    state.enemyBlend = 0;
    state.lastTarget = null;
    state.lastTargetHeading = vehicleHeading;
  }

  // Ball Cam changes a persistent mode; it does not replace the vehicle
  // heading with the ball angle in one update. The same blend lets Enemy Cam
  // keep the player vehicle readable while it turns toward (or away from) the
  // locked rival.
  const targetHeading = lerpAngle(vehicleHeading, state.lastTargetHeading, state.enemyBlend);
  const maximumTurn = response.headingRate * Math.min(Math.max(dt, 0), .05);
  state.heading += clamp(wrapAngle(targetHeading - state.heading), -maximumTurn, maximumTurn);

  const heading = { x: Math.cos(state.heading), z: Math.sin(state.heading) };
  const speed = Math.min(car.speed || 0, 55);
  const chaseDistance = tuning.chaseDistance + speed * tuning.chaseSpeedDistance;
  let position = {
    x: car.x - heading.x * chaseDistance,
    y: car.h + tuning.chaseHeight + Math.min(car.h, 6) * tuning.chaseCarHeightScale,
    z: car.z - heading.z * chaseDistance,
  };
  const pitchLook = clamp((forward.y || 0) * tuning.lookPitchInfluence + (car.lookY || 0) * .45, -.45, .75);
  const swivelHeading = clamp(car.lookX || 0, -1, 1) * .35;
  const carFocus = {
    x: car.x + Math.cos(state.heading + swivelHeading) * tuning.lookAhead,
    y: car.h + tuning.lookHeight + pitchLook,
    z: car.z + Math.sin(state.heading + swivelHeading) * tuning.lookAhead,
  };
  const verticalBounds = car.cameraVerticalBounds;
  if (verticalBounds) {
    position.y = clamp(position.y, verticalBounds.minPositionY, verticalBounds.maxPositionY);
    carFocus.y = clamp(carFocus.y, verticalBounds.minFocusY, verticalBounds.maxFocusY);
  }
  position = clampChasePositionToBounds(position, car, car.cameraHorizontalBounds);
  const boundedCarFocus = car.keepFocusInsideBounds === true
    ? clampFocusToBounds(carFocus, car.cameraHorizontalBounds)
    : carFocus;
  const target = targetFocus(boundedCarFocus, state, hasEnemyLock);
  if (verticalBounds) target.focus.y = clamp(target.focus.y, verticalBounds.minFocusY, verticalBounds.maxFocusY);
  const direction = directionBetween(position, target.focus);

  return {
    position,
    focus: target.focus,
    direction,
    // Equivalent to Rocket Arena's returned view-kernel `up` vector. It is
    // derived only from authoritative contact telemetry and smoothed here;
    // vehicle roll never leaks into the horizon.
    up,
    fov: fovFor(car.speed),
    heading: state.heading,
    enemyBlend: state.enemyBlend,
    mode,
    targetId: target.targetId,
    focusMode: target.focusMode,
    ...response,
    // Direction transitions must retain the same local-rig smoothing as Car
    // Cam. A mode-specific focus response makes toggling perceptible even when
    // the FOV and boom dimensions agree.
    focusSmoothing: response.focusSmoothing,
  };
}
