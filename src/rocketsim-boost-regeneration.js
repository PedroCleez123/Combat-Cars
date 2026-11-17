export const BOOST_MAX = 100;
export const BOOST_REGEN_DELAY_SECONDS = 2;
export const BOOST_REGEN_FIXED_STEP_HZ = 120;
export const BOOST_REGEN_DELAY_TICKS = BOOST_REGEN_DELAY_SECONDS * BOOST_REGEN_FIXED_STEP_HZ;
export const BOOST_REGEN_DURATION_SECONDS = 1;
export const BOOST_REGEN_DURATION_TICKS = BOOST_REGEN_DURATION_SECONDS * BOOST_REGEN_FIXED_STEP_HZ;
export const BOOST_REGEN_START_RATE_PER_SECOND = 50;
export const BOOST_REGEN_END_RATE_PER_SECOND = 150;
export const BOOST_REGEN_RATE_PER_SECOND = (BOOST_REGEN_START_RATE_PER_SECOND + BOOST_REGEN_END_RATE_PER_SECOND) / 2;

const EPSILON = 0.0001;

/**
 * Advance the deterministic combat boost state by one native fixed tick.
 * `boostBefore` and `boostAfter` are the values surrounding RocketSim's
 * control step; only a real decrease counts as consumption. Lobby/practice
 * infinite boost intentionally does not call this helper.
 */
export function stepBoostRegeneration({ boost, delayTicks, regenTicks = 0, boostBefore, boostAfter }) {
  const current = Math.max(0, Math.min(BOOST_MAX, Number(boostAfter ?? boost) || 0));
  const before = Number(boostBefore ?? current) || 0;
  const pending = Math.max(0, Math.floor(Number(delayTicks) || 0));
  const elapsed = Math.max(0, Math.min(BOOST_REGEN_DURATION_TICKS, Math.floor(Number(regenTicks) || 0)));
  if (current >= BOOST_MAX - EPSILON) return { boost: BOOST_MAX, delayTicks: 0, regenTicks: 0 };
  if (current < before - EPSILON) {
    return { boost: current, delayTicks: BOOST_REGEN_DELAY_TICKS, regenTicks: 0 };
  }
  if (pending > 1) return { boost: current, delayTicks: pending - 1, regenTicks: 0 };
  const progress = Math.min(elapsed, BOOST_REGEN_DURATION_TICKS - 1);
  const ramp = BOOST_REGEN_DURATION_TICKS <= 1 ? 1 : progress / (BOOST_REGEN_DURATION_TICKS - 1);
  const rate = BOOST_REGEN_START_RATE_PER_SECOND
    + (BOOST_REGEN_END_RATE_PER_SECOND - BOOST_REGEN_START_RATE_PER_SECOND) * ramp;
  return {
    boost: Math.min(BOOST_MAX, current + rate / BOOST_REGEN_FIXED_STEP_HZ),
    delayTicks: 0,
    regenTicks: Math.min(BOOST_REGEN_DURATION_TICKS, elapsed + 1),
  };
}
