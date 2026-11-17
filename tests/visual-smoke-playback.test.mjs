import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createVisualSmokePlayback, forceVisualSmokePhase, stepVisualSmokePlayback, visualSmokePhaseStart, VISUAL_SMOKE_PHASES } from "../src/visual-smoke-playback.js";

const require = createRequire(import.meta.url);
const { headingRateForFrame, isPhaseCaptureReady } = require("../tools/visual-smoke-metrics.cjs");
const car = { id: "pilot", grounded: true };

test("visual smoke playback covers ground, takeoff and fast air-turn phases", () => {
  const playback = createVisualSmokePlayback();
  playback.armed = true;
  const phases = [0, 1.6, 3.6, 7.6, 13, 18.1, 21.1]
    .map(now => stepVisualSmokePlayback(playback, { now, car: now >= 3.6 ? { grounded: false, surfaceType: "air" } : car }).phase);
  assert.deepEqual(phases, ["ground-idle", "ground-drive", "takeoff", "air-left-turn", "air-right-turn", "air-release", "complete"]);
  assert.equal(VISUAL_SMOKE_PHASES[2].until - VISUAL_SMOKE_PHASES[1].until, 4, "takeoff remains available for an authoritative airborne sample");
});

test("visual smoke keeps the disposable right-turn input active across the longer offscreen sample window", () => {
  const playback = createVisualSmokePlayback();
  playback.armed = true;
  stepVisualSmokePlayback(playback, { now: 0, car });
  stepVisualSmokePlayback(playback, { now: 6.8, car: { grounded: false, surfaceType: "air" } });
  for (const now of [17.8, 17.95]) {
    const result = stepVisualSmokePlayback(playback, { now, car: { grounded: false, surfaceType: "air" } });
    assert.equal(result.phase, "air-right-turn");
    assert.equal(result.input.jump, true);
    assert.equal(result.input.steer, 1);
  }
});

test("takeoff phase waits for an authoritative air sample before advancing", () => {
  const playback = createVisualSmokePlayback();
  playback.armed = true;
  stepVisualSmokePlayback(playback, { now: 0, car: { grounded: true, surfaceType: "ground" } });
  assert.equal(stepVisualSmokePlayback(playback, { now: 8, car: { grounded: true, surfaceType: "ground" } }).phase, "takeoff");
  assert.equal(playback.takeoffAirSampled, false);
  assert.equal(stepVisualSmokePlayback(playback, { now: 8.1, car: { grounded: false, surfaceType: "air" } }).phase, "takeoff");
  assert.equal(playback.takeoffAirSampled, true);
  assert.equal(stepVisualSmokePlayback(playback, { now: 8.15, car: { grounded: true, surfaceType: "ground" } }).phase, "air-left-turn");
  assert.equal(stepVisualSmokePlayback(playback, { now: 12.6, car: { grounded: true, surfaceType: "ground" } }).phase, "air-right-turn");
});

test("camera heading rate uses the applied frame dt across slow capture intervals", () => {
  const previous = { t: 4, heading: 0 };
  const current = { t: 5, frameDt: .05, heading: .18 };
  const wallClockRate = Math.abs(current.heading - previous.heading) / (current.t - previous.t);
  assert.ok(wallClockRate < 3.3, "one-second capture spacing would falsely pass the heading limit");
  assert.ok(Math.abs(headingRateForFrame(previous, current) - 3.6) < 1e-9);
  assert.ok(headingRateForFrame(previous, current) > 3.3, "the dt passed to camera follow must govern the rate");
});

test("camera heading rate caps oversized frame dt at the client 50ms limit", () => {
  const previous = { t: 10, heading: 0 };
  const current = { t: 12, frameDt: .5, heading: .18 };
  assert.ok(Math.abs(headingRateForFrame(previous, current) - 3.6) < 1e-9);
  assert.ok(headingRateForFrame(previous, current) > 3.3, "a slow wall-clock interval must not dilute the applied rate");
});

test("phase capture rejects every omitted phase even when a later phase is present", () => {
  const phases = [...VISUAL_SMOKE_PHASES.map(({ id }) => id), "complete"];
  for (let expectedIndex = 0; expectedIndex < phases.length - 1; expectedIndex += 1) {
    const expected = phases[expectedIndex];
    const later = phases[expectedIndex + 1];
    const laterAirEvidence = [{ phase: later, mode: "air" }];
    assert.equal(isPhaseCaptureReady(expected, { visualSmoke: { phase: later, cameraSamples: laterAirEvidence } }), false, `${expected} must not accept ${later}`);
  }
});

