/**
 * Opt-in browser input for the VIS-03 projectile rendering check.
 *
 * It deliberately waits for a two-car authoritative roster and fires only
 * from the red pilot in the internal `combat-lineup` bridge profile. The
 * module has no DOM, renderer, or WebSocket dependency.
 */

const EMPTY_INPUT = Object.freeze({
  throttle: 0,
  steer: 0,
  jump: false,
  boost: false,
  drift: false,
  airRoll: false,
  roll: 0,
  fire: false,
});

const finiteTime = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function createVis03BrowserPlayback({ fireSeconds = .12 } = {}) {
  return {
    phase: "wait-roster",
    phaseStartedAt: null,
    done: false,
    fireSeconds: Math.max(.02, finiteTime(fireSeconds) || .12),
  };
}

/**
 * Emits exactly one authoritative fire edge once the red observer can see the
 * two-pilot roster. The `combat-lineup` server profile owns the native poses;
 * this module only supplies the existing input contract.
 */
export function stepVis03BrowserPlayback(playback, { now = 0, localTeam = null, cars = [] } = {}) {
  if (!playback || typeof playback !== "object") throw new TypeError("playback must be an object");
  const at = finiteTime(now);
  const rosterReady = localTeam === "red" && Array.isArray(cars) && cars.length === 2;
  if (playback.done) return { phase: playback.phase, input: EMPTY_INPUT, done: true };
  if (playback.phase === "wait-roster") {
    if (!rosterReady) return { phase: playback.phase, input: EMPTY_INPUT, done: false };
    playback.phase = "fire";
    playback.phaseStartedAt = at;
    return { phase: playback.phase, input: { ...EMPTY_INPUT, fire: true }, done: false };
  }
  if (playback.phase === "fire") {
    if (at - playback.phaseStartedAt + 1e-9 < playback.fireSeconds) return { phase: playback.phase, input: { ...EMPTY_INPUT, fire: true }, done: false };
    playback.phase = "trail";
    playback.phaseStartedAt = at;
    return { phase: playback.phase, input: EMPTY_INPUT, done: false };
  }
  if (playback.phase === "trail") {
    playback.phase = "done";
    playback.done = true;
    return { phase: playback.phase, input: EMPTY_INPUT, done: true };
  }
  throw new Error(`Unknown VIS-03 playback phase: ${playback.phase}`);
}
