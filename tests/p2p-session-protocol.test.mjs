import assert from "node:assert/strict";
import test from "node:test";

import {
  createP2PHello,
  createP2PInput,
  createP2PState,
  createP2PWelcome,
  decodeP2PMessage,
  P2P_CONTROL_CHANNEL,
  P2P_PROTOCOL_VERSION,
  validateP2PMessage,
} from "../src/p2p-session-protocol.js";

const context = { roomId: "local", sessionId: "session_1" };
const controls = { throttle: 0.5, steer: -0.25, boost: true, jump: false };

test("P2P session constructors produce the minimal ordered hello/welcome/input/state contract", () => {
  assert.deepEqual(createP2PHello(context), {
    type: "hello", protocolVersion: P2P_PROTOCOL_VERSION, roomId: "local", sessionId: "session_1", sequence: 0,
  });
  assert.deepEqual(createP2PWelcome(context), {
    type: "welcome", protocolVersion: P2P_PROTOCOL_VERSION, roomId: "local", sessionId: "session_1", sequence: 0,
  });
  assert.deepEqual(createP2PInput({ ...context, sequence: 1, controls }), {
    type: "input", protocolVersion: P2P_PROTOCOL_VERSION, roomId: "local", sessionId: "session_1", sequence: 1, controls,
  });
  assert.deepEqual(createP2PState({ ...context, sequence: 1, controls }), {
    type: "state", protocolVersion: P2P_PROTOCOL_VERSION, roomId: "local", sessionId: "session_1", sequence: 1,
    state: { lastInputSequence: 1, controls },
  });
  assert.equal(P2P_CONTROL_CHANNEL, "arsenal-controls");
});

test("P2P validation enforces message type, room, session, exact keys, and structured controls", () => {
  const input = createP2PInput({ ...context, sequence: 1, controls });
  assert.equal(validateP2PMessage(input, { ...context, expectedType: "input" }).ok, true);
  assert.equal(validateP2PMessage(input, { ...context, roomId: "other" }).ok, false);
  assert.equal(validateP2PMessage(input, { ...context, sessionId: "other" }).ok, false);
  assert.equal(validateP2PMessage({ ...input, arbitrary: "value" }).ok, false);
  assert.equal(validateP2PMessage({ ...input, controls: { ...controls, extra: "value" } }).ok, false);
  assert.equal(validateP2PMessage({ ...input, controls: { ...controls, throttle: 2 } }).ok, false);
  assert.equal(validateP2PMessage({ ...input, controls: { ...controls, jump: 1 } }).ok, false);
  assert.equal(validateP2PMessage({ ...input, sequence: Number.MAX_SAFE_INTEGER + 1 }).ok, false);
  assert.throws(() => createP2PInput({ ...context, sequence: 1, controls: { ...controls, extra: {} } }), /Invalid P2P input/);
});

test("P2P decoding rejects malformed, oversized, and non-string frames", () => {
  assert.equal(decodeP2PMessage("not-json", context).ok, false);
  assert.equal(decodeP2PMessage(" ".repeat(2049), context).ok, false);
  assert.equal(decodeP2PMessage({ type: "hello" }, context).ok, false);
  assert.equal(decodeP2PMessage(JSON.stringify({ ...createP2PHello(context), roomId: "../private" }), context).ok, false);
});

test("P2P state sequence must match its structured acknowledgement", () => {
  const state = createP2PState({ ...context, sequence: 1, controls });
  assert.equal(validateP2PMessage({ ...state, state: { ...state.state, lastInputSequence: 2 } }).ok, false);
  assert.equal(validateP2PMessage({ ...state, state: { ...state.state, controls: { ...controls, steer: "0" } } }).ok, false);
});
