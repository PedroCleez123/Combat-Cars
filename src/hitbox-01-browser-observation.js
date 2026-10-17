/**
 * Browser-side observation campaign for HITBOX-01.
 *
 * This emits ordinary authoritative input only. It never changes the solver,
 * the RocketSim bridge, or collision settings. Its report identifies an
 * inverted native contact; a human still decides whether the visible chassis
 * remained above the floor at that moment.
 */

const DEFAULTS = Object.freeze({
  settleSeconds: 0.2,
  restartTimeoutSeconds: 4,
  jumpPulseSeconds: 0.09,
  jumpPulseMaxSeconds: 0.3,
  rotateMaxSeconds: 1.6,
  contactTimeoutSeconds: 2.5,
  snapshotStallSeconds: 1,
  invertedUpY: -0.65,
});

const emptyInput = () => ({
  throttle: 0, steer: 0, jump: false, boost: false, drift: false,
  airRoll: false, roll: 0, fire: false,
});

const rotateInput = () => ({ ...emptyInput(), airRoll: true, roll: 1, boost: true });
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const serial = (car, name) => Math.max(0, Number(car?.actionSerials?.[name]) || 0);
const isFloorSupport = car => Boolean(car?.grounded && (car.surfaceType === "ground" || car.surfaceType === "floor"));
const hasInvertedBodyFloorContact = car => Boolean(
  Array.isArray(car?.contacts)
  && car.contacts.some(contact => Number(contact?.normal?.y) > .65 && Number(contact?.wheelCount) === 0),
);

export function authoritativeUpY(car) {
  const orientation = car?.orientation;
  if (orientation && [orientation.x, orientation.y, orientation.z, orientation.w].every(Number.isFinite)) {
    const norm = orientation.x ** 2 + orientation.y ** 2 + orientation.z ** 2 + orientation.w ** 2;
    if (norm > .000001) return 1 - 2 * (orientation.x ** 2 + orientation.z ** 2) / norm;
  }
  return Math.cos(finite(car?.pitch)) * Math.cos(finite(car?.roll));
}

function report(playback) {
  return {
    phase: playback?.phase || "unknown",
    done: Boolean(playback?.done),
    restartConfirmed: Boolean(playback?.restartConfirmed),
    jumpObserved: Boolean(playback?.observed?.jump),
    inversionObserved: Boolean(playback?.observed?.inversion),
    invertedGroundContact: Boolean(playback?.observed?.invertedGroundContact),
    minimumUpY: Number(playback?.observed?.minimumUpY ?? 1),
    outcome: playback?.outcome || null,
  };
}

function result(playback, input, restartRequested = false) {
  return { phase: playback.phase, input, restartRequested, done: playback.done, report: report(playback) };
}

function finish(playback, outcome) {
  playback.phase = "done";
  playback.done = true;
  playback.outcome = outcome;
}

function observe(playback, car) {
  const upY = authoritativeUpY(car);
  playback.observed.minimumUpY = Math.min(playback.observed.minimumUpY, upY);
  playback.observed.jump ||= serial(car, "jump") > playback.baseline.jump || !car.grounded;
  playback.observed.inversion ||= upY <= playback.tuning.invertedUpY;
  playback.observed.invertedGroundContact ||= hasInvertedBodyFloorContact(car) && upY <= playback.tuning.invertedUpY;
}

export function createHitbox01BrowserObservation(options = {}) {
  const tuning = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    tuning[key] = key === "invertedUpY"
      ? finite(options[key], fallback)
      : Math.max(.001, finite(options[key], fallback));
  }
  return {
    phase: "awaiting-rocketsim",
    phaseStartedAt: null,
    restartRequested: false,
    restartSent: false,
    restartSerial: null,
    restartConfirmed: false,
    lastSnapshotToken: null,
    lastSnapshotAt: null,
    done: false,
    outcome: null,
    tuning,
    baseline: { jump: 0 },
    observed: { jump: false, inversion: false, invertedGroundContact: false, minimumUpY: 1 },
  };
}

