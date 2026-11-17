import test from "node:test";
import assert from "node:assert/strict";
import {
  P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY,
  P2P_PERSISTENT_GUEST_ROOM_STORAGE_KEY,
  clearP2PPersistentHostRoom,
  clearP2PPersistentGuestRoom,
  loadP2PPersistentHostRoom,
  loadP2PPersistentGuestRoom,
  saveP2PPersistentHostRoom,
  saveP2PPersistentGuestRoom,
} from "../src/p2p-persistent-room-storage.js";

const hostRoom = Object.freeze({
  roomCode: "0123456789", roomId: "0123456789", hostSecret: "h".repeat(43),
  expiresAt: 7 * 24 * 60 * 60 * 1000, mode: "2v2", maxPlayers: 4,
});
const guestRoom = Object.freeze({
  roomCode: "0123456789", roomId: "0123456789", participantId: "participant_0123456789",
  reconnectToken: "r".repeat(43), expiresAt: 7 * 24 * 60 * 60 * 1000, mode: "2v2", maxPlayers: 4,
});

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

test("persistent owner storage restores the same private room identity after reload", () => {
  const local = storage();
  assert.equal(saveP2PPersistentHostRoom(hostRoom, { storage: local, now: 1 }), true);
  assert.deepEqual(loadP2PPersistentHostRoom({ storage: local, now: 1 }), hostRoom);
  assert.equal(clearP2PPersistentHostRoom({ storage: local }), true);
  assert.equal(local.getItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY), null);
});

test("persistent owner storage rejects and removes expired or malformed credentials", () => {
  const local = storage();
  local.setItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY, JSON.stringify({ ...hostRoom, expiresAt: 1 }));
  assert.equal(loadP2PPersistentHostRoom({ storage: local, now: 1 }), null);
  assert.equal(local.getItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY), null);
  local.setItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY, "{bad");
  assert.equal(loadP2PPersistentHostRoom({ storage: local, now: 1 }), null);
});

test("persistent owner storage does not write an invalid record", () => {
  const local = storage();
  assert.equal(saveP2PPersistentHostRoom({ ...hostRoom, hostSecret: "not-a-secret" }, { storage: local, now: 1 }), false);
  assert.equal(local.getItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY), null);
});

test("persistent guest storage keeps a reconnect ticket separate from the public room key", () => {
  const local = storage();
  assert.equal(saveP2PPersistentGuestRoom(guestRoom, { storage: local, now: 1 }), true);
  assert.deepEqual(loadP2PPersistentGuestRoom({ storage: local, now: 1 }), guestRoom);
  assert.equal(clearP2PPersistentGuestRoom({ storage: local }), true);
  assert.equal(local.getItem(P2P_PERSISTENT_GUEST_ROOM_STORAGE_KEY), null);
});
