import assert from "node:assert/strict";
import test from "node:test";

import { P2PSignalingClient } from "../src/p2p-signaling-client.js";
import { SignalRoomCore } from "../src/p2p-signaling-protocol.js";

const ORIGIN = "https://signal.example";
const roomId = "room_0123456789abcdef";
const hostSecret = "h".repeat(43);
const guestSecret = "g".repeat(43);
const room = {
  roomId,
  hostHash: "a".repeat(64),
  guestHash: "b".repeat(64),
  expiresAt: 200_000,
};

function manualScheduler() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(callback) {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    runAll() {
      for (const [id, callback] of [...timers]) {
        if (!timers.delete(id)) continue;
        callback();
      }
    },
  };
}

class MemorySignalingRoom {
  constructor({ now }) {
    this.now = now;
    this.core = new SignalRoomCore({
      room,
      now,
      digestSecret: async (secret) => secret === hostSecret
        ? room.hostHash
        : secret === guestSecret ? room.guestHash : "c".repeat(64),
    });
    this.sockets = [];
    this.active = new Map();
    this.pending = [];
    this.deliveredSignals = [];
  }

  createWebSocketConstructor() {
    const roomForSocket = this;
    return class MemoryWebSocket {
      constructor(url) {
        this.url = url;
        this.room = roomForSocket;
        this.peerId = {};
        this.attachment = null;
        this.readyState = 0;
        this.listeners = new Map();
        this.closeArgs = null;
        this.room.sockets.push(this);
        this.room.active.set(this.peerId, this);
      }

      addEventListener(type, callback) {
        const callbacks = this.listeners.get(type) || [];
        callbacks.push(callback);
        this.listeners.set(type, callbacks);
      }

      fire(type, event = {}) {
        for (const callback of this.listeners.get(type) || []) callback(event);
      }

      open() {
        this.readyState = 1;
        this.fire("open");
      }

      send(serialized) {
        if (this.readyState !== 1) throw new Error("Socket is not open.");
        const message = JSON.parse(serialized);
        if (message.type === "join") {
          this.room.pending.push(this.room.join(this, serialized));
          return;
        }
        this.room.relay(this, serialized);
      }

      close(code, reason) {
        if (this.readyState >= 2) return;
        this.closeArgs = [code, reason];
        this.readyState = 2;
        this.room.disconnect(this);
        this.readyState = 3;
        this.fire("close");
      }

      serverSend(serialized) {
        if (this.readyState === 1) this.fire("message", { data: serialized });
      }
    };
  }

  async join(socket, serialized) {
    const result = await this.core.join(socket.peerId, serialized);
    if (!result.ok) {
      socket.close(result.code, result.reason);
      return;
    }
    socket.attachment = result.attachment;
    for (const notice of result.notices) this.deliver(notice.recipientId, notice.serialized);
  }

  relay(socket, serialized) {
    const result = this.core.relay(socket.peerId, serialized);
    if (!result.ok) return result;
    socket.attachment = result.senderAttachment;
    this.deliveredSignals.push(result.serialized);
    this.deliver(result.recipientId, result.serialized);
    return result;
  }

  disconnect(socket) {
    if (!this.active.has(socket.peerId)) return;
    const result = this.core.disconnect(socket.peerId, socket.attachment);
    this.active.delete(socket.peerId);
    for (const notice of result.notices) this.deliver(notice.recipientId, notice.serialized);
    for (const peerId of result.closeIds) this.active.get(peerId)?.close(1000, "Host left.");
  }

  deliver(peerId, serialized) {
    this.active.get(peerId)?.serverSend(serialized);
  }

  async drain() {
    while (this.pending.length) await this.pending.shift();
  }
}

test("causal room contract relays, explicitly reconnects a guest at sequence 1, and expires closed", async () => {
  let now = 100_000;
  const roomTransport = new MemorySignalingRoom({ now: () => now });
  const WebSocket = roomTransport.createWebSocketConstructor();
  const hostScheduler = manualScheduler();
  const guestScheduler = manualScheduler();
  const host = new P2PSignalingClient({ origin: ORIGIN, WebSocket, now: () => now, scheduler: hostScheduler });
  const guest = new P2PSignalingClient({ origin: ORIGIN, WebSocket, now: () => now, scheduler: guestScheduler });
  const hostSignals = [];
  const guestSignals = [];
  const hostPeerLeft = [];
  const hostReady = [];
  const guestReady = [];
  const hostClosed = [];
  const guestClosed = [];
  host.on("signal", (event) => hostSignals.push(event));
  guest.on("signal", (event) => guestSignals.push(event));
  host.on("peer-left", (event) => hostPeerLeft.push(event));
  host.on("peer-ready", (event) => hostReady.push(event));
  guest.on("peer-ready", (event) => guestReady.push(event));
  host.on("closed", (event) => hostClosed.push(event));
  guest.on("closed", (event) => guestClosed.push(event));

  const credentials = { roomId, expiresAt: room.expiresAt };
  host.connect({ ...credentials, role: "host", secret: hostSecret });
  guest.connect({ ...credentials, role: "guest", secret: guestSecret });
  roomTransport.sockets[0].open();
  roomTransport.sockets[1].open();
  await roomTransport.drain();

  assert.deepEqual(hostReady, [{ role: "guest" }]);
  assert.deepEqual(guestReady, [{ role: "host" }]);
  assert.equal(guest.sendSignal({ kind: "first-guest-signal" }), 1);
  assert.deepEqual(hostSignals, [{ payload: { kind: "first-guest-signal" }, sequence: 1 }]);
  assert.equal(host.sendSignal({ kind: "host-signal" }), 1);
  assert.deepEqual(guestSignals, [{ payload: { kind: "host-signal" }, sequence: 1 }]);

  guest.close();
  assert.deepEqual(hostPeerLeft, [{ role: "guest" }]);
  assert.equal(host.closed, false);
  assert.equal(host.incomingSequence, 0);
  assert.equal(roomTransport.sockets.length, 2, "guest disconnect does not trigger automatic retry");

  guest.connect({ ...credentials, role: "guest", secret: guestSecret });
  assert.equal(roomTransport.sockets.length, 3, "rejoin occurs only after an explicit connect call");
  roomTransport.sockets[2].open();
  await roomTransport.drain();
  assert.deepEqual(hostReady.at(-1), { role: "guest" });
  assert.deepEqual(guestReady.at(-1), { role: "host" });
  assert.equal(guest.sendSignal({ kind: "rejoined-guest-signal" }), 1);
  assert.deepEqual(hostSignals.at(-1), { payload: { kind: "rejoined-guest-signal" }, sequence: 1 });
  assert.equal(host.closed, false, "host accepts the new guest connection's sequence 1");

  const deliveredBeforeExpiry = roomTransport.deliveredSignals.length;
  guestClosed.length = 0;
  now = room.expiresAt;
  guestScheduler.runAll();
  hostScheduler.runAll();
  assert.deepEqual(guestClosed, [{ reason: "expired" }]);
  assert.deepEqual(hostClosed, [{ reason: "expired" }]);
  assert.equal(guest.closed, true);
  assert.equal(host.closed, true);

  const lateRelay = roomTransport.relay(roomTransport.sockets[0], JSON.stringify({
    type: "signal",
    protocolVersion: 1,
    sequence: 2,
    payload: JSON.stringify({ kind: "too-late" }),
  }));
  assert.equal(lateRelay.ok, false);
  assert.equal(lateRelay.reason, "Room expired.");
  assert.equal(roomTransport.deliveredSignals.length, deliveredBeforeExpiry);
});
