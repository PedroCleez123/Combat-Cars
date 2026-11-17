import assert from "node:assert/strict";
import test from "node:test";

import {
  causalCombatSnapshotFromHost,
  createP2PWasmCausalCombatEnvelope,
  decodeP2PWasmCausalCombatEnvelope,
  P2P_WASM_CAUSAL_COMBAT_MAX_BYTES,
  P2P_WASM_CAUSAL_COMBAT_TYPE,
  validateP2PWasmCausalCombatEnvelope,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-protocol.mjs";
import { createP2PWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-combat-host.mjs";

const context = Object.freeze({ roomId: "p2p-causal-room", sessionId: "p2p-causal-session" });
const idle = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const command = (overrides = {}) => ({ controls: { ...idle }, fire: false, restart: false, targetId: null, ...overrides });

async function firstCausalFireSnapshot() {
  const host = await createP2PWasmCombatHost();
  try {
    assert.equal(host.setHostCommand(command()).accepted, true);
    return host.receivePilotCommand({ sequence: 1, ...command({ fire: true, targetId: "p2p-host" }) }).snapshot;
  } finally {
    host.close();
  }
}

async function firstCausalStraightFireSnapshot() {
  const host = await createP2PWasmCombatHost();
  try {
    assert.equal(host.setHostCommand(command({ fire: true, targetId: null })).accepted, true);
    return host.receivePilotCommand({ sequence: 1, ...command() }).snapshot;
  } finally {
    host.close();
  }
}

test("P2P-WASM-21 keeps an explicit nullable targetId for an unguided host rocket", async () => {
  const source = await firstCausalStraightFireSnapshot();
  const rocket = source.combat.rockets[0];
  assert.ok(rocket, "the straight launch should remain visible in the first snapshot");
  assert.equal(Object.hasOwn(rocket, "targetId"), true);
  assert.equal(rocket.targetId, null);
  const normalized = causalCombatSnapshotFromHost(source);
  assert.equal(normalized.rockets[0].targetId, null);
});

test("P2P-WASM-21 converts and round-trips a real causal host snapshot within the existing DataChannel frame budget", async () => {
  const source = await firstCausalFireSnapshot();
  const before = structuredClone(source);
  const wire = createP2PWasmCausalCombatEnvelope({ ...context, sequence: 1, snapshot: source });
  const decoded = decodeP2PWasmCausalCombatEnvelope(wire);

  assert.deepEqual(source, before, "wire conversion must not mutate authoritative host state");
  assert.equal(decoded.type, P2P_WASM_CAUSAL_COMBAT_TYPE);
  assert.equal(decoded.sequence, 1);
  assert.deepEqual(decoded.snapshot.physical, causalCombatSnapshotFromHost(source).physical);
  assert.equal(decoded.snapshot.events[0].kind, "fire");
  assert.equal(decoded.snapshot.rockets[0].targetId, "p2p-host");
  assert.ok(new TextEncoder().encode(wire).byteLength <= P2P_WASM_CAUSAL_COMBAT_MAX_BYTES);
  assert.equal(validateP2PWasmCausalCombatEnvelope(decoded), true);
});

test("P2P-WASM-21 keeps full-host boost-pad feedback valid on the causal wire", async () => {
  const host = await createP2PWasmCombatHost();
  try {
    assert.equal(host.setHostCommand(command()).accepted, true);
    const source = host.receivePilotCommand({ sequence: 1, ...command() }).snapshot;
    source.combat.events.push({ kind: "pad", text: "PILOTO recoge nitro.", at: 0.1 });
    const wire = createP2PWasmCausalCombatEnvelope({ ...context, sequence: 1, snapshot: source });
    const decoded = decodeP2PWasmCausalCombatEnvelope(wire);
    assert.equal(decoded.snapshot.events.at(-1).kind, "pad");
  } finally {
    host.close();
  }
});

test("P2P-WASM-21 fails closed for altered wire semantics, unsafe objects, overflow and oversized frames", async () => {
  const source = await firstCausalFireSnapshot();
  const valid = JSON.parse(createP2PWasmCausalCombatEnvelope({ ...context, sequence: 1, snapshot: source }));
  const mutations = [
    value => { value.extra = true; },
    value => { value.snapshot.physical[0].vx = 2501; },
    value => { value.snapshot.cars[1].alive = false; },
    value => { value.snapshot.events[0].kind = "other"; },
    value => { value.snapshot.events[0].text = "x".repeat(161); },
    value => { value.snapshot.rockets[0].targetId = "other"; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.equal(validateP2PWasmCausalCombatEnvelope(candidate), false);
    assert.throws(() => decodeP2PWasmCausalCombatEnvelope(JSON.stringify(candidate)), /outside its versioned contract/);
  }
  const unsafe = JSON.stringify(valid).replace('"sequence":', '"__proto__":{},"sequence":');
  assert.throws(() => decodeP2PWasmCausalCombatEnvelope(unsafe), /outside its versioned contract/);
  assert.throws(() => decodeP2PWasmCausalCombatEnvelope(`${JSON.stringify(valid)}${" ".repeat(P2P_WASM_CAUSAL_COMBAT_MAX_BYTES)}`), /exceeds/);
});
