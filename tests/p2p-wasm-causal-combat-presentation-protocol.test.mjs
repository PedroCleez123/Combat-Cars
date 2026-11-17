import assert from "node:assert/strict";
import test from "node:test";

import {
  causalCombatPresentationFromHost,
  createP2PWasmCausalCombatPresentationEnvelope,
  decodeP2PWasmCausalCombatPresentationEnvelope,
  P2P_WASM_PRESENTATION_MAX_BYTES,
  P2P_WASM_PRESENTATION_PROTOCOL_VERSION,
  P2P_WASM_PRESENTATION_ACTION_SERIAL_KEYS,
  P2P_WASM_PRESENTATION_TYPE,
  validateP2PWasmCausalCombatPresentationEnvelope,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs";
import { createP2PWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-combat-host.mjs";
import {
  decodeP2PWasmCausalCombatEnvelope,
  createP2PWasmCausalCombatEnvelope,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-protocol.mjs";

const context = Object.freeze({ roomId: "p2p-causal-room", sessionId: "p2p-causal-session" });
const idle = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const command = (overrides = {}) => ({ controls: { ...idle }, fire: false, restart: false, targetId: null, ...overrides });

async function firstPresentationSnapshot() {
  const host = await createP2PWasmCombatHost();
  assert.equal(host.setHostCommand(command()).accepted, true);
  const first = host.receivePilotCommand({ sequence: 1, ...command() });
  assert.equal(first.accepted, true);
  return { host, snapshot: host.presentationSnapshot() };
}

test("P2P-WASM-41 round-trips explicit presentation telemetry without changing compact v1", async () => {
  const { host, snapshot } = await firstPresentationSnapshot();
  try {
    const source = structuredClone(snapshot);
    const wire = createP2PWasmCausalCombatPresentationEnvelope({ ...context, sequence: 1, snapshot });
    const decoded = decodeP2PWasmCausalCombatPresentationEnvelope(wire);
    assert.deepEqual(snapshot, source, "v5 encoding must not mutate authoritative host state");
    assert.equal(decoded.protocolVersion, P2P_WASM_PRESENTATION_PROTOCOL_VERSION);
    assert.equal(decoded.type, P2P_WASM_PRESENTATION_TYPE);
    assert.equal(decoded.sequence, 1);
    assert.equal(decoded.snapshot.tick, snapshot.tick);
    assert.deepEqual(decoded.snapshot.physical, snapshot.physical);
    assert.equal(decoded.presentation.length, 2);
    assert.ok(decoded.presentation.every(car => car.orientation && Number.isFinite(car.boost)));
    assert.ok(decoded.presentation.every(car => ["grounded", "first-jump", "double-jump", "dodge", "airborne"].includes(car.jumpState)));
    assert.ok(decoded.presentation.every(car => P2P_WASM_PRESENTATION_ACTION_SERIAL_KEYS.every(key => Number.isSafeInteger(car.actionSerials[key]) && car.actionSerials[key] >= 0)));
    assert.ok(new TextEncoder().encode(wire).byteLength <= P2P_WASM_PRESENTATION_MAX_BYTES);
    assert.equal(validateP2PWasmCausalCombatPresentationEnvelope(decoded), true);

    // The legacy decoder must reject a versioned v5 frame instead of silently
    // dropping its renderer telemetry.
    assert.throws(() => decodeP2PWasmCausalCombatEnvelope(wire), /outside its versioned contract/);
  } finally {
    host.close();
  }
});

test("P2P-WASM-41 fails closed for malformed telemetry and rejects unversioned host shapes", async () => {
  const { host, snapshot } = await firstPresentationSnapshot();
  try {
    const valid = JSON.parse(createP2PWasmCausalCombatPresentationEnvelope({ ...context, sequence: 1, snapshot }));
    const mutations = [
      value => { value.presentation[0].boost = 101; },
      value => { value.presentation[0].orientation.w = 0; },
      value => { value.presentation[0].wheelContact.hasContact = true; value.presentation[0].wheelContact.normal = { x: 0, y: 0, z: 0 }; },
      value => { value.presentation[0].wheelCount = 4.5; },
      value => { value.presentation[0].jumpState = "wall-jump"; },
      value => { value.presentation[0].actionSerials.jump = -1; },
      value => { value.presentation[0].actionSerials.doubleJump = 1.5; },
      value => { value.presentation[0].actionSerials.dodge = 10_000_001; },
      value => { value.presentation[0].actionSerials.extra = true; },
      value => { value.presentation[0].extra = true; },
      value => { value.protocolVersion = 1; },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(valid);
      mutate(candidate);
      assert.equal(validateP2PWasmCausalCombatPresentationEnvelope(candidate), false);
      assert.throws(() => decodeP2PWasmCausalCombatPresentationEnvelope(JSON.stringify(candidate)), /outside its versioned contract/);
    }
    assert.equal(validateP2PWasmCausalCombatPresentationEnvelope(snapshot), false);
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error("hostile shape"); } });
    assert.equal(validateP2PWasmCausalCombatPresentationEnvelope(hostile), false);
    assert.throws(() => causalCombatPresentationFromHost({ ...snapshot, presentation: [] }), /outside its versioned contract/);
    assert.throws(
      () => decodeP2PWasmCausalCombatPresentationEnvelope(`${JSON.stringify(valid)}${" ".repeat(P2P_WASM_PRESENTATION_MAX_BYTES)}`),
      /exceeds/,
    );
  } finally {
    host.close();
  }
});

