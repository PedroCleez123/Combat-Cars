import assert from "node:assert/strict";
import test from "node:test";

import { P2PSignalingClient, consumeP2PInviteFragment, createP2PInviteUrl, restoreP2PInvite } from "../src/p2p-signaling-client.js";

const ORIGIN = "https://signal.example";
const roomId = "room_0123456789abcdef";
const hostSecret = "h".repeat(43);
const guestSecret = "g".repeat(43);
const expiresAt = 1_800_000;

class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.listeners = new Map(); FakeSocket.instances.push(this); }
  addEventListener(type, callback) { const callbacks = this.listeners.get(type) || []; callbacks.push(callback); this.listeners.set(type, callbacks); }
  fire(type, event = {}) { if (type === "open") this.readyState = 1; if (type === "close") this.readyState = 3; for (const callback of this.listeners.get(type) || []) callback(event); }
  send(value) { this.sent.push(value); }
  close(code, reason) { this.closeArgs = [code, reason]; this.readyState = 2; this.fire("close"); }
}

function clientWith({ fetch, now = () => 1_000_000, scheduler } = {}) {
  FakeSocket.instances = [];
  return new P2PSignalingClient({ origin: ORIGIN, fetch, WebSocket: FakeSocket, now, scheduler });
}

test("createRoom uses the public POST contract and validates the exact bounded response", async () => {
  let request;
  const client = clientWith({ fetch: async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201, json: async () => ({ roomId, hostSecret, guestSecret, expiresAt }) };
  } });
  assert.deepEqual(await client.createRoom(), { roomId, hostSecret, guestSecret, expiresAt });
  assert.equal(request.url, `${ORIGIN}/v1/rooms`);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, "{}");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.redirect, "error");

  for (const invalid of [
    { roomId, hostSecret, guestSecret, expiresAt, extra: true },
    { roomId: "bad", hostSecret, guestSecret, expiresAt },
    { roomId, hostSecret: `${hostSecret}x`, guestSecret, expiresAt },
    { roomId, hostSecret, guestSecret, expiresAt: 999_999 },
  ]) {
    const invalidClient = clientWith({ fetch: async () => ({ ok: true, status: 201, json: async () => invalid }) });
    await assert.rejects(invalidClient.createRoom(), /Respuesta de sala/);
  }
});

