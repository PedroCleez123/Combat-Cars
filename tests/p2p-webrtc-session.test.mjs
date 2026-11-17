import test from "node:test";
import assert from "node:assert/strict";
import { P2PWebRTCSession, P2P_WEBRTC_MAX_MESSAGE_BYTES } from "../src/p2p-webrtc-session.js";
import {
  P2P_CONTROL_CHANNEL,
  P2P_METADATA_CHANNEL,
  P2P_MAX_MESSAGE_BYTES,
  P2P_MAX_SDP_BYTES,
  P2P_WEBRTC_SIGNAL_VERSION,
  createP2PWebRTCCandidate,
  createP2PWebRTCDescription,
  normalizeP2PWebRTCSignal,
} from "../src/p2p-session-protocol.js";

class FakeSignaling {
  constructor() { this.listeners = new Map(); this.sent = []; this.peer = null; }
  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }
  sendSignal(payload) {
    this.sent.push(payload);
    this.peer?.emit("signal", { payload });
  }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
}

class FakeChannel {
  constructor(label = P2P_CONTROL_CHANNEL, ordered = true) {
    this.label = label;
    this.ordered = ordered;
    this.readyState = "connecting";
    this.listeners = new Map();
    this.sent = [];
    this.closeCalls = 0;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
  send(data) { this.sent.push(data); }
  open() { this.readyState = "open"; this.dispatch("open"); }
  close() { this.closeCalls += 1; this.readyState = "closed"; this.dispatch("close"); }
}

class FakePeerConnection {
  static instances = [];
  constructor(configuration) {
    this.configuration = configuration;
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.addedCandidates = [];
    this.closed = 0;
    FakePeerConnection.instances.push(this);
  }
  createDataChannel(label, options) {
    this.createdChannelOptions = options;
    const channel = new FakeChannel(label, options.ordered);
    if (label === P2P_CONTROL_CHANNEL) this.createdChannel = channel;
    if (label === P2P_METADATA_CHANNEL) this.createdMetadataChannel = channel;
    return channel;
  }
  async createOffer() { return { type: "offer", sdp: "host-sdp" }; }
  async createAnswer() { return { type: "answer", sdp: "guest-sdp" }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription(description) { this.remoteDescription = description; }
  async addIceCandidate(candidate) { this.addedCandidates.push(candidate); }
  setIceConnectionState(state) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
  close() { this.closed += 1; this.connectionState = "closed"; }
}

class FakeScheduler {
  constructor() { this.timers = []; this.cleared = []; }
  setTimeout(callback, delay) {
    const timer = { callback, delay, cleared: false };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(timer) {
    timer.cleared = true;
    this.cleared.push(timer);
  }
  fire(timer) {
    if (!timer.cleared) timer.callback();
  }
}

function pair({ offerMode = "automatic" } = {}) {
  FakePeerConnection.instances = [];
  const hostSignaling = new FakeSignaling();
  const guestSignaling = new FakeSignaling();
  hostSignaling.peer = guestSignaling;
  guestSignaling.peer = hostSignaling;
  const hostEvents = [];
  const guestEvents = [];
  const host = new P2PWebRTCSession({ role: "host", signaling: hostSignaling, RTCPeerConnection: FakePeerConnection, offerMode, onEvent: (event) => hostEvents.push(event) });
  const guest = new P2PWebRTCSession({ role: "guest", signaling: guestSignaling, RTCPeerConnection: FakePeerConnection, offerMode, onEvent: (event) => guestEvents.push(event) });
  return { host, guest, hostSignaling, guestSignaling, hostEvents, guestEvents };
}

async function settle() { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); }

test("host sends one offer and ordered control channel; guest answers and accepts only the received channel", async () => {
  const { host, guest, hostSignaling, guestSignaling, hostEvents, guestEvents } = pair();
  host.start();
  guest.start();
  await settle();
  assert.deepEqual(hostSignaling.sent.map((signal) => signal.type), ["offer"]);
  assert.deepEqual(guestSignaling.sent.map((signal) => signal.type), ["answer"]);
  assert.equal(FakePeerConnection.instances[0].createdChannelOptions.ordered, true);
  assert.equal(hostSignaling.sent[0].sdp, "host-sdp");

  const hostPeer = FakePeerConnection.instances[0];
  const guestPeer = FakePeerConnection.instances[1];
  const guestChannel = new FakeChannel();
  guestPeer.ondatachannel({ channel: guestChannel });
  hostPeer.createdChannel.open();
  guestChannel.open();
  hostPeer.createdChannel.open();
  guestChannel.open();
  assert.equal(hostEvents.filter((event) => event.type === "channel-open").length, 1);
  assert.equal(guestEvents.filter((event) => event.type === "channel-open").length, 1);
  host.close();
  guest.close();
});

test("deferred offer waits for the guest listener and starts only once", async () => {
  const { host, guest, hostSignaling, guestSignaling } = pair({ offerMode: "deferred" });
  guest.start();
  host.start();
  assert.equal(guestSignaling.listeners.get("signal")?.size, 1, "guest installs its signal receiver during preparation");
  assert.deepEqual(hostSignaling.sent, [], "prepared host does not send an offer");

  host.beginOffer();
  host.beginOffer();
  await settle();
  assert.deepEqual(hostSignaling.sent.map((signal) => signal.type), ["offer"]);
  assert.deepEqual(guestSignaling.sent.map((signal) => signal.type), ["answer"]);
  host.beginOffer();
  await settle();
  assert.equal(hostSignaling.sent.filter((signal) => signal.type === "offer").length, 1);
  host.close();
  guest.close();
});

test("ICE state events are allowlisted and never include candidates or addresses", () => {
  const { host, hostEvents } = pair();
  host.start();
  const peer = FakePeerConnection.instances[0];
  peer.setIceConnectionState("checking");
  peer.setIceConnectionState("connected");
  peer.setIceConnectionState("bogus");
  host.close();
  const events = hostEvents.filter(event => event.type === "ice-state");
  assert.deepEqual(events.map(event => event.state), ["new", "checking", "connected", "closed"]);
  assert.deepEqual(events.map(event => Object.keys(event).sort()), [
    ["state", "type"], ["state", "type"], ["state", "type"], ["state", "type"],
  ]);
  assert.doesNotMatch(JSON.stringify(events), /candidate|192\.0\.2\.1|10\.0\.0\.1/);
});

test("a deferred host starts its negotiation deadline only when it offers", () => {
  FakePeerConnection.instances = [];
  const deferredScheduler = new FakeScheduler();
  const deferredEvents = [];
  const deferred = new P2PWebRTCSession({
    role: "host", signaling: new FakeSignaling(), RTCPeerConnection: FakePeerConnection,
    offerMode: "deferred", timeoutMs: 50, scheduler: deferredScheduler,
    onEvent: (event) => deferredEvents.push(event),
  });
  deferred.start();
  assert.equal(deferredScheduler.timers.length, 0, "an empty private room must not time out before a guest is ready");
  deferred.beginOffer();
  assert.equal(deferredScheduler.timers.length, 1);
  assert.equal(deferredScheduler.timers[0].delay, 50);
  deferredScheduler.fire(deferredScheduler.timers[0]);
  assert.equal(deferredEvents.find((event) => event.type === "error")?.error.code, "negotiation-timeout");
  assert.equal(deferredEvents.filter((event) => event.type === "closed").length, 1);

  const automaticScheduler = new FakeScheduler();
  const automatic = new P2PWebRTCSession({
    role: "host", signaling: new FakeSignaling(), RTCPeerConnection: FakePeerConnection,
    timeoutMs: 50, scheduler: automaticScheduler,
  });
  automatic.start();
  assert.equal(automaticScheduler.timers.length, 1, "automatic hosts keep the existing negotiation deadline");
  automatic.close();
  assert.equal(automaticScheduler.cleared.length, 1);
});

test("guest rejects a channel with an unexpected label or unordered delivery", () => {
  const { guest, guestEvents } = pair();
  guest.start();
  const badChannel = new FakeChannel("other", true);
  FakePeerConnection.instances[0].ondatachannel({ channel: badChannel });
  assert.equal(guestEvents.find((event) => event.type === "error")?.error.code, "channel-invalid");
  assert.equal(badChannel.readyState, "closed");

  const other = pair();
  other.guest.start();
  const unordered = new FakeChannel(P2P_CONTROL_CHANNEL, false);
  FakePeerConnection.instances[0].ondatachannel({ channel: unordered });
  assert.equal(other.guestEvents.find((event) => event.type === "error")?.error.code, "channel-invalid");
  assert.equal(unordered.readyState, "closed");
});

test("optional metadata channel is ordered and never becomes the control requirement", () => {
  const hostSignaling = new FakeSignaling();
  const guestSignaling = new FakeSignaling();
  hostSignaling.peer = guestSignaling;
  guestSignaling.peer = hostSignaling;
  const legacyEvents = [];
  const metadataHost = new P2PWebRTCSession({ role: "host", metadata: true, signaling: hostSignaling, RTCPeerConnection: FakePeerConnection });
  const legacyGuest = new P2PWebRTCSession({ role: "guest", signaling: guestSignaling, RTCPeerConnection: FakePeerConnection, onEvent: event => legacyEvents.push(event) });
  metadataHost.start();
  legacyGuest.start();
  const hostPeer = FakePeerConnection.instances.at(-2);
  const guestPeer = FakePeerConnection.instances.at(-1);
  assert.equal(hostPeer.createdMetadataChannel.label, P2P_METADATA_CHANNEL);
  assert.equal(hostPeer.createdMetadataChannel.ordered, true);
  const control = new FakeChannel(P2P_CONTROL_CHANNEL, true);
  const metadata = new FakeChannel(P2P_METADATA_CHANNEL, true);
  guestPeer.ondatachannel({ channel: metadata });
  guestPeer.ondatachannel({ channel: control });
  control.open();
  assert.equal(legacyGuest.state, "channel-open");
  metadata.dispatch("message", { data: "metadata" });
  assert.equal(legacyGuest.state, "channel-open");
  assert.equal(legacyEvents.filter(event => event.type === "error").length, 0);
  metadataHost.close();
  legacyGuest.close();
});

test("invalid metadata frames close only metadata while controls stay open", () => {
  const events = [];
  const signaling = new FakeSignaling();
  const guest = new P2PWebRTCSession({ role: "guest", signaling, RTCPeerConnection: FakePeerConnection, onEvent: event => events.push(event) });
  guest.start();
  const peer = FakePeerConnection.instances.at(-1);
  const metadata = new FakeChannel(P2P_METADATA_CHANNEL, true);
  const control = new FakeChannel(P2P_CONTROL_CHANNEL, true);
  peer.ondatachannel({ channel: metadata });
  peer.ondatachannel({ channel: control });
  metadata.open();
  control.open();
  metadata.dispatch("message", { data: "x".repeat(P2P_MAX_MESSAGE_BYTES + 1) });
  assert.equal(metadata.readyState, "closed");
  assert.equal(guest.state, "channel-open");
  assert.equal(events.some(event => event.type === "metadata-error"), true);
  assert.equal(events.some(event => event.type === "error"), false);
  guest.close();
});

test("candidate arriving before the remote description is bounded and applied afterward", async () => {
  const { guest, guestSignaling } = pair();
  guest.start();
  const candidate = { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "u" };
  guestSignaling.emit("signal", { payload: createP2PWebRTCCandidate(candidate) });
  assert.equal(FakePeerConnection.instances[0].addedCandidates.length, 0);
  guestSignaling.emit("signal", { payload: createP2PWebRTCDescription("offer", "offer-sdp") });
  await settle();
  assert.deepEqual(FakePeerConnection.instances[0].addedCandidates, [candidate]);
  guest.close();
});

test("signal schemas reject extra keys, wrong versions, duplicates, and impossible description order", async () => {
  const valid = createP2PWebRTCDescription("offer", "sdp");
  assert.equal(normalizeP2PWebRTCSignal({ ...valid, extra: true }), null);
  assert.equal(normalizeP2PWebRTCSignal({ ...valid, protocolVersion: 7 }), null);
  assert.equal(normalizeP2PWebRTCSignal({ ...valid, sdp: "x".repeat(P2P_MAX_SDP_BYTES + 1) }), null);
  assert.equal(normalizeP2PWebRTCSignal({ type: "candidate", protocolVersion: P2P_WEBRTC_SIGNAL_VERSION, candidate: { candidate: "x" } }), null);
  const { host, guest, guestEvents, guestSignaling } = pair();
  guest.start();
  guestSignaling.emit("signal", { payload: createP2PWebRTCDescription("answer", "wrong-order") });
  assert.equal(guestEvents.find((event) => event.type === "error")?.error.code, "description-order");
  assert.equal(guest.pc, null);

  const sessionPair = pair();
  sessionPair.guest.start();
  sessionPair.guestSignaling.emit("signal", { payload: valid });
  await settle();
  sessionPair.guestSignaling.emit("signal", { payload: valid });
  assert.equal(sessionPair.guestEvents.find((event) => event.type === "error")?.error.code, "description-duplicate");
  host.close();
});

test("send and receive enforce text-only message byte limits", () => {
  const { host, hostEvents } = pair();
  host.start();
  const channel = FakePeerConnection.instances[0].createdChannel;
  channel.open();
  host.send("ok");
  assert.deepEqual(channel.sent, ["ok"]);
  assert.throws(() => host.send(new Uint8Array([1])), TypeError);
  assert.throws(() => host.send("x".repeat(P2P_MAX_MESSAGE_BYTES + 1)), TypeError);
  channel.dispatch("message", { data: new Uint8Array([1]) });
  assert.equal(hostEvents.find((event) => event.type === "error")?.error.code, "channel-message-invalid");
});

test("an established direct control channel survives a later signaling socket loss", () => {
  const { host, hostSignaling, hostEvents } = pair();
  host.start();
  const peer = FakePeerConnection.instances.at(-1);
  peer.createdChannel.open();

  // The Worker WebSocket is only needed for SDP/ICE rendezvous. A later
  // close, error, stale signal, or signaling-side peer notice must not throw
  // a player out of a working direct DataChannel match.
  hostSignaling.emit("closed");
  hostSignaling.emit("error");
  hostSignaling.emit("peer-left", { role: "guest" });
  hostSignaling.emit("signal", { payload: { invalid: true } });

  assert.equal(host.state, "channel-open");
  assert.equal(host.terminal, false);
  assert.equal(peer.closed, 0);
  assert.equal(hostEvents.some(event => event.type === "error"), false);
  assert.equal(hostEvents.some(event => event.type === "peer-left"), false);
  assert.equal(hostEvents.some(event => event.type === "closed"), false);

  // A real direct-transport failure is still terminal; this is not masking
  // connectionState failures, only decoupling the completed P2P path from
  // its no-longer-needed signaling relay.
  peer.connectionState = "failed";
  peer.onconnectionstatechange();
  assert.equal(hostEvents.find(event => event.type === "error")?.error.code, "peer-connection-failed");
  host.close();
});

test("an explicit causal presentation transport may use its bounded 4 KiB frame without widening defaults", () => {
  const hostSignaling = new FakeSignaling();
  const host = new P2PWebRTCSession({
    role: "host", signaling: hostSignaling, RTCPeerConnection: FakePeerConnection,
    maxMessageBytes: P2P_WEBRTC_MAX_MESSAGE_BYTES,
  });
  host.start();
  const channel = FakePeerConnection.instances.at(-1).createdChannel;
  channel.open();
  const v5Frame = "x".repeat(P2P_MAX_MESSAGE_BYTES + 1);
  host.send(v5Frame);
  assert.deepEqual(channel.sent, [v5Frame]);
  assert.throws(() => host.send("x".repeat(P2P_WEBRTC_MAX_MESSAGE_BYTES + 1)), TypeError);
  assert.throws(() => new P2PWebRTCSession({
    role: "host", signaling: new FakeSignaling(), RTCPeerConnection: FakePeerConnection,
    maxMessageBytes: P2P_WEBRTC_MAX_MESSAGE_BYTES + 1,
  }), /Invalid P2P WebRTC session options/);
  host.close();
});

test("peer-left, negotiation timeout, and explicit close release listeners and resources once", async () => {
  const { host, hostSignaling, hostEvents } = pair();
  host.start();
  const peer = FakePeerConnection.instances[0];
  const channel = peer.createdChannel;
  hostSignaling.emit("peer-left", { role: "guest" });
  assert.equal(hostEvents.filter((event) => event.type === "peer-left").length, 1);
  assert.equal(hostEvents.filter((event) => event.type === "closed").length, 1);
  assert.equal(peer.closed, 1);
  assert.equal(channel.closeCalls, 1);
  assert.equal(hostSignaling.listeners.get("signal").size, 0);
  host.close();
  assert.equal(hostEvents.filter((event) => event.type === "closed").length, 1);

  const timeoutEvents = [];
  const timeoutSession = new P2PWebRTCSession({
    role: "guest", signaling: new FakeSignaling(), RTCPeerConnection: FakePeerConnection,
    timeoutMs: 5, onEvent: (event) => timeoutEvents.push(event),
  });
  timeoutSession.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(timeoutEvents.find((event) => event.type === "error")?.error.code, "negotiation-timeout");
  assert.equal(timeoutEvents.filter((event) => event.type === "closed").length, 1);
  assert.equal(FakePeerConnection.instances.at(-1).closed, 1);
});

test("negotiation API failures are reported without escaping signaling listeners", async () => {
  class BrokenPeer extends FakePeerConnection {
    async setRemoteDescription() { throw new Error("do not expose"); }
  }
  const signaling = new FakeSignaling();
  const events = [];
  const session = new P2PWebRTCSession({ role: "guest", signaling, RTCPeerConnection: BrokenPeer, onEvent: (event) => events.push(event) });
  session.start();
  signaling.emit("signal", { payload: createP2PWebRTCDescription("offer", "private-sdp") });
  await settle();
  assert.equal(events.find((event) => event.type === "error")?.error.code, "description-apply-failed");
  assert.equal(JSON.stringify(events).includes("private-sdp"), false);
  assert.equal(session.pc, null);
});
