import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runContactTransitionProbes } from "../src/contact-transition-probes.js";

const referencePath = resolve(process.argv[2] || "docs/reference-captures/rocketsim-r4-contact-transitions-c2baacb8.json");
const outputPath = resolve(process.argv[3] || "docs/reference-captures/arsenal-r4-contact-normalized.json");
const FIXED_STEP_HZ = 120;
const DROP_SCENARIOS = new Set(["flat-drop", "pitch-drop", "roll-drop"]);
const ARSENAL_SUSPENSION_TRAVEL = .24;
const round = value => Math.round(Number(value || 0) * 10000) / 10000;

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function upAngleDegrees(up) {
  if (!up) return null;
  const length = Math.hypot(up.x, up.y, up.z) || 1;
  return Math.acos(clamp(up.y / length, -1, 1)) * 180 / Math.PI;
}

function rotateByQuaternion(q, vector) {
  if (!q) return null;
  const ix = q.w * vector.x + q.y * vector.z - q.z * vector.y;
  const iy = q.w * vector.y + q.z * vector.x - q.x * vector.z;
  const iz = q.w * vector.z + q.x * vector.y - q.y * vector.x;
  const iw = -q.x * vector.x - q.y * vector.y - q.z * vector.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

function firstAirborneFrame(samples) {
  return samples.find(sample => !sample.state.grounded)?.frame ?? null;
}

function firstWheelSupportFrame(samples, afterFrame = 0) {
  return samples.find(sample => sample.frame > afterFrame && sample.state.wheelSupport)?.frame ?? null;
}

function firstBodyContactFrame(samples, afterFrame = 0) {
  return samples.find(sample => sample.frame > afterFrame && sample.state.bodyContact)?.frame ?? null;
}

function firstGroundedFrame(samples, afterFrame = 0) {
  return samples.find(sample => sample.frame > afterFrame && sample.state.grounded)?.frame ?? null;
}

function restHeight(samples) {
  return average(samples.slice(-10).map(sample => sample.state.position.y));
}

function estimateGravity(samples, contactFrame) {
  if (!contactFrame) return null;
  const freeFall = [];
  for (let index = 1; index < samples.length && samples[index].frame < contactFrame; index += 1) {
    const previous = samples[index - 1].state.velocity.y;
    const current = samples[index].state.velocity.y;
    const delta = (previous - current) * FIXED_STEP_HZ;
    if (Number.isFinite(delta) && delta > 0) freeFall.push(delta);
  }
  return median(freeFall.slice(0, 24));
}

function normalizedWheelCompression(wheel, engine) {
  if (engine === "rocketsim") return Number(wheel?.normalizedCompression) || 0;
  return Math.max(0, Math.min(1, (Number(wheel?.compression) || 0) / ARSENAL_SUSPENSION_TRAVEL));
}

function wheelForce(wheel) {
  return Math.max(0, Number(wheel?.force ?? wheel?.suspensionForce) || 0);
}

function suspensionMetrics(samples, engine, supportFrame) {
  if (supportFrame === null) {
    return {
      firstMeaningfulCompressionFrame: null,
      firstMeaningfulCompressionDelayFrames: null,
      peakAverageNormalizedCompression: null,
      settledAverageNormalizedCompression: null,
      firstMeaningfulRelativeLoadFrame: null,
      firstMeaningfulRelativeLoadDelayFrames: null,
      peakAverageRelativeLoad: null,
      settledAverageRelativeLoad: null
    };
  }
  const postSupport = samples.filter(sample => sample.frame >= supportFrame);
  const frameMeans = postSupport.map(sample => {
    const values = sample.state.wheels.map(wheel => normalizedWheelCompression(wheel, engine));
    return { frame: sample.frame, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
  });
  const forceMeans = postSupport.map(sample => {
    const values = sample.state.wheels.map(wheel => wheelForce(wheel));
    return { frame: sample.frame, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
  });
  const settledForce = average(forceMeans.slice(-10).map(sample => sample.mean));
  const relativeForce = settledForce > 1e-9
    ? forceMeans.map(sample => ({ frame: sample.frame, mean: sample.mean / settledForce }))
    : [];
  const meaningfulForce = relativeForce.find(sample => sample.mean >= .05);
  const meaningful = frameMeans.find(sample => sample.mean >= .05);
  return {
    firstMeaningfulCompressionFrame: meaningful?.frame ?? null,
    firstMeaningfulCompressionDelayFrames: meaningful ? meaningful.frame - supportFrame : null,
    peakAverageNormalizedCompression: frameMeans.length ? round(Math.max(...frameMeans.map(sample => sample.mean))) : null,
    settledAverageNormalizedCompression: frameMeans.length
      ? round(average(frameMeans.slice(-10).map(sample => sample.mean))) : null,
    firstMeaningfulRelativeLoadFrame: meaningfulForce?.frame ?? null,
    firstMeaningfulRelativeLoadDelayFrames: meaningfulForce ? meaningfulForce.frame - supportFrame : null,
    peakAverageRelativeLoad: relativeForce.length ? round(Math.max(...relativeForce.map(sample => sample.mean))) : null,
    settledAverageRelativeLoad: relativeForce.length
      ? round(average(relativeForce.slice(-10).map(sample => sample.mean))) : null
  };
}

function normalizeTrace(samples, { engine, dropScenario }) {
  const airborne = firstAirborneFrame(samples) || 0;
  const body = firstBodyContactFrame(samples, airborne);
  const wheel = firstWheelSupportFrame(samples, airborne);
  const grounded = firstGroundedFrame(samples, airborne);
  const contact = body || wheel || grounded;
  const startY = samples[0]?.state.position.y ?? null;
  const floorY = restHeight(samples);
  const clearance = startY === null || floorY === null ? null : Math.max(0, startY - floorY);
  const gravity = dropScenario ? estimateGravity(samples, contact) : null;
  const freeFallTime = gravity && clearance ? Math.sqrt(2 * clearance / gravity) : null;
  const supportTime = wheel === null ? null : wheel / FIXED_STEP_HZ;
  const supportTimeRatio = freeFallTime && supportTime ? supportTime / freeFallTime : null;
  const supportSample = wheel === null ? null : samples.find(sample => sample.frame === wheel);
  const supportUp = engine === "arsenal"
    ? rotateByQuaternion(supportSample?.state.orientation, { x: 0, y: 1, z: 0 })
    : supportSample?.state.orientation?.up;
  const tangential = contact === null ? [] : samples
    .filter(sample => sample.frame >= contact)
    .map(sample => sample.state.tangentSpeed)
    .filter(Number.isFinite);
  return {
    firstAirborneFrame: airborne || null,
    firstBodyContactFrame: body,
    firstWheelSupportFrame: wheel,
    firstGroundedFrame: grounded,
    clearance: clearance === null ? null : round(clearance),
    gravityEstimate: gravity === null ? null : round(gravity),
    freeFallTimeSeconds: freeFallTime === null ? null : round(freeFallTime),
    wheelSupportTimeSeconds: supportTime === null ? null : round(supportTime),
    wheelSupportTimeOverFreeFall: supportTimeRatio === null ? null : round(supportTimeRatio),
    bodyToWheelSupportFrames: body === null || wheel === null ? null : wheel - body,
    suspension: suspensionMetrics(samples, engine, wheel),
    firstSupportUpAngleDegrees: upAngleDegrees(supportUp) === null ? null : round(upAngleDegrees(supportUp)),
    maximumTangentSpeedAfterContact: tangential.length ? round(Math.max(...tangential)) : null,
    normalization: dropScenario
      ? "tiempo de apoyo dividido por sqrt(2 * altura libre / gravedad estimada)"
      : "no aplicable: la maniobra contiene salto o dodge activo"
  };
}

function summarizeArsenal(trace, id) {
  return normalizeTrace(trace.samples, { engine: "arsenal", dropScenario: DROP_SCENARIOS.has(id) });
}

function summarizeRocketSim(trace, id) {
  const airborne = firstAirborneFrame(trace.samples) || 0;
  return normalizeTrace(trace.samples, { engine: "rocketsim", dropScenario: DROP_SCENARIOS.has(id) && airborne > 0 });
}

const arsenal = runContactTransitionProbes();
const rocketsim = JSON.parse(await readFile(referencePath, "utf8"));
const ids = Object.keys(arsenal.traces);
const scenarios = Object.fromEntries(ids.map(id => {
  const own = summarizeArsenal(arsenal.traces[id], id);
  const reference = summarizeRocketSim(rocketsim.contactTraces[id], id);
  return [id, {
    arsenal: own,
    rocketsim: reference,
    normalizedDelta: {
      wheelSupportTimeOverFreeFall: own.wheelSupportTimeOverFreeFall === null || reference.wheelSupportTimeOverFreeFall === null
        ? null : round(reference.wheelSupportTimeOverFreeFall - own.wheelSupportTimeOverFreeFall),
      firstSupportUpAngleDegrees: own.firstSupportUpAngleDegrees === null || reference.firstSupportUpAngleDegrees === null
        ? null : round(reference.firstSupportUpAngleDegrees - own.firstSupportUpAngleDegrees),
      firstMeaningfulCompressionDelayFrames: own.suspension.firstMeaningfulCompressionDelayFrames === null
        || reference.suspension.firstMeaningfulCompressionDelayFrames === null
        ? null : reference.suspension.firstMeaningfulCompressionDelayFrames
          - own.suspension.firstMeaningfulCompressionDelayFrames,
      peakAverageNormalizedCompression: own.suspension.peakAverageNormalizedCompression === null
        || reference.suspension.peakAverageNormalizedCompression === null
        ? null : round(reference.suspension.peakAverageNormalizedCompression
          - own.suspension.peakAverageNormalizedCompression),
      settledAverageNormalizedCompression: own.suspension.settledAverageNormalizedCompression === null
        || reference.suspension.settledAverageNormalizedCompression === null
        ? null : round(reference.suspension.settledAverageNormalizedCompression
          - own.suspension.settledAverageNormalizedCompression),
      firstMeaningfulRelativeLoadDelayFrames: own.suspension.firstMeaningfulRelativeLoadDelayFrames === null
        || reference.suspension.firstMeaningfulRelativeLoadDelayFrames === null
        ? null : reference.suspension.firstMeaningfulRelativeLoadDelayFrames
          - own.suspension.firstMeaningfulRelativeLoadDelayFrames,
      peakAverageRelativeLoad: own.suspension.peakAverageRelativeLoad === null
        || reference.suspension.peakAverageRelativeLoad === null
        ? null : round(reference.suspension.peakAverageRelativeLoad
          - own.suspension.peakAverageRelativeLoad)
    }
  }];
}));

const report = {
  schemaVersion: 1,
  source: "Arsenal M4-03 contact normalization gate",
  fixedStepHz: FIXED_STEP_HZ,
  ownCapture: "generated by runContactTransitionProbes()",
  referenceCapture: referencePath,
  scenarios,
  decision: {
    status: "pending",
    conclusion: "La normalización permite comparar caída libre, ángulos de apoyo y carga relativa de rueda. El harness de desarrollo también conserva longitud y fuerza del muelle desde btVehicleRL; esos campos no forman parte de CarState ni de la producción.",
    allowedUse: "Usar diferencias normalizadas para escoger una única hipótesis M4-03; no copiar constantes ni ajustar TUNING con este informe.",
    blockedBy: [
      "La carga relativa se normaliza con el apoyo asentado de cada motor y no convierte sus unidades internas en una misma fuerza.",
      "Las maniobras de dodge no son caídas libres y quedan fuera de la razón tiempo/altura.",
      "El plano sintético no cubre paredes, esquinas ni techo."
    ]
  }
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Informe normalizado escrito en ${outputPath}`);
