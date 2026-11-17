import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOST_REGEN_DELAY_TICKS,
  BOOST_REGEN_DURATION_TICKS,
  BOOST_REGEN_START_RATE_PER_SECOND,
  BOOST_REGEN_END_RATE_PER_SECOND,
  BOOST_REGEN_RATE_PER_SECOND,
  BOOST_MAX,
  stepBoostRegeneration,
} from "../src/rocketsim-boost-regeneration.js";

test("boost regeneration waits two seconds, then accelerates for one second", () => {
  assert.equal(BOOST_REGEN_DELAY_TICKS, 240);
  assert.equal(BOOST_REGEN_DURATION_TICKS, 120);
  assert.equal(BOOST_REGEN_START_RATE_PER_SECOND, 50);
  assert.equal(BOOST_REGEN_END_RATE_PER_SECOND, 150);
  assert.equal(BOOST_REGEN_RATE_PER_SECOND, 100);
  let state = { boost: 0, delayTicks: 0, regenTicks: 0 };
  state = stepBoostRegeneration({ ...state, boostBefore: 1, boostAfter: 0 });
  for (let tick = 0; tick < BOOST_REGEN_DELAY_TICKS - 1; tick += 1) {
    state = stepBoostRegeneration({ ...state, boostBefore: state.boost, boostAfter: state.boost });
    assert.equal(state.boost, 0);
  }
  state = stepBoostRegeneration({ ...state, boostBefore: 0, boostAfter: 0 });
  const firstIncrement = state.boost;
  for (let tick = 1; tick < BOOST_REGEN_DURATION_TICKS; tick += 1) {
    state = stepBoostRegeneration({ ...state, boostBefore: state.boost, boostAfter: state.boost });
  }
  assert.ok(state.boost > firstIncrement * BOOST_REGEN_DURATION_TICKS / 2);
  assert.equal(state.regenTicks, BOOST_REGEN_DURATION_TICKS);
  assert.equal(Math.round(state.boost * 1000) / 1000, BOOST_MAX);
});

test("a real boost consumption during refill restarts the delay", () => {
  let state = { boost: 40, delayTicks: 0, regenTicks: 0 };
  state = stepBoostRegeneration({ ...state, boostBefore: 40, boostAfter: 39 });
  assert.equal(state.delayTicks, BOOST_REGEN_DELAY_TICKS);
  assert.equal(state.regenTicks, 0);
  for (let tick = 0; tick < BOOST_REGEN_DELAY_TICKS - 1; tick += 1) {
    state = stepBoostRegeneration({ ...state, boostBefore: state.boost, boostAfter: state.boost });
  }
  assert.equal(state.boost, 39);
  state = stepBoostRegeneration({ ...state, boostBefore: 39, boostAfter: 39 });
  assert.equal(state.boost, 39 + BOOST_REGEN_START_RATE_PER_SECOND / 120);
});

test("full boost never creates a pending regeneration timer", () => {
  const state = stepBoostRegeneration({ boostBefore: BOOST_MAX, boostAfter: BOOST_MAX, boost: BOOST_MAX, delayTicks: 0 });
  assert.deepEqual(state, { boost: BOOST_MAX, delayTicks: 0, regenTicks: 0 });
});
