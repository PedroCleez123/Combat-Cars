// Compare dimensionless curve shape only. World units and absolute scales are
// intentionally reported separately because reference engines may use other
// units, chassis sizes or time origins.

const SIGNALS = Object.freeze({
  height: sample => sample.state.position.y,
  speed: sample => Math.hypot(sample.state.velocity.x, sample.state.velocity.y, sample.state.velocity.z),
  verticalVelocity: sample => sample.state.velocity.y,
  pitchRate: sample => (sample.state.localAngularVelocity || sample.state.angularVelocity).pitch,
  yawRate: sample => (sample.state.localAngularVelocity || sample.state.angularVelocity).yaw,
  rollRate: sample => (sample.state.localAngularVelocity || sample.state.angularVelocity).roll
});

const round = value => Math.round(Number(value || 0) * 10000) / 10000;

function validateTrace(trace, label) {
  if (!trace || !Array.isArray(trace.samples) || trace.samples.length < 2) {
    throw new Error(`${label} no contiene al menos dos muestras`);
  }
  if (trace.samples.some(sample => !sample?.state || !sample.input)) {
    throw new Error(`${label} contiene una muestra sin state o input`);
  }
}

function resample(values, count = 32) {
  if (values.length === count) return values.slice();
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const position = i * (values.length - 1) / (count - 1);
    const lower = Math.floor(position);
    const upper = Math.min(values.length - 1, lower + 1);
    const amount = position - lower;
    result.push(values[lower] + (values[upper] - values[lower]) * amount);
  }
  return result;
}

function normalize(values) {
  const baseline = values[0];
  const relative = values.map(value => value - baseline);
  const magnitude = Math.max(...relative.map(value => Math.abs(value)));
  // A reference can be exactly stationary while the candidate retains a few
  // floating-point digits. Such a flat signal has no curve to compare, so it
  // must not produce a large normalized error from numerical noise alone.
  if (magnitude < 1e-3) return relative.map(() => 0);
  const scale = magnitude;
  return relative.map(value => value / scale);
}

function rmsDelta(left, right) {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += (left[i] - right[i]) ** 2;
  return Math.sqrt(sum / left.length);
}

function activationFrame(trace, scenario) {
  const key = scenario.includes("dodge") ? "dodge"
    : scenario.includes("double") ? "doubleJump" : scenario.includes("jump") ? "jump" : null;
  if (!key) return null;
  const sample = trace.samples.find(item => item.state.actionSerials?.[key] > 0);
  return sample?.frame ?? null;
}

function scenarioPhases(traceDocument, scenario) {
  const manifest = traceDocument?.scenarioManifest;
  const entry = manifest?.scenarios?.find(item => item.id === scenario);
  return entry?.phases || [];
}

function compareSignals(referenceSamples, candidateSamples, sampleCount) {
  const signals = {};
  for (const [name, read] of Object.entries(SIGNALS)) {
    const referenceRaw = referenceSamples.map(read);
    const candidateRaw = candidateSamples.map(read);
    const referenceShape = resample(normalize(referenceRaw), Math.min(sampleCount, referenceRaw.length));
    const candidateShape = resample(normalize(candidateRaw), Math.min(sampleCount, candidateRaw.length));
    signals[name] = {
      shapeRms: round(rmsDelta(referenceShape, candidateShape)),
      referencePeakAbs: round(Math.max(...referenceRaw.map(value => Math.abs(value)))),
      candidatePeakAbs: round(Math.max(...candidateRaw.map(value => Math.abs(value))))
    };
  }
  return signals;
}

function phaseComparisons(referenceTrace, candidateTrace, phases, sampleCount) {
  if (!phases.length) return [];
  const totalFrames = phases.reduce((total, phase) => total + phase.frames, 0);
  if (totalFrames !== candidateTrace.samples.length) return [];
  let startFrame = 0;
  return phases.map((phase, index) => {
    const endFrame = startFrame + phase.frames;
    const referenceStart = Math.round(startFrame / totalFrames * referenceTrace.samples.length);
    const referenceEnd = Math.round(endFrame / totalFrames * referenceTrace.samples.length);
    const candidateStart = Math.round(startFrame / totalFrames * candidateTrace.samples.length);
    const candidateEnd = Math.round(endFrame / totalFrames * candidateTrace.samples.length);
    startFrame = endFrame;
    return {
      id: phase.id || `phase-${index + 1}`,
      frames: phase.frames,
      input: phase.input,
      signals: compareSignals(
        referenceTrace.samples.slice(referenceStart, referenceEnd),
        candidateTrace.samples.slice(candidateStart, candidateEnd),
        sampleCount
      )
    };
  });
}