test("the native fetch default keeps its global receiver when called through the client", async () => {
  const originalFetch = globalThis.fetch;
  let receiver;
  globalThis.fetch = async function (...args) {
    receiver = this;
    return { ok: true, status: 201, json: async () => ({ roomId, hostSecret, guestSecret, expiresAt }) };
  };
  try {
    const client = new P2PSignalingClient({ origin: ORIGIN, WebSocket: FakeSocket, now: () => 1_000_000 });
    assert.deepEqual(await client.createRoom(), { roomId, hostSecret, guestSecret, expiresAt });
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("connect sends exact join as first frame without putting secrets in the URL; relay is sequential and bounded", () => {
  const client = clientWith();
  const received = [];
  client.on("signal", (event) => received.push(event));
  client.connect({ roomId, role: "host", secret: hostSecret, expiresAt });
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, `wss://signal.example/v1/rooms/${roomId}/signal`);
  assert.equal(socket.url.includes(hostSecret), false);
  socket.fire("open");
  assert.deepEqual(JSON.parse(socket.sent[0]), { type: "join", role: "host", secret: hostSecret });
  assert.equal(client.sendSignal({ sdp: "offer" }), 1);
  assert.equal(client.sendSignal({ candidate: "x" }), 2);
  assert.deepEqual(JSON.parse(socket.sent[1]), { type: "signal", protocolVersion: 1, sequence: 1, payload: '{"sdp":"offer"}' });
  socket.fire("message", { data: JSON.stringify({ type: "signal", protocolVersion: 1, sequence: 2, payload: '{"sdp":"answer"}' }) });
  assert.deepEqual(received, [{ payload: { sdp: "answer" }, sequence: 2 }]);
  socket.fire("message", { data: JSON.stringify({ type: "signal", protocolVersion: 1, sequence: 2, payload: "{}" }) });
  assert.equal(socket.closeArgs[0], 1008);
  assert.equal(client.socket, null);
});

test("peer-ready accepts exact complementary role and fails closed for malformed notices", () => {
  const client = clientWith();
  const ready = [];
  const errors = [];
  client.on("peer-ready", (event) => ready.push(event));
  client.on("error", (event) => errors.push(event));
  client.connect({ roomId, role: "host", secret: hostSecret, expiresAt });
  const socket = FakeSocket.instances[0];
  socket.fire("open");
  socket.fire("message", { data: JSON.stringify({ type: "peer-ready", protocolVersion: 1, role: "guest" }) });
  assert.deepEqual(ready, [{ role: "guest" }]);
  assert.equal(client.closed, false);
  assert.equal(socket.closeArgs, undefined);
  client.close();

  for (const malformed of [
    { type: "peer-ready", protocolVersion: 1, role: "guest", extra: true },
    { type: "peer-ready", protocolVersion: 2, role: "guest" },
    { type: "peer-ready", protocolVersion: 1, role: "admin" },
    { type: "peer-ready", protocolVersion: 1, role: "host" },
  ]) {
    const invalid = clientWith();
    const invalidErrors = [];
    invalid.on("error", (event) => invalidErrors.push(event));
    invalid.connect({ roomId, role: "host", secret: hostSecret, expiresAt });
    const invalidSocket = FakeSocket.instances[0];
    invalidSocket.fire("open");
    invalidSocket.fire("message", { data: JSON.stringify(malformed) });
    assert.equal(invalidErrors[0].code, "invalid-frame");
    assert.equal(invalidSocket.closeArgs[0], 1008);
    assert.equal(invalid.socket, null);
  }
});

test("peer notices and expiry close once and clear in-memory credentials", () => {
  let timerCallback;
  let cleared = false;
  const scheduler = { setTimeout: (fn) => { timerCallback = fn; return 17; }, clearTimeout: () => { cleared = true; } };
  const client = clientWith({ scheduler });
  const left = [];
  const closed = [];
  client.on("peer-left", (event) => left.push(event));
  client.on("closed", (event) => closed.push(event));
  client.connect({ roomId, role: "guest", secret: guestSecret, expiresAt });
  const socket = FakeSocket.instances[0];
  socket.fire("open");
  socket.fire("message", { data: JSON.stringify({ type: "host-left", protocolVersion: 1 }) });
  assert.deepEqual(left, [{ role: "host" }]);
  assert.deepEqual(closed, [{ reason: "host-left" }]);
  assert.equal(cleared, true);
  assert.equal(client.credentials, null);
  timerCallback();
  assert.equal(closed.length, 1);

  const expiring = clientWith({ scheduler: { setTimeout: (fn) => { timerCallback = fn; return 18; }, clearTimeout() {} } });
  const errors = [];
  expiring.on("error", (error) => errors.push(error));
  expiring.connect({ roomId, role: "host", secret: hostSecret, expiresAt });
  FakeSocket.instances.at(-1).fire("open");
  timerCallback();
  assert.equal(errors[0].code, "expired");
  assert.equal(expiring.socket, null);
});

test("invalid connect, socket errors, and unavailable origin fail without retry or recursion", () => {
  const offline = new P2PSignalingClient({ origin: null });
  assert.throws(() => offline.connect({ roomId, role: "host", secret: hostSecret, expiresAt }), /configurada/);
  const client = clientWith();
  assert.throws(() => client.connect({ roomId, role: "bad", secret: hostSecret, expiresAt }), /no válidas/);
  const errors = [];
  const closed = [];
  client.on("error", (error) => errors.push(error));
  client.on("closed", (event) => closed.push(event));
  client.connect({ roomId, role: "host", secret: hostSecret, expiresAt });
  const socket = FakeSocket.instances[0];
  socket.fire("error");
  socket.fire("close");
  assert.equal(errors.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(client.socket, null);
});

test("invite URLs keep credentials in a validated fragment and session storage expires", () => {
  const base = `https://game.example/p2p-room-lobby.html?source=local&keep=1`;
  const inviteUrl = createP2PInviteUrl(base, { roomId, guestSecret, expiresAt: Date.now() + 60_000 });
  assert.match(inviteUrl, /#p2p=/);
  assert.match(inviteUrl, /\?source=local&keep=1#p2p=/);
  assert.equal(inviteUrl.includes(guestSecret), false);
  const data = new Map();
  const storage = { setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key) ?? null, removeItem: (key) => data.delete(key) };
  const valid = consumeP2PInviteFragment({ hash: new URL(inviteUrl).hash, storage, now: () => Date.now() });
  assert.equal(valid.recognized, true);
  assert.deepEqual(valid.invite, { roomId, guestSecret, expiresAt: valid.invite.expiresAt });
  assert.deepEqual(restoreP2PInvite({ storage, now: () => Date.now() }), valid.invite);
  assert.equal(consumeP2PInviteFragment({ hash: "#p2p=bad&duplicate=1", storage, now: () => 1 }).invite, null);
  assert.equal(restoreP2PInvite({ storage, now: () => 1 }), null);
  const expired = consumeP2PInviteFragment({ hash: new URL(inviteUrl).hash, storage, now: () => Date.now() + 90_000 });
  assert.equal(expired.invite, null);
  assert.equal(restoreP2PInvite({ storage, now: () => Date.now() + 90_000 }), null);
});
