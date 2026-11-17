import { createFrameMetrics } from "./client-performance.js";

function formatFps(fps) {
  return `FPS ${Math.max(0, Math.round(Number.isFinite(fps) ? fps : 0))}`;
}

/**
 * Minimal, presentation-only frame-rate readout for the public P2P arena.
 * It owns no render loop: callers record their already-scheduled rAF frame.
 */
export function createP2PFpsCounter({
  element = null,
  windowMs = 1000,
  refreshMs = 500,
  smoothing = .25,
} = {}) {
  let metrics = createFrameMetrics({ windowMs, refreshMs, smoothing });
  let lastSnapshot = metrics.getSnapshot();

  const publish = snapshot => {
    if (!element || snapshot.sampleCount < 2) return;
    element.textContent = formatFps(snapshot.fps);
  };

  const recordFrame = timestamp => {
    metrics.recordFrame(timestamp);
    const snapshot = metrics.getSnapshot();
    if (snapshot !== lastSnapshot) publish(snapshot);
    lastSnapshot = snapshot;
    return snapshot;
  };

  const reset = () => {
    metrics = createFrameMetrics({ windowMs, refreshMs, smoothing });
    lastSnapshot = metrics.getSnapshot();
    if (element) element.textContent = "FPS —";
    return lastSnapshot;
  };

  return Object.freeze({ recordFrame, reset, getSnapshot: () => metrics.getSnapshot() });
}