export function buildHitbox01Report(playback) {
  return report(playback);
}

export function stepHitbox01BrowserObservation(playback, {
  now = 0,
  car = null,
  snapshotTime = undefined,
  playerCount = undefined,
  movementBackend = null,
  bridgeRevision = null,
} = {}) {
  if (!playback || typeof playback !== "object") throw new TypeError("playback must be an object");
  const at = finite(now);
  if (!car) return result(playback, emptyInput());
  if (movementBackend !== null && movementBackend !== "rocketsim") {
    finish(playback, "requires-rocketsim");
    return result(playback, emptyInput());
  }
  if (Number.isFinite(Number(bridgeRevision)) && Number(bridgeRevision) < 19) {
    finish(playback, "requires-r19");
    return result(playback, emptyInput());
  }
  if (Number.isSafeInteger(playerCount) && playerCount !== 1) {
    if (playback.restartRequested) finish(playback, "session-not-isolated");
    else playback.phase = "awaiting-solo-player";
    return result(playback, emptyInput());
  }

  const token = snapshotTime === undefined ? at : String(snapshotTime);
  if (!playback.restartRequested) {
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
    if (at - playback.lastSnapshotAt >= playback.tuning.snapshotStallSeconds) finish(playback, "snapshot-stalled");
    return result(playback, playback.phase === "rotate" ? rotateInput() : emptyInput());
  }
  playback.lastSnapshotToken = token;
  playback.lastSnapshotAt = at;
  if (playback.phase === "awaiting-restart") {
    if (serial(car, "respawn") > playback.restartSerial) {
      playback.restartConfirmed = true;
      playback.baseline.jump = serial(car, "jump");
      playback.phase = "settle";
      playback.phaseStartedAt = at;
    } else if (at - playback.phaseStartedAt >= playback.tuning.restartTimeoutSeconds) {
      finish(playback, "restart-unconfirmed");
    }
    return result(playback, emptyInput());
  }

  observe(playback, car);
  if (playback.phase === "settle") {
    if (isFloorSupport(car) && at - playback.phaseStartedAt >= playback.tuning.settleSeconds) {
      playback.phase = "jump";
      playback.phaseStartedAt = at;
      return result(playback, { ...emptyInput(), jump: true });
    }
    return result(playback, emptyInput());
  }
  if (playback.phase === "jump") {
    const elapsed = at - playback.phaseStartedAt;
    if ((!playback.observed.jump || elapsed < playback.tuning.jumpPulseSeconds) && elapsed < playback.tuning.jumpPulseMaxSeconds) {
      return result(playback, { ...emptyInput(), jump: true });
    }
    playback.phase = "rotate";
    playback.phaseStartedAt = at;
    return result(playback, rotateInput());
  }
  if (playback.phase === "rotate") {
    if (playback.observed.inversion) {
      playback.phase = "observe-contact";
      playback.phaseStartedAt = at;
      return result(playback, emptyInput());
    }
    if (at - playback.phaseStartedAt >= playback.tuning.rotateMaxSeconds) {
      finish(playback, "inversion-not-observed");
      return result(playback, emptyInput());
    }
    return result(playback, rotateInput());
  }
  if (playback.phase === "observe-contact") {
    // This campaign only observes the native body contact. It intentionally
    // sends neutral input after inversion and never adds an auto-upright or
    // recovery assist: regaining wheels remains a player action.
    if (playback.observed.invertedGroundContact) finish(playback, "inverted-ground-contact");
    else if (isFloorSupport(car)) finish(playback, "upright-ground-contact");
    else if (at - playback.phaseStartedAt >= playback.tuning.contactTimeoutSeconds) finish(playback, "no-ground-contact-after-inversion");
    return result(playback, emptyInput());
  }
  throw new Error(`Unknown HITBOX-01 observation phase: ${playback.phase}`);
}

export const HITBOX_01_OBSERVATION_DEFAULTS = DEFAULTS;
