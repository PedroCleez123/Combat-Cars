import test from "node:test";
import assert from "node:assert/strict";
import { createP2PMultiInviteUrl, consumeP2PMultiInviteFragment, normalizeP2PMultiRoomCode, parseP2PMultiRoomResponse, parseP2PMultiJoinResponse, P2PMultiSignalingClient } from "../src/p2p-multiparty-signaling-client.js";

const secret = letter => letter.repeat(43);
const body = { roomId: "room_0123456789abcdef", hostSecret: secret("h"), guestSecrets: [secret("a"), secret("b"), secret("c")], expiresAt: 10_000, mode: "2v2", maxPlayers: 4 };

test("multi signaling parses a bounded room credential response", () => {
  assert.equal(parseP2PMultiRoomResponse(body, 1).guestSecrets.length, 3);
  assert.equal(parseP2PMultiRoomResponse({ ...body, guestSecrets: [secret("a"), secret("a")] }, 1), null);
  assert.equal(parseP2PMultiRoomResponse({ ...body, maxPlayers: 6 }, 1), null);
  assert.equal(parseP2PMultiRoomResponse({ ...body, mode: "unsupported" }, 1), null);
});

test("multi signaling creates a room-open record before mode selection and configures it explicitly", async () => {
  const requests = [];
  const roomCode = "0123456789";
  const guestSecrets = ["a", "b", "c", "d", "e"].map(secret);
  const client = new P2PMultiSignalingClient({
    origin: "https://signal.example", now: () => 1,
    fetch: async (url, init) => {
      const request = { url, body: JSON.parse(init.body) }; requests.push(request);
      if (url.endsWith("/rooms")) return new Response(JSON.stringify({ roomCode, roomId: roomCode, hostSecret: secret("h"), guestSecrets, expiresAt: 10_000, mode: null, maxPlayers: 6, phase: "room-open" }), { status: 201 });
      return new Response(JSON.stringify({ roomCode, roomId: roomCode, expiresAt: 10_000, mode: "2v2", maxPlayers: 4, phase: "team-selection" }), { status: 200 });
    },
  });
  const room = await client.createRoom();
  assert.equal(room.phase, "room-open");
  assert.equal(room.mode, null);
  const configured = await client.configureRoom({ roomCode, hostSecret: secret("h"), mode: "2v2", maxPlayers: 4 });
  assert.equal(configured.phase, "team-selection");
  assert.deepEqual(requests.map(request => request.body), [
    {},
    { roomCode, hostSecret: secret("h"), mode: "2v2", maxPlayers: 4 },
  ]);
});

test("a promoted host restores the same persistent room to its unconfigured waiting state", async () => {
  const requests = [];
  const roomCode = "0123456789";
  const client = new P2PMultiSignalingClient({
    origin: "https://signal.example", now: () => 1,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push({ url, body });
      return new Response(JSON.stringify({ roomCode, roomId: roomCode, expiresAt: 10_000, mode: null, maxPlayers: 6, phase: "room-open" }), { status: 200 });
    },
  });
  const reset = await client.resetRoom({ roomCode, hostSecret: secret("h") });
  assert.deepEqual(reset, { roomCode, roomId: roomCode, expiresAt: 10_000, mode: null, maxPlayers: 6, phase: "room-open" });
  assert.deepEqual(requests, [{
    url: "https://signal.example/v2/rooms/configure",
    body: { roomCode, hostSecret: secret("h"), mode: null, maxPlayers: 6 },
  }]);
});

test("a stale former-host credential is distinguishable from a transient restore failure", async () => {
  const client = new P2PMultiSignalingClient({
    origin: "https://signal.example", now: () => 1,
    fetch: async () => new Response(JSON.stringify({ error: "not host" }), { status: 403 }),
  });
  await assert.rejects(
    () => client.resetRoom({ roomCode: "0123456789", hostSecret: secret("h") }),
    error => error instanceof Error && error.code === "room-not-owner" && error.message === "Solo el host actual puede restaurar la sala.",
  );
});

