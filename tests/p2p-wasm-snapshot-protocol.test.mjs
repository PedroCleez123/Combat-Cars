import assert from "node:assert/strict";
import test from "node:test";

import {
  createP2PWasmSnapshotEnvelope,
  decodeP2PWasmSnapshotEnvelope,
  P2P_WASM_SNAPSHOT_MAX_BYTES,
  P2P_WASM_SNAPSHOT_MAX_CONTEXT_ID_LENGTH,
  P2P_WASM_SNAPSHOT_MAX_INPUT_SEQUENCE,
  P2P_WASM_SNAPSHOT_MAX_TICK,
  P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT,
  P2P_WASM_SNAPSHOT_PROTOCOL_VERSION,
  P2P_WASM_SNAPSHOT_TYPE,
  validateP2PWasmSnapshotEnvelope,
} from "../tools/wasm-spike/p2p-wasm-snapshot-protocol.mjs";

const context = Object.freeze({ roomId: "p2p-wasm-room", sessionId: "p2p-wasm-session" });

function makeSnapshot(overrides = {}) {
  const cars = [
    { id: "p2p-host", team: "blue", x: 100, z: -200, h: 17, yaw: 0.25, vx: 0, vz: 900, vh: 0 },
    { id: "p2p-pilot", team: "red", x: -600, z: 17, h: 0, yaw: -0.5, vx: -2300, vz: 0, vh: 0 },
  ];
  return { tick: 24, lastInputSequence: 4, cars, ...overrides };
}

function createText(snapshot = makeSnapshot(), envelopeContext = context) {
  return createP2PWasmSnapshotEnvelope(snapshot, envelopeContext);
}

function parsedValid() {
  return JSON.parse(createText());
}

test("P2P-WASM diagnostic envelope round-trips measured impact and normal gameplay velocities without clamping", () => {
  const snapshot = makeSnapshot();
  snapshot.cars[0].vx = 1257.8899;
  snapshot.cars[0].vz = -2300;
  snapshot.cars[1].vh = 2200;

  const text = createText(snapshot);
  const decoded = decodeP2PWasmSnapshotEnvelope(text);

  assert.equal(decoded.protocolVersion, P2P_WASM_SNAPSHOT_PROTOCOL_VERSION);
  assert.equal(decoded.type, P2P_WASM_SNAPSHOT_TYPE);
  assert.equal(decoded.type, "wasm-snapshot");
  assert.equal(decoded.tick, 24);
  assert.equal(decoded.lastInputSequence, 4);
  assert.deepEqual(decoded.context, context);
  assert.deepEqual(decoded.cars, snapshot.cars);
  assert.equal(decoded.cars[0].vx, 1257.8899);
  assert.equal(validateP2PWasmSnapshotEnvelope(decoded), true);
  assert.ok(new TextEncoder().encode(text).byteLength <= P2P_WASM_SNAPSHOT_MAX_BYTES);
});

test("velocity envelope accepts its inclusive bounds and rejects overflow without clamping", () => {
  const accepted = makeSnapshot();
  accepted.cars[0].vx = P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT;
  accepted.cars[1].vh = -P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT;
  assert.equal(validateP2PWasmSnapshotEnvelope(JSON.parse(createText(accepted))), true);

  for (const overflow of [P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT + 0.001, Infinity, NaN]) {
    const snapshot = makeSnapshot();
    snapshot.cars[0].vx = overflow;
    assert.throws(() => createText(snapshot), /outside its versioned envelope contract/);
  }

  const text = createText();
  const decoded = JSON.parse(text);
  decoded.cars[0].vx = P2P_WASM_SNAPSHOT_MAX_VELOCITY_COMPONENT + 1;
  assert.equal(validateP2PWasmSnapshotEnvelope(decoded), false);
});

