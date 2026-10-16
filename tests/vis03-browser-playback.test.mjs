import assert from "node:assert/strict";
import test from "node:test";
import { createVis03BrowserPlayback, stepVis03BrowserPlayback } from "../src/vis03-browser-playback.js";

test("VIS-03 waits for the red two-pilot roster before firing one edge", () => {
  const playback = createVis03BrowserPlayback({ fireSeconds: .1 });
  const blueOnly = [{ id: "blue", team: "blue" }];
  const ready = [{ id: "blue", team: "blue" }, { id: "red", team: "red" }];

  assert.deepEqual(stepVis03BrowserPlayback(playback, { now: 0, localTeam: "blue", cars: ready }), {
    phase: "wait-roster", input: { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false }, done: false,
  });
  assert.equal(stepVis03BrowserPlayback(playback, { now: .01, localTeam: "red", cars: blueOnly }).phase, "wait-roster");

  const fire = stepVis03BrowserPlayback(playback, { now: .02, localTeam: "red", cars: ready });
  assert.equal(fire.phase, "fire");
  assert.equal(fire.input.fire, true);
  assert.equal(stepVis03BrowserPlayback(playback, { now: .119, localTeam: "red", cars: ready }).input.fire, true);

  const trail = stepVis03BrowserPlayback(playback, { now: .12, localTeam: "red", cars: ready });
  assert.equal(trail.phase, "trail");
  assert.equal(trail.input.fire, false);
  assert.deepEqual(stepVis03BrowserPlayback(playback, { now: .13, localTeam: "red", cars: ready }), {
    phase: "done", input: { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false }, done: true,
  });
});
