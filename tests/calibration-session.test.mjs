import assert from "node:assert/strict";
import test from "node:test";
import { beginCalibrationSession, buildCalibrationReport, calibrationStepHasEvidence, completeCalibrationStep, recordCalibrationSample, recommendedCalibrationDecision } from "../src/calibration-session.js";

function view(overrides = {}) {
  return {
    pitch: .1, yaw: .2, roll: -.3, speed: 18, h: 4, grounded: false, jumps: 1, jumpState: "first-jump",
    angularVelocity: { pitch: 2, yaw: -3, roll: 4 },
    ...overrides
  };
}

function addAirEvidence(session, at = 1) {
  const boost = session.active.id === "pitch-up-boost";
  recordCalibrationSample(session, view({ boosting: boost }), null, at);
  recordCalibrationSample(session, view({ pitch: .6, boosting: boost, angularVelocity: { pitch: 5, yaw: 1, roll: 1 } }), null, at + .1);
}

test("calibration session records authoritative ranges and proposes one matching tuning group", () => {
  const session = beginCalibrationSession("2026-10-10T12:00:00.000Z", "test build");
  recordCalibrationSample(session, view(), 18, 1);
  recordCalibrationSample(session, view({ pitch: .6, speed: 27, h: 7, angularVelocity: { pitch: 5, yaw: 1, roll: 1 } }), 26, 1.1);
  completeCalibrationStep(session, "lento", "El morro tarda demasiado en invertir.", "2026-10-10T12:00:01.000Z");

  const result = session.results[0];
  assert.equal(result.samples, 2);
  assert.deepEqual(result.peakAngularVelocity, { pitch: 5, yaw: 3, roll: 4 });
  assert.deepEqual(result.speed, { min: 18, max: 27 });
  assert.deepEqual(result.height, { min: 4, max: 7 });
  assert.deepEqual(result.acknowledgement, { min: 18, max: 26 });
  assert.match(recommendedCalibrationDecision(session), /airPitch\*/);
  assert.match(buildCalibrationReport(session), /El morro tarda demasiado/);
  assert.match(buildCalibrationReport(session), /Muestras autoritativas: 2/);
  assert.match(buildCalibrationReport(session), /Evidencia: aire=sí/);
});

test("calibration session does not turn a camera or multiple defect report into a physics-tuning request", () => {
  const camera = beginCalibrationSession("start", "test build");
  addAirEvidence(camera);
  completeCalibrationStep(camera, "camara", "", "end");
  assert.match(recommendedCalibrationDecision(camera), /cámara/);
  assert.match(recommendedCalibrationDecision(camera), /no ajustes TUNING/);
  assert.doesNotMatch(recommendedCalibrationDecision(camera), /Candidato único/);

  const mixed = beginCalibrationSession("start", "test build");
  addAirEvidence(mixed, 1);
  completeCalibrationStep(mixed, "lento", "", "one");
  addAirEvidence(mixed, 2);
  completeCalibrationStep(mixed, "lento", "", "two");
  addAirEvidence(mixed, 3);
  completeCalibrationStep(mixed, "lento", "", "three");
  assert.match(recommendedCalibrationDecision(mixed), /más de un grupo candidato/);
});

test("calibration session ignores malformed samples, requires maneuver evidence, and permits an explicit no-evidence result", () => {
  const session = beginCalibrationSession("start", "test build");
  recordCalibrationSample(session, null, 5, 1);
  assert.equal(session.active.samples, 0);
  recordCalibrationSample(session, view(), null, 2);
  assert.deepEqual(session.active.acknowledgement, { min: null, max: null });
  assert.equal(calibrationStepHasEvidence(session), false);
  completeCalibrationStep(session, "correcto", "", "blocked");
  assert.equal(session.results.length, 0);
  for (let index = 0; index < 6; index += 1) {
    if (index > 0) recordCalibrationSample(session, view(), null, index * 2);
    recordCalibrationSample(session, view(), null, index * 2 + 1);
    completeCalibrationStep(session, "sin-evidencia", "", `end-${index}`);
  }
  assert.equal(session.status, "complete");
  assert.equal(session.active, null);
  assert.equal(session.results.length, 6);
  assert.match(buildCalibrationReport(session), /No se ha registrado un defecto dominante/);
});
