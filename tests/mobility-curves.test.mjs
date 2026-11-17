import assert from "node:assert/strict";
import test from "node:test";
import { runMobilityCurveSuite } from "../src/mobility-curve-probes.js";
import { compareCurveTraces } from "../src/mobility-curve-comparison.js";

test("the reference-ready mobility curve suite is deterministic", () => {
  const first = runMobilityCurveSuite();
  const second = runMobilityCurveSuite();
  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.fixedStepHz, 120);
  assert.equal(first.profile, "calibration");
  assert.equal(first.sampling, "one sample after every authoritative fixed step");
  assert.equal(first.scenarioManifest.version, 1);
  assert.equal(first.scenarioManifest.fixedStepHz, 120);
  assert.equal(first.scenarioManifest.durationFrames, 144);
  assert.deepEqual(first.scenarioManifest.scenarios.map(scenario => scenario.id), [
    "ground-control", "first-jump", "double-jump", "dodge-forward",
    "dodge-side", "dodge-diagonal-roll", "air-axes", "free-air-roll",
    "air-pitch", "air-yaw", "air-roll", "air-double-jump",
    "air-dodge-forward", "air-dodge-side", "air-dodge-diagonal-roll"
  ]);
  assert.equal(new Set(first.scenarioManifest.scenarios.map(scenario => scenario.traceKey)).size, 15);
  for (const scenario of first.scenarioManifest.scenarios) {
    assert.ok(first.traces[scenario.traceKey], `${scenario.id} must have a trace`);
    assert.equal(scenario.phases.reduce((total, phase) => total + phase.frames, 0), 144);
  }

  for (const [name, trace] of Object.entries(first.traces)) {
    assert.equal(trace.fixedStepHz, 120, `${name} must use the authoritative cadence`);
    assert.equal(trace.samples.length, 144, `${name} must cover 1.2 seconds at 120 Hz`);
    assert.equal(trace.samples[0].frame, 1);
    assert.equal(trace.samples.at(-1).frame, 144);
  }

  assert.equal(first.traces.firstJump.markers[0].value, "1:0:0");
  assert.equal(first.traces.doubleJump.markers.at(-1).value, "1:1:0");
  assert.equal(first.traces.dodgeForward.markers.at(-1).value, "1:0:1");
  assert.equal(first.traces.dodgeSide.markers.at(-1).value, "1:0:1");
  assert.equal(first.traces.dodgeDiagonalRoll.markers.at(-1).value, "1:0:1");

  const diagonal = first.traces.dodgeDiagonalRoll.samples.find(sample => sample.state.actionSerials.dodge === 1);
  assert.ok(diagonal, "the diagonal trace must expose the committed dodge");
  assert.ok(Math.abs(diagonal.state.dodgeDirection.forward - .4472) < .001);
  assert.ok(Math.abs(diagonal.state.dodgeDirection.side - .8944) < .001);

  const air = first.traces.airAxes.samples;
  assert.equal(air[0].input.throttle, 1);
  assert.equal(air[35].input.throttle, 1);
  assert.equal(air[36].input.throttle, 0);
  assert.equal(air[72].input.throttle, -1);
  assert.equal(first.traces.freeAirRoll.samples[0].input.airRoll, true);
  assert.equal(first.traces.freeAirRoll.samples[0].input.roll, 1);
  assert.ok(Math.max(...first.traces.freeAirRoll.samples.map(sample => Math.abs(sample.state.localAngularVelocity.roll))) > 1);

  const ground = first.traces.groundControl.samples;
  assert.equal(ground[0].input.throttle, 1);
  assert.equal(ground[47].input.steer, 0);
  assert.equal(ground[48].input.steer, 1);
  assert.equal(ground[71].input.drift, false);
  assert.equal(ground[72].input.drift, true);
  assert.equal(ground[96].input.throttle, 0);
  assert.deepEqual(first.scenarioManifest.scenarios[0].phases.map(phase => phase.id), [
    "accelerate", "grip-turn", "powerslide-turn", "release"
  ]);
});

test("curve comparison reports zero shape error for an identical capture", () => {
  const capture = runMobilityCurveSuite();
  const report = compareCurveTraces(capture, capture, "dodge-diagonal-roll");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.referenceSamples, 144);
  assert.equal(report.candidateSamples, 144);
  assert.equal(report.activationFrame.reference, 12);
  assert.equal(report.activationFrame.candidate, 12);
  assert.equal(report.directionDelta.forward, 0);
  assert.equal(report.directionDelta.side, 0);
  for (const signal of Object.values(report.signals)) assert.equal(signal.shapeRms, 0);
  assert.deepEqual(report.phases.map(phase => phase.id), ["phase-1", "phase-2", "phase-3", "phase-4"]);
  assert.equal(report.orientation.samples, 144);
  assert.ok(report.orientation.forward.meanDegrees < .2);
  assert.ok(report.orientation.forward.maxDegrees < 2);
  assert.ok(report.orientation.up.meanDegrees < .2);
  assert.ok(report.orientation.up.maxDegrees < 2);
  for (const phase of report.phases) {
    for (const signal of Object.values(phase.signals)) assert.equal(signal.shapeRms, 0);
  }
});

test("curve comparison exposes LAN snapshot phases without treating them as native frames", () => {
  const trace = {
    samples: Array.from({ length: 4 }, (_, index) => ({
      frame: index + 1,
      input: {},
      state: {
        position: { x: index, y: index, z: 0 },
        velocity: { x: index, y: 0, z: 0 },
        localAngularVelocity: { pitch: 0, yaw: 0, roll: 0 },
        angularVelocity: { pitch: 0, yaw: 0, roll: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        actionSerials: { jump: 0, doubleJump: 0, dodge: 0 },
        dodgeDirection: { forward: 0, side: 0 },
      },
    })),
  };
  const document = {
    fixedStepHz: 60,
    scenarioManifest: { scenarios: [{ id: "dodge-side", phases: [{ id: "pulse", snapshots: 1 }, { id: "release", snapshots: 3 }] }] },
    traces: { dodgeSide: trace },
  };
  const report = compareCurveTraces(document, document, "dodge-side");
  assert.deepEqual(report.phases.map(phase => phase.id), ["pulse", "release"]);
  assert.deepEqual(report.phases.map(phase => phase.frames), [1, 3]);
});

