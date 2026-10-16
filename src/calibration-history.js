import { CALIBRATION_STEPS, buildCalibrationReport, recommendedCalibrationDecision } from "./calibration-session.js";

export const CALIBRATION_HISTORY_LIMIT = 6;

function validSession(session) {
  return session && session.status === "complete" && Array.isArray(session.results)
    && session.results.length === CALIBRATION_STEPS.length && typeof session.startedAt === "string";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function parseCalibrationHistory(serialized) {
  try {
    const value = JSON.parse(serialized || "[]");
    return Array.isArray(value) ? value.filter(validSession).slice(-CALIBRATION_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function appendCalibrationHistory(history, session) {
  const current = Array.isArray(history) ? history.filter(validSession) : [];
  if (!validSession(session)) return current.slice(-CALIBRATION_HISTORY_LIMIT);
  return [...current, clone(session)].slice(-CALIBRATION_HISTORY_LIMIT);
}

function decisionKey(session) {
  const decision = recommendedCalibrationDecision(session);
  const match = decision.match(/Candidato único para investigar, sin aplicar aún: ([^.]+)/);
  return match ? match[1] : null;
}

export function compareCalibrationSessions(history) {
  const sessions = Array.isArray(history) ? history.filter(validSession).slice(-2) : [];
  if (sessions.length < 2) {
    return { status: "needs-more-sessions", text: "Falta una segunda sesión completada para comparar el defecto dominante." };
  }
  const [first, second] = sessions;
  const firstCandidate = decisionKey(first);
  const secondCandidate = decisionKey(second);
  if (firstCandidate && firstCandidate === secondCandidate) {
    return {
      status: "repeated-candidate",
      candidate: firstCandidate,
      text: `El mismo candidato aparece en dos pasadas: ${firstCandidate}. Ya se puede investigar un único grupo, sin cambiar los demás.`
    };
  }
  return {
    status: "mixed-or-no-candidate",
    text: "Las dos pasadas no señalan un único candidato repetido. Repite el guion antes de ajustar TUNING."
  };
}

export function buildCalibrationComparisonReport(history) {
  const sessions = Array.isArray(history) ? history.filter(validSession).slice(-2) : [];
  const lines = [
    "# FIS-14D.2 — comparación de sesiones de calibración",
    `Sesiones incluidas: ${sessions.length}`,
    ""
  ];
  sessions.forEach((session, index) => {
    lines.push(`# Sesión ${index + 1}`);
    lines.push(buildCalibrationReport(session));
    lines.push("");
  });
  lines.push(`## Conclusión`, compareCalibrationSessions(sessions).text);
  return lines.join("\n");
}
