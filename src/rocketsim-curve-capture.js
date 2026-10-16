import { ROCKETSIM_FIXED_STEP_HZ } from "./rocketsim-protocol.js";

const round = value => {
  const rounded = Math.round(Number(value || 0) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export function normalizeCurveInput(input = {}) {
  return {
    throttle: round(input.throttle),
    steer: round(input.steer),
    jump: Boolean(input.jump),
    boost: Boolean(input.boost),
    drift: Boolean(input.drift),
    airRoll: Boolean(input.airRoll),
    roll: round(input.roll),
  };
}

export function bridgeArenaForInitialCondition(initialCondition) {
  if (initialCondition === "grounded") return "clean-six-planes";
  if (initialCondition === "airborne") return "air-void";
  if (initialCondition === "second-action-airborne") return "second-action-airborne";
  throw new Error(`Unsupported bridge initial condition: ${initialCondition}`);
}

export function createBridgeActionTracker() {
  const previous = { hasJumped: false, hasDoubleJumped: false, hasFlipped: false };
  const serials = { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 };
  return {
    observe(flags) {
      if (flags.hasJumped && !previous.hasJumped) serials.jump += 1;
      if (flags.hasDoubleJumped && !previous.hasDoubleJumped) serials.doubleJump += 1;
      if (flags.hasFlipped && !previous.hasFlipped) serials.dodge += 1;
      Object.assign(previous, flags);
      return { ...serials };
    },
  };
}

export function bridgeCarToCurveState(car, actionSerials) {
  return {
    position: { x: round(car.position.x), y: round(car.position.y), z: round(car.position.z) },
    velocity: { x: round(car.velocity.x), y: round(car.velocity.y), z: round(car.velocity.z) },
    angularVelocity: {
      pitch: round(car.localAngularVelocity.pitch),
      yaw: round(car.localAngularVelocity.yaw),
      roll: round(car.localAngularVelocity.roll),
    },
    localAngularVelocity: {
      pitch: round(car.localAngularVelocity.pitch),
      yaw: round(car.localAngularVelocity.yaw),
      roll: round(car.localAngularVelocity.roll),
    },
    orientation: {
      x: round(car.orientation.x), y: round(car.orientation.y),
      z: round(car.orientation.z), w: round(car.orientation.w),
    },
    grounded: car.grounded,
    jumpState: car.jumpState,
    jumps: car.jumps,
    secondJumpWindow: round(car.secondJumpWindow),
    dodgeTime: round(car.dodgeTime),
    dodgeDirection: { forward: round(car.dodgeDirection.forward), side: round(car.dodgeDirection.side) },
    actionSerials,
  };
}

export function bridgeFrameToCurveSample({ frame, input, car, actionTracker }) {
  if (!Number.isSafeInteger(frame) || frame < 1) throw new Error("Bridge curve frame is invalid");
  if (!car || car.id !== 1) throw new Error("Bridge curve requires car 1");
  if (!actionTracker?.observe) throw new Error("Bridge curve action tracker is missing");
  return {
    frame,
    time: round(frame / ROCKETSIM_FIXED_STEP_HZ),
    input: normalizeCurveInput(input),
    state: bridgeCarToCurveState(car, actionTracker.observe(car.actionFlags)),
  };
}
