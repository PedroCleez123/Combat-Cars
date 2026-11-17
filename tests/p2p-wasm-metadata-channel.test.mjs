import assert from "node:assert/strict";
import test from "node:test";
import { createP2PWasmMetadataEnvelope, decodeP2PWasmMetadataEnvelope, validateP2PWasmMetadataEnvelope } from "../tools/wasm-spike/p2p-wasm-metadata-channel.mjs";

const players = [{ id: "p2p-host", team: "blue", name: "Pedro" }, { id: "p2p-pilot", team: "red", name: "Rival" }];
const pads = [{ id: "boost-01", x: 1, h: 0, z: -2, amount: 100, cooldown: 0, active: true }];

test("metadata side-channel round-trips names and pads without causal v4 fields", () => {
  const decoded = decodeP2PWasmMetadataEnvelope(createP2PWasmMetadataEnvelope({ roomId: "room", sessionId: "session", sequence: 1, players, pads }));
  assert.deepEqual(decoded.players, players);
  assert.deepEqual(decoded.pads, pads);
  assert.equal("secret" in decoded, false);
});

test("metadata side-channel carries the complete 88-pad combat floor within its transport budget", () => {
  const fullPads = Array.from({ length: 88 }, (_, id) => ({
    id: `pad-${id}`,
    x: id % 2 ? 12 : -12,
    h: 0,
    z: id % 3 ? 24 : -24,
    amount: id < 12 ? 60 : 38,
    cooldown: 0,
    active: true,
  }));
  const text = createP2PWasmMetadataEnvelope({ roomId: "room", sessionId: "session", sequence: 1, players, pads: fullPads });
  assert.ok(new TextEncoder().encode(text).byteLength <= 8192);
  assert.equal(decodeP2PWasmMetadataEnvelope(text).pads.length, 88);
});

test("metadata side-channel fails closed on duplicate/invalid pads and unknown keys", () => {
  assert.throws(() => createP2PWasmMetadataEnvelope({ roomId: "room", sessionId: "session", sequence: 1, players, pads: [{ ...pads[0], id: "bad id" }] }));
  assert.throws(() => decodeP2PWasmMetadataEnvelope(JSON.stringify({ protocolVersion: 1, type: "wasm-causal-combat-metadata", roomId: "room", sessionId: "session", sequence: 1, players, pads, extra: true })));
  assert.equal(validateP2PWasmMetadataEnvelope({ protocolVersion: 1, type: "wasm-causal-combat-metadata", roomId: "room", sessionId: "session", sequence: 1, players, pads }), true);
});
