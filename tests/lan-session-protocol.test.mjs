import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedOrigin } from "../src/lan-session-protocol.js";

test("LAN origin guard accepts the same host used to open the server", () => {
  assert.equal(isAllowedOrigin("http://192.168.1.20:5300", { port: 5300, host: "192.168.1.20:5300" }), true);
  assert.equal(isAllowedOrigin("http://evil.example:5300", { port: 5300, host: "192.168.1.20:5300" }), false);
});

test("configured LAN origins remain an explicit allowlist", () => {
  const configured = new Set(["http://game-host:5300"]);
  assert.equal(isAllowedOrigin("http://game-host:5300", { port: 5300, host: "192.168.1.20:5300", configured }), true);
  assert.equal(isAllowedOrigin("http://192.168.1.20:5300", { port: 5300, host: "192.168.1.20:5300", configured }), false);
});
