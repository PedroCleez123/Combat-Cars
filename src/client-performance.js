const finiteNonNegative = value => Number.isFinite(value) && value >= 0 ? value : 0;

/** A fixed-capacity pool. Items are constructed up front so acquisition cannot grow it. */
export function createBoundedPool(capacity, createItem) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Pool capacity must be a positive integer");
  if (typeof createItem !== "function") throw new TypeError("Pool needs an item factory");
  const items = Array.from({ length: capacity }, () => createItem());
  const available = [...items];
  const active = new Set();
  return Object.freeze({
    acquire() {
      const item = available.pop() || null;
      if (item !== null) active.add(item);
      return item;
    },
    release(item) {
      if (!active.delete(item)) return false;
      available.push(item);
      return true;
    },
    get capacity() { return capacity; },
    get activeCount() { return active.size; },
    get availableCount() { return available.length; },
  });
}

/** Windowed FPS and frame-time statistics, published with a slow exponential smoother. */
export function createFrameMetrics({ windowMs = 1000, refreshMs = 500, smoothing = .25 } = {}) {
  if (!Number.isFinite(windowMs) || windowMs < 100) throw new RangeError("Metric window must be at least 100ms");
  if (!Number.isFinite(refreshMs) || refreshMs < 1) throw new RangeError("Metric refresh must be positive");
  if (!Number.isFinite(smoothing) || smoothing <= 0 || smoothing > 1) throw new RangeError("Metric smoothing must be in (0, 1]");
  let previousAt = null;
  let lastPublishedAt = null;
  let smoothedFps = 0;
  let smoothedFrameMs = 0;
  let samples = [];
  let published = Object.freeze({ fps: 0, frameTimeMs: 0, frameTimeMaxMs: 0, sampleCount: 0, windowMs });
  let snapshotMax = -1;
  let snapshotSource = null;
  let snapshot = published;

  function recordFrame(now) {
    if (!Number.isFinite(now)) return published;
    if (previousAt !== null && now > previousAt) {
      samples.push({ at: now, frameMs: now - previousAt });
      const cutoff = now - windowMs;
      while (samples.length && samples[0].at < cutoff) samples.shift();
      if (lastPublishedAt === null || now - lastPublishedAt >= refreshMs) {
        const elapsedMs = samples.length > 1 ? samples.at(-1).at - samples[0].at : 0;
        const fps = elapsedMs > 0 ? (samples.length - 1) * 1000 / elapsedMs : 0;
        const frameTimeMs = samples.length ? samples.reduce((sum, sample) => sum + sample.frameMs, 0) / samples.length : 0;
        smoothedFps = smoothedFps ? smoothedFps + smoothing * (fps - smoothedFps) : fps;
        smoothedFrameMs = smoothedFrameMs ? smoothedFrameMs + smoothing * (frameTimeMs - smoothedFrameMs) : frameTimeMs;
        published = Object.freeze({
          fps: Math.round(smoothedFps * 10) / 10,
          frameTimeMs: Math.round(smoothedFrameMs * 10) / 10,
          sampleCount: samples.length,
          windowMs,
        });
        lastPublishedAt = now;
      }
    }
    previousAt = now;
    return published;
  }

  function getSnapshot() {
    const frameTimeMaxMs = samples.reduce((max, sample) => Math.max(max, sample.frameMs), 0);
    const roundedMax = Math.round(frameTimeMaxMs * 10) / 10;
    if (snapshotSource !== published || snapshotMax !== roundedMax) {
      snapshotSource = published;
      snapshotMax = roundedMax;
      snapshot = Object.freeze({ ...published, frameTimeMaxMs: roundedMax });
    }
    return snapshot;
  }

  return Object.freeze({ recordFrame, getSnapshot });
}

