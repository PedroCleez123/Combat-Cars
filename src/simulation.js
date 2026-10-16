export const ARENA = Object.freeze({ halfWidth: 62, halfDepth: 46, ceilingHeight: 24, scoreToWin: 15 });

export const ARENA_PROFILES = Object.freeze({
  calibration: Object.freeze({
    id: "calibration", label: "CALIBRACIÓN LIMPIA", pads: false, combat: false, unlimitedBoost: true,
    ramps: false, covers: false
  }),
  scrapyard: Object.freeze({
    id: "scrapyard", label: "DESGUACE", pads: true, combat: true, unlimitedBoost: false,
    ramps: true, covers: true
  })
});

const TAU = Math.PI * 2;
// This footprint matches the visible chassis (3.55 × 1.84). The calibration
// arena uses the same oriented box for contact against all six arena planes.
const CHASSIS_HALF_LENGTH = 1.775;
const CHASSIS_HALF_WIDTH = .92;
// The body collider is centered just above the wheel plane. Keep its center
// separate from the legacy cover volume until that profile joins the new solver.
const CHASSIS_HALF_HEIGHT = .9;
const CHASSIS_CENTER_HEIGHT = .95;
const CHASSIS_CONTACT_CENTER_HEIGHT = .9;
const ARENA_CONTACT_SLOP = .035;
const ARENA_SUPPORT_SLOP = .002;
const WHEEL_RADIUS = .43;
const WHEEL_ATTACHMENT_HEIGHT = .52;
const WHEEL_REST_LENGTH = .24;
const WHEEL_MAX_LENGTH = .42;
const WHEEL_MIN_ALIGNMENT = .45;
// A damper can react while a wheel is almost fully extended, but that is not
// enough to hand ground controls or jump recovery back to the driver. Require
// meaningful spring compression for the gameplay support state.
const WHEEL_LOADED_COMPRESSION = .0001;
// A pair of tires can carry the chassis before the springs reach the static
// .10 travel used by the old flat-rest probe. Keep the gameplay support gate
// at .01 travel so a tilted two-wheel landing remains grounded while
// the suspension settles instead of dropping back into airborne gravity.
const WHEEL_GROUND_COMPRESSION = .01;
const WHEEL_LAYOUT = Object.freeze([
  { id: "frontLeft", x: 1.02, z: -.91, steered: true },
  { id: "frontRight", x: 1.02, z: .91, steered: true },
  { id: "rearLeft", x: -1.05, z: -.91, steered: false },
  { id: "rearRight", x: -1.05, z: .91, steered: false }
]);
const PHYSICS_STEP = 1 / 120;
const MAX_VEHICLES = 6;
// Keep the legacy simulation default for its regression suite. The live server
// explicitly starts CAL-01 in the calibration profile below.
const DEFAULT_MATCH_SETTINGS = Object.freeze({ vehicleLimit: 6, botCount: 5, arena: "scrapyard" });
const EMPTY_GEOMETRY = Object.freeze([]);
const CALIBRATION_PLANES = Object.freeze([
  { kind: "floor", point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  { kind: "wall", point: { x: -ARENA.halfWidth, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
  { kind: "wall", point: { x: ARENA.halfWidth, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } },
  { kind: "wall", point: { x: 0, y: 0, z: -ARENA.halfDepth }, normal: { x: 0, y: 0, z: 1 } },
  { kind: "wall", point: { x: 0, y: 0, z: ARENA.halfDepth }, normal: { x: 0, y: 0, z: -1 } },
  { kind: "ceiling", point: { x: 0, y: ARENA.ceilingHeight, z: 0 }, normal: { x: 0, y: -1, z: 0 } }
]);
const TUNING = Object.freeze({
  // The values use Arsenal world units, calibrated around Rocket League's
  // 120 Hz control relationships rather than copied implementation values.
  gravity: 16,
  maxSpeed: 56,
  supersonicSpeed: 53,
  driveSpeed: 39,
  driveAcceleration: 45,
  reverseSpeed: 17,
  reverseAcceleration: 38,
  brakeAcceleration: 72,
  coastDrag: 13,
  driftDrag: 3.8,
  lateralGrip: 30,
  driftGrip: 5.5,
  turnRate: 2.15,
  driftTurnRate: 3.1,
  // RocketSim publishes 875/3 immediate force and 4375/3 sustained force.
  // Scale both to Arsenal's 56 u/s cap rather than treating a tap as an
  // arbitrary special case.
  jumpImpulse: 7.101449275362319,
  jumpMinTime: .025,
  jumpHoldTime: .2,
  jumpHoldAcceleration: 35.507246376811594,
  secondJumpTime: 1.25,
  doubleJumpImpulse: 7.101449275362319,
  // The second impulse is scaled to the same vertical units as the first
  // jump; the minimum keeps a late tap from becoming a stronger jump.
  doubleJumpMinVelocity: 5.65,
  // RocketSim's public Octane configuration uses a 0.5 aggregate input
  // threshold. The project keeps its own input mapping but follows that
  // threshold so a weak analogue movement remains a vertical double jump.
  dodgeDeadzone: .5,
  // A flip is a horizontal, one-shot velocity impulse. Its angular motion is
  // a separate short torque window; it is not a second source of lift or a
  // continuous linear acceleration.
  dodgeInitialImpulse: 12.2,
  dodgeTime: .65,
  dodgePitchLockTime: .3,
  dodgeVerticalDampStart: .15,
  dodgeVerticalDampEnd: .21,
  // RocketSim damps the vertical velocity throughout the flip once its short
  // start window has elapsed. A .25 loss means a .75 retained fraction per
  // 120 Hz tick, matching the measured steady fall in the clean trace.
  dodgeVerticalDampPerStep: .25,
  // RocketSim applies FLIP_TORQUE_Y=224 and FLIP_TORQUE_X=260 every fixed
  // tick, integrates the resulting angular velocity, then applies the 5.5
  // rad/s car cap at the end of the tick. Keeping torque here (rather than a
  // fixed dodge rate) preserves the short per-frame overrun in the reference
  // orientation curve while the published velocity remains capped.
  dodgePitchTorque: 224,
  dodgeRollTorque: 260,
  // RocketSim exposes 200/3 air throttle acceleration versus 3175/3 boost
  // acceleration. Retain that ≈6.3% relationship in Arsenal units.
  airThrottleAcceleration: 1.52,
  // RocketSim has a small ground/air boost distinction. The Arsenal air
  // value remains the calibration anchor; the ground value preserves the
  // public 2975:3175 relationship instead of treating both states as equal.
  boostGroundAcceleration: 22.488188976377952,
  boostAirAcceleration: 24,
  boostMinTime: .1,
  boostDrain: 33.3,
  boostRecovery: 0,
  wallRestitution: .28,
  wallRideGravity: 11.5,
  wallRideWindow: .18,
  wallRideMinHeight: .35,
  wallDriveAcceleration: 30,
  wallJumpImpulse: 8.5,
  wallJumpLift: 4.8,
  // Four independent wheel supports are only enabled in CAL-01 for FIS-12B.
  // Their static compression balances gravity at the visible wheel plane.
  suspensionStiffness: 26.666666666666668,
  suspensionDamping: 4.8,
  suspensionAngularResponse: .8,
  // Contact forces can leave a small residual pitch/roll moment because the
  // four wheel samples are solved independently. Damping that angular rate is
  // a suspension response, not a target orientation: it never asks the car
  // to become level and it preserves the attitude at first contact.
  suspensionAngularDamping: 20,
  suspensionAngularLimit: 3.4,
  // A chassis-plane impact transfers its normal impulse through the contact
  // arm. This is a collision response, not an upright target: a centred hit
  // produces no pitch/roll and an offset hit only changes angular velocity.
  contactAngularResponse: .72,
  // CAL-01 ground propulsion is applied at loaded wheels in FIS-13A. The
  // legacy target-speed driver remains in DESGUACE until it is migrated.
  wheelDriveForce: 45,
  wheelReverseForce: 38,
  wheelBrakeForce: 72,
  wheelCoastForce: 13,
  wheelLateralGrip: 30,
  wheelGripLoad: 2.8,
  wheelYawResponse: .62,
  wheelYawRate: 2.35,
  wheelYawDamping: 3.4,
  // A held powerslide follows a progressive handbrake value. The front and
  // rear wheel solver remains our own, while its public RocketSim reference
  // reduces lateral friction to one tenth at full handbrake.
  powerslideLateralGripFactor: .1,
  driftYawTorque: 7.4,
  driftYawRate: 3.15,
  driftYawDamping: .9,
  // Air input contributes torque to a local angular velocity. The complete
  // vector is capped, matching the public RocketSim contract, rather than
  // independently clamping pitch, yaw and roll.
  airMaxAngularSpeed: 5.5,
  // M2-03 pitch: match RocketSim's isolated active rate (~3.74 rad/s at
  // 0.3 s) and retain readable angular momentum after the input is released.
  airPitchTorque: 12.46,
  // M2-04 yaw: isolated RocketSim input reaches ~2.73 rad/s at 0.3 s.
  airYawTorque: 9.11,
  // M2-05 roll: one local cap remains in place, while the isolated response
  // now follows the reference ramp instead of reaching the cap immediately.
  airRollTorque: 38.35,
  // CAL-04 showed that release required roughly twice as long as a quarter
  // turn. Keep the driven rates and torque untouched, but brake a released
  // axis promptly enough for a pilot to chain corrections in one aerial.
  airPitchDamping: 2.8,
  airYawDamping: 1.9,
  airRollDamping: 4.8,
  // Contact impulses use the local lever arm of the chassis. Ground contacts
  // turn the heading immediately; airborne contacts add bounded local spin.
  groundImpactYawResponse: .006,
  groundImpactYawLimit: .24,
  airImpactAngularResponse: .24,
  impactAngularRateLimit: 8.5,
  ramSpeedThreshold: 34,
  ramDamagePerSpeed: 1.45,
  ramDamageCap: 28
});

// RocketSim's public Octane configuration exposes steering as a speed curve,
// not as a fixed wheel angle. The reference samples are expressed in Rocket
// League world units per second; Arsenal's calibrated top speed is 56 units,
// so 2300 reference units map to that cap. Keep the curve as data and
// interpolate it rather than fitting another ad-hoc turn-rate formula.
const STEER_ANGLE_FROM_SPEED = Object.freeze([
  [0, .53356],
  [500, .31930],
  [1000, .18203],
  [1500, .10570],
  [1750, .08507],
  [3000, .03454]
]);
const ROCKETSIM_MAX_SPEED = 2300;
const DRIVE_TORQUE_FACTOR_FROM_SPEED = Object.freeze([
  [0, 1],
  [1400, .1],
  [1410, 0]
]);
const POWERSLIDE_STEER_ANGLE_FROM_SPEED = Object.freeze([
  [0, .39235],
  [2500, .12610]
]);
const POWERSLIDE_RISE_RATE = 5;
const POWERSLIDE_FALL_RATE = 2;

function referenceSpeedFromArsenal(forwardSpeed) {
  return clamp(Math.abs(Number(forwardSpeed) || 0) * ROCKETSIM_MAX_SPEED / TUNING.maxSpeed, 0, Number.POSITIVE_INFINITY);
}

function sampleLinearCurve(points, input) {
  if (input <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [nextInput, nextOutput] = points[index];
    const [previousInput, previousOutput] = points[index - 1];
    if (input <= nextInput) {
      const span = nextInput - previousInput;
      const fraction = span > 0 ? (input - previousInput) / span : 0;
      return previousOutput + (nextOutput - previousOutput) * fraction;
    }
  }
  return points.at(-1)[1];
}

export function steeringAngleFromSpeed(forwardSpeed) {
  return sampleLinearCurve(STEER_ANGLE_FROM_SPEED, referenceSpeedFromArsenal(forwardSpeed));
}

export function driveTorqueFactorFromSpeed(forwardSpeed) {
  return sampleLinearCurve(DRIVE_TORQUE_FACTOR_FROM_SPEED, referenceSpeedFromArsenal(forwardSpeed));
}

export function powerslideSteeringAngleFromSpeed(forwardSpeed) {
  return sampleLinearCurve(POWERSLIDE_STEER_ANGLE_FROM_SPEED, referenceSpeedFromArsenal(forwardSpeed));
}
const SCRAP_COVERS = Object.freeze([
  { x: -14, z: -19, halfX: 5.5, halfZ: 3, height: 5 },
  { x: 15, z: 20, halfX: 5.5, halfZ: 3, height: 5 },
  { x: -12, z: 19, halfX: 4, halfZ: 4, height: 6 },
  { x: 15, z: -20, halfX: 4, halfZ: 4, height: 6 },
  { x: -54, z: 36, halfX: 2.5, halfZ: 2.5, height: 12 },
  { x: 54, z: -36, halfX: 2.5, halfZ: 2.5, height: 12 }
]);
const RAMPS = Object.freeze([
  { x: -30, z: -8, halfX: 8, halfZ: 9, rise: 2.45, ascend: 1 },
  { x: 30, z: 8, halfX: 8, halfZ: 9, rise: 2.45, ascend: -1 }
]);
const PAD_LAYOUT = [
  [-43, -27], [43, -27], [-43, 27], [43, 27], [0, -34], [0, 34],
  [-24, 0], [24, 0], [-7, -14], [7, 14]
];
const SPAWNS = {
  blue: [[-43, -22], [-50, 0], [-43, 22]],
  red: [[43, 22], [50, 0], [43, -22]]
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// The second-jump edge chooses a direction, but its short action window still
// receives the same local movement plane as the rest of the flight controls.
// Keep a partial analogue input partial, and normalize only combinations that
// exceed the unit control disc (for example yaw plus directional air roll).
function dodgeInputAxes(input) {
  const forward = clamp(input.throttle || 0, -1, 1);
  const side = (input.airRoll ? 0 : clamp(input.steer || 0, -1, 1)) + clamp(input.roll || 0, -1, 1);
  const magnitude = Math.hypot(forward, side);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return { forward: forward * scale, side: side * scale };
}

function dodgeControlState(input, dodgeForward, dodgeSide) {
  if (dodgeForward === 0 && dodgeSide === 0) return { cancellation: 0 };
  const live = dodgeInputAxes(input);
  // Flip cancel is a pitch cancellation. Side input is still useful while a
  // dodge is completing and must not cancel a forward/backward flip merely
  // because the player steers across it. This mirrors the reference contract
  // where only the pitch component is tested against the committed flip
  // torque.
  const opposingPitch = live.forward * dodgeForward < 0;
  return {
    // Opposing pitch cancels its rotation but leaves the already applied
    // movement impulse intact.
    cancellation: opposingPitch ? clamp(Math.abs(live.forward), 0, 1) : 0
  };
}

function dodgeImpulse(car, dodgeForward, dodgeSide) {
  // The flip's velocity is committed in the ground plane, even when the car
  // is already pitched. RocketSim applies its initial dodge velocity over the
  // flattened forward/right basis and scales side/back flips by speed.
  const forward = forwardDirection(car);
  const forwardLength = Math.hypot(forward.x, forward.z);
  const forward2D = forwardLength > .0001
    ? { x: forward.x / forwardLength, z: forward.z / forwardLength }
    : { x: Math.cos(car.yaw), z: Math.sin(car.yaw) };
  const right2D = { x: -forward2D.z, z: forward2D.x };
  const forwardSpeed = car.vx * forward2D.x + car.vz * forward2D.z;
  const speedRatio = clamp(Math.abs(forwardSpeed) / TUNING.maxSpeed, 0, 1);
  const movingForward = Math.abs(forwardSpeed) < 2
    ? dodgeForward >= 0
    : (dodgeForward >= 0) === (forwardSpeed >= 0);
  const forwardScale = movingForward ? 1 : (1 + 1.5 * speedRatio) * (16 / 15);
  const sideScale = 1 + .9 * speedRatio;
  return {
    x: forward2D.x * dodgeForward * TUNING.dodgeInitialImpulse * forwardScale
      + right2D.x * dodgeSide * TUNING.dodgeInitialImpulse * sideScale,
    z: forward2D.z * dodgeForward * TUNING.dodgeInitialImpulse * forwardScale
      + right2D.z * dodgeSide * TUNING.dodgeInitialImpulse * sideScale
  };
}
const length = (x, z) => Math.hypot(x, z);
const approach = (value, target, amount) => {
  const result = value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
  return Object.is(result, -0) ? 0 : result;
};
const wrapAngle = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
const round = n => {
  const value = Math.round(n * 100) / 100;
  return Object.is(value, -0) ? 0 : value;
};
// Angular rates are bounded as one vector. Two decimal places can round each
// component outward enough to make the serialized vector appear above the
// physical cap, so retain one extra digit for this contract.
const roundAngularRate = n => {
  const value = Math.round(n * 1000) / 1000;
  return Object.is(value, -0) ? 0 : value;
};
const whole = value => Math.round(Number(value) || 0);

function axisQuaternion(x, y, z, angle) {
  const half = angle * .5, scale = Math.sin(half);
  return { x: x * scale, y: y * scale, z: z * scale, w: Math.cos(half) };
}

function multiplyQuaternion(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

function normalizeQuaternion(q) {
  const scale = 1 / Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x * scale, y: q.y * scale, z: q.z * scale, w: q.w * scale };
}

function quaternionFromBasis(forward, up, right) {
  const m00 = forward.x, m01 = up.x, m02 = right.x;
  const m10 = forward.y, m11 = up.y, m12 = right.y;
  const m20 = forward.z, m21 = up.z, m22 = right.z;
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    q = { w: .25 * scale, x: (m21 - m12) / scale, y: (m02 - m20) / scale, z: (m10 - m01) / scale };
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = { w: (m21 - m12) / scale, x: .25 * scale, y: (m01 + m10) / scale, z: (m02 + m20) / scale };
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = { w: (m02 - m20) / scale, x: (m01 + m10) / scale, y: .25 * scale, z: (m12 + m21) / scale };
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = { w: (m10 - m01) / scale, x: (m02 + m20) / scale, y: (m12 + m21) / scale, z: .25 * scale };
  }
  return normalizeQuaternion(q);
}

function alignCarToWall(car, normalX, normalZ) {
  const up = { x: normalX, y: 0, z: normalZ };
  const currentForward = forwardDirection(car);
  let forward = {
    x: currentForward.x - up.x * (currentForward.x * up.x + currentForward.z * up.z),
    y: currentForward.y,
    z: currentForward.z - up.z * (currentForward.x * up.x + currentForward.z * up.z)
  };
  let forwardLength = Math.hypot(forward.x, forward.y, forward.z);
  if (forwardLength < .08) {
    const projectedVelocity = car.vx * up.x + car.vz * up.z;
    forward = {
      x: car.vx - up.x * projectedVelocity,
      y: car.vh,
      z: car.vz - up.z * projectedVelocity
    };
    forwardLength = Math.hypot(forward.x, forward.y, forward.z);
  }
  if (forwardLength < .08) forward = { x: 0, y: 0, z: normalX ? 1 : 0 };
  else { forward.x /= forwardLength; forward.y /= forwardLength; forward.z /= forwardLength; }
  let right = {
    x: forward.y * up.z - forward.z * up.y,
    y: forward.z * up.x - forward.x * up.z,
    z: forward.x * up.y - forward.y * up.x
  };
  const rightLength = Math.hypot(right.x, right.y, right.z);
  right.x /= rightLength; right.y /= rightLength; right.z /= rightLength;
  forward = {
    x: up.y * right.z - up.z * right.y,
    y: up.z * right.x - up.x * right.z,
    z: up.x * right.y - up.y * right.x
  };
  car.orientation = quaternionFromBasis(forward, up, right);
  syncEulerFromAttitude(car);
}

function rotateDirection(q, x, y, z) {
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

function attitudeFromEuler(yaw, pitch, roll) {
  let q = axisQuaternion(0, 1, 0, -yaw);
  q = multiplyQuaternion(q, axisQuaternion(0, 0, 1, -pitch));
  return normalizeQuaternion(multiplyQuaternion(q, axisQuaternion(1, 0, 0, roll)));
}

function setGroundAttitude(car) {
  car.orientation = attitudeFromEuler(car.yaw, car.pitch, car.roll);
}

function syncEulerFromAttitude(car) {
  const forward = rotateDirection(car.orientation, 1, 0, 0);
  car.yaw = wrapAngle(Math.atan2(forward.z, forward.x));
  car.pitch = -Math.asin(clamp(forward.y, -1, 1));
  if (Object.is(car.pitch, -0)) car.pitch = 0;
  const up = rotateDirection(car.orientation, 0, 1, 0);
  const right = { x: -forward.z, y: 0, z: forward.x };
  const rightLength = Math.hypot(right.x, right.z);
  if (rightLength < .0001) return;
  right.x /= rightLength; right.z /= rightLength;
  const baseUp = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x
  };
  car.roll = wrapAngle(Math.atan2(up.x * right.x + up.y * right.y + up.z * right.z, up.x * baseUp.x + up.y * baseUp.y + up.z * baseUp.z));
}

function applyAirAttitude(car, dt) {
  // Integrate the three local rates as one angular-velocity vector. Chaining
  // roll, yaw and pitch quaternions made a simultaneous input depend on that
  // arbitrary order. A single axis-angle delta preserves each isolated axis
  // and gives the combined controls one deterministic chassis-space motion.
  const localX = car.rollRate;
  const localY = -car.yawRate;
  const localZ = -car.pitchRate;
  const angularSpeed = Math.hypot(localX, localY, localZ);
  if (angularSpeed > .0000001) {
    const delta = axisQuaternion(
      localX / angularSpeed,
      localY / angularSpeed,
      localZ / angularSpeed,
      angularSpeed * dt
    );
    car.orientation = normalizeQuaternion(multiplyQuaternion(car.orientation, delta));
  }
  syncEulerFromAttitude(car);
}

function clampAirAngularVelocity(car) {
  const speed = Math.hypot(car.pitchRate, car.yawRate, car.rollRate);
  if (speed <= TUNING.airMaxAngularSpeed) return;
  const scale = TUNING.airMaxAngularSpeed / speed;
  car.pitchRate *= scale;
  car.yawRate *= scale;
  car.rollRate *= scale;
}

function applyAirControlTorque(car, pitchInput, yawInput, rollInput, dt) {
  // This is an original local-rate integrator following RocketSim's public
  // relationship: input adds local torque; pitch/yaw damping fades as their
  // axis is held; roll keeps damping while it is driven. It deliberately does
  // not impose a target angular velocity on each axis.
  car.pitchRate += (pitchInput * TUNING.airPitchTorque
    - car.pitchRate * TUNING.airPitchDamping * (1 - Math.abs(pitchInput))) * dt;
  car.yawRate += (yawInput * TUNING.airYawTorque
    - car.yawRate * TUNING.airYawDamping * (1 - Math.abs(yawInput))) * dt;
  car.rollRate += (rollInput * TUNING.airRollTorque
    - car.rollRate * TUNING.airRollDamping) * dt;
  clampAirAngularVelocity(car);
}

function forwardDirection(car) {
  return rotateDirection(car.orientation, 1, 0, 0);
}

function rightDirection(car) {
  return rotateDirection(car.orientation, 0, 0, 1);
}

function tangentDirection(direction, normal) {
  const projection = direction.x * normal.normalX + direction.y * normal.normalY + direction.z * normal.normalZ;
  const tangent = {
    x: direction.x - normal.normalX * projection,
    y: direction.y - normal.normalY * projection,
    z: direction.z - normal.normalZ * projection
  };
  const magnitude = Math.hypot(tangent.x, tangent.y, tangent.z);
  if (magnitude < .0001) return { x: direction.x, y: direction.y, z: direction.z };
  return { x: tangent.x / magnitude, y: tangent.y / magnitude, z: tangent.z / magnitude };
}

function groundSurfaceAt(x, z, ramps = RAMPS) {
  let height = 0, slopeX = 0;
  for (const ramp of ramps) {
    const localX = (x - ramp.x) * ramp.ascend;
    if (Math.abs(localX) > ramp.halfX || Math.abs(z - ramp.z) > ramp.halfZ) continue;
    const rampHeight = ((localX + ramp.halfX) / (ramp.halfX * 2)) * ramp.rise;
    if (rampHeight > height) {
      height = rampHeight;
      slopeX = ramp.ascend * ramp.rise / (ramp.halfX * 2);
    }
  }
  const normalLength = Math.hypot(slopeX, 1);
  return { height, slopeX, normalX: -slopeX / normalLength, normalY: 1 / normalLength, normalZ: 0 };
}

function chassisShape(car) {
  const forwardX = Math.cos(car.yaw), forwardZ = Math.sin(car.yaw);
  return {
    x: car.x, z: car.z,
    halfLength: CHASSIS_HALF_LENGTH, halfWidth: CHASSIS_HALF_WIDTH,
    axes: [{ x: forwardX, z: forwardZ }, { x: -forwardZ, z: forwardX }]
  };
}

function chassisVerticalBounds(car) {
  const forward = forwardDirection(car), right = rightDirection(car);
  const up = rotateDirection(car.orientation, 0, 1, 0);
  const centerY = car.h + up.y * CHASSIS_CENTER_HEIGHT;
  const radius = Math.abs(forward.y) * CHASSIS_HALF_LENGTH
    + Math.abs(right.y) * CHASSIS_HALF_WIDTH
    + Math.abs(up.y) * CHASSIS_HALF_HEIGHT;
  return { min: centerY - radius, max: centerY + radius };
}

// Resolve a contact point and impulse in the car's local chassis frame.  This
// is an original rigid-body approximation: the force is never applied as a
// world-axis rotation, so a centred hit produces no invented yaw.
function applyImpactSpin(car, contact, impulse) {
  const forward = forwardDirection(car), right = rightDirection(car);
  const up = rotateDirection(car.orientation, 0, 1, 0);
  const center = {
    x: car.x + up.x * CHASSIS_CENTER_HEIGHT,
    y: car.h + up.y * CHASSIS_CENTER_HEIGHT,
    z: car.z + up.z * CHASSIS_CENTER_HEIGHT
  };
  const offsetX = contact.x - center.x, offsetY = contact.y - center.y, offsetZ = contact.z - center.z;
  const armForward = clamp(offsetX * forward.x + offsetY * forward.y + offsetZ * forward.z, -CHASSIS_HALF_LENGTH, CHASSIS_HALF_LENGTH);
  const armSide = clamp(offsetX * right.x + offsetY * right.y + offsetZ * right.z, -CHASSIS_HALF_WIDTH, CHASSIS_HALF_WIDTH);
  const armUp = clamp(offsetX * up.x + offsetY * up.y + offsetZ * up.z, -CHASSIS_HALF_HEIGHT, CHASSIS_HALF_HEIGHT);
  const forceForward = impulse.x * forward.x + impulse.y * forward.y + impulse.z * forward.z;
  const forceSide = impulse.x * right.x + impulse.y * right.y + impulse.z * right.z;
  const forceUp = impulse.x * up.x + impulse.y * up.y + impulse.z * up.z;
  const rollTorque = armUp * forceSide - armSide * forceUp;
  const yawTorque = armSide * forceForward - armForward * forceSide;
  const pitchTorque = armForward * forceUp - armUp * forceForward;
  const torqueSize = Math.hypot(rollTorque, yawTorque, pitchTorque);
  if (torqueSize < .0001) return;
  car.impactSerial += 1;
  car.impactSpin = torqueSize;
  if (car.grounded) {
    // Wheels constrain pitch and roll on a supporting surface, but an offset
    // horizontal force can still redirect the heading.
    const yawKick = clamp(yawTorque * TUNING.groundImpactYawResponse, -TUNING.groundImpactYawLimit, TUNING.groundImpactYawLimit);
    car.yaw = wrapAngle(car.yaw + yawKick);
    setGroundAttitude(car);
    return;
  }
  car.rollRate = clamp(car.rollRate + rollTorque * TUNING.airImpactAngularResponse, -TUNING.impactAngularRateLimit, TUNING.impactAngularRateLimit);
  car.yawRate = clamp(car.yawRate + yawTorque * TUNING.airImpactAngularResponse, -TUNING.impactAngularRateLimit, TUNING.impactAngularRateLimit);
  car.pitchRate = clamp(car.pitchRate + pitchTorque * TUNING.airImpactAngularResponse, -TUNING.impactAngularRateLimit, TUNING.impactAngularRateLimit);
}

function chassisSupportPoints(car) {
  const shape = chassisShape(car);
  const forward = shape.axes[0], right = shape.axes[1];
  const points = [{ x: car.x, z: car.z }];
  for (const lengthSign of [-1, 1]) for (const widthSign of [-1, 1]) {
    points.push({
      x: car.x + forward.x * shape.halfLength * lengthSign + right.x * shape.halfWidth * widthSign,
      z: car.z + forward.z * shape.halfLength * lengthSign + right.z * shape.halfWidth * widthSign
    });
  }
  return points;
}

function coverShape(cover) {
  return {
    x: cover.x, z: cover.z, halfLength: cover.halfX, halfWidth: cover.halfZ,
    axes: [{ x: 1, z: 0 }, { x: 0, z: 1 }]
  };
}

function projectionRadius(shape, axis) {
  const [longAxis, wideAxis] = shape.axes;
  return shape.halfLength * Math.abs(longAxis.x * axis.x + longAxis.z * axis.z)
    + shape.halfWidth * Math.abs(wideAxis.x * axis.x + wideAxis.z * axis.z);
}

// Separating-axis test for two horizontal oriented boxes.  The returned normal
// points from the first shape to the second and identifies the shortest safe
// translation, keeping contact correction deterministic at 120 Hz.
function horizontalContact(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  let smallestOverlap = Infinity, normalX = 0, normalZ = 0;
  for (const axis of [...a.axes, ...b.axes]) {
    const distance = dx * axis.x + dz * axis.z;
    const overlap = projectionRadius(a, axis) + projectionRadius(b, axis) - Math.abs(distance);
    if (overlap <= 0) return null;
    if (overlap < smallestOverlap) {
      smallestOverlap = overlap;
      const side = distance >= 0 ? 1 : -1;
      normalX = axis.x * side; normalZ = axis.z * side;
    }
  }
  return { normalX, normalZ, overlap: smallestOverlap };
}

function chassisSupport(car, normalX, normalZ) {
  return projectionRadius(chassisShape(car), { x: normalX, z: normalZ });
}

function chassisContactFrame(car) {
  const forward = forwardDirection(car);
  const right = rightDirection(car);
  const up = rotateDirection(car.orientation, 0, 1, 0);
  return {
    center: {
      x: car.x + up.x * CHASSIS_CONTACT_CENTER_HEIGHT,
      y: car.h + up.y * CHASSIS_CONTACT_CENTER_HEIGHT,
      z: car.z + up.z * CHASSIS_CONTACT_CENTER_HEIGHT
    },
    axes: [forward, right, up],
    halfExtents: [CHASSIS_HALF_LENGTH, CHASSIS_HALF_WIDTH, CHASSIS_HALF_HEIGHT]
  };
}

function arenaPlaneSeparation(car, plane) {
  const frame = chassisContactFrame(car);
  const { normal, point } = plane;
  const centerDistance = (frame.center.x - point.x) * normal.x
    + (frame.center.y - point.y) * normal.y
    + (frame.center.z - point.z) * normal.z;
  let radius = 0;
  for (let index = 0; index < frame.axes.length; index += 1) {
    const axis = frame.axes[index];
    radius += frame.halfExtents[index] * Math.abs(axis.x * normal.x + axis.y * normal.y + axis.z * normal.z);
  }
  return { frame, separation: centerDistance - radius };
}

function arenaContactRecord(car, plane, separation) {
  const { frame } = arenaPlaneSeparation(car, plane);
  const { normal, point, kind } = plane;
  let support = { ...frame.center };
  for (let index = 0; index < frame.axes.length; index += 1) {
    const axis = frame.axes[index];
    const projection = axis.x * normal.x + axis.y * normal.y + axis.z * normal.z;
    const amount = -Math.sign(projection) * frame.halfExtents[index];
    support.x += axis.x * amount;
    support.y += axis.y * amount;
    support.z += axis.z * amount;
  }
  const offset = (support.x - point.x) * normal.x
    + (support.y - point.y) * normal.y
    + (support.z - point.z) * normal.z;
  support.x -= normal.x * offset;
  support.y -= normal.y * offset;
  support.z -= normal.z * offset;
  const normalVelocity = car.vx * normal.x + car.vh * normal.y + car.vz * normal.z;
  return {
    kind,
    normal: { x: normal.x, y: normal.y, z: normal.z },
    point: { x: support.x, y: support.y, z: support.z },
    wheelCount: 0,
    normalVelocity,
    separation
  };
}

function collectCalibrationContacts(car) {
  const contacts = [];
  for (const plane of CALIBRATION_PLANES) {
    const { separation } = arenaPlaneSeparation(car, plane);
    if (separation <= ARENA_CONTACT_SLOP) contacts.push(arenaContactRecord(car, plane, separation));
  }
  return contacts;
}

function wheelAnchor(frame, wheel) {
  const [forward, right, up] = frame.axes;
  return {
    x: frame.center.x + forward.x * wheel.x + right.x * wheel.z + up.x * (WHEEL_ATTACHMENT_HEIGHT - CHASSIS_CONTACT_CENTER_HEIGHT),
    y: frame.center.y + forward.y * wheel.x + right.y * wheel.z + up.y * (WHEEL_ATTACHMENT_HEIGHT - CHASSIS_CONTACT_CENTER_HEIGHT),
    z: frame.center.z + forward.z * wheel.x + right.z * wheel.z + up.z * (WHEEL_ATTACHMENT_HEIGHT - CHASSIS_CONTACT_CENTER_HEIGHT)
  };
}

function hasFloorWheelSupport(wheels) {
  return wheels.filter(wheel => wheel.kind === "floor"
    && wheel.compression >= WHEEL_GROUND_COMPRESSION
    && wheel.normalVelocity <= .05).length >= 2;
}

function collectCalibrationWheelContacts(car) {
  const frame = chassisContactFrame(car);
  const up = frame.axes[2];
  const wheels = [];
  for (const wheel of WHEEL_LAYOUT) {
    const anchor = wheelAnchor(frame, wheel);
    let closest = null;
    for (const plane of CALIBRATION_PLANES) {
      const alignment = up.x * plane.normal.x + up.y * plane.normal.y + up.z * plane.normal.z;
      if (alignment < WHEEL_MIN_ALIGNMENT) continue;
      const travel = (anchor.x - plane.point.x) * plane.normal.x
        + (anchor.y - plane.point.y) * plane.normal.y
        + (anchor.z - plane.point.z) * plane.normal.z - WHEEL_RADIUS;
      if (travel <= WHEEL_MAX_LENGTH && (!closest || travel < closest.travel)) {
        closest = { plane, travel, alignment };
      }
    }
    if (!closest) continue;
    const { plane, travel, alignment } = closest;
    const compression = clamp(WHEEL_REST_LENGTH - travel, 0, WHEEL_REST_LENGTH);
    const normalVelocity = car.vx * plane.normal.x + car.vh * plane.normal.y + car.vz * plane.normal.z;
    const force = Math.max(0, compression * TUNING.suspensionStiffness - normalVelocity * TUNING.suspensionDamping);
    wheels.push({
      id: wheel.id,
      localX: wheel.x,
      localZ: wheel.z,
      steered: wheel.steered,
      kind: plane.kind,
      normal: { ...plane.normal },
      point: {
        x: anchor.x - plane.normal.x * (travel + WHEEL_RADIUS),
        y: anchor.y - plane.normal.y * (travel + WHEEL_RADIUS),
        z: anchor.z - plane.normal.z * (travel + WHEEL_RADIUS)
      },
      travel,
      compression,
      normalVelocity,
      force,
      alignment
    });
  }
  return wheels;
}

function applyCalibrationSuspension(car, wheels, dt) {
  if (wheels.length === 0) return;
  const frame = chassisContactFrame(car);
  const [forward, right, up] = frame.axes;
  let pitchTorque = 0, rollTorque = 0;
  for (const wheel of wheels) {
    const forceX = wheel.normal.x * wheel.force;
    const forceY = wheel.normal.y * wheel.force;
    const forceZ = wheel.normal.z * wheel.force;
    car.vx += forceX * dt;
    car.vh += forceY * dt;
    car.vz += forceZ * dt;
    const armX = wheel.point.x - frame.center.x;
    const armY = wheel.point.y - frame.center.y;
    const armZ = wheel.point.z - frame.center.z;
    const armForward = armX * forward.x + armY * forward.y + armZ * forward.z;
    const armSide = armX * right.x + armY * right.y + armZ * right.z;
    const armUp = armX * up.x + armY * up.y + armZ * up.z;
    const forceForward = forceX * forward.x + forceY * forward.y + forceZ * forward.z;
    const forceSide = forceX * right.x + forceY * right.y + forceZ * right.z;
    const forceUp = forceX * up.x + forceY * up.y + forceZ * up.z;
    rollTorque += armUp * forceSide - armSide * forceUp;
    pitchTorque += armForward * forceUp - armUp * forceForward;
  }
  pitchTorque -= car.pitchRate * TUNING.suspensionAngularDamping;
  rollTorque -= car.rollRate * TUNING.suspensionAngularDamping;
  car.pitchRate = clamp(car.pitchRate + pitchTorque * TUNING.suspensionAngularResponse * dt,
    -TUNING.suspensionAngularLimit, TUNING.suspensionAngularLimit);
  car.rollRate = clamp(car.rollRate + rollTorque * TUNING.suspensionAngularResponse * dt,
    -TUNING.suspensionAngularLimit, TUNING.suspensionAngularLimit);
}

function applyCalibrationWheelDrive(car, wheels, input, dt) {
  const supported = wheels.filter(wheel => wheel.kind === "floor"
    && wheel.compression >= WHEEL_GROUND_COMPRESSION
    && wheel.normalVelocity <= .05);
  if (supported.length < 2) return;

  const forward = tangentDirection(forwardDirection(car), { normalX: 0, normalY: 1, normalZ: 0 });
  const right = tangentDirection(rightDirection(car), { normalX: 0, normalY: 1, normalZ: 0 });
  const baseForwardSpeed = car.vx * forward.x + car.vh * forward.y + car.vz * forward.z;
  const baseSideSpeed = car.vx * right.x + car.vh * right.y + car.vz * right.z;
  const handbrake = car.handbrake;
  // Steering follows the public normal and handbrake curves. RocketSim blends
  // between them using its progressively-filled handbrake value, rather than
  // swapping to a fixed turn angle on the first Shift frame.
  const normalSteerAngle = steeringAngleFromSpeed(baseForwardSpeed);
  const powerslideSteerAngle = powerslideSteeringAngleFromSpeed(baseForwardSpeed);
  const steering = clamp(input.steer, -1, 1)
    * (normalSteerAngle + (powerslideSteerAngle - normalSteerAngle) * handbrake);
  let yawTorque = 0;

  for (const wheel of supported) {
    const turn = wheel.steered ? steering : 0;
    const cosine = Math.cos(turn), sine = Math.sin(turn);
    const wheelForward = {
      x: forward.x * cosine + right.x * sine,
      y: forward.y * cosine + right.y * sine,
      z: forward.z * cosine + right.z * sine
    };
    const wheelRight = {
      x: right.x * cosine - forward.x * sine,
      y: right.y * cosine - forward.y * sine,
      z: right.z * cosine - forward.z * sine
    };
    // The yaw rate contributes the point velocity at the wheel. This gives a
    // front/rear pair different slip and produces a turning moment rather
    // than rotating yaw directly from the steering input.
    const localForwardSpeed = baseForwardSpeed - car.yawRate * wheel.localZ;
    const localSideSpeed = baseSideSpeed + car.yawRate * wheel.localX;
    // Slip is measured against the wheel's own heading. At speed, a turned
    // front wheel therefore develops lateral force even when the chassis has
    // not yet rotated, which is what initiates a physical turn.
    const longitudinalSpeed = localForwardSpeed * cosine + localSideSpeed * sine;
    const lateralSpeed = localSideSpeed * cosine - localForwardSpeed * sine;
    let longitudinalForce = 0;
    if (input.throttle > 0) {
      const driveScale = driveTorqueFactorFromSpeed(longitudinalSpeed);
      longitudinalForce = TUNING.wheelDriveForce * input.throttle * driveScale / supported.length;
    } else if (input.throttle < 0) {
      if (longitudinalSpeed > .4) longitudinalForce = TUNING.wheelBrakeForce * input.throttle / supported.length;
      else {
        const driveScale = driveTorqueFactorFromSpeed(longitudinalSpeed);
        longitudinalForce = TUNING.wheelReverseForce * input.throttle * driveScale / supported.length;
      }
    } else {
      longitudinalForce = -clamp(longitudinalSpeed * 20, -TUNING.wheelCoastForce, TUNING.wheelCoastForce) / supported.length;
    }
    const gripScale = 1 + (TUNING.powerslideLateralGripFactor - 1) * handbrake;
    let lateralForce = -lateralSpeed * TUNING.wheelLateralGrip * gripScale / supported.length;
    const maxGrip = Math.max(.01, wheel.force * TUNING.wheelGripLoad);
    const demand = Math.hypot(longitudinalForce, lateralForce);
    if (demand > maxGrip) {
      const scale = maxGrip / demand;
      longitudinalForce *= scale;
      lateralForce *= scale;
    }
    const forceX = wheelForward.x * longitudinalForce + wheelRight.x * lateralForce;
    const forceY = wheelForward.y * longitudinalForce + wheelRight.y * lateralForce;
    const forceZ = wheelForward.z * longitudinalForce + wheelRight.z * lateralForce;
    car.vx += forceX * dt;
    car.vh += forceY * dt;
    car.vz += forceZ * dt;
    const forceForward = forceX * forward.x + forceY * forward.y + forceZ * forward.z;
    const forceSide = forceX * right.x + forceY * right.y + forceZ * right.z;
    yawTorque += wheel.localX * forceSide - wheel.localZ * forceForward;
  }

  // The compact wheel model needs a bounded yaw compensation because it does
  // not use Bullet's full contact constraint. Scale it with the same
  // handbrake transition so it cannot create an instantaneous slide.
  yawTorque += input.steer * TUNING.driftYawTorque * handbrake;
  const yawRateLimit = TUNING.wheelYawRate + (TUNING.driftYawRate - TUNING.wheelYawRate) * handbrake;
  car.yawRate = clamp(car.yawRate + yawTorque * TUNING.wheelYawResponse * dt,
    -yawRateLimit, yawRateLimit);
  if (Math.abs(input.steer) < .01) {
    const yawDamping = TUNING.wheelYawDamping + (TUNING.driftYawDamping - TUNING.wheelYawDamping) * handbrake;
    car.yawRate = approach(car.yawRate, 0, yawDamping * dt);
  }
  car.yaw = wrapAngle(car.yaw + car.yawRate * dt);
  // Wheel drive updates yaw, but it must not impose an upright target on an
  // airborne attitude that has just found support. Contact and suspension are
  // the only mechanisms allowed to change pitch/roll at this boundary.
  setGroundAttitude(car);
}

function mergeCalibrationWheelContacts(contacts, wheels) {
  for (const contact of contacts) contact.wheelCount = 0;
  for (const wheel of wheels) {
    if (wheel.compression < WHEEL_LOADED_COMPRESSION) continue;
    let contact = contacts.find(candidate => candidate.kind === wheel.kind
      && candidate.normal.x === wheel.normal.x
      && candidate.normal.y === wheel.normal.y
      && candidate.normal.z === wheel.normal.z);
    if (!contact) {
      // The chassis can remain clear of a plane while its suspension is
      // supporting it. Publish that wheel-plane contact with zero geometric
      // tire separation instead of hiding the support from the snapshot.
      contact = {
        kind: wheel.kind,
        normal: { ...wheel.normal },
        point: { ...wheel.point },
        wheelCount: 0,
        normalVelocity: wheel.normalVelocity,
        separation: 0
      };
      contacts.push(contact);
    }
    contact.wheelCount += 1;
  }
  return contacts;
}

function groundContactAtChassis(car, covers = SCRAP_COVERS, ramps = RAMPS) {
  let support = groundSurfaceAt(car.x, car.z, ramps);
  for (const point of chassisSupportPoints(car)) {
    const candidate = groundSurfaceAt(point.x, point.z, ramps);
    if (candidate.height > support.height) support = candidate;
  }
  const bounds = chassisVerticalBounds(car);
  for (const cover of covers) {
    if (bounds.min < cover.height - .05) continue;
    if (!horizontalContact(coverShape(cover), chassisShape(car))) continue;
    if (cover.height > support.height) support = { height: cover.height, slopeX: 0, normalX: 0, normalY: 1, normalZ: 0, kind: "cover" };
  }
  return support;
}

function spawnPoint(team, index) {
  const slot = SPAWNS[team][index % SPAWNS[team].length];
  return { x: slot[0], z: slot[1], yaw: team === "blue" ? 0 : Math.PI };
}

function normalizeSettings(value = {}, humanCount = 0) {
  const arena = Object.hasOwn(ARENA_PROFILES, value.arena) ? value.arena : DEFAULT_MATCH_SETTINGS.arena;
  const minimumVehicles = Math.max(1, humanCount);
  // CAL-01 deliberately guarantees an uncluttered solo test when there is one
  // connected driver. Existing humans remain connected if somebody changes the
  // profile while a LAN session already has more than one driver.
  const requestedLimit = arena === "calibration" ? 1 : whole(value.vehicleLimit ?? DEFAULT_MATCH_SETTINGS.vehicleLimit);
  const vehicleLimit = clamp(requestedLimit, minimumVehicles, MAX_VEHICLES);
  const requestedBots = arena === "calibration" ? 0 : whole(value.botCount ?? DEFAULT_MATCH_SETTINGS.botCount);
  const botCount = clamp(requestedBots, 0, vehicleLimit);
  return { vehicleLimit, botCount, arena };
}

function makeCar(id, team, slot, isBot = true) {
  const p = spawnPoint(team, slot);
  return {
    id, name: isBot ? `BOT-${id.replace(/\D/g, "") || "A"}` : "PILOTO",
    team, slot, isBot, x: p.x, z: p.z, h: 0, yaw: p.yaw, pitch: 0, roll: 0,
    vx: 0, vz: 0, vh: 0, pitchRate: 0, yawRate: 0, rollRate: 0,
    orientation: attitudeFromEuler(p.yaw, 0, 0), airTime: 0, jumpState: "grounded", jumpHold: 0, jumpElapsed: 0, secondJumpWindow: 0, dodgeTime: 0, dodgePitchLock: 0, dodgeX: 0, dodgeZ: 0, dodgeH: 0, dodgeForward: 0, dodgeSide: 0, dodgeCancelling: false, lastLanding: null, pendingLanding: null, hp: 100, boost: 100, jumps: 2,
    respawn: 0, fireCooldown: 0, invulnerable: .8, ramCooldown: 0, lastHitBy: null, impactSerial: 0, impactSpin: 0, jumpSerial: 0, doubleJumpSerial: 0, dodgeSerial: 0, respawnSerial: 0, boosting: false, boostTime: 0,
    input: emptyInput(), lastJump: false, padCooldown: 0, kills: 0, deaths: 0,
    wallNormalX: 0, wallNormalZ: 0, wallRideNormalX: 0, wallRideNormalZ: 0,
    wallRide: false, wallRideTime: 0, ceilingContact: false, coverContact: false, handbrake: 0, grounded: true, contacts: [], wheels: [],
    surfaceNormalX: 0, surfaceNormalY: 1, surfaceNormalZ: 0
  };
}

function emptyInput() {
  return { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false };
}

export class ArenaMatch {
  constructor(seed = 1, settings = DEFAULT_MATCH_SETTINGS) {
    this.seed = seed >>> 0;
    this.time = 0;
    this.tickCount = 0;
    this.cars = [];
    this.rockets = [];
    this.pads = [];
    this.score = { blue: 0, red: 0 };
    this.events = [];
    this.winner = null;
    this.nextRocket = 1;
    this.nextBot = 1;
    this.stepRemainder = 0;
    this.settings = normalizeSettings(settings);
    this.resetPads();
    this.fillBots();
  }

  profile() { return ARENA_PROFILES[this.settings.arena]; }

  activeRamps() { return this.profile().ramps ? RAMPS : EMPTY_GEOMETRY; }

  activeCovers() { return this.profile().covers ? SCRAP_COVERS : EMPTY_GEOMETRY; }

  resetPads() {
    this.pads = this.profile().pads ? PAD_LAYOUT.map((p, index) => ({ id: index, x: p[0], z: p[1], timer: 0 })) : [];
  }

  random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  humanCount() { return this.cars.filter(car => !car.isBot).length; }

  teamCount(team) { return this.cars.filter(car => car.team === team).length; }

  freeSlot(team) {
    for (let slot = 0; slot < SPAWNS[team].length; slot += 1) {
      if (!this.cars.some(car => car.team === team && car.slot === slot)) return slot;
    }
    return 0;
  }

  leastPopulatedTeam() {
    // Seed the odd bot roster with Red so the first connected pilot joins Blue.
    return this.teamCount("blue") < this.teamCount("red") ? "blue" : "red";
  }

  fillBots() {
    const wanted = Math.min(this.settings.botCount, this.settings.vehicleLimit - this.humanCount());
    while (this.cars.filter(car => car.isBot).length < wanted && this.cars.length < this.settings.vehicleLimit) {
      const team = this.leastPopulatedTeam();
      const slot = this.freeSlot(team);
      this.cars.push(makeCar(`bot-${this.nextBot++}`, team, slot, true));
    }
  }

  addHuman(id, name = "PILOTO") {
    if (this.humanCount() >= this.settings.vehicleLimit) return null;
    const bots = this.cars.filter(car => car.isBot);
    let team, slot, replacement = null;
    if (this.cars.length >= this.settings.vehicleLimit) {
      const blueHumans = this.cars.filter(car => !car.isBot && car.team === "blue").length;
      const preferredTeam = blueHumans <= this.humanCount() - blueHumans ? "blue" : "red";
      replacement = bots.find(car => car.team === preferredTeam) || bots[0];
      if (!replacement) return null;
      team = replacement.team; slot = replacement.slot;
    } else {
      team = this.leastPopulatedTeam(); slot = this.freeSlot(team);
    }
    const human = makeCar(id, team, slot, false);
    human.name = String(name).slice(0, 16) || "PILOTO";
    if (replacement) this.cars[this.cars.indexOf(replacement)] = human;
    else this.cars.push(human);
    this.event(`${human.name} entra en ${human.team === "blue" ? "AZUL" : "ROJO"}.`, "join");
    return human;
  }

  removeHuman(id) {
    const index = this.cars.findIndex(car => car.id === id && !car.isBot);
    if (index < 0) return;
    const old = this.cars[index];
    this.cars.splice(index, 1);
    const beforeBots = this.cars.filter(car => car.isBot).length;
    this.fillBots();
    this.event(beforeBots < this.cars.filter(car => car.isBot).length ? `${old.name} ha salido; bot de relevo activado.` : `${old.name} ha salido.`, "leave");
  }

  configure(settings) {
    this.settings = normalizeSettings({ ...this.settings, ...settings }, this.humanCount());
    this.restart("CONFIGURACIÓN DE PARTIDA APLICADA");
  }

  restart(label = "NUEVA RONDA · primero a 15 eliminaciones") {
    const humans = this.cars.filter(car => !car.isBot).map(car => ({ id: car.id, name: car.name }));
    this.cars = [];
    this.rockets = [];
    this.resetPads();
    this.score = { blue: 0, red: 0 };
    this.events = [];
    this.winner = null;
    this.time = 0;
    this.tickCount = 0;
    this.stepRemainder = 0;
    this.nextRocket = 1;
    this.nextBot = 1;
    this.fillBots();
    for (const human of humans) this.addHuman(human.id, human.name);
    this.event(label, "round");
  }

  event(text, kind = "") {
    this.events.push({ text, kind, at: this.time });
    if (this.events.length > 10) this.events.shift();
  }

  input(id, input) {
    const car = this.cars.find(candidate => candidate.id === id && !candidate.isBot);
    if (!car) return;
    car.input = {
      throttle: clamp(Number(input.throttle) || 0, -1, 1),
      steer: clamp(Number(input.steer) || 0, -1, 1),
      jump: Boolean(input.jump), boost: Boolean(input.boost),
      drift: Boolean(input.drift), airRoll: Boolean(input.airRoll), roll: clamp(Number(input.roll) || 0, -1, 1), fire: Boolean(input.fire)
    };
  }

  tick(dt) {
    dt = clamp(dt, 0, .05);
    this.stepRemainder = Math.min(.15, this.stepRemainder + dt);
    while (this.stepRemainder + 1e-9 >= PHYSICS_STEP) {
      this.stepRemainder -= PHYSICS_STEP;
      this.simulateStep(PHYSICS_STEP);
    }
    return this.snapshot();
  }

  simulateStep(dt) {
    this.time += dt;
    this.tickCount += 1;
    for (const pad of this.pads) pad.timer = Math.max(0, pad.timer - dt);
    if (!this.winner) {
      for (const car of this.cars) {
        if (car.isBot) car.input = this.botInput(car);
        this.updateCar(car, dt);
      }
      this.resolveCarBumps();
      if (this.profile().combat) this.updateRockets(dt);
    }
  }

  botInput(car) {
    if (car.respawn > 0) return emptyInput();
    const opponents = this.cars.filter(other => other.team !== car.team && other.respawn <= 0);
    const target = opponents.sort((a, b) => (a.x - car.x) ** 2 + (a.z - car.z) ** 2 - ((b.x - car.x) ** 2 + (b.z - car.z) ** 2))[0];
    if (!target) return emptyInput();
    const desired = Math.atan2(target.z - car.z, target.x - car.x);
    const turn = clamp(wrapAngle(desired - car.yaw) * 2.4, -1, 1);
    const distance = length(target.x - car.x, target.z - car.z);
    const threatened = this.rockets.some(rocket => rocket.team !== car.team && (rocket.x - car.x) ** 2 + (rocket.z - car.z) ** 2 < 260);
    const angleError = Math.abs(wrapAngle(desired - car.yaw));
    return {
      throttle: threatened ? .7 : 1,
      steer: threatened ? (this.random() > .5 ? 1 : -1) : turn,
      jump: (threatened && car.h === 0 && this.random() < .06) || (car.h === 0 && this.random() < .004),
      boost: (distance > 20 || threatened) && car.boost > 8,
      drift: threatened && car.h <= .3, airRoll: false, roll: threatened && car.h > .3 ? turn : 0,
      fire: distance < 50 && angleError < .16 && car.fireCooldown <= 0
    };
  }

  updateCar(car, dt) {
    if (car.respawn > 0) {
      car.respawn -= dt;
      if (car.respawn <= 0) this.respawnCar(car);
      return;
    }
    const input = car.input;
    // The same action is free air roll in flight and powerslide on a surface.
    // Preserve RocketSim's gradual handbrake rise/fall so touching down with
    // Shift held has the same progressive ground response as holding it there.
    const handbrakeRate = input.drift ? POWERSLIDE_RISE_RATE : POWERSLIDE_FALL_RATE;
    car.handbrake = approach(car.handbrake, input.drift ? 1 : 0, handbrakeRate * dt);
    car.wallNormalX = 0; car.wallNormalZ = 0; car.wallRide = car.wallRideTime > 0; car.ceilingContact = false;
    car.wallRideTime = Math.max(0, car.wallRideTime - dt);
    if (!car.wallRide) { car.wallRideNormalX = 0; car.wallRideNormalZ = 0; }
    car.fireCooldown = Math.max(0, car.fireCooldown - dt);
    car.invulnerable = Math.max(0, car.invulnerable - dt);
    car.ramCooldown = Math.max(0, car.ramCooldown - dt);
    car.padCooldown = Math.max(0, car.padCooldown - dt);
    const ramps = this.activeRamps();
    const covers = this.activeCovers();
    const calibrationArena = this.settings.arena === "calibration";
    const initialContacts = calibrationArena ? collectCalibrationContacts(car) : [];
    const initialWheels = calibrationArena ? collectCalibrationWheelContacts(car) : [];
    const surface = groundContactAtChassis(car, covers, ramps);
    const surfaceNormalVelocity = car.vx * surface.normalX + car.vh * surface.normalY + car.vz * surface.normalZ;
    // Support depends on velocity away from the contact plane, not on world
    // vertical speed. A car climbing a ramp has positive vh but remains on it.
    const grounded = calibrationArena
      ? hasFloorWheelSupport(initialWheels)
      : car.h <= surface.height + .02 && surfaceNormalVelocity <= .05;
    if (!grounded && car.jumpState === "grounded") car.jumpState = "airborne";
    if (calibrationArena) {
      car.contacts = mergeCalibrationWheelContacts(initialContacts, initialWheels);
      car.wheels = initialWheels;
    }
    car.grounded = grounded;
    car.surfaceNormalX = grounded ? surface.normalX : 0;
    car.surfaceNormalY = grounded ? surface.normalY : 0;
    car.surfaceNormalZ = grounded ? surface.normalZ : 0;
    car.coverContact = grounded && surface.kind === "cover";
    const previousChassisBottom = chassisVerticalBounds(car).min;
    const wasAirborne = car.airTime > 0 || !grounded;
    let forwardX = Math.cos(car.yaw), forwardZ = Math.sin(car.yaw);

    if (grounded && calibrationArena) {
      // FIS-13A keeps CAL-01's motion on the wheel contact model. The legacy
      // direct target-speed and yaw driver below remains scoped to DESGUACE
      // until its ramps and cover contacts join the same force model.
      applyCalibrationWheelDrive(car, initialWheels, input, dt);
      const forward = forwardDirection(car);
      forwardX = forward.x; forwardZ = forward.z;
    } else if (grounded) {
      const drifting = input.drift;
      let forwardTangent = tangentDirection({ x: forwardX, y: 0, z: forwardZ }, surface);
      let rightTangent = tangentDirection({ x: -forwardZ, y: 0, z: forwardX }, surface);
      let forwardSpeed = car.vx * forwardTangent.x + car.vh * forwardTangent.y + car.vz * forwardTangent.z;
      let lateralSpeed = car.vx * rightTangent.x + car.vh * rightTangent.y + car.vz * rightTangent.z;
      const speedFactor = clamp(Math.abs(forwardSpeed) / 16, .35, 1);
      const turnRate = (drifting ? TUNING.driftTurnRate : TUNING.turnRate) * speedFactor;
      car.yaw = wrapAngle(car.yaw + input.steer * turnRate * dt);
      forwardX = Math.cos(car.yaw); forwardZ = Math.sin(car.yaw);
      forwardTangent = tangentDirection({ x: forwardX, y: 0, z: forwardZ }, surface);
      rightTangent = tangentDirection({ x: -forwardZ, y: 0, z: forwardX }, surface);

      if (input.throttle > 0) {
        const targetSpeed = TUNING.driveSpeed * input.throttle;
        if (forwardSpeed < targetSpeed) forwardSpeed = approach(forwardSpeed, targetSpeed, TUNING.driveAcceleration * dt);
        else if (!input.boost) forwardSpeed = approach(forwardSpeed, targetSpeed, TUNING.coastDrag * dt);
      }
      else if (input.throttle < 0) {
        const braking = forwardSpeed > 0 ? TUNING.brakeAcceleration : TUNING.reverseAcceleration;
        forwardSpeed = approach(forwardSpeed, TUNING.reverseSpeed * input.throttle, braking * dt);
      } else forwardSpeed = approach(forwardSpeed, 0, (drifting ? TUNING.driftDrag : TUNING.coastDrag) * dt);
      lateralSpeed = approach(lateralSpeed, 0, (drifting ? TUNING.driftGrip : TUNING.lateralGrip) * dt);
      car.vx = forwardTangent.x * forwardSpeed + rightTangent.x * lateralSpeed;
      car.vh = forwardTangent.y * forwardSpeed + rightTangent.y * lateralSpeed;
      car.vz = forwardTangent.z * forwardSpeed + rightTangent.z * lateralSpeed;
      const surfacePitch = -Math.atan(surface.slopeX * Math.cos(car.yaw));
      const surfaceRoll = Math.atan(surface.slopeX * Math.sin(car.yaw));
      car.pitch = approach(car.pitch, surfacePitch, 8 * dt);
      car.roll = approach(car.roll, surfaceRoll, (drifting ? 3.5 : 9) * dt);
      car.pitchRate = approach(car.pitchRate, 0, 8 * dt);
      car.yawRate = approach(car.yawRate, 0, 8 * dt);
      car.rollRate = approach(car.rollRate, 0, 8 * dt);
      setGroundAttitude(car);
    } else if (car.wallRide) {
      car.airTime += dt;
      const wallUp = { x: -car.wallRideNormalX, y: 0, z: -car.wallRideNormalZ };
      if (input.steer !== 0 && (wallUp.x || wallUp.z)) {
        const turn = axisQuaternion(wallUp.x, wallUp.y, wallUp.z, -input.steer * 1.25 * dt);
        car.orientation = normalizeQuaternion(multiplyQuaternion(turn, car.orientation));
        syncEulerFromAttitude(car);
      }
      const forward = forwardDirection(car);
      car.vx += forward.x * input.throttle * TUNING.wallDriveAcceleration * dt;
      car.vz += forward.z * input.throttle * TUNING.wallDriveAcceleration * dt;
      car.vh += forward.y * input.throttle * TUNING.wallDriveAcceleration * dt;
      forwardX = forward.x; forwardZ = forward.z;
    } else {
      car.airTime += dt;
      if (car.dodgeTime > 0) {
        // The horizontal burst remains committed to the edge that began the
        // dodge. A forward/backward flip receives pitch torque, a side flip
        // receives roll torque; yaw is never invented as a dodge axis.
        const control = dodgeControlState(input, car.dodgeForward, car.dodgeSide);
        car.dodgeCancelling = control.cancellation > .01;
        // The dodge does not invent yaw or erase the small yaw rate already
        // present on the jump edge. RocketSim's final vector cap naturally
        // scales that rate when the pitch/roll torque overshoots the cap.
        car.pitchRate += car.dodgeForward * TUNING.dodgePitchTorque
          * (1 - control.cancellation) * dt;
        car.rollRate += car.dodgeSide * TUNING.dodgeRollTorque * dt;
      } else {
        car.dodgeCancelling = false;
        const freeAirRollHeld = input.airRoll;
        // Rocket League convention: forward input pitches the nose downward;
        // reverse input pitches it upward. Each input drives a local angular
        // velocity target, while released controls are damped independently.
        // This keeps the result deterministic when packets arrive in bursts.
        // A completed flip retains the reference's short pitch lock. Yaw and
        // roll remain available, but a pitch input cannot immediately erase
        // the committed flip pose.
        const pitchInput = car.dodgePitchLock > 0 ? 0 : input.throttle;
        // Free air roll is a modifier: while it is held, steering becomes
        // roll and yaw is released. Directional roll remains independent and
        // can coexist with yaw when the modifier is not held.
        const yawInput = freeAirRollHeld ? 0 : input.steer;
        applyAirControlTorque(car, pitchInput, yawInput, input.roll, dt);
      }
      applyAirAttitude(car, dt);
      // RocketSim clamps angular velocity after integrating the rigid body.
      // This ordering is observable during the first 0.65 s of a flip.
      if (car.dodgeTime > 0) clampAirAngularVelocity(car);
      car.vx *= Math.max(0, 1 - .035 * dt);
      car.vz *= Math.max(0, 1 - .035 * dt);
      const forward = forwardDirection(car); forwardX = forward.x; forwardZ = forward.z;
      // Throttle is primarily an air-pitch input, but the reference vehicle
      // also gets a small chassis-aligned force from it. Keep it far below
      // boost so it supports recovery without turning W/S into a substitute
      // for boost.
      if (input.throttle !== 0) {
        const airThrottle = input.throttle * TUNING.airThrottleAcceleration * dt;
        car.vx += forward.x * airThrottle;
        car.vz += forward.z * airThrottle;
        car.vh += forward.y * airThrottle;
      }
    }

    car.secondJumpWindow = Math.max(0, car.secondJumpWindow - dt);
    car.dodgePitchLock = Math.max(0, car.dodgePitchLock - dt);
    if (car.dodgeTime > 0) {
      // RocketSim damps the vertical component after the short start window;
      // it does not add a second movement force after the initial impulse.
      const dodgeElapsed = TUNING.dodgeTime - car.dodgeTime;
      if (dodgeElapsed >= TUNING.dodgeVerticalDampStart
          && (car.vh < 0 || dodgeElapsed < TUNING.dodgeVerticalDampEnd)) {
        const tickScale = dt / (1 / 120);
        car.vh *= Math.pow(1 - TUNING.dodgeVerticalDampPerStep, tickScale);
      }
      car.dodgeTime = Math.max(0, car.dodgeTime - dt);
      if (car.dodgeTime === 0) {
        car.dodgeCancelling = false;
        if (car.jumpState === "dodge") car.jumpState = "airborne";
      }
    }
    const jumpPressed = input.jump && !car.lastJump;
    let firstJumpStarted = false;
    if (jumpPressed && car.wallRide && car.jumps > 0) {
      car.jumps -= 1;
      car.vx -= car.wallRideNormalX * TUNING.wallJumpImpulse;
      car.vz -= car.wallRideNormalZ * TUNING.wallJumpImpulse;
      car.vh = Math.max(car.vh + TUNING.wallJumpLift, TUNING.wallJumpLift);
      car.wallRide = false; car.wallRideTime = 0;
      car.wallRideNormalX = 0; car.wallRideNormalZ = 0;
      car.jumpHold = 0; car.jumpElapsed = 0; car.secondJumpWindow = 0; car.dodgeTime = 0; car.dodgePitchLock = 0; car.dodgeForward = 0; car.dodgeSide = 0; car.dodgeCancelling = false;
      car.jumpState = "wall-jump";
      car.jumpSerial += 1;
      this.event(`${car.name} salta desde la pared.`, "wall-jump");
    } else if (jumpPressed && grounded && car.jumps === 2) {
      car.jumps = 1;
      // The flat arena keeps the legacy vertical impulse. On a ramp, a small
      // normal component stops the jump from being glued to the surface and
      // gives the later wall-contact story a single impulse convention.
      car.vx += surface.normalX * TUNING.jumpImpulse;
      car.vz += surface.normalZ * TUNING.jumpImpulse;
      car.vh = surface.normalY * TUNING.jumpImpulse;
      car.h = Math.max(.15, car.h);
      car.airTime = .001;
      car.jumpState = "first-jump";
      car.jumpHold = TUNING.jumpHoldTime;
      car.jumpElapsed = 0;
      car.secondJumpWindow = 0;
      firstJumpStarted = true;
      car.pitchRate = 0; car.yawRate = 0; car.rollRate = 0;
      car.jumpSerial += 1;
      this.event(`${car.name} salta.`, "jump");
    } else if (jumpPressed && !grounded && car.jumps === 1 && car.airTime > .005 && car.secondJumpWindow > 0) {
      car.jumps = 0;
      // Keep the dodge direction in the same local control plane as the air
      // controls.  In particular, direct air roll contributes to the lateral
      // dodge axis; when free air roll is held, steering has already changed
      // role from yaw to roll and must not be counted twice.  This mirrors the
      // reference game's observable input contract without copying its hidden
      // physics implementation.
      const dodgeAxes = dodgeInputAxes(input);
      const dodgeMagnitude = Math.hypot(dodgeAxes.forward, dodgeAxes.side);
      const hasDodgeDirection = Math.abs(dodgeAxes.forward) + Math.abs(dodgeAxes.side) >= TUNING.dodgeDeadzone;
      if (!hasDodgeDirection) {
        car.vh = Math.max(car.vh + TUNING.doubleJumpImpulse, TUNING.doubleJumpMinVelocity);
        car.jumpState = "double-jump";
        car.jumpHold = 0;
        car.jumpElapsed = 0;
        car.doubleJumpSerial += 1;
        this.event(`${car.name} hace doble salto.`, "double-jump");
      } else {
        // A directional second jump is a committed, normalized dodge in body
        // space. Diagonals retain the same total burst as a forward dodge.
        const forwardAmount = dodgeAxes.forward / dodgeMagnitude;
        const sideAmount = dodgeAxes.side / dodgeMagnitude;
        const impulse = dodgeImpulse(car, forwardAmount, sideAmount);
        car.vx += impulse.x;
        car.vz += impulse.z;
        car.dodgeX = impulse.x;
        car.dodgeZ = impulse.z;
        car.dodgeH = 0;
        car.dodgeForward = forwardAmount;
        car.dodgeSide = sideAmount;
        car.dodgeCancelling = false;
        car.dodgeTime = TUNING.dodgeTime;
        car.dodgePitchLock = TUNING.dodgeTime + TUNING.dodgePitchLockTime;
        car.jumpState = "dodge";
        car.jumpHold = 0;
        car.jumpElapsed = 0;
        // The torque window starts on the next physics tick, after the
        // one-shot impulse has been committed. This matches the source update
        // order and avoids a double attitude step on the activation frame.
        car.dodgeSerial += 1;
        this.event(`${car.name} hace dodge aéreo.`, "dodge");
      }
    }
    // RocketSim guarantees a minimum jump pulse and starts the second-action
    // window only after the sustained first-jump force has ended. A quick key
    // tap therefore cannot shorten the takeoff or move the dodge window earlier.
    if (car.jumpState === "first-jump" && (!grounded || firstJumpStarted)) {
      const jumpCanContinue = car.jumpElapsed < TUNING.jumpHoldTime - 1e-9;
      const minimumPulse = car.jumpElapsed < TUNING.jumpMinTime - 1e-9;
      if (jumpCanContinue && (minimumPulse || input.jump)) {
        const forceScale = minimumPulse ? .62 : 1;
        car.vh += TUNING.jumpHoldAcceleration * forceScale * dt;
        car.jumpElapsed = Math.min(TUNING.jumpHoldTime, car.jumpElapsed + dt);
        car.jumpHold = Math.max(0, TUNING.jumpHoldTime - car.jumpElapsed);
      } else if (car.jumpHold > 0 || car.secondJumpWindow === 0) {
        car.jumpHold = 0;
        car.secondJumpWindow = TUNING.secondJumpTime;
        car.jumpState = "airborne";
      }
    }
    car.lastJump = input.jump;
    const unlimitedBoost = this.profile().unlimitedBoost;
    // Resource exhaustion always ends boost on the following fixed step. The
    // minimum pulse only applies while a unit of boost is still available.
    const hasBoost = unlimitedBoost || car.boost > 0;
    const wantsBoost = input.boost && hasBoost;
    if (!hasBoost) car.boosting = false;
    else if (car.boosting) {
      if (!wantsBoost && car.boostTime >= TUNING.boostMinTime) car.boosting = false;
    } else if (wantsBoost) car.boosting = true;
    if (car.boosting) {
      car.boostTime += dt;
      if (!unlimitedBoost) car.boost = Math.max(0, car.boost - TUNING.boostDrain * dt);
      const thrust = forwardDirection(car);
      const boostAcceleration = grounded ? TUNING.boostGroundAcceleration : TUNING.boostAirAcceleration;
      car.vx += thrust.x * boostAcceleration * dt;
      car.vz += thrust.z * boostAcceleration * dt;
      // The chassis forward axis already follows a grounded ramp. Applying
      // all three components keeps boost tangent to the contact plane instead
      // of flattening its uphill component.
      car.vh += thrust.y * boostAcceleration * dt;
    } else {
      car.boostTime = 0;
      if (TUNING.boostRecovery > 0) car.boost = Math.min(100, car.boost + TUNING.boostRecovery * dt);
    }

    if (calibrationArena && car.wheels.length > 0) {
      applyCalibrationSuspension(car, car.wheels, dt);
      // Wheel drive owns grounded yaw in CAL-01. Suspension contributes pitch
      // and roll around those same local axes without imposing an attitude.
      if (Math.abs(car.pitchRate) > .00001 || Math.abs(car.rollRate) > .00001) applyAirAttitude(car, dt);
    }

    car.vh -= (car.wallRide ? TUNING.wallRideGravity : TUNING.gravity) * dt;
    // Clamp after every velocity-changing force in this step. Clamping before
    // gravity allowed an already capped airborne car to exceed maxSpeed by the
    // end of the substep.
    const speed = Math.hypot(car.vx, car.vz, car.vh);
    if (speed > TUNING.maxSpeed) { const scale = TUNING.maxSpeed / speed; car.vx *= scale; car.vz *= scale; car.vh *= scale; }
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    car.h += car.vh * dt;
    if (calibrationArena) this.resolveCalibrationArenaContacts(car);
    else this.clampToArena(car);
    this.resolveCoverCollisions(car, previousChassisBottom, covers);
    const landingSurface = groundContactAtChassis(car, covers, ramps);
    const floorContactAfterMove = calibrationArena
      ? car.contacts.find(contact => contact.kind === "floor"
        && contact.separation <= ARENA_SUPPORT_SLOP && contact.normalVelocity <= .05)
      : null;
    const wheelsAfterMove = calibrationArena ? collectCalibrationWheelContacts(car) : [];
    const retainsGroundSupport = grounded
      && car.airTime <= 0
      && landingSurface.height >= car.h - .35
      && car.h <= landingSurface.height + .35;
    const followsSurface = calibrationArena ? hasFloorWheelSupport(wheelsAfterMove) || Boolean(floorContactAfterMove) : retainsGroundSupport;
    if (grounded && !retainsGroundSupport && landingSurface.height < surface.height - .1 && car.vh > 0) {
      // A ramp edge is a support discontinuity. Release the car into gravity
      // instead of carrying an artificial upward component beyond the mesh.
      car.vh = -TUNING.gravity * dt;
    }
    if (followsSurface || (!calibrationArena && car.h <= landingSurface.height)) {
      if (car.vh < -8) { car.vx *= .82; car.vz *= .82; }
      const normalVelocity = car.vx * landingSurface.normalX
        + car.vh * landingSurface.normalY
        + car.vz * landingSurface.normalZ;
      car.vx -= landingSurface.normalX * normalVelocity;
      car.vh -= landingSurface.normalY * normalVelocity;
      car.vz -= landingSurface.normalZ * normalVelocity;
      // A rotated chassis can reach the floor before any tire does. Once the
      // landing branch levels it to the ground frame, place the wheel root on
      // that plane as well; otherwise a full dodge can be left floating at
      // the old rotated-body height with no wheel support.
      car.h = landingSurface.height;
      if (wasAirborne) {
        const landingObservation = {
          frame: this.tickCount,
          pitch: car.pitch,
          roll: car.roll,
          pitchRate: car.pitchRate,
          rollRate: car.rollRate,
          normalSpeed: normalVelocity
        };
        // In CAL-01, a chassis contact can precede actual suspension support.
        // Keep its pre-recovery values but publish it only if the final wheel
        // manifold accepts the landing on this or a later substep.
        if (calibrationArena) car.pendingLanding = landingObservation;
        else car.lastLanding = landingObservation;
      }
      car.airTime = 0;
      if (!calibrationArena) {
        car.jumps = 2; car.jumpState = "grounded"; car.jumpHold = 0; car.jumpElapsed = 0; car.secondJumpWindow = 0; car.dodgeTime = 0; car.dodgePitchLock = 0; car.dodgeForward = 0; car.dodgeSide = 0; car.dodgeCancelling = false;
        car.grounded = true;
        car.surfaceNormalX = landingSurface.normalX;
        car.surfaceNormalY = landingSurface.normalY;
        car.surfaceNormalZ = landingSurface.normalZ;
        car.coverContact = landingSurface.kind === "cover";
      }
      // Do not flatten or retarget the chassis on landing. The orientation
      // remains the one produced by air controls and contact resolution; the
      // wheel springs may then react through their physical forces.
    }
    if (calibrationArena) {
      // Re-solve after the inherited landing attitude adjustment, then derive
      // support and legacy HUD normals from the common six-plane manifold.
      this.resolveCalibrationArenaContacts(car);
      car.wheels = collectCalibrationWheelContacts(car);
      const chassisFloorSupport = car.contacts.find(contact => contact.kind === "floor"
        && contact.separation <= ARENA_SUPPORT_SLOP && contact.normalVelocity <= .05);
      car.contacts = mergeCalibrationWheelContacts(car.contacts, car.wheels);
      const floorWheel = car.wheels.find(wheel => wheel.kind === "floor"
        && wheel.compression >= WHEEL_GROUND_COMPRESSION
        && wheel.normalVelocity <= .05);
      // A body-floor contact can resolve a fast impact before the suspension
      // has loaded. It still belongs in `contacts`, but it must not hand back
      // driving, jumps, or the grounded state without a real wheel support.
      car.grounded = hasFloorWheelSupport(car.wheels);
      const floorSupport = floorWheel || (car.grounded ? chassisFloorSupport : null);
      // The final manifold is authoritative. A body contact can resolve late
      // in a fast landing, after the earlier support pass has run, so close
      // the jump action here as well as in the regular landing branch.
      if (car.grounded) {
        if (car.pendingLanding) {
          car.lastLanding = car.pendingLanding;
          car.pendingLanding = null;
        }
        car.jumps = 2;
        car.jumpState = "grounded";
        car.jumpHold = 0;
        car.jumpElapsed = 0;
        car.secondJumpWindow = 0;
        car.dodgeTime = 0;
        car.dodgePitchLock = 0;
        car.dodgeForward = 0;
        car.dodgeSide = 0;
        car.dodgeCancelling = false;
      }
      car.surfaceNormalX = floorSupport ? floorSupport.normal.x : 0;
      car.surfaceNormalY = floorSupport ? floorSupport.normal.y : 0;
      car.surfaceNormalZ = floorSupport ? floorSupport.normal.z : 0;
      car.coverContact = false;
    }
    for (const pad of this.pads) {
      if (pad.timer <= 0 && car.padCooldown <= 0 && (pad.x - car.x) ** 2 + (pad.z - car.z) ** 2 < 20) {
        car.boost = Math.min(100, car.boost + 38);
        pad.timer = 6; car.padCooldown = .4;
        this.event(`${car.name} recoge nitro.`, "pad");
      }
    }
    if (this.profile().combat && input.fire && car.fireCooldown <= 0) this.fireRocket(car);
  }

  clampToArena(car) {
    for (const axis of [["x", "vx", ARENA.halfWidth], ["z", "vz", ARENA.halfDepth]]) {
      const [position, velocity, limit] = axis;
      const normalX = position === "x" ? 1 : 0, normalZ = position === "z" ? 1 : 0;
      const innerLimit = limit - chassisSupport(car, normalX, normalZ);
      const storedNormal = position === "x" ? car.wallRideNormalX : car.wallRideNormalZ;
      const sameRideWall = car.wallRideTime > 0 && Math.abs(storedNormal) > 0 && Math.sign(storedNormal) === Math.sign(car[position]);
      const rideContact = sameRideWall && innerLimit - Math.abs(car[position]) <= .12;
      if (Math.abs(car[position]) > innerLimit || rideContact) {
        const wallSide = Math.sign(car[position]) || Math.sign(storedNormal);
        car[position] = wallSide * innerLimit;
        const towardWall = car[velocity] * wallSide;
        if (position === "x") car.wallNormalX = wallSide;
        else car.wallNormalZ = wallSide;
        const tangentSpeed = Math.hypot(position === "x" ? car.vz : car.vx, car.vh);
        const wantsWallRide = car.h > TUNING.wallRideMinHeight && car.airTime > .005
          && (car.input.throttle !== 0 || car.input.boost) && (tangentSpeed > 5 || towardWall > 0);
        if (wantsWallRide) {
          // Contact removes only the component pointing out of the wall. The
          // tangent (horizontal or vertical) remains continuous, so a car can
          // slide along a wall instead of bouncing away from it.
          if (towardWall > 0) car[velocity] -= wallSide * towardWall;
          car.wallRide = true;
          car.wallRideTime = TUNING.wallRideWindow;
          car.wallRideNormalX = position === "x" ? wallSide : 0;
          car.wallRideNormalZ = position === "z" ? wallSide : 0;
          alignCarToWall(car, position === "x" ? -wallSide : 0, position === "z" ? -wallSide : 0);
          car[position] = wallSide * (limit - chassisSupport(car, normalX, normalZ));
        } else if (towardWall > 0) {
          car[velocity] -= wallSide * towardWall * (1 + TUNING.wallRestitution);
        }
      }
    }
    if (car.h > ARENA.ceilingHeight) {
      car.h = ARENA.ceilingHeight;
      if (car.vh > 0) car.vh = -car.vh * TUNING.wallRestitution;
      car.ceilingContact = true;
    }
  }

  resolveCalibrationArenaContacts(car) {
    // Each plane resolves only penetration and inward normal velocity. Two
    // ordered passes settle corners deterministically while leaving tangent
    // velocity and chassis attitude untouched.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const plane of CALIBRATION_PLANES) {
        const { separation } = arenaPlaneSeparation(car, plane);
        if (separation >= 0) continue;
        const contact = arenaContactRecord(car, plane, separation);
        const correction = -separation;
        car.x += plane.normal.x * correction;
        car.h += plane.normal.y * correction;
        car.z += plane.normal.z * correction;
        const normalVelocity = car.vx * plane.normal.x + car.vh * plane.normal.y + car.vz * plane.normal.z;
        const normalImpulse = normalVelocity < 0 ? -normalVelocity : 0;
        if (normalImpulse > 0) {
          // Resolve the incoming normal impulse at its actual contact point.
          // The resulting moment lets a tipped chassis roll/pitch toward its
          // wheel manifold after a body-first landing, while a centred flat
          // impact leaves the attitude untouched.
          const frame = contact && arenaPlaneSeparation(car, plane).frame;
          if (frame) {
            const armX = contact.point.x - frame.center.x;
            const armY = contact.point.y - frame.center.y;
            const armZ = contact.point.z - frame.center.z;
            const [forward, right, up] = frame.axes;
            const armForward = armX * forward.x + armY * forward.y + armZ * forward.z;
            const armSide = armX * right.x + armY * right.y + armZ * right.z;
            const armUp = armX * up.x + armY * up.y + armZ * up.z;
            const impulseX = plane.normal.x * normalImpulse;
            const impulseY = plane.normal.y * normalImpulse;
            const impulseZ = plane.normal.z * normalImpulse;
            const impulseForward = impulseX * forward.x + impulseY * forward.y + impulseZ * forward.z;
            const impulseSide = impulseX * right.x + impulseY * right.y + impulseZ * right.z;
            const impulseUp = impulseX * up.x + impulseY * up.y + impulseZ * up.z;
            const pitchTorque = armForward * impulseUp - armUp * impulseForward;
            const rollTorque = armUp * impulseSide - armSide * impulseUp;
            // Euler pitch/roll rates use the inverse sign of the local
            // right-handed collision moment used by the chassis basis.
            car.pitchRate = clamp(car.pitchRate - pitchTorque * TUNING.contactAngularResponse,
              -TUNING.suspensionAngularLimit, TUNING.suspensionAngularLimit);
            car.rollRate = clamp(car.rollRate - rollTorque * TUNING.contactAngularResponse,
              -TUNING.suspensionAngularLimit, TUNING.suspensionAngularLimit);
          }
          car.vx -= plane.normal.x * normalVelocity;
          car.vh -= plane.normal.y * normalVelocity;
          car.vz -= plane.normal.z * normalVelocity;
        }
      }
    }
    car.contacts = collectCalibrationContacts(car);
    const wall = car.contacts.find(contact => contact.kind === "wall");
    car.wallNormalX = wall ? -wall.normal.x : 0;
    car.wallNormalZ = wall ? -wall.normal.z : 0;
    car.ceilingContact = car.contacts.some(contact => contact.kind === "ceiling");
    car.wallRide = false;
    car.wallRideTime = 0;
    car.wallRideNormalX = 0;
    car.wallRideNormalZ = 0;
    return car.contacts;
  }

  resolveCoverCollisions(car, previousChassisBottom, covers = SCRAP_COVERS) {
    for (const cover of covers) {
      const contact = horizontalContact(coverShape(cover), chassisShape(car));
      if (!contact) continue;
      const bounds = chassisVerticalBounds(car);
      // A falling chassis that crossed the top is lifted onto the same cover
      // surface that groundContactAtChassis exposes on the next landing pass.
      if (previousChassisBottom >= cover.height - .05 && bounds.min < cover.height && car.vh <= 0) {
        car.h += cover.height - bounds.min;
        car.vh = 0;
        continue;
      }
      // A full chassis volume above the cover does not receive a horizontal
      // correction, so flying over a container is possible.
      if (bounds.min >= cover.height - .05 || bounds.max <= 0) continue;
      car.x += contact.normalX * contact.overlap;
      car.z += contact.normalZ * contact.overlap;
      const intoCover = car.vx * contact.normalX + car.vz * contact.normalZ;
      if (intoCover < 0) {
        const rebound = 1 + TUNING.wallRestitution;
        car.vx -= contact.normalX * intoCover * rebound;
        car.vz -= contact.normalZ * intoCover * rebound;
      }
    }
  }

  resolveCarBumps() {
    for (let i = 0; i < this.cars.length; i += 1) for (let j = i + 1; j < this.cars.length; j += 1) {
      const a = this.cars[i], b = this.cars[j];
      if (a.respawn > 0 || b.respawn > 0) continue;
      const aBounds = chassisVerticalBounds(a), bBounds = chassisVerticalBounds(b);
      if (aBounds.min < bBounds.max && bBounds.min < aBounds.max) {
        const contact = horizontalContact(chassisShape(a), chassisShape(b));
        if (!contact) continue;
        const { normalX: nx, normalZ: nz } = contact;
        const push = contact.overlap * .5;
        // Positional correction happens before impulse so idle cars cannot stay
        // interpenetrating.  Velocity remains responsible for the game feel.
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
        const relativeSpeed = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        const impulse = relativeSpeed < 0 ? -relativeSpeed * .58 : 0;
        a.vx -= nx * impulse; a.vz -= nz * impulse;
        b.vx += nx * impulse; b.vz += nz * impulse;
        if (impulse > .01) {
          const contact = { x: (a.x + b.x) * .5, y: (a.h + b.h) * .5 + CHASSIS_CENTER_HEIGHT, z: (a.z + b.z) * .5 };
          applyImpactSpin(a, contact, { x: -nx * impulse, y: 0, z: -nz * impulse });
          applyImpactSpin(b, contact, { x: nx * impulse, y: 0, z: nz * impulse });
        }
        const closingSpeed = -relativeSpeed;
        if (a.team !== b.team && closingSpeed >= TUNING.ramSpeedThreshold && a.ramCooldown <= 0 && b.ramCooldown <= 0) {
          const aToward = a.vx * nx + a.vz * nz;
          const bToward = -(b.vx * nx + b.vz * nz);
          const attacker = aToward >= bToward ? a : b;
          const victim = attacker === a ? b : a;
          const damage = Math.min(TUNING.ramDamageCap, Math.round((closingSpeed - TUNING.ramSpeedThreshold) * TUNING.ramDamagePerSpeed));
          if (damage > 0) {
            a.ramCooldown = b.ramCooldown = .38;
            this.damage(victim, damage, attacker.id);
            this.event(`${attacker.name} EMBISTE A ${victim.name} · -${damage} blindaje`, "ram");
          }
        }
      }
    }
  }

  rocketHitsCover(rocket, covers = SCRAP_COVERS) {
    return covers.some(cover => rocket.h <= cover.height + .65 && Math.abs(rocket.x - cover.x) <= cover.halfX + .25 && Math.abs(rocket.z - cover.z) <= cover.halfZ + .25);
  }

  rocketHitsRamp(rocket, ramps = RAMPS) {
    return rocket.h <= groundSurfaceAt(rocket.x, rocket.z, ramps).height + .18;
  }

  fireRocket(car) {
    if (!this.profile().combat) return;
    const direction = forwardDirection(car), { x: fx, z: fz, y: fy } = direction;
    car.fireCooldown = .72;
    this.rockets.push({ id: this.nextRocket++, team: car.team, owner: car.id, x: car.x + fx * 2.5, z: car.z + fz * 2.5, h: car.h + 1.1 + fy * 2.5, vx: car.vx + fx * 74, vz: car.vz + fz * 74, vh: car.vh + fy * 74, life: 2.1 });
    this.event(`${car.name} lanza un cohete.`, "fire");
  }

  updateRockets(dt) {
    const covers = this.activeCovers(), ramps = this.activeRamps();
    const remaining = [];
    for (const rocket of this.rockets) {
      rocket.life -= dt; rocket.x += rocket.vx * dt; rocket.z += rocket.vz * dt; rocket.h += rocket.vh * dt;
      const victim = this.cars.find(car => car.team !== rocket.team && car.respawn <= 0 && (car.x - rocket.x) ** 2 + (car.z - rocket.z) ** 2 < 10 && Math.abs(car.h - rocket.h) < 3.5);
      const cover = this.rocketHitsCover(rocket, covers);
      const ramp = this.rocketHitsRamp(rocket, ramps);
      const boundary = Math.abs(rocket.x) > ARENA.halfWidth || Math.abs(rocket.z) > ARENA.halfDepth || rocket.life <= 0;
      if (ramp || cover || victim || boundary) this.explode(rocket, victim ? "impacto directo" : cover ? "cohete contra cobertura" : ramp ? "cohete contra rampa" : "impacto", victim);
      else remaining.push(rocket);
    }
    this.rockets = remaining;
  }

  explode(rocket, label, direct) {
    let hit = false;
    for (const car of this.cars) {
      if (car.team === rocket.team || car.respawn > 0 || car.invulnerable > 0) continue;
      let blastX = car.x - rocket.x, blastZ = car.z - rocket.z;
      const distance = length(blastX, blastZ);
      if (distance > 7) continue;
      const falloff = 1 - distance / 7;
      const damage = direct === car ? 65 : Math.round(42 * falloff);
      // Blast force creates combat movement as well as damage. A direct hit
      // uses the rocket's heading when the explosion is centred on the car.
      if (distance < .05) { blastX = rocket.vx; blastZ = rocket.vz; }
      const blastLength = Math.max(.001, length(blastX, blastZ));
      const kick = (direct === car ? 18 : 12) * Math.max(.28, falloff);
      car.vx += blastX / blastLength * kick;
      car.vz += blastZ / blastLength * kick;
      car.vh += (direct === car ? 7 : 4) * Math.max(.28, falloff);
      applyImpactSpin(car, { x: rocket.x, y: rocket.h, z: rocket.z }, {
        x: blastX / blastLength * kick,
        y: (direct === car ? 7 : 4) * Math.max(.28, falloff),
        z: blastZ / blastLength * kick
      });
      if (damage > 0) { this.damage(car, damage, rocket.owner); hit = true; }
    }
    const missText = label === "cohete contra cobertura" ? "COHETE CONTRA COBERTURA" : label === "cohete contra rampa" ? "COHETE CONTRA RAMPA" : "cohete detonado";
    this.event(hit ? `${label.toUpperCase()} · blindaje dañado` : missText, hit ? "hit" : "miss");
  }

  damage(victim, amount, attackerId) {
    victim.hp -= amount; victim.lastHitBy = attackerId;
    if (victim.hp <= 0) this.eliminate(victim, attackerId);
  }

  eliminate(victim, attackerId) {
    if (victim.respawn > 0) return;
    victim.respawn = 2.35; victim.hp = 0; victim.vx = victim.vz = victim.vh = 0; victim.deaths += 1;
    const attacker = this.cars.find(car => car.id === attackerId);
    const killerTeam = attacker && attacker.team !== victim.team ? attacker.team : null;
    if (killerTeam) {
      this.score[killerTeam] += 1;
      attacker.kills += 1;
      this.event(`${attacker.name} ELIMINA A ${victim.name}`, "elimination");
      if (this.score[killerTeam] >= ARENA.scoreToWin) {
        this.winner = killerTeam;
        this.event(`${killerTeam === "blue" ? "AZUL" : "ROJO"} GANA LA RONDA`, "winner");
      }
    } else this.event(`${victim.name} queda fuera de combate.`, "elimination");
  }

  respawnCar(car) {
    const p = spawnPoint(car.team, car.slot);
    Object.assign(car, { x: p.x, z: p.z, yaw: p.yaw, pitch: 0, roll: 0, h: 0, vx: 0, vz: 0, vh: 0, pitchRate: 0, yawRate: 0, rollRate: 0, orientation: attitudeFromEuler(p.yaw, 0, 0), airTime: 0, jumpState: "grounded", jumpHold: 0, jumpElapsed: 0, secondJumpWindow: 0, dodgeTime: 0, dodgePitchLock: 0, dodgeX: 0, dodgeZ: 0, dodgeH: 0, dodgeForward: 0, dodgeSide: 0, dodgeCancelling: false, lastLanding: null, pendingLanding: null, wallNormalX: 0, wallNormalZ: 0, wallRideNormalX: 0, wallRideNormalZ: 0, wallRide: false, wallRideTime: 0, ceilingContact: false, handbrake: 0, boosting: false, boostTime: 0, contacts: [], wheels: [], coverContact: false, hp: 100, boost: 33, jumps: 2, respawn: 0, invulnerable: .9, lastJump: false, impactSpin: 0 });
    car.respawnSerial += 1;
    this.event(`${car.name} reaparece.`, "respawn");
  }

  snapshot() {
    const profile = this.profile();
    return {
      time: round(this.time), score: this.score, winner: this.winner,
      settings: { ...this.settings, humans: this.humanCount(), bots: this.cars.filter(car => car.isBot).length, profile: profile.label },
      rules: { pads: profile.pads, combat: profile.combat, unlimitedBoost: profile.unlimitedBoost, ramps: profile.ramps, covers: profile.covers },
      cars: this.cars.map(car => {
        const forward = forwardDirection(car);
        return {
          id: car.id, name: car.name, team: car.team, bot: car.isBot,
          x: round(car.x), z: round(car.z), h: round(car.h),
          yaw: round(car.yaw), pitch: round(car.pitch), roll: round(car.roll),
          orientation: { x: round(car.orientation.x), y: round(car.orientation.y), z: round(car.orientation.z), w: round(car.orientation.w) },
          angularVelocity: { pitch: roundAngularRate(car.pitchRate), yaw: roundAngularRate(car.yawRate), roll: roundAngularRate(car.rollRate) },
          impactSerial: car.impactSerial, impactSpin: round(car.impactSpin),
          actionSerials: { jump: car.jumpSerial, doubleJump: car.doubleJumpSerial, dodge: car.dodgeSerial, respawn: car.respawnSerial },
          speed: round(Math.hypot(car.vx, car.vz, car.vh)),
          velocity: { x: round(car.vx), y: round(car.vh), z: round(car.vz) },
          forwardSpeed: round(car.vx * forward.x + car.vh * forward.y + car.vz * forward.z),
          steer: car.input.steer, powerslide: round(car.handbrake), grounded: car.grounded,
          surfaceNormal: { x: round(car.surfaceNormalX), y: round(car.surfaceNormalY), z: round(car.surfaceNormalZ) },
          contacts: (car.contacts || []).map(contact => ({
            kind: contact.kind,
            normal: { x: round(contact.normal.x), y: round(contact.normal.y), z: round(contact.normal.z) },
            point: { x: round(contact.point.x), y: round(contact.point.y), z: round(contact.point.z) },
            wheelCount: contact.wheelCount,
            normalVelocity: round(contact.normalVelocity),
            separation: round(contact.separation)
          })),
          wheels: (car.wheels || []).map(wheel => ({
            id: wheel.id,
            kind: wheel.kind,
            normal: { x: round(wheel.normal.x), y: round(wheel.normal.y), z: round(wheel.normal.z) },
            point: { x: round(wheel.point.x), y: round(wheel.point.y), z: round(wheel.point.z) },
            travel: round(wheel.travel), compression: round(wheel.compression),
            normalVelocity: round(wheel.normalVelocity), force: round(wheel.force)
          })),
          surfaceType: car.coverContact ? "cover" : car.grounded ? "ground" : "air",
          jumpState: car.jumpState, jumpHoldRemaining: round(car.jumpHold), jumpHeldFor: round(car.jumpElapsed), jumpWindowRemaining: round(car.secondJumpWindow),
          dodging: car.dodgeTime > 0, dodgeRemaining: round(car.dodgeTime), dodgePitchLockRemaining: round(car.dodgePitchLock), dodgeCancelling: car.dodgeCancelling,
          // Publish the committed local direction for calibration. It is an
          // observation of the server state, never a client-side steering
          // request, so the trace can prove exactly which dodge was accepted.
          dodgeDirection: { forward: round(car.dodgeForward), side: round(car.dodgeSide) },
          lastLanding: car.lastLanding ? {
            frame: car.lastLanding.frame,
            pitch: round(car.lastLanding.pitch), roll: round(car.lastLanding.roll),
            pitchRate: round(car.lastLanding.pitchRate), rollRate: round(car.lastLanding.rollRate),
            normalSpeed: round(car.lastLanding.normalSpeed)
          } : null,
          supersonic: Math.hypot(car.vx, car.vz) > TUNING.supersonicSpeed,
          hp: round(car.hp), boost: round(car.boost), jumps: car.jumps,
          respawn: round(Math.max(0, car.respawn)), kills: car.kills, deaths: car.deaths,
          boosting: car.boosting,
          wallNormal: { x: car.wallNormalX, z: car.wallNormalZ },
          wallRide: car.wallRide, ceilingContact: car.ceilingContact
        };
      }),
      rockets: this.rockets.map(rocket => ({ id: rocket.id, team: rocket.team, x: round(rocket.x), z: round(rocket.z), h: round(rocket.h), vx: round(rocket.vx), vz: round(rocket.vz), vh: round(rocket.vh) })),
      pads: this.pads.map(pad => ({ ...pad, timer: round(pad.timer) })),
      events: this.events.slice(-4)
    };
  }
}
