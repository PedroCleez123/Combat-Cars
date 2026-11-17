import test from "node:test";
import assert from "node:assert/strict";
import { captureWasmAirVoidMultiCarTrace, WASM_MULTICAR_COUNT, WASM_MULTICAR_FRAME_COUNT } from "../tools/wasm-spike/multi-car.mjs";

test("WASM capacity fixture advances six isolated cars with one shared tick", async () => {
  const result = await captureWasmAirVoidMultiCarTrace();
  assert.equal(result.ok, true);
  assert.equal(result.count, WASM_MULTICAR_COUNT);
  assert.equal(result.ticks, WASM_MULTICAR_FRAME_COUNT);
  assert.equal(result.last.length, WASM_MULTICAR_COUNT);
  assert.ok(result.last.every(sample => Number.isFinite(sample.state.position.x)));
});

test("WASM capacity fixture rejects a seventh car before starting", async () => {
  await assert.rejects(() => captureWasmAirVoidMultiCarTrace({ count: WASM_MULTICAR_COUNT + 1 }), /count is out of range/);
});
