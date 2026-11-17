export function createVisualSmokePlayback(startedAt = null) {
  return {
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    phase: "waiting-for-snapshot",
    armed: false,
    done: false,
    captureHold: false,
    captureHoldStartedAt: null,
    lastInput: null,
    restartRequested: false,
    restartSent: false,
    takeoffAirSampled: false,
  };
}

// Software/offscreen renderers can service requestAnimationFrame far below the
// display refresh rate. These intentionally generous windows keep every input
// phase observable without changing any player-facing control timing.
export const VISUAL_SMOKE_PHASES = Object.freeze([
  Object.freeze({ id: "ground-idle", until: 1.5 }),
  Object.freeze({ id: "ground-drive", until: 3.5 }),
  // Give RocketSim time to publish the first airborne state even when the
  // offscreen renderer delivers input and camera frames sparsely.
  Object.freeze({ id: "takeoff", until: 7.5 }),
  // Software/offscreen capture can spend several seconds between exact
  // observations. Keep the two airborne turn windows generous enough to
  // collect an authoritative air sample after a wall/ground transition.
  Object.freeze({ id: "air-left-turn", until: 12.5 }),
  Object.freeze({ id: "air-right-turn", until: 18 }),
  Object.freeze({ id: "air-release", until: 21 }),
]);

export function visualSmokePhaseStart(phase) {
  if (phase === "complete") return VISUAL_SMOKE_PHASES.at(-1).until + 0.001;
  const index = VISUAL_SMOKE_PHASES.findIndex(entry => entry.id === phase);
  if (index < 0) return null;
  return index === 0 ? 0 : VISUAL_SMOKE_PHASES[index - 1].until;
}

export function forceVisualSmokePhase(playback, phase, now) {
  const start = visualSmokePhaseStart(phase);
  if (!playback || !Number.isFinite(now) || start === null) return false;
  playback.startedAt = now - start;
  playback.phase = phase;
  playback.done = phase === "complete";
  playback.restartRequested = phase === "air-left-turn";
  playback.restartSent = false;
  if (["air-left-turn", "air-right-turn", "air-release", "complete"].includes(phase)) playback.takeoffAirSampled = true;
  return true;
}

function emptyInput() {
  return { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false };
}

function result(playback, phase, input, done = false) {
  playback.phase = phase;
  playback.lastInput = input;
  playback.done = done;
  return { phase, input, done };
}

/**
 * Deterministic presentation-only input timeline. It exercises the camera's
 * ground, takeoff and fast-air-heading paths; RocketSim remains authoritative.
 */
export function stepVisualSmokePlayback(playback, { now, car = null } = {}) {
  if (!playback || !Number.isFinite(now)) return { phase: "invalid", input: emptyInput(), done: true };
  if (!car) {
    return result(playback, "waiting-for-snapshot", emptyInput());
  }
  if (!playback.armed) {
    return result(playback, "waiting-for-client", emptyInput());
  }
  // Electron's offscreen capture can yield to one or more animation frames
  // between capturePage() and the follow-up telemetry read. The smoke harness
  // raises captureHold only after the exact phase is observed; retaining the
  // last presentation input makes the capture deterministic without changing
  // the player-facing path (the flag only exists on visualSmoke=1).
  if (playback.captureHold && playback.phase && playback.phase !== "waiting-for-snapshot" && playback.phase !== "waiting-for-client") {
    if (playback.captureHoldStartedAt === null) playback.captureHoldStartedAt = now;
    return result(playback, playback.phase, playback.lastInput || emptyInput(), playback.done);
  }
  if (playback.captureHoldStartedAt !== null) {
    // Exclude time spent inside capturePage() from the presentation timeline,
    // otherwise a slow software renderer can skip the next exact phase.
    playback.startedAt = playback.startedAt === null
      ? now
      : playback.startedAt + Math.max(0, now - playback.captureHoldStartedAt);
    playback.captureHoldStartedAt = null;
  }
  if (playback.startedAt === null) playback.startedAt = now;
  const elapsed = Math.max(0, now - playback.startedAt);
  const authoritativeAir = car.surfaceType === "air" || car.grounded === false;
  let phase;
  let input = emptyInput();
  if (elapsed < VISUAL_SMOKE_PHASES[0].until) {
    phase = "ground-idle";
  } else if (elapsed < VISUAL_SMOKE_PHASES[1].until) {
    phase = "ground-drive";
    input = { ...input, throttle: 1, boost: true };
  } else if (
    elapsed < VISUAL_SMOKE_PHASES[2].until
    || !playback.takeoffAirSampled
  ) {
    phase = "takeoff";
    input = { ...input, throttle: 1, jump: true, boost: true };
    // Keep the takeoff label attached to the first authoritative airborne
    // camera sample. The next frame may advance to the turn phase, so the
    // capture gate can prove RocketSim actually reported air during takeoff.
    if (authoritativeAir) playback.takeoffAirSampled = true;
  } else if (elapsed < VISUAL_SMOKE_PHASES[3].until) {
    phase = "air-left-turn";
    input = { ...input, throttle: 1, jump: true, boost: true, steer: -1, airRoll: true, roll: -1 };
  } else if (elapsed < VISUAL_SMOKE_PHASES[4].until) {
    phase = "air-right-turn";
    // The second jump is deliberately part of the disposable smoke timeline.
    // It keeps the right-turn sample window authoritative in slow/offscreen
    // renderers; it does not alter the player's controls or auto-recovery.
    input = { ...input, throttle: 1, jump: true, boost: true, steer: 1, airRoll: true, roll: 1 };
  } else if (elapsed < VISUAL_SMOKE_PHASES[5].until) {
    phase = "air-release";
    input = { ...input, throttle: 1, boost: true };
  } else {
    phase = "complete";
    playback.done = true;
  }
  return result(playback, phase, input, playback.done);
}
