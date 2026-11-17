import test from "node:test";
import assert from "node:assert/strict";
import { captureWasmCleanGroundTrace } from "../tools/wasm-spike/ground-trace.mjs";
import { compareGroundTraces, groundTraceInput } from "../tools/wasm-spike/ground-trace-contract.mjs";

test("WASM clean-ground fixture stays supported for a complete trace", async () => {
  const trace = await captureWasmCleanGroundTrace();
  assert.equal(trace.fixture, "clean-six-planes-one-car-r1");
  assert.equal(trace.samples.length, 240);
  assert.ok(trace.samples.every(sample => sample.grounded === true));
  assert.ok(trace.samples.every(sample => Number.isFinite(sample.state.position.y)));
  assert.deepEqual(trace.samples.map(sample => sample.input), trace.samples.map((_, index) => groundTraceInput(index + 1)));
});

test("ground trace comparator rejects an altered control tape", async () => {
  const trace = await captureWasmCleanGroundTrace();
  const altered = structuredClone(trace);
  altered.samples[120].input.throttle = -1;
  assert.throws(() => compareGroundTraces(trace, altered), /ground state differs at tick 121/);
});

test("WASM clean-ground fixture keeps the first post-settle tick at one", async () => {
  const trace = await captureWasmCleanGroundTrace();
  assert.equal(trace.samples[0].tick, 1);
  assert.equal(trace.samples.at(-1).tick, 240);
});
