import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import {
  MOBILITY_PARITY_FRAME_COUNT,
  MOBILITY_PARITY_TOLERANCES,
  WALL_HORIZON_FRAME_COUNT,
  WALL_HORIZON_TOLERANCES,
  captureNativeMobilityParityTrace,
  captureNativeWallHorizonTrace,
  captureWasmMobilityParityTrace,
  captureWasmWallHorizonTrace,
  compareMobilityParityTraces,
  compareWallHorizonTraces,
} from "../tools/wasm-spike/mobility-parity-trace.mjs";

test("WASM mobility tape is deterministic and observes dodge plus landing", async () => {
  const first = await captureWasmMobilityParityTrace();
  const second = await captureWasmMobilityParityTrace();
  assert.deepEqual(second, first);
  assert.equal(first.samples.length, MOBILITY_PARITY_FRAME_COUNT);
  assert.ok(first.samples.some(sample => sample.state.actionFlags.hasFlipped), "the tape must commit a dodge");
  assert.ok(first.samples.some((sample, index) => index > 0 && sample.state.grounded && !first.samples[index - 1].state.grounded), "the tape must land after the dodge");
});

test("WASM wall tape reaches body contact and remains deterministic for the sustained horizon", async () => {
  const first = await captureWasmWallHorizonTrace();
  const second = await captureWasmWallHorizonTrace();
  assert.deepEqual(second, first);
  assert.equal(first.samples.length, WALL_HORIZON_FRAME_COUNT);
  assert.ok(first.samples.some(sample => sample.bodyContact.hasContact), "the tape must reach the wall");
});

test("R20 and WASM match dodge/landing and wall contact over the explicit horizons", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* optional native gate */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a file; native R20 integration omitted");
    return;
  }

  const wasmMobility = await captureWasmMobilityParityTrace();
  const nativeMobility = await captureNativeMobilityParityTrace(executable);
  const mobilityReport = compareMobilityParityTraces(wasmMobility, nativeMobility, MOBILITY_PARITY_TOLERANCES);
  assert.equal(mobilityReport.ok, true, JSON.stringify(mobilityReport));
  assert.ok(mobilityReport.dodgeTick !== null);
  assert.ok(mobilityReport.landingTick !== null);

  const wasmWall = await captureWasmWallHorizonTrace();
  const nativeWall = await captureNativeWallHorizonTrace(executable);
  const wallReport = compareWallHorizonTraces(wasmWall, nativeWall, WALL_HORIZON_TOLERANCES);
  assert.equal(wallReport.ok, true, JSON.stringify(wallReport));
  assert.ok(wallReport.firstContactTick !== null);
});
