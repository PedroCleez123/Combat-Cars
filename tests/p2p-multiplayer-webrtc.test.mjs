import test from "node:test";
import assert from "node:assert/strict";
import { P2PMultiplayerWebRTCStar } from "../src/p2p-multiplayer-webrtc.js";

class Signaling { constructor() { this.listeners = new Map(); this.sent = []; } on(type, fn) { const set = this.listeners.get(type) || new Set(); set.add(fn); this.listeners.set(type, set); return () => set.delete(fn); } emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); } sendSignal(payload, options) { this.sent.push({ payload, options }); } }
class Session { constructor(options) { this.options = options; this.starts = 0; this.offers = 0; this.closed = 0; } start() { this.starts += 1; return this; } beginOffer() { this.offers += 1; return this; } send(data) { this.data = data; } close() { this.closed += 1; } }

test("host star isolates signal and offer lifecycle by guest slot", () => {
  const signaling = new Signaling(); const star = new P2PMultiplayerWebRTCStar({ role: "host", signaling, guestSlots: [1, 2], WebRTCSession: Session });
  star.start();
  assert.equal(star.get(1).starts, 1); assert.equal(star.get(2).starts, 1);
  signaling.emit("peer-ready", { slot: 2 });
  assert.equal(star.get(1).offers, 0); assert.equal(star.get(2).offers, 1);
  star.get(1).options.signaling.sendSignal({ offer: 1 });
  assert.deepEqual(signaling.sent[0].options, { targetSlot: 1 });
  let received = 0; star.get(1).options.signaling.on("signal", () => { received += 1; });
  signaling.emit("signal", { sourceSlot: 2, payload: {} }); signaling.emit("signal", { sourceSlot: 1, payload: {} });
  assert.equal(received, 1); star.close(); assert.equal(star.get(1), null);
});

test("guest star can signal only the host and rejects invalid slot topology", () => {
  const signaling = new Signaling(); const star = new P2PMultiplayerWebRTCStar({ role: "guest", slot: 3, signaling, WebRTCSession: Session }).start();
  star.get(3).options.signaling.sendSignal({ answer: 1 });
  assert.deepEqual(signaling.sent[0].options, { targetSlot: null }); star.close();
  assert.throws(() => new P2PMultiplayerWebRTCStar({ role: "guest", slot: null, signaling, WebRTCSession: Session }), TypeError);
});

test("host star replaces a departed pre-game guest session in the same slot", () => {
  const signaling = new Signaling();
  const star = new P2PMultiplayerWebRTCStar({ role: "host", signaling, guestSlots: [1], WebRTCSession: Session }).start();
  const original = star.get(1);
  assert.equal(star.replace(1), true);
  assert.equal(original.closed, 1);
  assert.notEqual(star.get(1), original);
  assert.equal(star.get(1).starts, 1);
  star.close();
});

test("the elected guest rebuilds a host star while other guests restart toward it", async () => {
  const signaling = new Signaling();
  const events = [];
  const elected = new P2PMultiplayerWebRTCStar({
    role: "guest", slot: 1, failoverGuestSlots: [1, 2, 3], signaling, WebRTCSession: Session,
    onEvent: event => events.push(event),
  }).start();
  const original = elected.get(1);
  signaling.emit("host-promoted", { slot: 1, hostEpoch: 2, connectedSlots: [1, 3], promoted: true });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(original.closed, 1);
  assert.equal(elected.role, "host");
  assert.equal(elected.get(1), null);
  assert.equal(elected.get(3).starts, 1);
  assert.equal(elected.get(3).offers, 1);
  assert.deepEqual(events.at(-1), { type: "host-promoted", formerSlot: 1, hostEpoch: 2, connectedSlots: [1, 3], slot: 1, role: "host" });
  elected.close();
});

test("a promoted host creates a WebRTC session for a guest that joins after promotion", async () => {
  const signaling = new Signaling();
  const elected = new P2PMultiplayerWebRTCStar({
    role: "guest", slot: 1, failoverGuestSlots: [1, 2, 3], signaling, WebRTCSession: Session,
  }).start();
  signaling.emit("host-promoted", { slot: 1, hostEpoch: 3, connectedSlots: [1], promoted: true });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(elected.role, "host");
  assert.equal(elected.get(2), null);
  signaling.emit("peer-ready", { slot: 2 });
  assert.equal(elected.get(2).starts, 1);
  assert.equal(elected.get(2).offers, 1);
  assert.deepEqual(elected.guestSlots, [2]);
  elected.close();
});
