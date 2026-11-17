import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, { ArsenalSignalRoom, ArsenalMultiSignalRoom } from "../cloudflare/arsenal-signal-worker.mjs";
import {
  SignalRoomCore,
  SIGNAL_RATE_LIMIT_MAX_MESSAGES,
  SIGNAL_RATE_LIMIT_WINDOW_MS,
  SIGNAL_ROOM_TTL_MS,
} from "../src/p2p-signaling-protocol.js";
import { P2P_MULTI_ROOM_RETENTION_MS } from "../src/p2p-multiparty-signaling.js";

const hostSecret = "h".repeat(43);
const guestSecret = "g".repeat(43);
const room = { roomId: "room_0123456789abcdef", hostHash: "a".repeat(64), guestHash: "b".repeat(64), expiresAt: 1_000 + SIGNAL_ROOM_TTL_MS };
const digestSecret = async (secret) => secret === hostSecret ? "a".repeat(64) : secret === guestSecret ? "b".repeat(64) : "c".repeat(64);
const join = (role, secret) => JSON.stringify({ type: "join", role, secret });
const signal = (sequence, payload) => JSON.stringify({ type: "signal", protocolVersion: 1, sequence, payload: JSON.stringify(payload) });

test("Combat Cars deployment config pins the Pages origin and the Durable Object worker", async () => {
  const wrangler = await readFile(new URL("../cloudflare/wrangler.toml", import.meta.url), "utf8");
  assert.match(wrangler, /^name\s*=\s*"combat-cars-signal"$/m);
  assert.match(wrangler, /^main\s*=\s*"arsenal-signal-worker\.mjs"$/m);
  assert.match(wrangler, /^ALLOWED_ORIGINS\s*=\s*"https:\/\/combat-cars\.pages\.dev"$/m);
  assert.match(wrangler, /name = "ARSENAL_SIGNAL_ROOM"/u);
  assert.match(wrangler, /name = "ARSENAL_MULTI_SIGNAL_ROOM"/u);
  assert.match(wrangler, /new_sqlite_classes = \["ArsenalSignalRoom"\]/u);
  assert.match(wrangler, /new_sqlite_classes = \["ArsenalMultiSignalRoom"\]/u);
});

test("room accepts exactly one host and guest and relays opaque payload only to the other peer", async () => {
  const core = new SignalRoomCore({ room, now: () => 1_001, digestSecret });
  const hostSocket = {};
  const guestSocket = {};
  const thirdSocket = {};
  assert.equal((await core.join(hostSocket, join("host", hostSecret))).ok, true);
  assert.equal((await core.join(guestSocket, join("guest", guestSecret))).ok, true);
  assert.equal((await core.join(thirdSocket, join("guest", guestSecret))).ok, false);
  assert.equal((await core.join({}, join("host", hostSecret))).ok, false);
  assert.equal((await core.join(null, join("host", hostSecret))).ok, false);
  const relayed = core.relay(hostSocket, signal(1, { sdp: "opaque offer", candidate: { raw: true } }));
  assert.equal(relayed.ok, true);
  assert.equal(relayed.recipientId, guestSocket);
  assert.deepEqual(JSON.parse(relayed.serialized), { type: "signal", protocolVersion: 1, sequence: 1, payload: JSON.stringify({ sdp: "opaque offer", candidate: { raw: true } }) });
  assert.equal(core.relay(hostSocket, signal(1, { sdp: "replay" })).ok, false);
  assert.equal(core.relay(thirdSocket, signal(1, {})).ok, false);
});

test("room core rehydrates verified roles and sender sequence after hibernation", async () => {
  const beforeHibernate = new SignalRoomCore({ room, now: () => 1_001, digestSecret });
  const hostSocket = { readyState: 1 };
  const guestSocket = { readyState: 1 };
  const host = await beforeHibernate.join(hostSocket, join("host", hostSecret));
  const guest = await beforeHibernate.join(guestSocket, join("guest", guestSecret));
  assert.equal(host.ok && guest.ok, true);
  const first = beforeHibernate.relay(hostSocket, signal(3, { type: "offer" }));
  assert.equal(first.ok, true);
  const afterHibernate = new SignalRoomCore({ room, now: () => 1_002, digestSecret }).rehydrate([
    { id: hostSocket, attachment: first.senderAttachment },
    { id: guestSocket, attachment: guest.attachment },
  ]);
  assert.equal(afterHibernate.relay(hostSocket, signal(3, { type: "replay" })).ok, false);
  assert.equal(afterHibernate.relay(hostSocket, signal(4, { type: "candidate" })).recipientId, guestSocket);
});

