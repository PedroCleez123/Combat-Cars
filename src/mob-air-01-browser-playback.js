/**
 * Deterministic browser campaign for MOB-AIR-01.
 *
 * This is an observation tool, not a second physics implementation. It emits
 * the normal vehicle-input shape and only advances from authoritative
 * snapshots. The caller owns transport and records the returned report.
 */

const DEFAULTS = Object.freeze({
  settleSeconds: 0.2,
  restartTimeoutSeconds: 4,
  firstJumpSeconds: 0.09,
  firstJumpMaxSeconds: 0.3,
  releaseSeconds: 0.08,
  directedJumpSeconds: 0.07,
  directedJumpMaxSeconds: 0.24,
  airControlSeconds: 0.42,
  recoverySeconds: 2.2,
  snapshotStallSeconds: 1,
});

const emptyInput = () => ({
  throttle: 0, steer: 0, jump: false, boost: false, drift: false,
  airRoll: false, roll: 0, fire: false,
});

const directedJumpInput = direction => {
  if (direction === "front") return { ...emptyInput(), throttle: 1, jump: true };
  if (direction === "side") return { ...emptyInput(), steer: 1, jump: true, airRoll: true, roll: 1 };
  return { ...emptyInput(), throttle: 1, steer: 1, jump: true, roll: 1 };
};
const airControlInput = () => ({
  ...emptyInput(), throttle: -1, steer: 1, boost: true, airRoll: true, roll: 1,
});

function finiteTime(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function phaseElapsed(playback, now) {
  return now - playback.phaseStartedAt + 1e-9;
}

function isFloorSupport(car) {
  return Boolean(car?.grounded && (car.surfaceType === "ground" || car.surfaceType === "floor"));
}

function serial(car, name) {
  return Math.max(0, Number(car?.actionSerials?.[name]) || 0);
}

function observe(playback, car) {
  if (!car) return;
  playback.observed.airborne ||= !car.grounded;
  playback.observed.firstJump ||= serial(car, "jump") > playback.baseline.jump;
  playback.observed.doubleJump ||= serial(car, "doubleJump") > playback.baseline.doubleJump;
  playback.observed.dodge ||= serial(car, "dodge") > playback.baseline.dodge;
  playback.observed.maxSpeed = Math.max(playback.observed.maxSpeed, finiteTime(car.speed));
  playback.observed.lastJumpState = car.jumpState || playback.observed.lastJumpState;
  playback.observed.lastSurface = car.surfaceType || playback.observed.lastSurface;
  playback.observed.finalCar = car;
}

function actionEvidenceComplete(playback) {
  return Boolean(
    playback?.observed?.firstJump
      && (playback?.observed?.doubleJump || playback?.observed?.dodge)
      && playback?.observed?.dodge,
  );
}

function result(playback, input, restartRequested = false) {
  return {
    phase: playback.phase,
    input,
    restartRequested,
    done: playback.done,
    report: buildMobAir01Report(playback),
  };
}

function inputForPhase(playback) {
  if (playback.phase === "first-jump") return { ...emptyInput(), jump: true };
  if (playback.phase === "directed-second-jump") return directedJumpInput(playback.dodgeDirection);
  if (playback.phase === "air-control") return airControlInput();
  return emptyInput();
}

export function createMobAir01BrowserPlayback(options = {}) {
  const tuning = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    tuning[key] = Math.max(0.001, finiteTime(options[key], fallback));
  }
  return {
    phase: "settle",
    phaseStartedAt: null,
    restartRequested: false,
    restartSent: false,
    restartSerial: null,
    restartConfirmed: false,
    lastSnapshotToken: null,
    lastSnapshotAt: null,
    done: false,
    tuning,
    dodgeDirection: ["front", "side", "diagonal"].includes(options.dodgeDirection) ? options.dodgeDirection : "diagonal",
    baseline: { jump: 0, doubleJump: 0, dodge: 0 },
    observed: {
      airborne: false, firstJump: false, doubleJump: false, dodge: false,
      maxSpeed: 0, lastJumpState: null, lastSurface: null, finalCar: null,
    },
    recoveryResult: null,
  };
}

export function buildMobAir01Report(playback) {
  return {
    phase: playback?.phase || "unknown",
    dodgeDirection: playback?.dodgeDirection || "diagonal",
    done: Boolean(playback?.done),
    firstJumpObserved: Boolean(playback?.observed?.firstJump),
    directedSecondJumpObserved: Boolean(playback?.observed?.doubleJump || playback?.observed?.dodge),
    dodgeObserved: Boolean(playback?.observed?.dodge),
    airborneObserved: Boolean(playback?.observed?.airborne),
    recovered: playback?.recoveryResult === "wheel-support",
    recoveryResult: playback?.recoveryResult || null,
    maxSpeed: Number(playback?.observed?.maxSpeed || 0),
    lastJumpState: playback?.observed?.lastJumpState || null,
    lastSurface: playback?.observed?.lastSurface || null,
    restartConfirmed: Boolean(playback?.restartConfirmed),
  };
}

