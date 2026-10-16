import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runContactTransitionProbes } from "../src/contact-transition-probes.js";

const referencePath = resolve(process.argv[2] || "docs/reference-captures/rocketsim-r4-contact-transitions-c2baacb8.json");
const outputPath = resolve(process.argv[3] || "docs/reference-captures/arsenal-r4-contact-comparison.json");
const FIXED_STEP_HZ = 120;
const round = value => Math.round(Number(value || 0) * 10000) / 10000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rotateByQuaternion(q, v) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

function upAngleDegrees(up) {
  const length = Math.hypot(up.x, up.y, up.z) || 1;
  return Math.acos(clamp(up.y / length, -1, 1)) * 180 / Math.PI;
}

function arsenalUp(sample) {
  return rotateByQuaternion(sample.state.orientation, { x: 0, y: 1, z: 0 });
}

function isSettled(state) {
  const angular = state.angularVelocity || { pitch: 0, yaw: 0, roll: 0 };
  return Boolean(state.grounded)
    && Math.abs(state.normalSpeed || 0) < .05
    && (state.tangentSpeed || 0) < .05
    && Math.max(Math.abs(angular.pitch), Math.abs(angular.yaw), Math.abs(angular.roll)) < .05;
}

function firstSettledFrame(samples, startFrame) {
  for (let index = Math.max(0, startFrame - 1); index < samples.length; index += 1) {
    if (isSettled(samples[index].state)) return samples[index].frame;
  }
  return null;
}

function summarizeArsenal(trace) {
  const samples = trace.samples;
  const firstAirborne = samples.find(sample => !sample.state.grounded)?.frame ?? 0;
  const firstBodyContact = trace.summary.firstBodyContactFrame;
  const firstWheelSupport = trace.summary.firstWheelSupportFrame;
  const firstGrounded = trace.summary.firstGroundedFrame;
  const firstSupportSample = samples.find(sample => sample.frame === firstWheelSupport);
  const maxTangent = trace.summary.maximumTangentSpeedAfterBodyContact;
  return {
    firstAirborneFrame: firstAirborne || null,
    firstBodyContactFrame: firstBodyContact,
    firstWheelSupportFrame: firstWheelSupport,
    firstGroundedFrame: firstGrounded,
    bodyToWheelSupportFrames: trace.summary.bodyToWheelSupportFrames,
    maximumTangentSpeedAfterContact: maxTangent,
    firstSupportUpAngleDegrees: firstSupportSample ? round(upAngleDegrees(arsenalUp(firstSupportSample))) : null,
    settledFrame: firstSettledFrame(samples, firstGrounded || firstWheelSupport || 1),
    final: trace.summary.final
  };
}

function summarizeRocketSim(trace) {
  const samples = trace.samples;
  const firstAirborne = samples.find(sample => !sample.state.grounded)?.frame ?? 0;
  const afterAirborne = samples.filter(sample => sample.frame > firstAirborne);
  const firstBody = afterAirborne.find(sample => sample.state.bodyContact);
  const firstWheel = afterAirborne.find(sample => sample.state.wheelSupport);
  const firstGrounded = afterAirborne.find(sample => sample.state.grounded);
  const contactStart = firstBody?.frame || firstWheel?.frame || firstGrounded?.frame || null;
  const afterContact = contactStart ? samples.filter(sample => sample.frame >= contactStart) : [];
  const maxTangent = afterContact.length
    ? Math.max(...afterContact.map(sample => sample.state.tangentSpeed || 0))
    : null;
  const firstSupportUp = firstWheel?.state.orientation?.up;
  return {
    firstAirborneFrame: firstAirborne || null,
    firstBodyContactFrame: firstBody?.frame ?? null,
    firstWheelSupportFrame: firstWheel?.frame ?? null,
    firstGroundedFrame: firstGrounded?.frame ?? null,
    bodyToWheelSupportFrames: firstBody && firstWheel ? firstWheel.frame - firstBody.frame : null,
    maximumTangentSpeedAfterContact: maxTangent === null ? null : round(maxTangent),
    firstSupportUpAngleDegrees: firstSupportUp ? round(upAngleDegrees(firstSupportUp)) : null,
    settledFrame: firstSettledFrame(samples, contactStart || firstAirborne || 1),
    final: samples.at(-1)?.state || null
  };
}

function delta(a, b) {
  return a === null || b === null || a === undefined || b === undefined ? null : round(b - a);
}

const arsenal = runContactTransitionProbes();
const rocketsim = JSON.parse(await readFile(referencePath, "utf8"));
const scenarioIds = Object.keys(arsenal.traces);
const scenarios = Object.fromEntries(scenarioIds.map(id => {
  const own = summarizeArsenal(arsenal.traces[id]);
  const reference = summarizeRocketSim(rocketsim.contactTraces[id]);
  return [id, {
    arsenal: own,
    rocketsim: reference,
    deltas: {
      firstWheelSupportFrames: delta(own.firstWheelSupportFrame, reference.firstWheelSupportFrame),
      firstGroundedFrames: delta(own.firstGroundedFrame, reference.firstGroundedFrame),
      settledFrames: delta(own.settledFrame, reference.settledFrame),
      firstSupportUpAngleDegrees: delta(own.firstSupportUpAngleDegrees, reference.firstSupportUpAngleDegrees),
      maximumTangentSpeed: own.maximumTangentSpeedAfterContact === null || reference.maximumTangentSpeedAfterContact === null
        ? null
        : round(reference.maximumTangentSpeedAfterContact - own.maximumTangentSpeedAfterContact)
    }
  }];
}));

const report = {
  schemaVersion: 1,
  source: "Arsenal M4-02 contact comparison",
  fixedStepHz: FIXED_STEP_HZ,
  ownCapture: "docs/reference-captures/arsenal-m4-01-contact-transitions.json",
  referenceCapture: referencePath,
  scenarios,
  interpretation: {
    purpose: "Comparar orden de contacto, apoyo, recuperación y tendencia tangencial en un suelo sintético.",
    units: "Los frames y ángulos se comparan directamente; posición y velocidad conservan las unidades propias de cada motor.",
    limitations: [
      "RocketSim expone contacto de carrocería solo cuando Bullet informa una colisión del chasis; el apoyo de rueda se observa mediante wheelsWithContact.",
      "RocketSim no publica compresión de muelle en CarState; el harness R4 conserva telemetría interna de longitud y fuerza solo para normalize:contacts.",
      "Las alturas iniciales no son equivalentes en unidades internas: R4 usa 30 UU sobre CAR_SPAWN_REST_Z para mantener las caídas inequívocamente aéreas.",
      "Esta comparación no justifica copiar código o constantes ni declara equivalencia exacta con Rocket League o Car Soccer."
    ]
  }
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Comparación escrita en ${outputPath}`);
