import assert from "node:assert/strict";
import test from "node:test";

import { createAssetAwarePrewarmGate, createBoundedPool, createDefaultFramebufferPrewarmer, createDeferredPrewarmGate, createFirstEffectDiagnostics, createFrameMetrics, createRenderTargetPrewarmer, readRendererInfo } from "../src/client-performance.js";

test("bounded pools reuse their fixed inventory and reject duplicate releases", () => {
  let created = 0;
  const pool = createBoundedPool(2, () => ({ id: ++created }));
  const first = pool.acquire();
  const second = pool.acquire();

  assert.equal(created, 2);
  assert.equal(pool.acquire(), null);
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.release(first), true);
  assert.equal(pool.release(first), false);
  assert.equal(pool.acquire(), first);
  assert.equal(pool.release(second), true);
  assert.equal(pool.release(first), true);
  assert.equal(pool.activeCount, 0);
  assert.equal(pool.availableCount, 2);
  assert.equal(created, 2);
});

test("frame metrics report a smoothed temporal FPS and frame time", () => {
  const metrics = createFrameMetrics({ windowMs: 1000, refreshMs: 500, smoothing: .5 });
  for (let at = 0; at <= 1000; at += 1000 / 60) metrics.recordFrame(at);
  const snapshot = metrics.getSnapshot();

  assert.ok(Math.abs(snapshot.fps - 60) < 1);
  assert.ok(Math.abs(snapshot.frameTimeMs - 1000 / 60) < .2);
  assert.ok(snapshot.sampleCount >= 29);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(metrics.getSnapshot(), snapshot);
});

test("frame metrics expose the largest frame time in the recent window", () => {
  const metrics = createFrameMetrics({ windowMs: 250, refreshMs: 1000, smoothing: 1 });
  metrics.recordFrame(0);
  metrics.recordFrame(16);
  metrics.recordFrame(216);
  assert.equal(metrics.getSnapshot().frameTimeMaxMs, 200);
  metrics.recordFrame(232);
  metrics.recordFrame(248);
  assert.equal(metrics.getSnapshot().frameTimeMaxMs, 200);
  metrics.recordFrame(500);
  assert.equal(metrics.getSnapshot().frameTimeMaxMs, 252);
  for (let at = 516; at <= 756; at += 16) metrics.recordFrame(at);
  assert.equal(metrics.getSnapshot().frameTimeMaxMs, 16);
});

function fakeRenderer({ failRender = false } = {}) {
  const state = {
    target: "game-target",
    viewport: { x: 1, y: 2, z: 800, w: 600 },
    scissor: { x: 3, y: 4, z: 700, w: 500 },
    scissorTest: true,
    clearColor: { value: 0x123456 },
    clearAlpha: .4,
    autoClear: false,
    renderCalls: 0,
    renderedScene: null,
    renderedCamera: null,
  };
  const copyVector = (value, into) => Object.assign(into, value);
  const renderer = {
    autoClear: state.autoClear,
    getRenderTarget: () => state.target,
    setRenderTarget(value) { state.target = value; },
    getViewport(into) { return copyVector(state.viewport, into); },
    setViewport(...values) { state.viewport = values.length === 1 ? { ...values[0] } : { x: values[0], y: values[1], z: values[2], w: values[3] }; },
    getScissor(into) { return copyVector(state.scissor, into); },
    setScissor(value) { state.scissor = { ...value }; },
    getScissorTest: () => state.scissorTest,
    setScissorTest(value) { state.scissorTest = value; },
    getClearColor(into) { into.value = state.clearColor.value; return into; },
    setClearColor(value, alpha) { state.clearColor = { value: value.value }; state.clearAlpha = alpha; },
    getClearAlpha: () => state.clearAlpha,
    clear() {},
    render(scene, camera) { state.renderCalls += 1; state.renderedScene = scene; state.renderedCamera = camera; if (failRender) throw new Error("lost context"); },
  };
  return { renderer, state };
}