export function stepMobAir01BrowserPlayback(playback, { now = 0, car = null, snapshotTime = undefined, playerCount = undefined } = {}) {
  if (!playback || typeof playback !== "object") throw new TypeError("playback must be an object");
  const at = finiteTime(now);
  // A roster rebuild can publish a state before this browser has received its
  // welcome/car pair. Starting against an arbitrary remote car would make the
  // report meaningless and could restart a shared combat session.
  if (!car) return result(playback, emptyInput());
  // This campaign validates one vehicle's action serials. Do not start, or
  // keep sending inputs, while a second browser is part of the same match.
  // Normal multiplayer gameplay remains unaffected because this runs only
  // behind the explicit `mobair01` query flag.
  const hasPlayerCount = Number.isSafeInteger(playerCount);
  if (hasPlayerCount && playerCount !== 1) {
    if (playback.restartRequested && !playback.done) {
      playback.phase = "done";
      playback.done = true;
      playback.recoveryResult = "session-not-isolated";
    } else if (!playback.done) {
      playback.phase = "awaiting-solo-player";
    }
    return result(playback, emptyInput());
  }
  // Unit callers do not need to manufacture a snapshot ID. The browser passes
  // state.time, so a frozen WebSocket snapshot cannot advance a timed phase.
  const token = snapshotTime === undefined ? at : String(snapshotTime);
  if (!playback.restartRequested) {
    if (playback.phase === "awaiting-solo-player") playback.phase = "settle";
    playback.restartRequested = true;
    playback.phase = "awaiting-restart";
    playback.phaseStartedAt = at;
    playback.restartSerial = serial(car, "respawn");
    playback.lastSnapshotToken = token;
    playback.lastSnapshotAt = at;
    return result(playback, emptyInput(), true);
  }
  if (playback.done) return result(playback, emptyInput());
  if (playback.lastSnapshotToken === token) {
    if (playback.lastSnapshotAt !== null && at - playback.lastSnapshotAt >= playback.tuning.snapshotStallSeconds) {
      playback.phase = "done";
      playback.done = true;
      playback.recoveryResult = "snapshot-stalled";
    }
    return result(playback, inputForPhase(playback));
  }
  playback.lastSnapshotToken = token;
  playback.lastSnapshotAt = at;
  if (playback.phase === "awaiting-restart") {
    if (serial(car, "respawn") > playback.restartSerial) {
      playback.phase = "settle";
      playback.phaseStartedAt = at;
      playback.restartConfirmed = true;
      playback.baseline = { jump: serial(car, "jump"), doubleJump: serial(car, "doubleJump"), dodge: serial(car, "dodge") };
      return result(playback, emptyInput());
    }
    if (phaseElapsed(playback, at) >= playback.tuning.restartTimeoutSeconds) {
      playback.phase = "done";
      playback.done = true;
      playback.recoveryResult = "restart-unconfirmed";
    }
    return result(playback, emptyInput());
  }
  observe(playback, car);
  if (playback.phaseStartedAt === null) playback.phaseStartedAt = at;
  if (playback.phase === "settle") {
    if (isFloorSupport(car) && phaseElapsed(playback, at) >= playback.tuning.settleSeconds) {
      playback.baseline = { jump: serial(car, "jump"), doubleJump: serial(car, "doubleJump"), dodge: serial(car, "dodge") };
      playback.phase = "first-jump";
      playback.phaseStartedAt = at;
      return result(playback, { ...emptyInput(), jump: true });
    }
    return result(playback, emptyInput());
  }
  if (playback.phase === "first-jump") {
    const enoughPulse = phaseElapsed(playback, at) >= playback.tuning.firstJumpSeconds;
    const launched = playback.observed.firstJump || !car.grounded;
    if ((!enoughPulse || !launched) && phaseElapsed(playback, at) < playback.tuning.firstJumpMaxSeconds) return result(playback, { ...emptyInput(), jump: true });
    playback.phase = "release";
    playback.phaseStartedAt = at;
    return result(playback, emptyInput());
  }
  if (playback.phase === "release") {
    if (phaseElapsed(playback, at) < playback.tuning.releaseSeconds) return result(playback, emptyInput());
    playback.phase = "directed-second-jump";
    playback.phaseStartedAt = at;
    return result(playback, directedJumpInput(playback.dodgeDirection));
  }
  if (playback.phase === "directed-second-jump") {
    const actionObserved = playback.observed.doubleJump || playback.observed.dodge;
    if ((!actionObserved || phaseElapsed(playback, at) < playback.tuning.directedJumpSeconds) && phaseElapsed(playback, at) < playback.tuning.directedJumpMaxSeconds) return result(playback, directedJumpInput(playback.dodgeDirection));
    playback.phase = "air-control";
    playback.phaseStartedAt = at;
    return result(playback, airControlInput());
  }
  if (playback.phase === "air-control") {
    if (phaseElapsed(playback, at) < playback.tuning.airControlSeconds) return result(playback, airControlInput());
    playback.phase = "recover";
    playback.phaseStartedAt = at;
    return result(playback, emptyInput());
  }
  if (playback.phase === "recover") {
    if (isFloorSupport(car)) {
      playback.phase = "done";
      playback.done = true;
      playback.recoveryResult = actionEvidenceComplete(playback) ? "wheel-support" : "actions-missing";
    } else if (phaseElapsed(playback, at) >= playback.tuning.recoverySeconds) {
      playback.phase = "done";
      playback.done = true;
      playback.recoveryResult = actionEvidenceComplete(playback) ? "no-wheel-support" : "actions-missing";
    }
    return result(playback, emptyInput());
  }
  throw new Error(`Unknown MOB-AIR-01 playback phase: ${playback.phase}`);
}

export const MOB_AIR_01_PLAYBACK_DEFAULTS = DEFAULTS;