test("signal relay quota rejects floods, renews after its window, and survives hibernation", async () => {
  let now = 2_000;
  const hostSocket = {};
  const guestSocket = {};
  const beforeHibernate = new SignalRoomCore({ room, now: () => now, digestSecret });
  const host = await beforeHibernate.join(hostSocket, join("host", hostSecret));
  const guest = await beforeHibernate.join(guestSocket, join("guest", guestSecret));
  let senderAttachment;
  for (let sequence = 1; sequence <= SIGNAL_RATE_LIMIT_MAX_MESSAGES; sequence += 1) {
    const result = beforeHibernate.relay(hostSocket, signal(sequence, { candidate: sequence }));
    assert.equal(result.ok, true);
    senderAttachment = result.senderAttachment;
  }
  assert.equal(beforeHibernate.relay(hostSocket, signal(SIGNAL_RATE_LIMIT_MAX_MESSAGES + 1, { candidate: "flood" })).ok, false);

  const afterHibernate = new SignalRoomCore({ room, now: () => now, digestSecret }).rehydrate([
    { id: hostSocket, attachment: senderAttachment },
    { id: guestSocket, attachment: guest.attachment },
  ]);
  const blocked = afterHibernate.relay(hostSocket, signal(SIGNAL_RATE_LIMIT_MAX_MESSAGES + 1, { candidate: "must not reset" }));
  assert.deepEqual(blocked, { ok: false, code: 1008, reason: "Signaling rate limit exceeded." });

  now += SIGNAL_RATE_LIMIT_WINDOW_MS;
  const renewed = afterHibernate.relay(hostSocket, signal(SIGNAL_RATE_LIMIT_MAX_MESSAGES + 1, { candidate: "next window" }));
  assert.equal(renewed.ok, true);
  assert.deepEqual(renewed.senderAttachment, {
    role: "host",
    lastSequence: SIGNAL_RATE_LIMIT_MAX_MESSAGES + 1,
    rateWindowStartedAt: now,
    rateWindowCount: 1,
  });
});

test("peer-ready is emitted only when the second peer joins and contains only complementary roles", async () => {
  const core = new SignalRoomCore({ room, now: () => 1_001, digestSecret });
  const hostSocket = { opaque: "host transport" };
  const guestSocket = { opaque: "guest transport" };
  const host = await core.join(hostSocket, join("host", hostSecret));
  assert.deepEqual(host.notices, []);

  const guest = await core.join(guestSocket, join("guest", guestSecret));
  assert.deepEqual(guest.notices, [
    { recipientId: guestSocket, serialized: JSON.stringify({ type: "peer-ready", protocolVersion: 1, role: "host" }) },
    { recipientId: hostSocket, serialized: JSON.stringify({ type: "peer-ready", protocolVersion: 1, role: "guest" }) },
  ]);
  for (const notice of guest.notices) {
    assert.deepEqual(Object.keys(JSON.parse(notice.serialized)).sort(), ["protocolVersion", "role", "type"]);
    assert.equal(notice.serialized.includes("opaque"), false);
    assert.equal(notice.serialized.includes(hostSecret), false);
    assert.equal(notice.serialized.includes(guestSecret), false);
  }
});

test("rehydrating connected peers does not re-emit peer-ready, while a guest reconnect does", async () => {
  const core = new SignalRoomCore({ room, now: () => 1_001, digestSecret });
  const hostSocket = { opaque: "host" };
  const firstGuestSocket = { opaque: "guest first connection" };
  const host = await core.join(hostSocket, join("host", hostSecret));
  const guest = await core.join(firstGuestSocket, join("guest", guestSecret));
  const rehydrated = new SignalRoomCore({ room, now: () => 1_002, digestSecret }).rehydrate([
    { id: hostSocket, attachment: host.attachment },
    { id: firstGuestSocket, attachment: guest.attachment },
  ]);
  assert.equal(rehydrated.peers.size, 2);
  assert.equal((await rehydrated.join({ opaque: "duplicate" }, join("guest", guestSecret))).ok, false);

  rehydrated.disconnect(firstGuestSocket, guest.attachment);
  const reconnectedGuestSocket = { opaque: "guest reconnect" };
  const reconnected = await rehydrated.join(reconnectedGuestSocket, join("guest", guestSecret));
  assert.deepEqual(reconnected.notices, [
    { recipientId: reconnectedGuestSocket, serialized: JSON.stringify({ type: "peer-ready", protocolVersion: 1, role: "host" }) },
    { recipientId: hostSocket, serialized: JSON.stringify({ type: "peer-ready", protocolVersion: 1, role: "guest" }) },
  ]);
});

