import assert from "node:assert/strict";
import test from "node:test";

import { createClientHello, isAllowedOrigin, normalizePilotName, normalizeTargetId, validateHello } from "../src/lan-session-protocol.js";

test("optional target intent accepts only the existing bounded safe id format", () => {
  assert.equal(normalizeTargetId("web-abc_123"), "web-abc_123");
  assert.equal(normalizeTargetId({ id: "web-abc" }), null);
  assert.equal(normalizeTargetId("x".repeat(97)), null);
  assert.equal(normalizeTargetId("../server"), null);
});

test("hello identity is normalized to a safe 16-character name on both sides of the contract", () => {
  const name = "  María <script> piloto muy largo  ";
  const normalized = normalizePilotName(name);
  assert.equal(normalized, "María script pil");
  assert.equal(Array.from(normalized).length, 16);
  assert.equal(createClientHello({ sessionId: "session-1", name }).name, normalized);
  assert.equal(validateHello({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "session-1", name }).name, normalized);
  assert.equal(normalizePilotName("<>"), "PILOTO");
});

test("hello preserves a string hosted access token only for server authentication", () => {
  const hello = validateHello({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "session-1", accessToken: "compact.token.value" });
  assert.equal(hello.ok, true);
  assert.equal(hello.accessToken, "compact.token.value");
  assert.equal(validateHello({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "session-1", accessToken: 42 }).accessToken, null);
});

test("LAN origin guard accepts the same host used to open the server", () => {
  assert.equal(isAllowedOrigin("http://192.168.1.20:5300", { port: 5300, host: "192.168.1.20:5300" }), true);
  assert.equal(isAllowedOrigin("http://evil.example:5300", { port: 5300, host: "192.168.1.20:5300" }), false);
});

test("configured LAN origins remain an explicit allowlist", () => {
  const configured = new Set(["http://game-host:5300"]);
  assert.equal(isAllowedOrigin("http://game-host:5300", { port: 5300, host: "192.168.1.20:5300", configured }), true);
  assert.equal(isAllowedOrigin("http://192.168.1.20:5300", { port: 5300, host: "192.168.1.20:5300", configured }), false);
});