function rotateQuaternion(q, vector) {
  const ix = q.w * vector.x + q.y * vector.z - q.z * vector.y;
  const iy = q.w * vector.y + q.z * vector.x - q.x * vector.z;
  const iz = q.w * vector.z + q.x * vector.y - q.y * vector.x;
  const iw = -q.x * vector.x - q.y * vector.y - q.z * vector.z;
  const rotated = {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
  const magnitude = Math.hypot(rotated.x, rotated.y, rotated.z);
  return magnitude > 0.000001
    ? { x: rotated.x / magnitude, y: rotated.y / magnitude, z: rotated.z / magnitude }
    : rotated;
}

function orientationVectors(state) {
  if (state?.orientation?.forward && state.orientation.up) return state.orientation;
  if (state?.orientation && Number.isFinite(state.orientation.w)) {
    return {
      forward: rotateQuaternion(state.orientation, { x: 1, y: 0, z: 0 }),
      up: rotateQuaternion(state.orientation, { x: 0, y: 1, z: 0 })
    };
  }
  return null;
}

function angularDifferenceDegrees(left, right) {
  const dot = Math.max(-1, Math.min(1, left.x * right.x + left.y * right.y + left.z * right.z));
  return Math.acos(dot) * 180 / Math.PI;
}

function orientationComparison(referenceSamples, candidateSamples) {
  const count = Math.min(referenceSamples.length, candidateSamples.length);
  const forward = [], up = [];
  for (let i = 0; i < count; i += 1) {
    const reference = orientationVectors(referenceSamples[i].state);
    const candidate = orientationVectors(candidateSamples[i].state);
    if (!reference || !candidate) continue;
    forward.push(angularDifferenceDegrees(reference.forward, candidate.forward));
    up.push(angularDifferenceDegrees(reference.up, candidate.up));
  }
  if (!forward.length) return null;
  const summary = values => ({
    meanDegrees: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    maxDegrees: round(Math.max(...values))
  });
  return { samples: forward.length, forward: summary(forward), up: summary(up) };
}

export function compareCurveTraces(reference, candidate, scenario, sampleCount = 32) {
  const key = scenario.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const referenceTrace = reference?.traces?.[key];
  const candidateTrace = candidate?.traces?.[key];
  if (!referenceTrace || !candidateTrace) throw new Error(`Falta el escenario ${scenario}`);
  validateTrace(referenceTrace, `reference.${scenario}`);
  validateTrace(candidateTrace, `candidate.${scenario}`);

  const signals = compareSignals(referenceTrace.samples, candidateTrace.samples, sampleCount);

  const referenceDirection = referenceTrace.samples.find(sample =>
    Math.abs(sample.state.dodgeDirection?.forward || 0) + Math.abs(sample.state.dodgeDirection?.side || 0) > 0
  )?.state.dodgeDirection || null;
  const candidateDirection = candidateTrace.samples.find(sample =>
    Math.abs(sample.state.dodgeDirection?.forward || 0) + Math.abs(sample.state.dodgeDirection?.side || 0) > 0
  )?.state.dodgeDirection || null;

  return {
    schemaVersion: 1,
    scenario,
    referenceSamples: referenceTrace.samples.length,
    candidateSamples: candidateTrace.samples.length,
    referenceFixedStepHz: reference.fixedStepHz,
    candidateFixedStepHz: candidate.fixedStepHz,
    activationFrame: {
      reference: activationFrame(referenceTrace, scenario),
      candidate: activationFrame(candidateTrace, scenario)
    },
    directionDelta: referenceDirection && candidateDirection ? {
      forward: round(candidateDirection.forward - referenceDirection.forward),
      side: round(candidateDirection.side - referenceDirection.side)
    } : null,
    signals,
    orientation: orientationComparison(referenceTrace.samples, candidateTrace.samples),
    phases: phaseComparisons(referenceTrace, candidateTrace, scenarioPhases(candidate, scenario), sampleCount),
    note: "shapeRms usa tiempo normalizado; peakAbs conserva las unidades de cada fuente"
  };
}