test("strict version, type, exact keys, context, sequence, car identities, and teams are enforced", () => {
  const cases = [
    value => { value.protocolVersion = 2; },
    value => { value.type = "snapshot"; },
    value => { value.extra = true; },
    value => { value.tick = 0; },
    value => { value.tick = 1.5; },
    value => { value.lastInputSequence = 0; },
    value => { value.context.extra = "not-allowed"; },
    value => { value.context.roomId = "bad room"; },
    value => { value.cars[0].id = "other-car"; },
    value => { value.cars[1].id = "p2p-host"; },
    value => { value.cars[0].team = "red"; },
    value => { value.cars.reverse(); },
    value => { value.cars[0].extra = 1; },
    value => { value.cars[0].yaw = Infinity; },
    value => { value.cars[0].x = 10_001; },
  ];

  for (const mutate of cases) {
    const value = parsedValid();
    mutate(value);
    assert.equal(validateP2PWasmSnapshotEnvelope(value), false);
    assert.throws(() => decodeP2PWasmSnapshotEnvelope(JSON.stringify(value)), /outside its versioned contract/);
  }

  assert.throws(() => createText(makeSnapshot({ tick: P2P_WASM_SNAPSHOT_MAX_TICK + 1 })), /outside its versioned envelope contract/);
  assert.throws(() => createText(makeSnapshot({ lastInputSequence: P2P_WASM_SNAPSHOT_MAX_INPUT_SEQUENCE + 1 })), /outside its versioned envelope contract/);
  assert.throws(() => createText(makeSnapshot(), { roomId: "r".repeat(P2P_WASM_SNAPSHOT_MAX_CONTEXT_ID_LENGTH + 1), sessionId: "session" }), /outside its versioned envelope contract/);
});

test("unsafe prototypes, accessors, and __proto__ JSON keys are rejected without invoking getters", () => {
  const instance = Object.assign(new (class Message {})(), parsedValid());
  assert.equal(validateP2PWasmSnapshotEnvelope(instance), false);

  const revoked = Proxy.revocable(parsedValid(), {});
  revoked.revoke();
  assert.doesNotThrow(() => assert.equal(validateP2PWasmSnapshotEnvelope(revoked.proxy), false));

  const getterMessage = parsedValid();
  let getterCalls = 0;
  Object.defineProperty(getterMessage, "protocolVersion", {
    enumerable: true,
    get() { getterCalls += 1; return P2P_WASM_SNAPSHOT_PROTOCOL_VERSION; },
  });
  assert.equal(validateP2PWasmSnapshotEnvelope(getterMessage), false);
  assert.equal(getterCalls, 0);

  const pollutedText = createText().replace('"context":', '"__proto__":{},"context":');
  assert.equal(validateP2PWasmSnapshotEnvelope(JSON.parse(pollutedText)), false);
  assert.throws(() => decodeP2PWasmSnapshotEnvelope(pollutedText), /outside its versioned contract/);
});

test("JSON decoding rejects malformed text and enforces the inclusive 2048-byte UTF-8 limit", () => {
  assert.throws(() => decodeP2PWasmSnapshotEnvelope("{"), SyntaxError);
  assert.throws(() => decodeP2PWasmSnapshotEnvelope({}), TypeError);

  const valid = createText();
  const byteLength = new TextEncoder().encode(valid).byteLength;
  const atLimit = `${valid}${" ".repeat(P2P_WASM_SNAPSHOT_MAX_BYTES - byteLength)}`;
  const overLimit = `${atLimit} `;
  assert.equal(new TextEncoder().encode(atLimit).byteLength, P2P_WASM_SNAPSHOT_MAX_BYTES);
  assert.equal(decodeP2PWasmSnapshotEnvelope(atLimit).type, "wasm-snapshot");
  assert.equal(new TextEncoder().encode(overLimit).byteLength, P2P_WASM_SNAPSHOT_MAX_BYTES + 1);
  assert.throws(() => decodeP2PWasmSnapshotEnvelope(overLimit), RangeError);
});
