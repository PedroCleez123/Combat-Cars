import assert from "node:assert/strict";
import { captureWasmCombatAlphaCoverContactTrace } from "../tools/wasm-spike/combat-alpha-cover-contact-trace.mjs";
import test from "node:test";

const WASM_MODULE_URL = new URL("../tools/wasm-spike/build/rocketsim_wasm.mjs", import.meta.url);

test("COV-02 exposes a deterministic high-speed container-contact fixture", async () => {
  const { default: createRocketSimWasm } = await import(`${WASM_MODULE_URL.href}?cover-contact-red=${Date.now()}`);
  const module = await createRocketSimWasm();
  try {
    assert.equal(typeof module._rs_init_trace_combat_alpha_cover_contact, "function",
      "COV-02 requires a dedicated cover-contact initializer, not a renderer or manual teleport");
    assert.equal(module._rs_init_trace_combat_alpha_cover_contact(), 1);
  } finally {
    if (typeof module._rs_destroy === "function") module._rs_destroy();
  }
});

test("COV-02 high-speed contact stops at the container and reverses velocity", async () => {
  const trace = await captureWasmCombatAlphaCoverContactTrace();
  assert.equal(trace.fixture, "combat-alpha-cover-contact-r1");
  assert.equal(trace.samples.length, 240);

  const scale = trace.scale;
  const toAuthored = value => value * scale;
  const x = sample => toAuthored(sample.state.position.x);
  const vx = sample => toAuthored(sample.state.velocity.x);
  const maximumApproachSpeed = Math.max(...trace.samples.slice(0, 90).map(sample => vx(sample)));
  assert.ok(maximumApproachSpeed >= 45,
    `cover contact never reached high speed (${maximumApproachSpeed.toFixed(2)} UU/s)`);

  // The north container occupies x=[-50,-40], z=[-70,-46]. The car starts
  // outside at x=-90 and must not tunnel through its inner face at -40.
  const maximumX = Math.max(...trace.samples.map(sample => x(sample)));
  assert.ok(maximumX < -45,
    `cover contact crossed the container (${maximumX.toFixed(2)} authored X)`);

  const firstReverse = trace.samples.find((sample, index) => index >= 90 && vx(sample) < -1);
  assert.ok(firstReverse, "cover contact never produced a separating velocity");
  assert.ok(x(firstReverse) < -50,
    `separating velocity began inside the container (${x(firstReverse).toFixed(2)} authored X)`);
});