test("worker persists the joining attachment before best-effort peer-ready delivery", async () => {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const storedRoom = { ...room, hostHash: hash(hostSecret), guestHash: hash(guestSecret), expiresAt: Date.now() + SIGNAL_ROOM_TTL_MS };
  const guestSocket = {
    attachment: { role: "guest", lastSequence: 0 },
    deserializeAttachment() { return this.attachment; },
    serializeAttachment(value) { this.attachment = value; },
    send() { throw new Error("Guest socket disappeared before the best-effort send."); },
    close() {},
  };
  const hostSocket = {
    attachment: { role: null, lastSequence: 0 },
    deserializeAttachment() { return this.attachment; },
    serializeAttachment(value) { this.attachment = value; },
    send(serialized) {
      assert.deepEqual(this.attachment, { role: "host", lastSequence: 0 });
      this.sent = JSON.parse(serialized);
    },
    close() {},
  };
  let getSocketsCalls = 0;
  const ctx = {
    storage: { sql: { exec(query) { return query.startsWith("SELECT") ? { toArray: () => [{
      room_id: storedRoom.roomId,
      host_hash: storedRoom.hostHash,
      guest_hash: storedRoom.guestHash,
      expires_at: storedRoom.expiresAt,
    }] } : { toArray: () => [] }; } } },
    getWebSockets() { getSocketsCalls += 1; return getSocketsCalls < 3 ? [hostSocket, guestSocket] : [hostSocket]; },
  };
  const durableObject = new ArsenalSignalRoom(ctx, {});
  await durableObject.webSocketMessage(hostSocket, join("host", hostSecret));
  assert.deepEqual(hostSocket.attachment, { role: "host", lastSequence: 0 });
  assert.deepEqual(hostSocket.sent, { type: "peer-ready", protocolVersion: 1, role: "guest" });
});

test("worker closes a socket that exceeds the persisted per-connection signal quota", async () => {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const storedRoom = { ...room, hostHash: hash(hostSecret), guestHash: hash(guestSecret), expiresAt: Date.now() + SIGNAL_ROOM_TTL_MS };
  const makeSocket = (attachment) => ({
    attachment,
    sent: [],
    closes: [],
    deserializeAttachment() { return this.attachment; },
    serializeAttachment(value) { this.attachment = value; },
    send(serialized) { this.sent.push(serialized); },
    close(code, reason) { this.closes.push({ code, reason }); },
  });
  const hostSocket = makeSocket({ role: "host", lastSequence: 0 });
  const guestSocket = makeSocket({ role: "guest", lastSequence: 0 });
  const ctx = {
    storage: { sql: { exec(query) { return query.startsWith("SELECT") ? { toArray: () => [{
      room_id: storedRoom.roomId,
      host_hash: storedRoom.hostHash,
      guest_hash: storedRoom.guestHash,
      expires_at: storedRoom.expiresAt,
    }] } : { toArray: () => [] }; } } },
    getWebSockets() { return [hostSocket, guestSocket]; },
  };
  const durableObject = new ArsenalSignalRoom(ctx, {});
  for (let sequence = 1; sequence <= SIGNAL_RATE_LIMIT_MAX_MESSAGES; sequence += 1) {
    await durableObject.webSocketMessage(hostSocket, signal(sequence, { candidate: sequence }));
  }
  await durableObject.webSocketMessage(hostSocket, signal(SIGNAL_RATE_LIMIT_MAX_MESSAGES + 1, { candidate: "flood" }));
  assert.deepEqual(hostSocket.closes, [{ code: 1008, reason: "Signaling rate limit exceeded." }]);
  assert.equal(hostSocket.closes[0].reason.includes("flood"), false);
  assert.equal(guestSocket.sent.length, SIGNAL_RATE_LIMIT_MAX_MESSAGES);
});

