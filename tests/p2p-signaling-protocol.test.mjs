import assert from "node:assert/strict";
import test from "node:test";

import {
  createJoinMessage,
  decodeSignalFrame,
  isAllowedOrigin,
  normalizeAllowedOrigins,
  normalizeCorsPreflight,
  normalizeJoinMessage,
  normalizeRoomId,
  normalizeRoomRecord,
  normalizeSignalMessage,
  normalizeWebSocketRequest,
  SIGNAL_MAX_FRAME_BYTES,
  SIGNAL_MAX_PAYLOAD_BYTES,
  SIGNAL_PROTOCOL_VERSION,
} from "../src/p2p-signaling-protocol.js";

const hostSecret = "h".repeat(43);
const guestSecret = "g".repeat(43);
const room = { roomId: "room_0123456789abcdef", hostHash: "a".repeat(64), guestHash: "b".repeat(64), expiresAt: 10_000 };

test("signaling room and join normalization require exact, bounded fields", () => {
  assert.equal(normalizeRoomId(room.roomId), room.roomId);
  assert.equal(normalizeRoomId("../private"), null);
  assert.deepEqual(normalizeRoomRecord(room), room);
  assert.equal(normalizeRoomRecord({ ...room, extra: true }), null);
  assert.deepEqual(createJoinMessage({ role: "host", secret: hostSecret }), { type: "join", role: "host", secret: hostSecret });
  assert.equal(normalizeJoinMessage({ type: "join", role: "admin", secret: hostSecret }), null);
  assert.equal(normalizeJoinMessage({ type: "join", role: "host", secret: `${hostSecret}x` }), null);
  assert.equal(normalizeJoinMessage({ type: "join", role: "host", secret: hostSecret, extra: 1 }), null);
  assert.throws(() => createJoinMessage({ role: "guest", secret: "short" }), /Invalid signaling join/);
});

test("origin allowlist accepts only explicit canonical web origins and fails closed", () => {
  const origins = normalizeAllowedOrigins("https://arsenal.example, http://localhost:5173, https://arsenal.example/path, null, https://user:pw@bad.example");
  assert.deepEqual(origins, ["https://arsenal.example", "http://localhost:5173"]);
  assert.equal(isAllowedOrigin("https://arsenal.example", origins), true);
  assert.equal(isAllowedOrigin("https://arsenal.example.evil", origins), false);
  assert.equal(isAllowedOrigin("null", origins), false);
  assert.equal(isAllowedOrigin("https://arsenal.example/", origins), false);
  assert.deepEqual(normalizeAllowedOrigins(undefined), []);
});

test("WebSocket route normalization accepts only the exact room route and GET", () => {
  const input = { method: "GET", pathname: `/v1/rooms/${room.roomId}/signal`, origin: "https://arsenal.example", allowedOrigins: ["https://arsenal.example"] };
  assert.deepEqual(normalizeWebSocketRequest(input), { ok: true, roomId: room.roomId });
  assert.equal(normalizeWebSocketRequest({ ...input, method: "POST" }).status, 405);
  assert.equal(normalizeWebSocketRequest({ ...input, pathname: `/v1/rooms/${room.roomId}/signal/extra` }).status, 404);
  assert.equal(normalizeWebSocketRequest({ ...input, origin: "https://evil.example" }).status, 403);
});

test("CORS preflight only authorizes the exact public room creation request", () => {
  const input = {
    method: "OPTIONS",
    pathname: "/v1/rooms",
    origin: "https://arsenal.example",
    requestMethod: "POST",
    requestHeaders: "content-type",
    allowedOrigins: ["https://arsenal.example"],
  };
  assert.deepEqual(normalizeCorsPreflight(input), {
    ok: true,
    origin: "https://arsenal.example",
    methods: "POST",
    headers: "Content-Type",
  });
  assert.equal(normalizeCorsPreflight({ ...input, origin: "https://evil.example" }).status, 403);
  assert.equal(normalizeCorsPreflight({ ...input, allowedOrigins: [] }).status, 403);
  assert.equal(normalizeCorsPreflight({ ...input, pathname: "/v1/rooms/room_0123456789abcdef/signal" }).status, 404);
  assert.equal(normalizeCorsPreflight({ ...input, search: "?extra=1" }).status, 404);
  assert.equal(normalizeCorsPreflight({ ...input, requestMethod: "DELETE" }).status, 405);
  assert.equal(normalizeCorsPreflight({ ...input, requestHeaders: "content-type, authorization" }).status, 400);
});

test("signal payload and outer frame enforce version, exact keys, JSON string, byte limits, and sequence", () => {
  const frame = { type: "signal", protocolVersion: SIGNAL_PROTOCOL_VERSION, sequence: 1, payload: JSON.stringify({ sdp: "opaque" }) };
  assert.deepEqual(normalizeSignalMessage(frame), frame);
  assert.deepEqual(decodeSignalFrame(JSON.stringify(frame)), frame);
  assert.equal(normalizeSignalMessage({ ...frame, protocolVersion: 2 }), null);
  assert.equal(normalizeSignalMessage({ ...frame, extra: 1 }), null);
  assert.equal(normalizeSignalMessage({ ...frame, sequence: 0 }), null);
  assert.equal(normalizeSignalMessage({ ...frame, sequence: 1 }, { lastSequence: 1 }), null);
  assert.equal(normalizeSignalMessage({ ...frame, payload: { candidate: "opaque" } }), null);
  assert.equal(normalizeSignalMessage({ ...frame, payload: "not-json" }), null);
  assert.equal(normalizeSignalMessage({ ...frame, payload: JSON.stringify({ sdp: "x".repeat(SIGNAL_MAX_PAYLOAD_BYTES) }) }), null);
  assert.equal(decodeSignalFrame(" ".repeat(SIGNAL_MAX_FRAME_BYTES + 1)), null);
  assert.equal(decodeSignalFrame("{"), null);
  assert.equal(decodeSignalFrame(new Uint8Array([123])), null);
});
