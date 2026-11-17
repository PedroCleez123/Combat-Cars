import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { once } from "node:events";
import test from "node:test";
import { captureWasmWallTrace } from "../tools/wasm-spike/wall-trace.mjs";
import {
  NativeWallBridgeUnavailableError,
  compareWallTracesWithBridge,
} from "../tools/wasm-spike/compare-wall-with-bridge.mjs";
import {
  createWasmSmokeServer,
  resolveWasmSmokeResource,
  startWasmSmokeServer,
} from "../tools/wasm-spike/browser-smoke-server.mjs";
import {
  WALL_TRACE_EXPECTED_FIRST_CONTACT_TICK,
  WALL_TRACE_FRAME_COUNT,
  compareWallTraces,
  wallTraceInput,
} from "../tools/wasm-spike/wall-trace-contract.mjs";

let captured;
async function wallTrace() {
  captured ??= await captureWasmWallTrace();
  return structuredClone(captured);
}

test("wall initializer keeps a separate identity from the clean-ground fixture", async () => {
  const modulePath = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);
  const { default: createRocketSimWasm } = await import(`${modulePath.href}?wall-fixture=${Date.now()}`);
  const Module = await createRocketSimWasm();
  try {
    assert.equal(Module._rs_init_trace_air_void_cars(7), 0);
    assert.equal(Module._rs_init(), 1);
    assert.equal(Module._rs_init_trace_air_void(), 0);
    assert.equal(Module._rs_init_trace_clean_ground(), 0);
    assert.equal(Module._rs_init_trace_clean_wall_contact(), 0);
    Module._rs_destroy();

    assert.equal(Module._rs_init_trace_clean_wall_contact(), 1);
    assert.equal(Module._rs_init_trace_clean_ground(), 0);
    Module._rs_destroy();

    assert.equal(Module._rs_init_trace_clean_ground(), 1);
    assert.equal(Module._rs_init_trace_clean_wall_contact(), 0);
  } finally {
    Module._rs_destroy();
  }
});

test("WASM clean-six-planes trace reaches the +X body wall with JSON-basis contact", async () => {
  const trace = await wallTrace();
  assert.equal(trace.fixture, "clean-six-planes-one-car-r1");
  assert.equal(trace.samples.length, WALL_TRACE_FRAME_COUNT);
  assert.equal(trace.samples[0].tick, 1);
  assert.equal(trace.samples.at(-1).tick, WALL_TRACE_FRAME_COUNT);
  assert.deepEqual(trace.samples.map(sample => sample.input), trace.samples.map((_, index) => wallTraceInput(index + 1)));

  const firstContact = trace.samples.find(sample => sample.contact.hasContact);
  assert.ok(firstContact, "the body should contact an arena wall");
  assert.ok(Math.abs(firstContact.tick - WALL_TRACE_EXPECTED_FIRST_CONTACT_TICK) <= 2, `first contact was tick ${firstContact.tick}`);
  assert.equal(firstContact.grounded, true);
  assert.ok(firstContact.contact.normal.x < -0.9, `JSON normal should point toward -X: ${JSON.stringify(firstContact.contact.normal)}`);
});

test("wall comparator rejects a mutated input tape and mutated contact normal", async () => {
  const baseline = await wallTrace();
  const alteredInput = structuredClone(baseline);
  alteredInput.samples[30].input.boost = false;
  assert.throws(() => compareWallTraces(alteredInput, baseline), /input contract differs at tick 31/);

  const alteredContact = structuredClone(baseline);
  const firstContact = alteredContact.samples.find(sample => sample.contact.hasContact);
  firstContact.contact.normal.x = 1;
  assert.throws(() => compareWallTraces(alteredContact, baseline), /normal does not point toward -X/);
});

test("wall browser smoke resolves only GET requests for exact allowlisted paths", () => {
  assert.equal(resolveWasmSmokeResource("GET", "/"), "browser-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/browser-wall-smoke.html"), "browser-wall-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/wall-trace-contract.mjs"), "wall-trace-contract.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/build/rocketsim_wasm.wasm"), "build/rocketsim_wasm.wasm");
  assert.equal(resolveWasmSmokeResource("POST", "/browser-wall-smoke.html"), null);
  for (const deniedPath of [
    "/package.json",
    "/../package.json",
    "/%2e%2e/package.json",
    "/build/../../package.json",
    "/browser-wall-smoke.html?cache=1",
    "/browser-wall-smoke.html#fragment",
    "//localhost/browser-wall-smoke.html",
    "C:\\package.json",
  ]) assert.equal(resolveWasmSmokeResource("GET", deniedPath), null, `${deniedPath} should be denied`);
});

test("browser smoke server has no import-time listener and starts on loopback", async () => {
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

test("native wall trace compares against configured R20 bridge or skips explicitly", async t => {
  const executable = process.env.ROCKETSIM_BRIDGE_EXE;
  let validFile = false;
  try { validFile = Boolean(executable && statSync(executable).isFile()); } catch { /* The native bridge is optional in ordinary test runs. */ }
  if (!validFile) {
    t.skip("ROCKETSIM_BRIDGE_EXE is unset or does not name a file; native R20 integration omitted");
    return;
  }

  try {
    const result = await compareWallTracesWithBridge(executable, { wasmTrace: await wallTrace() });
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
  } catch (error) {
    if (error instanceof NativeWallBridgeUnavailableError) {
      t.skip(`Native R20 bridge is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
});