test("multi-party worker promotes the earliest guest, rotates its old slot hash and persists the epoch", () => {
  const stored = {
    room_id: "room_0123456789abcdef",
    host_hash: "a".repeat(64),
    guest_hashes: JSON.stringify(["b".repeat(64), "c".repeat(64), "d".repeat(64)]),
    guest_reservations: "{}",
    expires_at: Date.now() + SIGNAL_ROOM_TTL_MS,
    mode: "2v2",
    max_players: 4,
    host_epoch: 0,
  };
  const makeSocket = attachment => ({
    attachment,
    sent: [],
    deserializeAttachment() { return this.attachment; },
    serializeAttachment(value) { this.attachment = value; },
    send(serialized) { this.sent.push(JSON.parse(serialized)); },
    close() {},
  });
  const hostSocket = makeSocket({ role: "host", slot: null, joinOrder: 0, hostEpoch: 0, lastSequence: 0, rateWindowStartedAt: null, rateWindowCount: 0 });
  const earliestGuest = makeSocket({ role: "guest", slot: 1, joinOrder: 1, hostEpoch: 0, lastSequence: 0, rateWindowStartedAt: null, rateWindowCount: 0 });
  const laterGuest = makeSocket({ role: "guest", slot: 2, joinOrder: 2, hostEpoch: 0, lastSequence: 0, rateWindowStartedAt: null, rateWindowCount: 0 });
  const sql = {
    exec(query, ...args) {
      if (query.startsWith("PRAGMA") || query.startsWith("CREATE TABLE") || query.startsWith("ALTER TABLE")) return { toArray: () => [] };
      if (query.startsWith("SELECT guest_reservations")) return { toArray: () => [{ guest_reservations: stored.guest_reservations }] };
      if (query.startsWith("SELECT room_id")) return { toArray: () => [stored] };
      if (query.startsWith("UPDATE multi_room SET host_hash")) {
        [stored.host_hash, stored.guest_hashes, stored.host_epoch] = args;
        return { toArray: () => [] };
      }
      return { toArray: () => [] };
    },
  };
  const ctx = { storage: { sql }, getWebSockets: () => [hostSocket, earliestGuest, laterGuest] };
  const durableObject = new ArsenalMultiSignalRoom(ctx, {});
  durableObject.disconnect(hostSocket);

  assert.equal(earliestGuest.attachment.role, "host");
  assert.equal(earliestGuest.attachment.slot, null);
  assert.equal(earliestGuest.attachment.hostEpoch, 1);
  assert.equal(stored.host_hash, "b".repeat(64));
  const rotated = JSON.parse(stored.guest_hashes);
  assert.equal(rotated[0].length, 64);
  assert.notEqual(rotated[0], "b".repeat(64));
  assert.equal(stored.host_epoch, 1);
  assert.deepEqual(earliestGuest.sent.at(-1), { protocolVersion: 2, type: "host-promoted", slot: 1, hostEpoch: 1, connectedSlots: [1, 2] });
  assert.deepEqual(laterGuest.sent.at(-1), { protocolVersion: 2, type: "host-promoted", slot: 1, hostEpoch: 1, connectedSlots: [1, 2] });
});

test("room expiration rejects new joins and signaling", async () => {
  const core = new SignalRoomCore({ room, now: () => room.expiresAt, digestSecret });
  assert.equal((await core.join("host-socket", join("host", hostSecret))).ok, false);
  assert.equal(core.relay("host-socket", signal(1, { type: "offer" })).ok, false);
});

test("host departure ends guest session while guest departure only notifies host", async () => {
  const core = new SignalRoomCore({ room, now: () => 1_001, digestSecret });
  const hostSocket = {};
  const guestSocket = {};
  await core.join(hostSocket, join("host", hostSecret));
  await core.join(guestSocket, join("guest", guestSecret));
  const guestExit = core.disconnect(guestSocket, { role: "guest", lastSequence: 0 });
  assert.equal(guestExit.notices[0].recipientId, hostSocket);
  assert.deepEqual(JSON.parse(guestExit.notices[0].serialized), { type: "guest-left", protocolVersion: 1 });
  assert.deepEqual(guestExit.closeIds, []);

  const freshCore = new SignalRoomCore({ room, now: () => 1_001, digestSecret });
  const freshHostSocket = {};
  const freshGuestSocket = {};
  await freshCore.join(freshHostSocket, join("host", hostSecret));
  await freshCore.join(freshGuestSocket, join("guest", guestSecret));
  const hostExit = freshCore.disconnect(freshHostSocket, { role: "host", lastSequence: 0 });
  assert.equal(hostExit.notices[0].recipientId, freshGuestSocket);
  assert.deepEqual(JSON.parse(hostExit.notices[0].serialized), { type: "host-left", protocolVersion: 1 });
  assert.deepEqual(hostExit.closeIds, [freshGuestSocket]);
});