test("a missing persistent room is classified as stale so the caller can mint a new personal room", async () => {
  const client = new P2PMultiSignalingClient({
    origin: "https://signal.example", now: () => 1,
    fetch: async () => new Response(JSON.stringify({ error: "room missing" }), { status: 404 }),
  });
  await assert.rejects(
    () => client.resetRoom({ roomCode: "0123456789", hostSecret: secret("h") }),
    error => error instanceof Error && error.code === "room-expired" && error.message === "La sala ha caducado.",
  );
});

test("multi signaling parses a short-code join response and keeps the assigned slot", () => {
  const joined = { roomCode: "0123456789", roomId: "0123456789", guestSecret: secret("j"), participantId: "participant_0123456789", reconnectToken: secret("r"), slot: 2, expiresAt: 10_000, mode: "3v3", maxPlayers: 6 };
  assert.equal(parseP2PMultiJoinResponse(joined, 1).slot, 2);
  assert.equal(parseP2PMultiJoinResponse({ ...joined, roomCode: "012345678A" }, 1), null);
  assert.equal(parseP2PMultiJoinResponse({ ...joined, slot: 6 }, 1), null);
  assert.equal(parseP2PMultiJoinResponse({ ...joined, maxPlayers: 5 }, 1), null);
  const legacy = { ...joined }; delete legacy.participantId; delete legacy.reconnectToken;
  assert.equal(parseP2PMultiJoinResponse(legacy, 1).participantId, null);
});

test("multi signaling joins a short code without exposing room secrets in the request", async () => {
  const requests = [];
  const client = new P2PMultiSignalingClient({
    origin: "https://signal.example",
    now: () => 1,
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ roomCode: "0123456789", roomId: "0123456789", guestSecret: secret("j"), participantId: "participant_0123456789", reconnectToken: secret("r"), slot: 1, expiresAt: 10_000, mode: "2v2", maxPlayers: 4 }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const joined = await client.joinRoomByCode(" 0123-456789 ", { mode: "2v2" });
  assert.equal(joined.mode, "2v2");
  assert.equal(requests[0].url, "https://signal.example/v2/rooms/join");
  assert.deepEqual(requests[0].body, { roomCode: "0123456789", mode: "2v2", persistent: true });
  assert.equal(JSON.stringify(requests[0].body).includes("guestSecret"), false);
});

test("multi signaling can request the same participant ticket without exposing it in the public room key", async () => {
  const requests = [];
  const client = new P2PMultiSignalingClient({
    origin: "https://signal.example", now: () => 1,
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ roomCode: "0123456789", roomId: "0123456789", guestSecret: secret("j"), participantId: "participant_0123456789", reconnectToken: secret("r"), slot: 2, expiresAt: 10_000, mode: "2v2", maxPlayers: 4 }), { status: 200 });
    },
  });
  const joined = await client.joinRoomByCode("0123456789", { reconnect: { participantId: "participant_0123456789", reconnectToken: secret("r") } });
  assert.equal(joined.slot, 2);
  assert.deepEqual(requests[0].body, { roomCode: "0123456789", participantId: "participant_0123456789", reconnectToken: secret("r") });
});

test("multi short keys accept harmless spaces and separators but remain exactly ten Crockford characters", () => {
  assert.equal(normalizeP2PMultiRoomCode(" 0123-456789 "), "0123456789");
  assert.equal(normalizeP2PMultiRoomCode("012345678I"), null);
  assert.equal(normalizeP2PMultiRoomCode("012345678"), null);
});

test("multi invitations keep a single guest credential in the URL fragment", () => {
  const url = createP2PMultiInviteUrl({ baseUrl: "https://combat-cars.pages.dev/p2p-multiplayer.html", roomId: body.roomId, guestSecret: body.guestSecrets[1], slot: 2, expiresAt: body.expiresAt, mode: body.mode, maxPlayers: body.maxPlayers });
  const parsed = consumeP2PMultiInviteFragment({ hash: new URL(url).hash, now: 1 });
  assert.equal(parsed.invite.slot, 2);
  assert.equal(parsed.invite.guestSecret, body.guestSecrets[1]);
  assert.equal(consumeP2PMultiInviteFragment({ hash: new URL(url).hash, now: body.expiresAt }).invite, null);
});

