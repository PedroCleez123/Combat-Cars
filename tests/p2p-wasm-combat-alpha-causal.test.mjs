import assert from "node:assert/strict";
import test from "node:test";
import { captureCombatAlphaCausalTrace } from "../tools/wasm-spike/combat-alpha-causal-trace.mjs";
import {
  assertCombatAlphaCausalTrace,
  COMBAT_ALPHA_CAUSAL_TRACE_FIXTURE,
  COMBAT_ALPHA_CAUSAL_STATIC_INTERCEPTION_TEXT,
  COMBAT_ALPHA_CAUSAL_TRACE_SCHEMA_VERSION,
  createCombatAlphaCausalTrace,
} from "../tools/wasm-spike/combat-alpha-causal-trace-contract.mjs";

test("P2P-WASM-47 captures a real alpha-pair launch and static interception without teleports", async () => {
  const trace = await captureCombatAlphaCausalTrace();
  assert.equal(trace.schemaVersion, COMBAT_ALPHA_CAUSAL_TRACE_SCHEMA_VERSION);
  assert.equal(trace.fixture, COMBAT_ALPHA_CAUSAL_TRACE_FIXTURE);
  assert.deepEqual(trace.phases.map(phase => phase.name), ["spawn-and-fire", "static-interception"]);
  assert.equal(trace.phases[0].frame.tick, 1);
  assert.ok(trace.phases[0].frame.physical[0].x < -1400);
  assert.ok(trace.phases[0].frame.physical[1].x > 1900);
  assert.ok(trace.phases[0].frame.events.some(event => event.kind === "fire"));
  assert.ok(trace.phases[1].frame.events.some(event => event.kind === "miss" && event.text === COMBAT_ALPHA_CAUSAL_STATIC_INTERCEPTION_TEXT));
  assert.equal(trace.phases[1].frame.rocketCount, 0);
  for (let index = 1; index < trace.timeline.length; index += 1) {
    assert.equal(trace.timeline[index].tick, trace.timeline[index - 1].tick + 1);
  }
});

test("P2P-WASM-47 contract rejects a fake alpha trace without static interception", () => {
  const frame = {
    tick: 1, lastInputSequence: 1,
    physical: [
      { id: "p2p-host", team: "blue", x: -1500, z: -1230, h: 17, yaw: 0, vx: 0, vz: 0, vh: 0 },
      { id: "p2p-pilot", team: "red", x: 1970, z: 1230, h: 17, yaw: Math.PI, vx: 0, vz: 0, vh: 0 },
    ],
    events: [{ kind: "fire", text: "fire", at: .02 }], rockets: [{ id: 1 }],
  };
  const finalFrame = { ...frame, tick: 2, lastInputSequence: 2 };
  assert.throws(() => createCombatAlphaCausalTrace({ phases: [{ name: "a", frame }, { name: "b", frame: finalFrame }], timeline: [frame, finalFrame] }), /intercepción/);
  assert.throws(() => assertCombatAlphaCausalTrace({ schemaVersion: 99, fixture: COMBAT_ALPHA_CAUSAL_TRACE_FIXTURE, fixedStepHz: 60, phases: [], timeline: [] }), /versión/);
});
