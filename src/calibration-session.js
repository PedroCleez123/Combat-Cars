// The calibration session is client-side observability. It records
// authoritative snapshots only and never alters input, prediction, or physics.
export const CALIBRATION_STEPS = Object.freeze([
  Object.freeze({
    id: "pitch-down",
    title: "1/6 · Pitch abajo",
    instruction: "Salta y mantén W entre 0,3 y 0,5 s. El morro debe bajar de forma continua.",
    expected: "W baja el morro; no debe girar respecto al mundo ni responder tarde.",
    candidate: "airPitch*"
  }),
  Object.freeze({
    id: "pitch-up-boost",
    title: "2/6 · Pitch arriba y nitro",
    instruction: "Salta, mantén S entre 0,3 y 0,5 s y aplica nitro.",
    expected: "S eleva el morro y el nitro añade ascenso según esa orientación.",
    candidate: "airPitch*"
  }),
  Object.freeze({
    id: "yaw",
    title: "3/6 · Yaw derecho",
    instruction: "Salta y mantén D entre 0,3 y 0,5 s.",
    expected: "La nariz gira a la derecha sin air roll ni desplazamiento lateral repentino.",
    candidate: "airYaw*"
  }),
  Object.freeze({
    id: "roll",
    title: "4/6 · Air roll",
    instruction: "Salta, prueba Ctrl izquierdo y después Espacio.",
    expected: "Los dos controles ruedan alrededor del morro en sentidos opuestos.",
    candidate: "airRoll*"
  }),
  Object.freeze({
    id: "combined-release",
    title: "5/6 · Combinación y liberación",
    instruction: "Salta, combina W + D + Shift y suelta los controles.",
    expected: "El giro combinado es continuo; al soltar, las tasas se atenúan sin detenerse de golpe.",
    candidate: "amortiguación aérea"
  }),
  Object.freeze({
    id: "boost-landing",
    title: "6/6 · Ascenso y aterrizaje",
    instruction: "Salta, apunta con S, aplica nitro, suelta y aterriza.",
    expected: "Asciende según el morro y recupera dos saltos al estabilizarse en suelo.",
    candidate: "boostGroundAcceleration/boostAirAcceleration"
  })
]);

const rounded = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
const emptyPeak = () => ({ pitch: 0, yaw: 0, roll: 0 });
const emptyRange = () => ({ min: null, max: null });

function createAggregate(step, startedAt) {
  return {
    id: step.id,
    title: step.title,
    startedAt,
    endedAt: null,
    samples: 0,
    peakAngularVelocity: emptyPeak(),
    speed: emptyRange(),
    height: emptyRange(),
    acknowledgement: emptyRange(),
    evidence: { airborne: false, attitudeChanged: false, angularMotion: false, boosted: false, landed: false },
    first: null,
    last: null
  };
}

function updateRange(range, value) {
  if (!Number.isFinite(value)) return;
  range.min = range.min === null ? value : Math.min(range.min, value);
  range.max = range.max === null ? value : Math.max(range.max, value);
}

function viewSample(car) {
  const angular = car?.angularVelocity || {};
  return {
    attitude: {
      pitch: rounded(Number(car?.pitch)),
      yaw: rounded(Number(car?.yaw)),
      roll: rounded(Number(car?.roll))
    },
    state: car?.jumpState || (car?.grounded ? "grounded" : "airborne"),
    jumps: Number.isFinite(car?.jumps) ? car.jumps : null,
    grounded: Boolean(car?.grounded)
  };
}

function closeAggregate(session, result, note, at) {
  const aggregate = session.active;
  if (!aggregate) return;
  aggregate.endedAt = at;
  aggregate.result = result;
  aggregate.note = note.trim();
  session.results.push(aggregate);
  session.active = null;
}

export function beginCalibrationSession(at, build = "local") {
  return {
    build,
    startedAt: at,
    status: "active",
    stepIndex: 0,
    results: [],
    active: createAggregate(CALIBRATION_STEPS[0], at)
  };
}

export function recordCalibrationSample(session, car, acknowledgementMs, at) {
  if (!session || session.status !== "active" || !session.active || !car) return session;
  const aggregate = session.active;
  const angular = car.angularVelocity || {};
  aggregate.samples += 1;
  for (const axis of ["pitch", "yaw", "roll"]) {
    const rate = Number(angular[axis]);
    if (Number.isFinite(rate)) aggregate.peakAngularVelocity[axis] = Math.max(aggregate.peakAngularVelocity[axis], Math.abs(rate));
  }
  updateRange(aggregate.speed, Number(car.speed));
  updateRange(aggregate.height, Number(car.h));
  updateRange(aggregate.acknowledgement, Number.isFinite(acknowledgementMs) ? acknowledgementMs : Number.NaN);
  const sample = viewSample(car);
  if (!aggregate.first) aggregate.first = sample;
  else {
    const initial = aggregate.first.attitude;
    const current = sample.attitude;
    if (["pitch", "yaw", "roll"].some(axis => Number.isFinite(initial[axis])
      && Number.isFinite(current[axis]) && Math.abs(initial[axis] - current[axis]) >= .08)) {
      aggregate.evidence.attitudeChanged = true;
    }
  }
  aggregate.evidence.airborne ||= !sample.grounded;
  aggregate.evidence.angularMotion ||= ["pitch", "yaw", "roll"].some(axis => Math.abs(Number(angular[axis]) || 0) >= .3);
  aggregate.evidence.boosted ||= Boolean(car.boosting);
  aggregate.evidence.landed ||= Boolean(aggregate.last && !aggregate.last.grounded && sample.grounded);
  aggregate.last = sample;
  aggregate.lastAt = at;
  return session;
}

