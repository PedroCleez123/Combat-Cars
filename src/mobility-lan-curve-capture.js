import { normalizeCurveInput } from "./rocketsim-curve-capture.js";

const round = value => {
  const rounded = Math.round(Number(value || 0) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

function serials(car) {
  return {
    jump: Math.max(0, Number(car?.actionSerials?.jump) || 0),
    doubleJump: Math.max(0, Number(car?.actionSerials?.doubleJump) || 0),
    dodge: Math.max(0, Number(car?.actionSerials?.dodge) || 0),
    respawn: Math.max(0, Number(car?.actionSerials?.respawn) || 0),
  };
}

// State messages are already the public, authoritative server projection. Do
// not reconstruct physics here: this adapter only normalizes that projection
// into the curve-comparison schema.
export function lanCarToCurveState(car) {
  if (!car || typeof car !== "object") throw new Error("La muestra LAN no contiene coche");
  return {
    position: { x: round(car.x), y: round(car.h), z: round(car.z) },
    velocity: { x: round(car.velocity?.x), y: round(car.velocity?.y), z: round(car.velocity?.z) },
    angularVelocity: {
      pitch: round(car.angularVelocity?.pitch),
      yaw: round(car.angularVelocity?.yaw),
      roll: round(car.angularVelocity?.roll),
    },
    localAngularVelocity: {
      pitch: round(car.angularVelocity?.pitch),
      yaw: round(car.angularVelocity?.yaw),
      roll: round(car.angularVelocity?.roll),
    },
    orientation: {
      x: round(car.orientation?.x), y: round(car.orientation?.y),
      z: round(car.orientation?.z), w: round(car.orientation?.w),
    },
    grounded: Boolean(car.grounded),
    jumpState: String(car.jumpState || "unknown"),
    jumps: Math.max(0, Number(car.jumps) || 0),
    secondJumpWindow: round(car.jumpWindowRemaining),
    dodgeTime: round(car.dodgeRemaining),
    dodgeDirection: { forward: round(car.dodgeDirection?.forward), side: round(car.dodgeDirection?.side) },
    actionSerials: serials(car),
  };
}

export function lanStateToCurveSample({ frame, time, input, car }) {
  if (!Number.isSafeInteger(frame) || frame < 1) throw new Error("El frame LAN de curva no es válido");
  if (!Number.isFinite(Number(time)) || Number(time) < 0) throw new Error("El tiempo LAN de curva no es válido");
  return {
    frame,
    time: round(time),
    input: normalizeCurveInput(input),
    state: lanCarToCurveState(car),
  };
}