/** Draws a temporary scene into a target once, restoring renderer state and disposing the target. */
export function createRenderTargetPrewarmer({ renderer, createTarget, viewportTarget, scissorTarget, clearColorTarget }) {
  if (!renderer || typeof createTarget !== "function") throw new TypeError("Prewarmer needs a renderer and target factory");
  let attempted = false;
  let warmed = false;

  return function prewarm(scene, camera) {
    if (attempted) return warmed;
    attempted = true;
    let target = null;
    let previous = null;
    try {
      if (!scene || !camera || !viewportTarget || !scissorTarget || !clearColorTarget) return false;
      target = createTarget();
      if (!target || typeof renderer.getViewport !== "function" || typeof renderer.setViewport !== "function" ||
          typeof renderer.getScissor !== "function" || typeof renderer.setScissor !== "function" ||
          typeof renderer.getRenderTarget !== "function" || typeof renderer.setRenderTarget !== "function" ||
          typeof renderer.getClearColor !== "function" || typeof renderer.setClearColor !== "function") return false;
      previous = {
        target: renderer.getRenderTarget(),
        viewport: renderer.getViewport(viewportTarget).clone(),
        scissor: renderer.getScissor(scissorTarget).clone(),
        scissorTest: renderer.getScissorTest(),
        clearColor: renderer.getClearColor(clearColorTarget).clone(),
        clearAlpha: renderer.getClearAlpha(),
        autoClear: renderer.autoClear,
      };
      const width = target.width || target.texture?.image?.width || 1;
      const height = target.height || target.texture?.image?.height || 1;
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      warmed = true;
    } catch {
      warmed = false;
    } finally {
      if (previous) {
        try { renderer.setRenderTarget(previous.target); } catch { /* Continue restoring independent renderer state. */ }
        try { renderer.setViewport(previous.viewport); } catch { /* Renderer may be partially unavailable. */ }
        try { renderer.setScissor(previous.scissor); } catch { /* Renderer may be partially unavailable. */ }
        try { renderer.setScissorTest(previous.scissorTest); } catch { /* Renderer may be partially unavailable. */ }
        try { renderer.setClearColor(previous.clearColor, previous.clearAlpha); } catch { /* Renderer may be partially unavailable. */ }
        try { renderer.autoClear = previous.autoClear; } catch { /* Renderer may be partially unavailable. */ }
      }
      try { target?.dispose?.(); } catch { /* A failed warmup must not block the game. */ }
    }
    return warmed;
  };
}

/**
 * Renders a one-pixel representative pass into the real canvas framebuffer.
 *
 * Some drivers defer pipeline work until a draw reaches the default framebuffer;
 * an offscreen render target alone is therefore not sufficient evidence that a
 * first live explosion cannot hitch. Call this only while a loading cover is
 * visible. All renderer state touched by the pass is restored afterwards.
 */
export function createDefaultFramebufferPrewarmer({ renderer, viewportTarget, scissorTarget }) {
  if (!renderer) throw new TypeError("Default framebuffer prewarmer needs a renderer");
  let attempted = false;
  let warmed = false;

  return function prewarmDefaultFramebuffer(scene, camera) {
    if (attempted) return warmed;
    attempted = true;
    let previous = null;
    try {
      if (!scene || !camera || !viewportTarget || !scissorTarget ||
          typeof renderer.getViewport !== "function" || typeof renderer.setViewport !== "function" ||
          typeof renderer.getScissor !== "function" || typeof renderer.setScissor !== "function" ||
          typeof renderer.getScissorTest !== "function" || typeof renderer.setScissorTest !== "function" ||
          typeof renderer.getRenderTarget !== "function" || typeof renderer.setRenderTarget !== "function" ||
          typeof renderer.render !== "function") return false;
      previous = {
        target: renderer.getRenderTarget(),
        viewport: renderer.getViewport(viewportTarget).clone(),
        scissor: renderer.getScissor(scissorTarget).clone(),
        scissorTest: renderer.getScissorTest(),
        autoClear: renderer.autoClear,
      };
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, 1, 1);
      renderer.setScissor(0, 0, 1, 1);
      renderer.setScissorTest(true);
      renderer.render(scene, camera);
      warmed = true;
    } catch {
      warmed = false;
    } finally {
      if (previous) {
        try { renderer.setRenderTarget(previous.target); } catch { /* Continue restoring remaining renderer state. */ }
        try { renderer.setViewport(previous.viewport); } catch { /* Renderer may be partially unavailable. */ }
        try { renderer.setScissor(previous.scissor); } catch { /* Renderer may be partially unavailable. */ }
        try { renderer.setScissorTest(previous.scissorTest); } catch { /* Renderer may be partially unavailable. */ }
        try { renderer.autoClear = previous.autoClear; } catch { /* no-op */ }
      }
    }
    return warmed;
  };
}

