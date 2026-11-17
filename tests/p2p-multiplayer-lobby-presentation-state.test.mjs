import test from "node:test";
import assert from "node:assert/strict";
import { createP2PWasmMultiplayerLobbyHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-host.mjs";
import { createP2PMultiplayerLobbyPresentationState } from "../src/p2p-multiplayer-lobby-presentation-state.js";

test("lobby presentation maps an authoritative FFA roster without combat state", async () => {
  const host = await createP2PWasmMultiplayerLobbyHost({ roomId: "present-room", sessionId: "present-session", mode: "ffa", hostName: "Host" });
  try {
    await host.addPlayer({ id: "p2p-guest-1", name: "Invitado" });
    const state = createP2PMultiplayerLobbyPresentationState(host.snapshot(), { roomId: "present-room", sessionId: "present-session" });
    assert.equal(state.cars.length, 2);
    assert.equal(state.rules.combat, false);
    assert.equal(state.rules.unlimitedBoost, true);
    assert.equal(state.cars.every(car => car.team === null && car.hp === 100 && car.kills === 0), true);
  } finally { host.close(); }
});
