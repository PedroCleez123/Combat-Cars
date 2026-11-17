const MAX_CLIENT_FRAME_DT_SECONDS = 0.05;

function headingRateForFrame(previous, current) {
  const frameDt = current?.frameDt;
  if (!Number.isFinite(frameDt) || frameDt <= 0) return Number.NaN;
  const appliedFrameDt = Math.min(frameDt, MAX_CLIENT_FRAME_DT_SECONDS);
  return Math.abs(current.heading - previous.heading) / appliedFrameDt;
}

function isPhaseCaptureReady(expectedPhase, snapshot) {
  const visualSmoke = snapshot?.visualSmoke;
  if (visualSmoke?.phase !== expectedPhase) return false;
  if (!["takeoff", "air-left-turn", "air-right-turn"].includes(expectedPhase)) return true;
  return Array.isArray(visualSmoke.cameraSamples)
    && visualSmoke.cameraSamples.some(sample => sample?.phase === expectedPhase && sample?.mode === "air");
}

module.exports = {
  MAX_CLIENT_FRAME_DT_SECONDS,
  headingRateForFrame,
  isPhaseCaptureReady,
};
