/**
 * Opt-in, browser-side input timeline for the MOB-02 camera validation.
 *
 * This module deliberately has no DOM, Three.js, or WebSocket dependency. It
 * only consumes the authoritative car snapshot and returns the same input
 * shape used by the normal client. The caller is responsible for sending the
 * one restart request when `restartRequested` is true.
 */

const DEFAULTS = Object.freeze({
  jumpPulseSeconds: 0.09,
  aerialSeconds: 0.36,
  recoverySeconds: 2,
  wallSettleSpeed: 48,
});

const emptyInput = () => ({
  throttle: 0,
  steer: 0,
  jump: false,
  boost: false,
  drift: false,
  airRoll: false,
  roll: 0,
  fire: false,
});

const driveInput = () => ({ ...emptyInput(), throttle: 1, boost: true });

const aerialInput = () => ({
  ...emptyInput(),
  throttle: -1,
  steer: 1,
  boost: true,
  airRoll: true,
  roll: 1,
});

function finiteTime(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function wheelCount(car) {
  const contacts = Array.isArray(car?.contacts) ? car.contacts : [];
  return Number(contacts[0]?.wheelCount) || 0;
}

/** Return true when the authoritative snapshot is supported by the wall. */
export function isMob02WallSupport(car) {
  return Boolean(
    car?.grounded
    && car.wallRide
    && car.surfaceType === "wall"
    && wheelCount(car) > 0
  );
}

/** Return true for a stable wall support from which the jump can be pulsed. */
export function isMob02StableWallSupport(car, speedLimit = DEFAULTS.wallSettleSpeed) {
  return isMob02WallSupport(car) && finiteTime(car.speed) < speedLimit;
}

function isFloorSupport(car) {
  return Boolean(
    car?.grounded
    && (car.surfaceType === "ground" || car.surfaceType === "floor")
  );
}

/**
 * Create a fresh MOB-02 playback state. The returned object is intentionally
 * plain so callers can keep it in their client loop without a class instance.
 */
export function createMob02BrowserPlayback(options = {}) {
  const tuning = {
    ...DEFAULTS,
    ...options,
    jumpPulseSeconds: Math.max(0.001, finiteTime(options.jumpPulseSeconds, DEFAULTS.jumpPulseSeconds)),
    aerialSeconds: Math.max(0.001, finiteTime(options.aerialSeconds, DEFAULTS.aerialSeconds)),
    recoverySeconds: Math.max(0.001, finiteTime(options.recoverySeconds, DEFAULTS.recoverySeconds)),
    wallSettleSpeed: Math.max(0, finiteTime(options.wallSettleSpeed, DEFAULTS.wallSettleSpeed)),
  };
  return {
    phase: "drive",
    phaseStartedAt: null,
    restartRequested: false,
    done: false,
    recoveryResult: null,
    tuning,
  };
}

function result(playback, input, restartRequested = false) {
  return {
    phase: playback.phase,
    input,
    restartRequested,
    done: playback.done,
    recoveryResult: playback.recoveryResult,
  };
}

/**
 * Advance the deterministic input timeline using one authoritative snapshot.
 * `now` is seconds from the caller's monotonic clock. The first invocation
 * requests one restart and remains neutral until a snapshot is available.
 */
export function stepMob02BrowserPlayback(playback, { now = 0, car = null } = {}) {
  if (!playback || typeof playback !== "object") throw new TypeError("playback must be an object");
  const at = finiteTime(now);

  if (!playback.restartRequested) {
    playback.restartRequested = true;
    playback.phaseStartedAt = car ? at : null;
    return result(playback, emptyInput(), true);
  }
  if (playback.done) return result(playback, emptyInput());
  if (!car) return result(playback, emptyInput());
  if (playback.phaseStartedAt === null) playback.phaseStartedAt = at;

  if (playback.phase === "drive") {
    if (isMob02WallSupport(car)) {
      playback.phase = "settle";
      playback.phaseStartedAt = at;
      return result(playback, emptyInput());
    }
    return result(playback, driveInput());
  }

  if (playback.phase === "settle") {
    if (isMob02StableWallSupport(car, playback.tuning.wallSettleSpeed)) {
      playback.phase = "jump";
      playback.phaseStartedAt = at;
      return result(playback, { ...emptyInput(), jump: true });
    }
    return result(playback, emptyInput());
  }

  if (playback.phase === "jump") {
    if (at - playback.phaseStartedAt + 1e-9 < playback.tuning.jumpPulseSeconds) {
      return result(playback, { ...emptyInput(), jump: true });
    }
    playback.phase = "aerial";
    playback.phaseStartedAt = at;
    return result(playback, aerialInput());
  }

  if (playback.phase === "aerial") {
    if (at - playback.phaseStartedAt + 1e-9 < playback.tuning.aerialSeconds) {
      return result(playback, aerialInput());
    }
    playback.phase = "recover";
    playback.phaseStartedAt = at;
    return result(playback, emptyInput());
  }

  if (playback.phase === "recover") {
    if (isFloorSupport(car)) {
      playback.phase = "done";
      playback.done = true;
      playback.recoveryResult = "wheel-support";
    } else if (at - playback.phaseStartedAt + 1e-9 >= playback.tuning.recoverySeconds) {
      playback.phase = "done";
      playback.done = true;
      // RocketSim does not auto-upright a car that settles on its body. The
      // browser test records that outcome instead of changing vehicle physics.
      playback.recoveryResult = "no-wheel-support";
    }
    return result(playback, emptyInput());
  }

  throw new Error(`Unknown MOB-02 playback phase: ${playback.phase}`);
}

export const MOB02_PLAYBACK_DEFAULTS = DEFAULTS;