/** Defers a one-shot warmup until the real scene has been constructed. */
export function createDeferredPrewarmGate(warm) {
  if (typeof warm !== "function") throw new TypeError("Deferred prewarm needs a warmup function");
  let sceneReady = false;
  let attempted = false;
  let warmed = false;

  return Object.freeze({
    markSceneReady() {
      sceneReady = true;
    },
    attempt(...args) {
      if (!sceneReady || attempted) return warmed;
      attempted = true;
      try { warmed = warm(...args) === true; } catch { warmed = false; }
      return warmed;
    },
    getSnapshot() {
      return Object.freeze({ sceneReady, attempted, warmed });
    },
  });
}

/**
 * Defers a one-shot warmup until the scene and any presentation assets that
 * were present when the scene became ready have settled. The warmup is
 * scheduled through an idle callback when available, with the caller's
 * scheduler making the behavior deterministic in tests. A settled fallback
 * asset still releases the gate, so a failed skin cannot stall presentation
 * forever.
 */
export function createAssetAwarePrewarmGate({ warm, getAssetReadyPromises = () => [], schedule = defaultIdleSchedule } = {}) {
  if (typeof warm !== "function") throw new TypeError("Asset-aware prewarm needs a warmup function");
  if (typeof getAssetReadyPromises !== "function") throw new TypeError("Asset-aware prewarm needs an asset promise source");
  if (typeof schedule !== "function") throw new TypeError("Asset-aware prewarm needs a scheduler");
  let sceneReady = false;
  let waitingForAssets = false;
  let scheduled = false;
  let attempted = false;
  let settled = false;
  let warmed = false;
  let failure = null;
  let revision = 0;
  const settledAssets = new WeakSet();

  function runWarmup(args, expectedRevision) {
    if (expectedRevision !== revision) return warmed;
    if (attempted || settled) return warmed;
    attempted = true;
    const settle = value => {
      if (expectedRevision !== revision) return warmed;
      warmed = value === true;
      settled = true;
      if (!warmed) failure = "warmup";
      return warmed;
    };
    try {
      const result = warm(...args);
      // Shader compilation can finish asynchronously in modern WebGL
      // renderers. Do not report the gate as settled until that promise has
      // resolved, otherwise the first real effect races the compiler.
      if (result && typeof result.then === "function") {
        Promise.resolve(result).then(settle, () => settle(false));
        return false;
      }
      return settle(result);
    } catch {
      settle(false);
    }
    return warmed;
  }

  function waitForSettledAssets(args, expectedRevision) {
    if (expectedRevision !== revision) return;
    let promises;
    try {
      promises = [...(getAssetReadyPromises() || [])].filter(value => value && typeof value.then === "function" && !settledAssets.has(value));
    } catch {
      promises = [];
    }
    if (!promises.length) {
      if (expectedRevision !== revision) return;
      waitingForAssets = false;
      scheduled = true;
      try {
        schedule(() => {
          if (expectedRevision !== revision) return;
          scheduled = false;
          runWarmup(args, expectedRevision);
        });
      } catch {
        if (expectedRevision !== revision) return;
        scheduled = false;
        // Scheduling failed in the render loop. Fail open without doing the
        // potentially expensive warmup inline on the input frame.
        settled = true;
        failure = "schedule";
      }
      return;
    }
    Promise.allSettled(promises).then(() => {
      if (expectedRevision !== revision) return;
      promises.forEach(promise => settledAssets.add(promise));
      // Re-read the source after the current batch settles. This covers a
      // second car joining while the initial GLTF batch was in flight.
      waitForSettledAssets(args, expectedRevision);
    }, () => waitForSettledAssets(args, expectedRevision));
  }

  return Object.freeze({
    markSceneReady() { sceneReady = true; },
    // New visible assets (for example a rival joining with its authored skin)
    // can add material/light permutations after a previous warmup completed.
    // Invalidate only presentation readiness; it never pauses simulation,
    // networking or input. Captured revisions make callbacks from the older
    // idle/asset pass harmless.
    invalidate() {
      revision += 1;
      waitingForAssets = false;
      scheduled = false;
      attempted = false;
      settled = false;
      warmed = false;
      failure = null;
    },
    attempt(...args) {
      if (!sceneReady || settled || waitingForAssets || scheduled) return warmed;
      waitingForAssets = true;
      waitForSettledAssets(args, revision);
      return warmed;
    },
    getSnapshot() {
      const phase = !sceneReady ? "waiting-for-scene"
        : waitingForAssets ? "waiting-for-assets"
          : scheduled ? "scheduled"
            : settled ? (warmed ? "warmed" : "failed")
              : attempted ? "warming"
                : "ready";
      return Object.freeze({ sceneReady, waitingForAssets, scheduled, attempted, settled, warmed, failure, revision, phase });
    },
  });
}