test("takeoff capture requires exact-phase authoritative camera air evidence", () => {
  const airEvidence = [{ phase: "takeoff", mode: "air" }];
  assert.equal(isPhaseCaptureReady("takeoff", { visualSmoke: { phase: "air-left-turn", cameraSamples: airEvidence } }), false);
  assert.equal(isPhaseCaptureReady("takeoff", { visualSmoke: { phase: "takeoff", cameraSamples: [{ phase: "takeoff", mode: "ground" }] } }), false);
  assert.equal(isPhaseCaptureReady("takeoff", { visualSmoke: { phase: "takeoff", cameraSamples: [{ phase: "takeoff", mode: "wall" }] } }), false);
  assert.equal(isPhaseCaptureReady("takeoff", { visualSmoke: { phase: "takeoff", cameraSamples: airEvidence } }), true);
});

test("air-turn captures require exact-phase authoritative air evidence", () => {
  assert.equal(isPhaseCaptureReady("air-left-turn", { visualSmoke: { phase: "air-left-turn", cameraSamples: [{ phase: "air-left-turn", mode: "wall" }] } }), false);
  assert.equal(isPhaseCaptureReady("air-right-turn", { visualSmoke: { phase: "air-right-turn", cameraSamples: [{ phase: "air-right-turn", mode: "air" }] } }), true);
});

test("visual smoke playback remains neutral until the authoritative car exists", () => {
  const playback = createVisualSmokePlayback();
  const result = stepVisualSmokePlayback(playback, { now: 10, car: null });
  assert.equal(result.phase, "waiting-for-snapshot");
  assert.equal(result.input.throttle, 0);
  assert.equal(result.done, false);
});

test("visual smoke playback remains neutral until the smoke gate arms it", () => {
  const playback = createVisualSmokePlayback();
  const result = stepVisualSmokePlayback(playback, { now: 10, car });
  assert.equal(result.phase, "waiting-for-client");
  assert.equal(result.input.throttle, 0);
  assert.equal(result.done, false);
});

test("visual smoke capture hold preserves the exact phase and last input", () => {
  const playback = createVisualSmokePlayback();
  playback.armed = true;
  const initial = stepVisualSmokePlayback(playback, { now: 0, car: { grounded: true, surfaceType: "ground" } });
  assert.equal(initial.phase, "ground-idle");
  playback.captureHold = true;
  const held = stepVisualSmokePlayback(playback, { now: 20, car: { grounded: false, surfaceType: "air" } });
  assert.equal(held.phase, "ground-idle");
  assert.deepEqual(held.input, initial.input);
  assert.equal(held.done, false);
});

test("visual smoke capture hold pauses the phase clock", () => {
  const playback = createVisualSmokePlayback();
  playback.armed = true;
  stepVisualSmokePlayback(playback, { now: 0, car: { grounded: true, surfaceType: "ground" } });
  playback.captureHold = true;
  stepVisualSmokePlayback(playback, { now: 1, car: { grounded: true, surfaceType: "ground" } });
  playback.captureHold = false;
  const resumed = stepVisualSmokePlayback(playback, { now: 20, car: { grounded: true, surfaceType: "ground" } });
  assert.equal(resumed.phase, "ground-idle");
  assert.equal(playback.captureHoldStartedAt, null);
});

test("visual smoke can resume each exact capture phase deterministically", () => {
  const playback = createVisualSmokePlayback();
  playback.armed = true;
  assert.equal(visualSmokePhaseStart("air-left-turn"), VISUAL_SMOKE_PHASES[2].until);
  assert.equal(forceVisualSmokePhase(playback, "air-left-turn", 20), true);
  const result = stepVisualSmokePlayback(playback, { now: 20, car: { grounded: true, surfaceType: "ground" } });
  assert.equal(result.phase, "air-left-turn");
  assert.equal(playback.takeoffAirSampled, true);
  assert.equal(playback.restartRequested, true);
  assert.equal(forceVisualSmokePhase(playback, "complete", 21), true);
  assert.equal(stepVisualSmokePlayback(playback, { now: 21, car: { grounded: true, surfaceType: "ground" } }).phase, "complete");
});
