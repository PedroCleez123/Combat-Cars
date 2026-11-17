import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerLobbyHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-host.mjs";
import {
  createP2PWasmMultiplayerLobbyEnvelope,
  decodeP2PWasmMultiplayerLobbyEnvelope,
  validateP2PWasmMultiplayerLobbySnapshot,
} from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-protocol.mjs";

test("lobby protocol round-trips bounded roster snapshots and rejects combat fields", async () => {
  const host = await createP2PWasmMultiplayerLobbyHost({ roomId: "room-proto", sessionId: "session-proto", mode: "ffa", hostName: "Host" });
  try {
    const snapshot = host.snapshot();
    assert.equal(validateP2PWasmMultiplayerLobbySnapshot(snapshot), true);
    const wire = createP2PWasmMultiplayerLobbyEnvelope({ roomId: "room-proto", sessionId: "session-proto", sequence: 1, snapshot });
    const decoded = decodeP2PWasmMultiplayerLobbyEnvelope(wire);
    assert.equal(decoded.protocolVersion, 1);
    assert.deepEqual(decoded.snapshot, snapshot);
    const withScore = { ...snapshot, score: {} };
    assert.equal(validateP2PWasmMultiplayerLobbySnapshot(withScore), false);
    assert.throws(() => createP2PWasmMultiplayerLobbyEnvelope({ roomId: "room-proto", sessionId: "session-proto", sequence: 1, snapshot: withScore }), /fuera de contrato/i);
    assert.throws(() => decodeP2PWasmMultiplayerLobbyEnvelope(wire.replace('"protocolVersion":1', '"protocolVersion":6')), /fuera de contrato/i);
  } finally { host.close(); }
});

test("lobby protocol enforces room/session binding and bounded input", async () => {
  const host = await createP2PWasmMultiplayerLobbyHost({ roomId: "room-bind", sessionId: "session-bind", mode: "1v1", hostName: "Host" });
  try {
    const snapshot = host.snapshot();
    assert.throws(() => createP2PWasmMultiplayerLobbyEnvelope({ roomId: "wrong", sessionId: "session-bind", sequence: 1, snapshot }), /sesión/i);
    assert.throws(() => decodeP2PWasmMultiplayerLobbyEnvelope("{"), /JSON/i);
    assert.throws(() => decodeP2PWasmMultiplayerLobbyEnvelope("x".repeat(16 * 1024 + 1)), /acotado/i);
  } finally { host.close(); }
});