function defaultIdleSchedule(callback) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout: 1200 });
    return;
  }
  setTimeout(callback, 0);
}

/** Captures the first real effect allocation without counting prewarm representatives. */
export function createFirstEffectDiagnostics({ renderer, metrics, getFrame = () => null } = {}) {
  let firstEffect = null;
  const namedEffects = new Map();
  return Object.freeze({
    record(effect) {
      if (typeof effect !== "string" || !effect) return firstEffect;
      if (!namedEffects.has(effect)) {
        const snapshot = readRendererInfo(renderer, metrics);
        namedEffects.set(effect, Object.freeze({
          effect,
          frame: getFrame(),
          frameTimeMs: snapshot.frameTimeMs,
          frameTimeMaxMs: snapshot.frameTimeMaxMs,
          programs: snapshot.programs,
          renderCalls: snapshot.render.calls,
        }));
      }
      firstEffect ||= namedEffects.get(effect);
      return firstEffect;
    },
    getSnapshot() {
      return firstEffect;
    },
    getEffect(effect) {
      return typeof effect === "string" ? namedEffects.get(effect) || null : null;
    },
    getEffects() {
      return Object.freeze(Object.fromEntries([...namedEffects.entries()]));
    },
  });
}

export function readRendererInfo(renderer, metrics, { qualityTier = "high" } = {}) {
  const frame = metrics.getSnapshot();
  const info = renderer?.info || {};
  return Object.freeze({
    fps: frame.fps,
    frameTimeMs: frame.frameTimeMs,
    frameTimeMaxMs: frame.frameTimeMaxMs,
    sampleCount: frame.sampleCount,
    windowMs: frame.windowMs,
    qualityTier: typeof qualityTier === "string" && qualityTier ? qualityTier : "high",
    render: Object.freeze({ calls: finiteNonNegative(info.render?.calls), triangles: finiteNonNegative(info.render?.triangles), points: finiteNonNegative(info.render?.points), lines: finiteNonNegative(info.render?.lines) }),
    memory: Object.freeze({ geometries: finiteNonNegative(info.memory?.geometries), textures: finiteNonNegative(info.memory?.textures) }),
    programs: Number.isFinite(info.programs?.length) ? info.programs.length : 0,
  });
}
