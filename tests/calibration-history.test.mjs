import assert from "node:assert/strict";
import test from "node:test";
import { appendCalibrationHistory, buildCalibrationComparisonReport, compareCalibrationSessions, parseCalibrationHistory } from "../src/calibration-history.js";
import { beginCalibrationSession, completeCalibrationStep, recordCalibrationSample } from "../src/calibration-session.js";

function view() {
  return {
    pitch: .1, yaw: .2, roll: -.3, speed: 18, h: 4, grounded: false, jumps: 1, jumpState: "first-jump",
    angularVelocity: { pitch: 2, yaw: -3, roll: 4 }
  };
}

function completeSession(defectIndex = null) {
  const session = beginCalibrationSession("2026-10-10T12:00:00.000Z", "test build");
  for (let index = 0; index < 6; index += 1) {
    recordCalibrationSample(session, view(), 12, index);
    recordCalibrationSample(session, view(), 18, index + .1);
    completeCalibrationStep(session, "sin-evidencia", "", `end-${index}`);
  }
  if (defectIndex !== null) session.results[defectIndex].result = "lento";
  return session;
}

test("calibration history parses only completed sessions and remains bounded", () => {
  const complete = completeSession();
  const history = parseCalibrationHistory(JSON.stringify([
    { status: "active", startedAt: "now", results: [] },
    { status: "complete", startedAt: "now", results: [] },
    complete, complete, complete, complete, complete, complete, complete
  ]));
  assert.equal(history.length, 6);
  assert.deepEqual(parseCalibrationHistory("{invalid"), []);
  assert.equal(appendCalibrationHistory(history, { status: "active", startedAt: "now", results: [] }).length, 6);
});

test("two matching calibration sessions identify one repeated candidate without changing physics", () => {
  const first = completeSession(0);
  const second = completeSession(0);
  const history = appendCalibrationHistory(appendCalibrationHistory([], first), second);
  const comparison = compareCalibrationSessions(history);
  assert.deepEqual(comparison, {
    status: "repeated-candidate",
    candidate: "airPitch*",
    text: "El mismo candidato aparece en dos pasadas: airPitch*. Ya se puede investigar un único grupo, sin cambiar los demás."
  });
  assert.match(buildCalibrationComparisonReport(history), /comparación de sesiones/);
  assert.match(buildCalibrationComparisonReport(history), /airPitch\*/);
});

test("different calibration candidates remain a repeat request", () => {
  const history = [completeSession(0), completeSession(2)];
  assert.deepEqual(compareCalibrationSessions(history), {
    status: "mixed-or-no-candidate",
    text: "Las dos pasadas no señalan un único candidato repetido. Repite el guion antes de ajustar TUNING."
  });
});