function mutableTarget(seed) {
  const target = { ...seed };
  Object.defineProperty(target, "clone", { value() { return mutableTarget(this); } });
  return target;
}

test("render-target prewarm draws once, restores renderer state, and disposes the temporary target", () => {
  const { renderer, state } = fakeRenderer();
  const scene = {};
  const camera = {};
  let disposed = 0;
  let created = 0;
  const prewarm = createRenderTargetPrewarmer({
    renderer,
    createTarget: () => { created += 1; return { width: 32, height: 16, dispose() { disposed += 1; } }; },
    viewportTarget: mutableTarget({}),
    scissorTarget: mutableTarget({}),
    clearColorTarget: mutableTarget({}),
  });

  assert.equal(prewarm(scene, camera), true);
  assert.equal(prewarm({}, {}), true);
  assert.equal(created, 1);
  assert.equal(state.renderCalls, 1);
  assert.equal(state.renderedScene, scene);
  assert.equal(state.renderedCamera, camera);
  assert.equal(disposed, 1);
  assert.equal(state.target, "game-target");
  assert.deepEqual(state.viewport, { x: 1, y: 2, z: 800, w: 600 });
  assert.deepEqual(state.scissor, { x: 3, y: 4, z: 700, w: 500 });
  assert.equal(state.scissorTest, true);
  assert.equal(state.clearColor.value, 0x123456);
  assert.equal(state.clearAlpha, .4);
  assert.equal(renderer.autoClear, false);
});

test("render-target prewarm failure is safe, restored, disposed, and not retried", () => {
  const { renderer, state } = fakeRenderer({ failRender: true });
  let disposed = 0;
  const prewarm = createRenderTargetPrewarmer({
    renderer,
    createTarget: () => ({ width: 8, height: 8, dispose() { disposed += 1; } }),
    viewportTarget: mutableTarget({}),
    scissorTarget: mutableTarget({}),
    clearColorTarget: mutableTarget({}),
  });

  assert.equal(prewarm({}, {}), false);
  assert.equal(prewarm({}, {}), false);
  assert.equal(state.renderCalls, 1);
  assert.equal(disposed, 1);
  assert.equal(state.target, "game-target");
  assert.deepEqual(state.viewport, { x: 1, y: 2, z: 800, w: 600 });
  assert.deepEqual(state.scissor, { x: 3, y: 4, z: 700, w: 500 });
  assert.equal(state.scissorTest, true);
});

test("default-framebuffer prewarm uses one clipped live draw and restores renderer state", () => {
  const { renderer, state } = fakeRenderer();
  const scene = {};
  const camera = {};
  const prewarm = createDefaultFramebufferPrewarmer({
    renderer,
    viewportTarget: mutableTarget({}),
    scissorTarget: mutableTarget({}),
  });

  assert.equal(prewarm(scene, camera), true);
  assert.equal(prewarm({}, {}), true);
  assert.equal(state.renderCalls, 1);
  assert.equal(state.renderedScene, scene);
  assert.equal(state.renderedCamera, camera);
  assert.equal(state.target, "game-target");
  assert.deepEqual(state.viewport, { x: 1, y: 2, z: 800, w: 600 });
  assert.deepEqual(state.scissor, { x: 3, y: 4, z: 700, w: 500 });
  assert.equal(state.scissorTest, true);
  assert.equal(renderer.autoClear, false);
});

test("deferred prewarm waits for the first state scene and remains idempotent", () => {
  const calls = [];
  const gate = createDeferredPrewarmGate((scene, camera) => {
    calls.push({ scene, camera });
    return true;
  });
  const scene = {};
  const camera = {};

  assert.equal(gate.attempt(scene, camera), false);
  assert.deepEqual(gate.getSnapshot(), { sceneReady: false, attempted: false, warmed: false });
  gate.markSceneReady();
  assert.equal(gate.attempt(scene, camera), true);
  gate.markSceneReady();
  assert.equal(gate.attempt({}, {}), true);
  assert.deepEqual(calls, [{ scene, camera }]);
  assert.deepEqual(gate.getSnapshot(), { sceneReady: true, attempted: true, warmed: true });
});