test("Worker CORS preflight is exact, route scoped, and fail closed", async () => {
  const preflight = (origin, path = "/v1/rooms", headers = "content-type") => worker.fetch(new Request(`https://signal.example${path}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": headers,
    },
  }), { ALLOWED_ORIGINS: "https://arsenal.example" });

  const allowed = await preflight("https://arsenal.example");
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://arsenal.example");
  assert.equal(allowed.headers.get("access-control-allow-methods"), "POST");
  assert.equal(allowed.headers.get("access-control-allow-headers"), "Content-Type");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
  assert.equal(allowed.headers.get("vary"), "Origin");

  const forbidden = await preflight("https://evil.example");
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("access-control-allow-origin"), null);
  const unknownRoute = await preflight("https://arsenal.example", "/v1/rooms/room_0123456789abcdef/signal");
  assert.equal(unknownRoute.status, 404);
  assert.equal(unknownRoute.headers.get("access-control-allow-origin"), null);
  const forbiddenHeader = await preflight("https://arsenal.example", "/v1/rooms", "content-type, authorization");
  assert.equal(forbiddenHeader.status, 400);
  assert.equal(forbiddenHeader.headers.get("access-control-allow-origin"), null);
  const closed = await worker.fetch(new Request("https://signal.example/v1/rooms", {
    method: "OPTIONS",
    headers: { origin: "https://arsenal.example", "access-control-request-method": "POST" },
  }), { ALLOWED_ORIGINS: "" });
  assert.equal(closed.status, 403);
  assert.equal(closed.headers.get("access-control-allow-origin"), null);
});

test("Worker create-room endpoint uses the real contract and never exposes internal hashes", async () => {
  const internalCalls = [];
  const stub = {
    async fetch(request) {
      internalCalls.push({ url: request.url, body: await request.json() });
      return new Response(null, { status: 201 });
    },
  };
  const namespace = {
    idFromName(roomId) {
      assert.match(roomId, /^[A-Za-z0-9_-]{1,64}$/u);
      return { roomId };
    },
    get(id) {
      assert.equal(id.roomId, internalCalls[0]?.body.roomId ?? id.roomId);
      return stub;
    },
  };
  const origin = "https://arsenal.example";
  const response = await worker.fetch(new Request("https://signal.example/v1/rooms", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}",
  }), { ALLOWED_ORIGINS: origin, ARSENAL_SIGNAL_ROOM: namespace });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["expiresAt", "guestSecret", "hostSecret", "roomCode", "roomId"]);
  assert.equal(result.roomId, result.roomCode);
  assert.match(result.roomCode, /^[0-9A-HJKMNP-TV-Z]{10}$/u);
  assert.match(result.hostSecret, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(result.guestSecret, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(result.hostSecret, result.guestSecret);
  assert.equal(internalCalls.length, 1);
  assert.deepEqual(Object.keys(internalCalls[0].body).sort(), ["expiresAt", "guestHash", "hostHash", "roomId"]);
  assert.match(internalCalls[0].body.hostHash, /^[a-f0-9]{64}$/u);
  assert.match(internalCalls[0].body.guestHash, /^[a-f0-9]{64}$/u);
  assert.notEqual(internalCalls[0].body.hostHash, result.hostSecret);
  assert.notEqual(internalCalls[0].body.guestHash, result.guestSecret);

  const forbidden = await worker.fetch(new Request("https://signal.example/v1/rooms", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: "{}",
  }), { ALLOWED_ORIGINS: origin, ARSENAL_SIGNAL_ROOM: namespace });
  assert.equal(forbidden.status, 403);
  assert.equal(await forbidden.text(), JSON.stringify({ error: "Origin not allowed." }));
});

test("v2 worker creates bounded slot credentials without altering the deployed v1 contract", async () => {
  const before = Date.now();
  const calls = [];
  const stub = { async fetch(request) { calls.push(await request.json()); return new Response(null, { status: 201 }); } };
  const namespace = { idFromName(roomId) { return { roomId }; }, get() { return stub; } };
  const origin = "https://arsenal.example";
  const response = await worker.fetch(new Request("https://signal.example/v2/rooms", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ mode: "ffa", maxPlayers: 3 }),
  }), { ALLOWED_ORIGINS: origin, ARSENAL_MULTI_SIGNAL_ROOM: namespace });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["expiresAt", "guestSecrets", "hostSecret", "maxPlayers", "mode", "roomCode", "roomId"]);
  assert.equal(body.roomCode, body.roomId);
  assert.match(body.roomCode, /^[0-9A-HJKMNP-TV-Z]{10}$/u);
  assert.equal(body.mode, "ffa");
  assert.equal(body.maxPlayers, 3);
  assert.equal(body.guestSecrets.length, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["expiresAt", "guestHashes", "hostHash", "maxPlayers", "mode", "roomId"]);
  assert.equal(calls[0].guestHashes.length, 2);
  assert.equal(calls[0].expiresAt >= before + P2P_MULTI_ROOM_RETENTION_MS, true);
  assert.equal(calls[0].expiresAt <= Date.now() + P2P_MULTI_ROOM_RETENTION_MS + 1000, true);
  assert.equal(JSON.stringify(body).includes(calls[0].hostHash), false);
  assert.equal(JSON.stringify(body).includes(calls[0].guestHashes[0]), false);

  const invalid = await worker.fetch(new Request("https://signal.example/v2/rooms", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ mode: "2v2", maxPlayers: 3 }),
  }), { ALLOWED_ORIGINS: origin, ARSENAL_MULTI_SIGNAL_ROOM: namespace });
  assert.equal(invalid.status, 400);
});

test("v2 worker creates a persistent room-open record before the host selects a mode", async () => {
  const calls = [];
  const stub = { async fetch(request) { calls.push(await request.json()); return new Response(null, { status: 201 }); } };
  const namespace = { idFromName(roomId) { return { roomId }; }, get() { return stub; } };
  const origin = "https://arsenal.example";
  const response = await worker.fetch(new Request("https://signal.example/v2/rooms", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}",
  }), { ALLOWED_ORIGINS: origin, ARSENAL_MULTI_SIGNAL_ROOM: namespace });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.phase, "room-open");
  assert.equal(body.mode, null);
  assert.equal(body.maxPlayers, 6);
  assert.equal(body.guestSecrets.length, 5);
  assert.equal(calls[0].mode, null);
  assert.equal(calls[0].maxPlayers, 6);
});

test("v2 worker lets only the host configure a room-open record", async () => {
  const calls = [];
  const stub = { async fetch(request) { calls.push(await request.json()); return new Response(JSON.stringify({ roomId: "0123456789", expiresAt: Date.now() + P2P_MULTI_ROOM_RETENTION_MS, mode: "2v2", maxPlayers: 4 }), { status: 200 }); } };
  const namespace = { idFromName(roomId) { assert.equal(roomId, "0123456789"); return { roomId }; }, get() { return stub; } };
  const origin = "https://arsenal.example";
  const response = await worker.fetch(new Request("https://signal.example/v2/rooms/configure", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ roomCode: "0123456789", hostSecret: "h".repeat(43), mode: "2v2", maxPlayers: 4 }),
  }), { ALLOWED_ORIGINS: origin, ARSENAL_MULTI_SIGNAL_ROOM: namespace });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { roomCode: "0123456789", roomId: "0123456789", expiresAt: body.expiresAt, mode: "2v2", maxPlayers: 4, phase: "team-selection" });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["hostHash", "maxPlayers", "mode", "roomCode"]);
  assert.notEqual(calls[0].hostHash, "h".repeat(43));
});

test("v2 worker lets a promoted host reset the same key to room-open", async () => {
  const calls = [];
  const stub = { async fetch(request) {
    const input = await request.json(); calls.push(input);
    return new Response(JSON.stringify({ roomId: "0123456789", expiresAt: Date.now() + P2P_MULTI_ROOM_RETENTION_MS, mode: null, maxPlayers: 6 }), { status: 200 });
  } };
  const namespace = { idFromName(roomId) { assert.equal(roomId, "0123456789"); return { roomId }; }, get() { return stub; } };
  const origin = "https://arsenal.example";
  const response = await worker.fetch(new Request("https://signal.example/v2/rooms/configure", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ roomCode: "0123456789", hostSecret: "h".repeat(43), mode: null, maxPlayers: 6 }),
  }), { ALLOWED_ORIGINS: origin, ARSENAL_MULTI_SIGNAL_ROOM: namespace });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { roomCode: "0123456789", roomId: "0123456789", expiresAt: body.expiresAt, mode: null, maxPlayers: 6, phase: "room-open" });
  assert.deepEqual({ ...calls[0], hostHash: typeof calls[0].hostHash }, { roomCode: "0123456789", hostHash: "string", mode: null, maxPlayers: 6 });
});

test("multi-party Durable Object keeps every persistent slot while the host changes mode", async () => {
  const host = "h".repeat(43);
  const hostHash = createHash("sha256").update(host).digest("hex");
  const stored = {
    room_id: "0123456789", host_hash: hostHash,
    guest_hashes: JSON.stringify(["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64), "e".repeat(64)]),
    guest_reservations: "{}", guest_tickets: "{}", expires_at: Date.now() + P2P_MULTI_ROOM_RETENTION_MS,
    mode: "room-open", max_players: 6, host_epoch: 0,
  };
  const sql = {
    exec(query, ...args) {
      if (query.startsWith("CREATE TABLE") || query.startsWith("PRAGMA") || query.startsWith("ALTER TABLE")) return { toArray: () => [] };
      if (query.startsWith("SELECT guest_reservations")) return { toArray: () => [{ guest_reservations: stored.guest_reservations }] };
      if (query.startsWith("SELECT guest_tickets")) return { toArray: () => [{ guest_tickets: stored.guest_tickets }] };
      if (query.startsWith("SELECT room_id")) return { toArray: () => [stored] };
      if (query.startsWith("UPDATE multi_room SET guest_hashes")) { [stored.guest_hashes, stored.mode, stored.max_players] = args; return { toArray: () => [] }; }
      return { toArray: () => [] };
    },
  };
  const durableObject = new ArsenalMultiSignalRoom({ storage: { sql }, getWebSockets: () => [] }, {});
  const response = await durableObject.configureRoom(new Request("https://signal-room.internal/_internal/configure", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode: "0123456789", hostHash, mode: "2v2", maxPlayers: 4 }),
  }));
  assert.equal(response.status, 200);
  assert.equal(stored.mode, "2v2");
  assert.equal(stored.max_players, 4);
  assert.equal(JSON.parse(stored.guest_hashes).length, 5);

  const second = await durableObject.configureRoom(new Request("https://signal-room.internal/_internal/configure", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode: "0123456789", hostHash, mode: "ffa", maxPlayers: 6 }),
  }));
  assert.equal(second.status, 200);
  assert.equal(stored.mode, "ffa");
  assert.equal(stored.max_players, 6);
  assert.equal(JSON.parse(stored.guest_hashes).length, 5);

  const reset = await durableObject.configureRoom(new Request("https://signal-room.internal/_internal/configure", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode: "0123456789", hostHash, mode: null, maxPlayers: 6 }),
  }));
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { roomId: "0123456789", expiresAt: stored.expires_at, mode: null, maxPlayers: 6 });
  assert.equal(stored.mode, "room-open");
  assert.equal(stored.max_players, 6);
  assert.equal(JSON.parse(stored.guest_hashes).length, 5);
});

test("v2 worker resolves a short room code to the first free guest slot", async () => {
  const calls = [];
  const stub = { async fetch(request) { calls.push({ url: request.url, body: await request.json() }); return new Response(JSON.stringify({ roomId: calls[0].body.roomCode, expiresAt: Date.now() + SIGNAL_ROOM_TTL_MS, mode: "2v2", maxPlayers: 4, slot: 1 }), { status: 200 }); } };
  const namespace = { idFromName(roomId) { assert.match(roomId, /^[0-9A-HJKMNP-TV-Z]{10}$/u); return { roomId }; }, get() { return stub; } };
  const origin = "https://arsenal.example";
  const response = await worker.fetch(new Request("https://signal.example/v2/rooms/join", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ roomCode: "0123456789", mode: "2v2" }),
  }), { ALLOWED_ORIGINS: origin, ARSENAL_MULTI_SIGNAL_ROOM: namespace });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["expiresAt", "guestSecret", "maxPlayers", "mode", "roomCode", "roomId", "slot"]);
  assert.equal(body.roomCode, "0123456789");
  assert.equal(body.slot, 1);
  assert.match(body.guestSecret, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(JSON.stringify(calls[0].body).includes(body.guestSecret), false);
});

test("v2 persistent opt-in returns a participant reconnect ticket without changing legacy joins", async () => {
  const calls = [];
  const stub = {
    async fetch(request) {
      calls.push(await request.json());
      return new Response(JSON.stringify({ roomId: calls[0].roomCode, expiresAt: Date.now() + SIGNAL_ROOM_TTL_MS, mode: "2v2", maxPlayers: 4, slot: 1 }), { status: 200 });
    },
  };
  const namespace = { idFromName(roomId) { return { roomId }; }, get() { return stub; } };
  const origin = "https://arsenal.example";
  const response = await worker.fetch(new Request("https://signal.example/v2/rooms/join", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ roomCode: "0123456789", persistent: true }),
  }), { ALLOWED_ORIGINS: origin, ARSENAL_MULTI_SIGNAL_ROOM: namespace });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.participantId, /^[A-Za-z0-9_-]{16,64}$/u);
  assert.match(body.reconnectToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(calls[0].ticketHash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(calls[0]).includes(body.reconnectToken), false);
});

test("multi-party Durable Object reserves a reconnect ticket for its original slot during the grace window", async () => {
  const now = Date.now();
  const stored = {
    room_id: "0123456789",
    host_hash: "a".repeat(64),
    guest_hashes: JSON.stringify(["b".repeat(64), "c".repeat(64), "d".repeat(64)]),
    guest_reservations: "{}",
    guest_tickets: "{}",
    expires_at: now + SIGNAL_ROOM_TTL_MS,
    mode: "2v2",
    max_players: 4,
    host_epoch: 0,
  };
  const sql = {
    exec(query, ...args) {
      if (query.startsWith("CREATE TABLE") || query.startsWith("PRAGMA") || query.startsWith("ALTER TABLE")) return { toArray: () => [] };
      if (query.startsWith("SELECT guest_reservations")) return { toArray: () => [{ guest_reservations: stored.guest_reservations }] };
      if (query.startsWith("SELECT guest_tickets")) return { toArray: () => [{ guest_tickets: stored.guest_tickets }] };
      if (query.startsWith("SELECT room_id")) return { toArray: () => [stored] };
      if (query.startsWith("UPDATE multi_room SET guest_tickets")) { [stored.guest_tickets] = args; return { toArray: () => [] }; }
      if (query.startsWith("UPDATE multi_room SET guest_reservations")) { [stored.guest_reservations] = args; return { toArray: () => [] }; }
      if (query.startsWith("UPDATE multi_room SET guest_hashes")) { [stored.guest_hashes, stored.guest_reservations] = args; return { toArray: () => [] }; }
      return { toArray: () => [] };
    },
  };
  const ctx = { storage: { sql }, getWebSockets: () => [] };
  const durableObject = new ArsenalMultiSignalRoom(ctx, {});
  const participantId = "participant_0123456789";
  const ticketHash = "e".repeat(64);
  const redeem = async ({ participant = participantId, ticket = ticketHash, hash = "f".repeat(64) } = {}) => durableObject.redeemGuest(new Request("https://signal-room.internal/_internal/redeem-guest", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomCode: "0123456789", guestHash: hash, mode: "2v2", participantId: participant, ticketHash: ticket, reservationUntil: Date.now() + 40_000 }),
  }));

  const first = await redeem();
  assert.equal(first.status, 200);
  assert.equal((await first.json()).slot, 1);
  // A failed ICE/WebRTC attempt can be retried before the original 45-second
  // reservation expires. The same participant ticket must refresh its own
  // reservation instead of being reported as a full room.
  const immediateRetry = await redeem({ hash: "0".repeat(64) });
  assert.equal(immediateRetry.status, 200);
  assert.equal((await immediateRetry.json()).slot, 1);
  durableObject.clearGuestReservation(1);
  durableObject.activateGuestTicket(1);
  durableObject.markGuestDisconnected(1);

  const sameParticipant = await redeem({ hash: "1".repeat(64) });
  assert.equal(sameParticipant.status, 200);
  assert.equal((await sameParticipant.json()).slot, 1);
  const wrongTicket = await redeem({ ticket: "2".repeat(64) });
  assert.equal(wrongTicket.status, 409);
  durableObject.clearGuestReservation(1);
  const newcomer = await redeem({ participant: "participant_abcdefghij", ticket: "3".repeat(64), hash: "4".repeat(64) });
  assert.equal(newcomer.status, 200);
  assert.equal((await newcomer.json()).slot, 2);
});
