import assert from "node:assert/strict";
import test from "node:test";

import { createP2PFpsCounter } from "../src/p2p-fps-counter.js";

test("P2P FPS counter publishes a compact measured value only after its sampling window", () => {
  const output = { textContent: "FPS —" };
  const counter = createP2PFpsCounter({
    element: output,
    windowMs: 1000,
    refreshMs: 500,
    smoothing: 1,
  });

  counter.recordFrame(0);
  assert.equal(output.textContent, "FPS —");
  for (let frame = 1; frame <= 32; frame += 1) counter.recordFrame(frame * 1000 / 60);

  assert.equal(output.textContent, "FPS 60");
  assert.equal(counter.getSnapshot().fps, 60);
});

test("P2P FPS counter discards a hidden-tab interval before sampling the next visible frames", () => {
  const output = { textContent: "FPS —" };
  const counter = createP2PFpsCounter({
    element: output,
    windowMs: 1000,
    refreshMs: 500,
    smoothing: 1,
  });

  counter.recordFrame(0);
  for (let frame = 1; frame <= 32; frame += 1) counter.recordFrame(frame * 1000 / 60);
  assert.equal(output.textContent, "FPS 60");

  counter.reset();
  counter.recordFrame(10_000);
  for (let frame = 1; frame <= 32; frame += 1) counter.recordFrame(10_000 + frame * 1000 / 60);

  assert.equal(output.textContent, "FPS 60");
  assert.equal(counter.getSnapshot().frameTimeMaxMs < 20, true);
});
