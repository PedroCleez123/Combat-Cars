import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { once } from "node:events";
import test from "node:test";
import { captureWasmCarContactTrace } from "../tools/wasm-spike/car-contact-trace.mjs";
import {
  NativeCarContactBridgeUnavailableError,
  compareCarContactTracesWithBridge,
} from "../tools/wasm-spike/compare-car-contact-with-bridge.mjs";
import {
  createWasmSmokeServer,
  resolveWasmSmokeResource,
  startWasmSmokeServer,
} from "../tools/wasm-spike/browser-smoke-server.mjs";
import {
  CAR_CONTACT_EXPECTED_FIRST_TRANSFER_TICK,
  CAR_CONTACT_TRACE_FIXTURE,
  CAR_CONTACT_TRACE_FRAME_COUNT,
  carContactTraceInputs,
  compareCarContactTraces,
} from "../tools/wasm-spike/car-contact-trace-contract.mjs";

let captured;
async function carContactTrace() {
  captured ??= await captureWasmCarContactTrace();
  return structuredClone(captured);
}

test("P2P-WASM-06 initializes a distinct two-car combat-lineup fixture", async () => {
  const modulePath = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?car-contact-fixture=${Date.now()}`);
  const Module = await createRocketSimWasm();
  try {
    assert.equal(Module._rs_init_trace_clean_ground(), 1);
    assert.equal(Module._rs_init_trace_combat_lineup(), 0);
    Module._rs_destroy();

    assert.equal(Module._rs_init_trace_combat_lineup(), 1);
    assert.equal(Module._rs_init_trace_clean_ground(), 0);
    const tickPtr = Module._malloc(4);
    const statePtr = Module._malloc(9 * 4);
    try {
      assert.equal(Module._rs_snapshot_car(0, tickPtr, statePtr), 1);
      assert.equal(Module.HEAPU32[tickPtr >>> 2], 0);
      const targetX = Module.HEAPF32[statePtr >>> 2];
      assert.ok(Math.abs(targetX) <= 2, `target spawn x was ${targetX}`);

      assert.equal(Module._rs_snapshot_car(1, tickPtr, statePtr), 1);
      const chaserX = Module.HEAPF32[statePtr >>> 2];
      assert.ok(Math.abs(chaserX + 600) <= 2, `chaser spawn x was ${chaserX}`);
    } finally {
      Module._free(statePtr);
      Module._free(tickPtr);
    }
  } finally {
    Module._rs_destroy();
  }
});

test("P2P-WASM-06 transfers impulse near tick 108 with the exact input tape", async () => {
  const trace = await carContactTrace();
  assert.equal(trace.fixture, CAR_CONTACT_TRACE_FIXTURE);
  assert.equal(trace.samples.length, CAR_CONTACT_TRACE_FRAME_COUNT);
  assert.deepEqual(
    trace.samples.map(sample => sample.cars.map(car => car.input)),
    trace.samples.map((_, index) => carContactTraceInputs(index + 1)),
  );
  const report = compareCarContactTraces(trace, trace);
  assert.equal(report.ok, true);
  assert.ok(Math.abs(report.firstTransferTick - CAR_CONTACT_EXPECTED_FIRST_TRANSFER_TICK) <= 2);
});

test("car-contact comparator rejects a changed tape and a removed impulse event", async () => {
  const baseline = await carContactTrace();
  const alteredInput = structuredClone(baseline);
  alteredInput.samples[50].cars[1].input.throttle = 0;
  assert.throws(() => compareCarContactTraces(alteredInput, baseline), /input contract differs at tick 51/);

  const alteredEvent = structuredClone(baseline);
  const event = compareCarContactTraces(baseline, baseline).firstTransferTick;
  const target = alteredEvent.samples[event - 1].cars[0];
  const previousTarget = alteredEvent.samples[event - 2].cars[0];
  target.state.velocity.x = previousTarget.state.velocity.x;
  assert.throws(() => compareCarContactTraces(alteredEvent, baseline), /impulse transfer is missing/);
});

test("car-contact browser smoke exposes only its allowlisted GET resources", () => {
  assert.equal(resolveWasmSmokeResource("GET", "/browser-car-contact-smoke.html"), "browser-car-contact-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/car-contact-trace.mjs"), "car-contact-trace.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/car-contact-trace-contract.mjs"), "car-contact-trace-contract.mjs");
  assert.equal(resolveWasmSmokeResource("POST", "/browser-car-contact-smoke.html"), null);
  for (const deniedPath of [
    "/package.json",
    "/../package.json",
    "/%2e%2e/package.json",
    "/browser-car-contact-smoke.html?cache=1",
    "//localhost/browser-car-contact-smoke.html",
  ]) assert.equal(resolveWasmSmokeResource("GET", deniedPath), null, `${deniedPath} should be denied`);
});

test("car-contact smoke server is inert until explicitly started and binds loopback", async () => {
  const inertServer = createWasmSmokeServer();
  assert.equal(inertServer.listening, false);
  const server = startWasmSmokeServer(0);
  try {
    if (!server.listening) await once(server, "listening");
    assert.equal(server.address().address, "127.0.0.1");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("native P2P-WASM-06 integration compares with R20 or skips explicitly", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* Native R20 is optional in ordinary test runs. */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a file; native R20 car-contact integration omitted");
    return;
  }

  try {
    const result = await compareCarContactTracesWithBridge(executable, { wasmTrace: await carContactTrace() });
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
  } catch (error) {
    if (error instanceof NativeCarContactBridgeUnavailableError) {
      t.skip(`Native R20 bridge is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
});