test("asset-aware prewarm waits for GLTF settlement, schedules once, and exposes warmup phase", async () => {
  let releaseAsset;
  let pending = null;
  const asset = new Promise(resolve => { releaseAsset = resolve; });
  pending = asset;
  let scheduled = null;
  let warmCalls = 0;
  const gate = createAssetAwarePrewarmGate({
    warm: () => { warmCalls += 1; return true; },
    getAssetReadyPromises: () => pending ? [pending] : [],
    schedule: callback => { scheduled = callback; },
  });

  gate.markSceneReady();
  assert.equal(gate.attempt({}, {}), false);
  assert.equal(gate.getSnapshot().phase, "waiting-for-assets");
  releaseAsset({ status: "ready" });
  pending = null;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(gate.getSnapshot().phase, "scheduled");
  assert.equal(gate.getSnapshot().settled, false);
  assert.equal(warmCalls, 0);
  scheduled();
  assert.equal(gate.attempt({}, {}), true);
  assert.equal(warmCalls, 1);
  assert.equal(gate.getSnapshot().phase, "warmed");
  assert.equal(gate.getSnapshot().settled, true);
  assert.equal(gate.attempt({}, {}), true);
  assert.equal(warmCalls, 1);
});

test("asset-aware prewarm releases a failed warmup without retrying", () => {
  let scheduled = null;
  let warmCalls = 0;
  const gate = createAssetAwarePrewarmGate({
    warm: () => { warmCalls += 1; throw new Error("lost context"); },
    schedule: callback => { scheduled = callback; },
  });
  gate.markSceneReady();
  assert.equal(gate.attempt({}, {}), false);
  assert.equal(gate.getSnapshot().phase, "scheduled");
  scheduled();
  assert.equal(gate.attempt({}, {}), false);
  assert.deepEqual(gate.getSnapshot(), {
    sceneReady: true,
    waitingForAssets: false,
    scheduled: false,
    attempted: true,
    settled: true,
    warmed: false,
    failure: "warmup",
    revision: 0,
    phase: "failed",
  });
  assert.equal(warmCalls, 1);
  assert.equal(gate.attempt({}, {}), false);
  assert.equal(warmCalls, 1);
});