export function calibrationStepHasEvidence(session) {
  const aggregate = session?.active;
  if (!aggregate || aggregate.samples < 2) return false;
  const evidence = aggregate.evidence;
  const airControl = evidence.airborne && evidence.attitudeChanged && evidence.angularMotion;
  if (aggregate.id === "pitch-up-boost") return airControl && evidence.boosted;
  if (aggregate.id === "boost-landing") return evidence.airborne && evidence.boosted && evidence.landed;
  return airControl;
}

export function completeCalibrationStep(session, result, note = "", at) {
  if (!session || session.status !== "active") return session;
  if (!session.active || session.active.samples < 2) return session;
  if (result !== "sin-evidencia" && !calibrationStepHasEvidence(session)) return session;
  closeAggregate(session, result, note, at);
  session.stepIndex += 1;
  if (session.stepIndex >= CALIBRATION_STEPS.length) {
    session.status = "complete";
  } else {
    session.active = createAggregate(CALIBRATION_STEPS[session.stepIndex], at);
  }
  return session;
}

export function recommendedCalibrationDecision(session) {
  if (!session?.results?.length) return "Sin datos todavía: repite una maniobra antes de ajustar la física.";
  const defects = session.results.filter(result => !["correcto", "sin-evidencia"].includes(result.result));
  if (!defects.length) return "No se ha registrado un defecto dominante: conserva TUNING y acepta esta línea base.";
  const candidates = new Set(defects.map(result => {
    if (result.result === "camara") return "cámara";
    if (result.result === "retardo") return "red/ACK";
    if (result.result === "contacto") return "contactos/aterrizaje";
    if (result.result === "nitro") return "boostGroundAcceleration/boostAirAcceleration";
    return CALIBRATION_STEPS.find(step => step.id === result.id)?.candidate;
  }).filter(Boolean));
  if (candidates.size !== 1) return "Hay más de un grupo candidato: repite el guion y aísla un defecto antes de cambiar TUNING.";
  const [candidate] = candidates;
  if (candidate === "cámara" || candidate === "red/ACK" || candidate === "contactos/aterrizaje") {
    return `El defecto pertenece a ${candidate}: vuelve al hito dueño de ese subsistema; no ajustes TUNING para ocultarlo.`;
  }
  return `Candidato único para investigar, sin aplicar aún: ${candidate}. Repite este paso y ajusta solo ese grupo si el defecto vuelve a aparecer.`;
}

function formatRange(range, suffix = "") {
  if (range.min === null || range.max === null) return "—";
  return `${rounded(range.min)}–${rounded(range.max)}${suffix}`;
}

export function buildCalibrationReport(session) {
  if (!session) return "No hay una sesión de calibración.";
  const lines = [
    "# FIS-14D.1 — informe de calibración aérea",
    `Build: ${session.build}`,
    `Inicio: ${session.startedAt}`,
    `Estado: ${session.status}`,
    ""
  ];
  for (const result of session.results) {
    const first = result.first?.attitude || {};
    const last = result.last?.attitude || {};
    lines.push(`## ${result.title}`);
    lines.push(`- Resultado: ${result.result || "sin-evidencia"}`);
    lines.push(`- Muestras autoritativas: ${result.samples}`);
    lines.push(`- Actitud inicial/final P-Y-R: ${first.pitch ?? "—"} / ${first.yaw ?? "—"} / ${first.roll ?? "—"} → ${last.pitch ?? "—"} / ${last.yaw ?? "—"} / ${last.roll ?? "—"}`);
    lines.push(`- Pico de giro P-Y-R: ${rounded(result.peakAngularVelocity.pitch)} / ${rounded(result.peakAngularVelocity.yaw)} / ${rounded(result.peakAngularVelocity.roll)} rad/s`);
    lines.push(`- Velocidad: ${formatRange(result.speed)} u/s; altura: ${formatRange(result.height)} u; ACK: ${formatRange(result.acknowledgement, " ms")}`);
    const evidence = result.evidence;
    lines.push(`- Evidencia: aire=${evidence.airborne ? "sí" : "no"}; actitud=${evidence.attitudeChanged ? "sí" : "no"}; giro=${evidence.angularMotion ? "sí" : "no"}; nitro=${evidence.boosted ? "sí" : "no"}; aterrizaje=${evidence.landed ? "sí" : "no"}`);
    lines.push(`- Último estado: ${result.last?.state || "—"}; saltos: ${result.last?.jumps ?? "—"}`);
    if (result.note) lines.push(`- Nota: ${result.note}`);
    lines.push("");
  }
  if (session.active) lines.push(`Paso actual sin cerrar: ${session.active.title} (${session.active.samples} muestras).`, "");
  lines.push(`Decisión: ${recommendedCalibrationDecision(session)}`);
  return lines.join("\n");
}
