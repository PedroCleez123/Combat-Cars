import assert from "node:assert/strict";
import test from "node:test";

import { createLanInviteUrl, describePilotCapacity } from "../src/lan-session-ui.js";

test("LAN invite keeps the opened origin and path and carries the active room", () => {
  const invite = new URL(createLanInviteUrl("http://192.168.1.10:5300/game?room=old&debug=1#hud", "scrim_4"));
  assert.equal(invite.origin, "http://192.168.1.10:5300");
  assert.equal(invite.pathname, "/game");
  assert.equal(invite.searchParams.get("room"), "scrim_4");
  assert.equal(invite.searchParams.get("debug"), "1");
  assert.equal(invite.hash, "");
});

test("session readout takes pilot count and capacity from the authoritative snapshot", () => {
  assert.equal(describePilotCapacity({ settings: { humans: 2, vehicleLimit: 6 } }), "2/6 pilotos");
  assert.equal(describePilotCapacity({ settings: { vehicleLimit: 3 }, cars: [{ isBot: false }, { isBot: true }] }), "1/3 pilotos");
  assert.equal(describePilotCapacity(null), "Esperando snapshot del servidor");
});
