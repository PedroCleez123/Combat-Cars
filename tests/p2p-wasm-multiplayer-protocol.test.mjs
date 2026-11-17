import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerCombatHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-host.mjs";
import { causalMultiplayerSnapshotFromHost, createP2PWasmMultiplayerEnvelope, decodeP2PWasmMultiplayerEnvelope } from "../tools/wasm-spike/p2p-wasm-multiplayer-protocol.mjs";

test("v6 envelopes carry a real four-car WASM roster and reject duplicate/oversized identity state", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "2v2", playerIds: ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3"] });
  try {
    const envelope = createP2PWasmMultiplayerEnvelope({ roomId: "room_multi", sessionId: "session_multi", sequence: 1, snapshot: host.snapshot() });
    const decoded = decodeP2PWasmMultiplayerEnvelope(envelope);
    assert.equal(decoded.protocolVersion, 6);
    assert.equal(decoded.snapshot.cars.length, 4);
    assert.deepEqual(decoded.snapshot.cars.map(car => car.id), ["p2p-host", "p2p-guest-1", "p2p-guest-2", "p2p-guest-3"]);
    assert.deepEqual(decoded.snapshot.cars.map(car => car.team), ["blue", "red", "blue", "red"]);
    assert.deepEqual(causalMultiplayerSnapshotFromHost(host.snapshot()).cars.map(car => car.id), decoded.snapshot.cars.map(car => car.id));
    assert.throws(() => decodeP2PWasmMultiplayerEnvelope(envelope.replace("room_multi", "room_multi" + "x".repeat(100))), /contrato|acotado/i);
  } finally { host.close(); }
});
