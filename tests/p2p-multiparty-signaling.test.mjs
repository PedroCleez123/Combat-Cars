import test from "node:test";
import assert from "node:assert/strict";
import {
  P2P_MULTI_SIGNAL_PROTOCOL_VERSION,
  P2P_MULTI_ROOM_RETENTION_MS,
  P2PMultiPeerSignalRoomCore,
  createP2PMultiJoinMessage,
  createP2PMultiSignalFrame,
  normalizeP2PMultiRoomRecord,
  normalizeP2PMultiSignalFrame,
} from "../src/p2p-multiparty-signaling.js";

const hostSecret = "h".repeat(43);
const guestSecrets = ["a", "b", "c", "d", "e"].map(letter => letter.repeat(43));
const room = { roomId: "room_0123456789abcdef", hostHash: "a".repeat(64), guestHashes: guestSecrets.map((_, index) => String.fromCharCode(98 + index).repeat(64)), expiresAt: 100_000, mode: "3v3", maxPlayers: 6 };
const digestSecret = async secret => secret === hostSecret ? room.hostHash : guestSecrets.includes(secret) ? room.guestHashes[guestSecrets.indexOf(secret)] : "x".repeat(64);
const join = (role, slot, secret) => JSON.stringify(createP2PMultiJoinMessage({ role, slot, secret }));
const signal = (sequence, targetSlot, payload) => JSON.stringify(createP2PMultiSignalFrame(payload, { sequence, targetSlot }));

test("multi-party room validates a six-player roster and rejects malformed capacities", () => {
  assert.equal(normalizeP2PMultiRoomRecord(room).maxPlayers, 6);
  assert.equal(normalizeP2PMultiRoomRecord({ ...room, guestHashes: guestSecrets.slice(0, 2).map(() => "b".repeat(64)) }), null);
  assert.throws(() => createP2PMultiJoinMessage({ role: "guest", slot: 6, secret: guestSecrets[0] }), TypeError);
  assert.equal(P2P_MULTI_SIGNAL_PROTOCOL_VERSION, 2);
  assert.equal(P2P_MULTI_ROOM_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
});

test("host-star signaling emits the guest slot and routes each signal only to its intended peer", async () => {
  const core = new P2PMultiPeerSignalRoomCore({ room, now: () => 1_000, digestSecret });
  const host = {};
  const guestOne = {};
  const guestTwo = {};
  assert.equal((await core.join(host, join("host", null, hostSecret))).ok, true);
  const first = await core.join(guestOne, join("guest", 1, guestSecrets[0]));
  assert.equal(first.ok, true);
  assert.deepEqual(first.notices.map(notice => JSON.parse(notice.serialized)), [
    { protocolVersion: 2, type: "peer-ready", slot: null },
    { protocolVersion: 2, type: "peer-ready", slot: 1 },
  ]);
  const second = await core.join(guestTwo, join("guest", 2, guestSecrets[1]));
  assert.equal(second.ok, true);
  const toGuestTwo = core.relay(host, signal(1, 2, { description: "offer-2" }));
  assert.equal(toGuestTwo.ok, true);
  assert.equal(toGuestTwo.recipientId, guestTwo);
  assert.deepEqual(toGuestTwo.senderAttachment, { role: "host", slot: null, lastSequence: 1, rateWindowStartedAt: 1000, rateWindowCount: 1 });
  assert.equal("id" in toGuestTwo.senderAttachment, false);
  assert.deepEqual(JSON.parse(toGuestTwo.serialized), { protocolVersion: 2, type: "signal", sequence: 1, targetSlot: 2, sourceSlot: null, payload: JSON.stringify({ description: "offer-2" }) });
  const guestToHost = core.relay(guestOne, signal(1, null, { candidate: 1 }));
  assert.equal(guestToHost.ok, true);
  assert.equal(guestToHost.recipientId, host);
  assert.equal(JSON.parse(guestToHost.serialized).sourceSlot, 1);
  assert.equal(core.relay(guestOne, signal(2, 1, { invalid: true })).ok, false);
  assert.equal((await core.join({}, join("guest", 1, guestSecrets[0]))).ok, false);
});

test("multi-party signal sequences and host departure are fail-closed", async () => {
  const core = new P2PMultiPeerSignalRoomCore({ room, now: () => 1_000, digestSecret });
  const host = {};
  const guest = {};
  await core.join(host, join("host", null, hostSecret));
  await core.join(guest, join("guest", 1, guestSecrets[0]));
  assert.equal(core.relay(host, signal(1, 1, { sdp: 1 })).ok, true);
  assert.equal(core.relay(host, signal(1, 1, { replay: true })).ok, false);
  const departure = core.disconnect(host, { role: "host", slot: null });
  assert.deepEqual(departure.closeIds, [guest]);
  assert.equal(normalizeP2PMultiSignalFrame({ protocolVersion: 2, type: "signal", sequence: 1, targetSlot: 1, sourceSlot: null, payload: "{}" }, { lastSequence: 1 }), null);
});

test("persistent-room signaling promotes the earliest joined guest exactly once", async () => {
  const core = new P2PMultiPeerSignalRoomCore({ room, now: () => 1_000, digestSecret, enableHostFailover: true });
  const host = {};
  const firstGuest = {};
  const secondGuest = {};
  const hostJoin = await core.join(host, join("host", null, hostSecret));
  const firstJoin = await core.join(firstGuest, join("guest", 1, guestSecrets[0]));
  const secondJoin = await core.join(secondGuest, join("guest", 2, guestSecrets[1]));
  assert.equal(hostJoin.ok, true);
  assert.equal(firstJoin.ok, true);
  assert.equal(secondJoin.ok, true);
  assert.equal(firstJoin.attachment.joinOrder < secondJoin.attachment.joinOrder, true);

  const departure = core.disconnect(host, hostJoin.attachment);
  assert.deepEqual(departure.closeIds, []);
  assert.equal(departure.promotedPeerId, firstGuest);
  assert.deepEqual(departure.promotedAttachment, {
    role: "host", slot: null, joinOrder: firstJoin.attachment.joinOrder, hostEpoch: 1,
    lastSequence: 0, rateWindowStartedAt: null, rateWindowCount: 0,
  });
  assert.equal(departure.hostEpoch, 1);
  assert.deepEqual(departure.notices.map(item => JSON.parse(item.serialized)), [
    { protocolVersion: 2, type: "host-promoted", slot: 1, hostEpoch: 1, connectedSlots: [1, 2] },
    { protocolVersion: 2, type: "host-promoted", slot: 1, hostEpoch: 1, connectedSlots: [1, 2] },
  ]);
  assert.equal(core.peers.get("host").id, firstGuest);
  assert.equal(core.peers.get("host").role, "host");
  assert.equal(core.peers.get("guest-2").id, secondGuest);
  assert.equal(core.relay(firstGuest, signal(1, 2, { description: "new-offer" })).recipientId, secondGuest);
  assert.equal(core.relay(secondGuest, signal(1, null, { candidate: 1 })).recipientId, firstGuest);
});
