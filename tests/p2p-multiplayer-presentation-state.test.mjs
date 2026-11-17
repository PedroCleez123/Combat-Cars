import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerCombatHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-host.mjs";
import { createP2PWasmMultiplayerEnvelope } from "../tools/wasm-spike/p2p-wasm-multiplayer-protocol.mjs";
import { createP2PMultiplayerPresentationState } from "../src/p2p-multiplayer-presentation-state.js";

test("v6 presentation projects all authoritative cars to the existing Three renderer state", async () => {
  const host = await createP2PWasmMultiplayerCombatHost({ mode: "ffa", playerIds: ["p2p-host", "p2p-guest-1", "p2p-guest-2"], names: { "p2p-host": "Álex", "p2p-guest-1": "Bea" } });
  try {
    const envelope = createP2PWasmMultiplayerEnvelope({ roomId: "room_multi", sessionId: "session_multi", sequence: 1, snapshot: host.snapshot() });
    const state = createP2PMultiplayerPresentationState(envelope, { roomId: "room_multi", sessionId: "session_multi" });
    assert.equal(state.cars.length, 3);
    assert.deepEqual(state.cars.map(car => car.id), ["p2p-host", "p2p-guest-1", "p2p-guest-2"]);
    assert.deepEqual(state.cars.slice(0, 2).map(car => car.name), ["Álex", "Bea"]);
    assert.equal(state.settings.p2pPresentationProtocol, 6);
    assert.equal(state.settings.matchMode, "ffa");
    assert.equal(state.rules.freeForAll, true);
    assert.deepEqual(Object.keys(state.score).sort(), ["p2p-guest-1", "p2p-guest-2", "p2p-host"]);
    assert.equal(state.rules.pads, false);
    assert.equal(state.pads.length, 0);
    assert.ok(state.cars.every(car => Number.isFinite(car.speed) && car.orientation.w));
  } finally { host.close(); }
});
