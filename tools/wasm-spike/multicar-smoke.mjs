import assert from "node:assert/strict";
import { captureWasmAirVoidMultiCarTrace, WASM_MULTICAR_COUNT, WASM_MULTICAR_FRAME_COUNT } from "./multi-car.mjs";

const result = await captureWasmAirVoidMultiCarTrace();
assert.equal(result.ok, true);
assert.equal(result.count, WASM_MULTICAR_COUNT);
assert.equal(result.ticks, WASM_MULTICAR_FRAME_COUNT);
assert.equal(result.last.length, WASM_MULTICAR_COUNT);
assert.ok(result.last.every(sample => Number.isFinite(sample.state.position.x)));
console.log(JSON.stringify(result, null, 2));