test("multi signaling routes v2 frames with target and source slots", () => {
  const sent = [];
  const listeners = new Map();
  const socket = { readyState: 1, addEventListener(type, fn) { listeners.set(type, fn); }, send(value) { sent.push(JSON.parse(value)); }, close() {} };
  const client = new P2PMultiSignalingClient({ origin: "https://signal.example", WebSocket: function WebSocket() { return socket; }, now: () => 1 });
  const events = [];
  client.on("signal", event => events.push(event));
  client.connect({ roomId: body.roomId, role: "host", slot: null, secret: body.hostSecret, expiresAt: body.expiresAt });
  listeners.get("open")();
  assert.equal(sent[0].type, "join");
  client.sendSignal({ description: "offer" }, { targetSlot: 2 });
  assert.equal(sent[1].targetSlot, 2);
  client.receive(JSON.stringify({ protocolVersion: 2, type: "signal", sequence: 1, targetSlot: null, sourceSlot: 2, payload: JSON.stringify({ candidate: true }) }));
  assert.deepEqual(events[0], { payload: { candidate: true }, sequence: 1, targetSlot: null, sourceSlot: 2 });
  client.close();
});

test("a host accepts independent first signaling frames from every 2v2 guest slot", () => {
  const listeners = new Map();
  const socket = { readyState: 1, addEventListener(type, fn) { listeners.set(type, fn); }, send() {}, close() {} };
  const client = new P2PMultiSignalingClient({ origin: "https://signal.example", WebSocket: function WebSocket() { return socket; }, now: () => 1 });
  const events = [];
  client.on("signal", event => events.push(event));
  client.connect({ roomId: body.roomId, role: "host", slot: null, secret: body.hostSecret, expiresAt: body.expiresAt });
  listeners.get("open")();
  const signalFrom = slot => JSON.stringify({ protocolVersion: 2, type: "signal", sequence: 1, targetSlot: null, sourceSlot: slot, payload: JSON.stringify({ candidate: slot }) });
  client.receive(signalFrom(1));
  client.receive(signalFrom(2));
  client.receive(signalFrom(3));
  assert.deepEqual(events.map(event => [event.sourceSlot, event.sequence]), [[1, 1], [2, 1], [3, 1]]);
  client.receive(signalFrom(2));
  assert.equal(client.closed, true);
});

test("a promoted guest keeps its socket and can start routing host-star signals", () => {
  const sent = [];
  const listeners = new Map();
  const socket = { readyState: 1, addEventListener(type, fn) { listeners.set(type, fn); }, send(value) { sent.push(JSON.parse(value)); }, close() {} };
  const client = new P2PMultiSignalingClient({ origin: "https://signal.example", WebSocket: function WebSocket() { return socket; }, now: () => 1 });
  const promotions = [];
  client.on("host-promoted", event => promotions.push(event));
  client.connect({ roomId: body.roomId, role: "guest", slot: 1, secret: body.guestSecrets[0], expiresAt: body.expiresAt });
  listeners.get("open")();
  client.receive(JSON.stringify({ protocolVersion: 2, type: "host-promoted", slot: 1, hostEpoch: 4, connectedSlots: [1, 2] }));
  assert.deepEqual(promotions, [{ slot: 1, hostEpoch: 4, connectedSlots: [1, 2], promoted: true }]);
  assert.equal(client.closed, false);
  assert.deepEqual(client.credentials, { roomId: body.roomId, role: "host", slot: null, secret: body.guestSecrets[0], expiresAt: body.expiresAt });
  client.sendSignal({ description: "offer after promotion" }, { targetSlot: 2 });
  assert.equal(sent.at(-1).targetSlot, 2);
});
