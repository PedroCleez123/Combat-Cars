// Camera follow is deliberately separate from vehicle attitude. The car can
// roll freely in the air while the player view keeps a readable horizon.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrapAngle = value => {
  let wrapped = (value + Math.PI) % (Math.PI * 2);
  if (wrapped < 0) wrapped += Math.PI * 2;
  return wrapped - Math.PI;
};

export const CAMERA_FOLLOW_TUNING = Object.freeze({
  horizontalForwardDeadzone: .35,
  headingRate: 6,
  airHeadingRate: 2.8,
  wallHeadingRate: 2.35,
  lookAhead: 5.6,
  lookHeight: .85,
  lookPitchInfluence: 1.2,
  chaseDistance: 12.5,
  chaseSpeedDistance: .055,
  chaseHeight: 6.7,
  chaseCarHeightScale: .35,
  chasePositionSmoothing: 7.5,
  focusSmoothing: 10,
  airChasePositionSmoothing: 4.4,
  airFocusSmoothing: 5.8,
  wallChasePositionSmoothing: 3.8,
  wallFocusSmoothing: 4.9,
});

export function createCameraFollowState() {
  return { initialized: false, heading: 0 };
}

export function resetCameraFollowState(state) {
  state.initialized = false;
  state.heading = 0;
}

function headingFromForward(forward, fallback) {
  const length = Math.hypot(forward.x, forward.z);
  if (length < CAMERA_FOLLOW_TUNING.horizontalForwardDeadzone) return fallback;
  return Math.atan2(forward.z, forward.x);
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
  };
  if (mode === "air") return {
    headingRate: tuning.airHeadingRate,
    positionSmoothing: tuning.airChasePositionSmoothing,
    focusSmoothing: tuning.airFocusSmoothing,
  };
  return {
    headingRate: tuning.headingRate,
    positionSmoothing: tuning.chasePositionSmoothing,
    focusSmoothing: tuning.focusSmoothing,
  };
}

// Return camera targets, not a Three.js object. This keeps the policy
// deterministic and testable without a browser or a renderer.
export function stepCameraFollow(state, car, dt) {
  const tuning = CAMERA_FOLLOW_TUNING;
  const mode = followMode(car);
  const response = responseForMode(mode);
  const forward = car.forward || { x: 1, y: 0, z: 0 };
  const targetHeading = headingFromForward(forward, state.heading);
  if (!state.initialized) {
    state.heading = targetHeading;
    state.initialized = true;
  } else {
    // Limit heading motion per frame. A quaternion crossing near vertical
    // must not turn into a one-frame 180-degree camera swing.
    const maximumTurn = response.headingRate * Math.min(Math.max(dt, 0), .05);
    state.heading += clamp(wrapAngle(targetHeading - state.heading), -maximumTurn, maximumTurn);
  }

  const heading = { x: Math.cos(state.heading), z: Math.sin(state.heading) };
  const speed = Math.min(car.speed || 0, 55);
  const chaseDistance = tuning.chaseDistance + speed * tuning.chaseSpeedDistance;
  const position = {
    x: car.x - heading.x * chaseDistance,
    y: car.h + tuning.chaseHeight + Math.min(car.h, 6) * tuning.chaseCarHeightScale,
    z: car.z - heading.z * chaseDistance
  };
  const pitchLook = clamp((forward.y || 0) * tuning.lookPitchInfluence, -.45, .75);
  const focus = {
    x: car.x + heading.x * tuning.lookAhead,
    y: car.h + tuning.lookHeight + pitchLook,
    z: car.z + heading.z * tuning.lookAhead
  };
  const bounds = car.cameraVerticalBounds;
  if (bounds) {
    position.y = clamp(position.y, bounds.minPositionY, bounds.maxPositionY);
    focus.y = clamp(focus.y, bounds.minFocusY, bounds.maxFocusY);
  }
  return { position, focus, heading: state.heading, mode, ...response };
}