test("asset-aware prewarm keeps the effect gate closed until async shader work settles", async () => {
  let releaseWarmup;
  const warmup = new Promise(resolve => { releaseWarmup = resolve; });
  let scheduled = null;
  const gate = createAssetAwarePrewarmGate({
    warm: () => warmup,
    schedule: callback => { scheduled = callback; },
  });

  gate.markSceneReady();
  assert.equal(gate.attempt({}, {}), false);
  scheduled();
  assert.equal(gate.getSnapshot().phase, "warming");
  assert.equal(gate.getSnapshot().settled, false);
  releaseWarmup(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(gate.getSnapshot().phase, "warmed");
  assert.equal(gate.getSnapshot().settled, true);
  assert.equal(gate.getSnapshot().warmed, true);
});

test("asset-aware prewarm records scheduler failure without warming on the input frame", () => {
  let warmCalls = 0;
  const gate = createAssetAwarePrewarmGate({
    warm: () => { warmCalls += 1; return true; },
    schedule: () => { throw new Error("idle scheduler unavailable"); },
  });

  gate.markSceneReady();
  assert.equal(gate.attempt({}, {}), false);
  assert.deepEqual(gate.getSnapshot(), {
    sceneReady: true,
    waitingForAssets: false,
    scheduled: false,
    attempted: false,
    settled: true,
    warmed: false,
    failure: "schedule",
    revision: 0,
    phase: "failed",
  });
  assert.equal(gate.attempt({}, {}), false);
  assert.equal(warmCalls, 0);
});

test("asset-aware prewarm invalidates after a late vehicle asset and ignores an obsolete idle callback", async () => {
  const scheduled = [];
  let assets = [];
  let warmCalls = 0;
  const gate = createAssetAwarePrewarmGate({
    warm: () => { warmCalls += 1; return true; },
    getAssetReadyPromises: () => assets,
    schedule: callback => scheduled.push(callback),
  });

  gate.markSceneReady();
  gate.attempt();
  assert.equal(scheduled.length, 1);
  gate.invalidate();
  assert.equal(gate.getSnapshot().revision, 1);
  scheduled.shift()();
  assert.equal(warmCalls, 0, "an idle callback from the prior asset set cannot settle the new revision");

  let resolveLateAsset;
  const lateAsset = new Promise(resolve => { resolveLateAsset = resolve; });
  assets = [lateAsset];
  gate.attempt();
  assert.equal(gate.getSnapshot().phase, "waiting-for-assets");
  resolveLateAsset();
  await Promise.resolve();
  await Promise.resolve();
  assets = [];
  await Promise.resolve();
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.equal(gate.getSnapshot().phase, "warmed");
  assert.equal(warmCalls, 1);
});

test("first effect diagnostics records the first real effect once", () => {
  const metrics = createFrameMetrics();
  metrics.recordFrame(0);
  metrics.recordFrame(20);
  const diagnostics = createFirstEffectDiagnostics({
    renderer: { info: { render: { calls: 7 }, programs: [{}, {}, {}] } },
    metrics,
    getFrame: () => 12,
  });

  assert.deepEqual(diagnostics.record("rocket"), {
    effect: "rocket",
    frame: 12,
    frameTimeMs: 20,
    frameTimeMaxMs: 20,
    programs: 3,
    renderCalls: 7,
  });
  assert.equal(diagnostics.record("explosion").effect, "rocket");
  assert.equal(diagnostics.getSnapshot().effect, "rocket");
  assert.equal(diagnostics.getEffect("explosion").effect, "explosion");
  assert.deepEqual(Object.keys(diagnostics.getEffects()).sort(), ["explosion", "rocket"]);
});

test("renderer diagnostics expose copied, read-only counters", () => {
  const metrics = createFrameMetrics();
  metrics.recordFrame(0);
  metrics.recordFrame(16.7);
  const renderer = { info: { render: { calls: 4, triangles: 900 }, memory: { geometries: 12, textures: 2 }, programs: [{}, {}] } };
  const snapshot = readRendererInfo(renderer, metrics);

  assert.equal(snapshot.render.calls, 4);
  assert.equal(snapshot.render.triangles, 900);
  assert.equal(snapshot.frameTimeMaxMs, 16.7);
  assert.equal(snapshot.memory.geometries, 12);
  assert.equal(snapshot.programs, 2);
  assert.equal(snapshot.qualityTier, "high");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.render), true);
  renderer.info.render.calls = 99;
  assert.equal(snapshot.render.calls, 4);
});

test("renderer diagnostics label the selected quality tier without changing counters", () => {
  const metrics = createFrameMetrics();
  metrics.recordFrame(0);
  metrics.recordFrame(16.7);
  const renderer = { info: { render: { calls: 4, triangles: 900 }, memory: { geometries: 12, textures: 2 }, programs: [{}, {}] } };
  const high = readRendererInfo(renderer, metrics, { qualityTier: "high" });
  const low = readRendererInfo(renderer, metrics, { qualityTier: "low" });

  assert.equal(high.qualityTier, "high");
  assert.equal(low.qualityTier, "low");
  assert.deepEqual(low.render, high.render);
  assert.deepEqual(low.memory, high.memory);
  assert.equal(low.programs, high.programs);
  assert.equal(Object.isFrozen(low), true);
});
