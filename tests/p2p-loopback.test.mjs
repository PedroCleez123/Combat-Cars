import assert from "node:assert/strict";
import test from "node:test";

import { runP2PLoopback } from "../src/p2p-loopback.js";

function makeRtcMock({ failOnAnswer = false, delayHostDataChannel = false, omitHostDataChannel = false } = {}) {
  const instances = [];

  class MockChannel {
    constructor(label, ordered = true) {
      this.label = label;
      this.ordered = ordered;
      this.readyState = "connecting";
      this.listeners = new Map();
      this.closed = false;
      this.peer = null;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    dispatch(type, event = {}) {
      this[`on${type}`]?.(event);
      for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    }

    open() {
      this.readyState = "open";
      this.dispatch("open");
    }

    send(data) {
      assert.equal(this.readyState, "open");
      queueMicrotask(() => this.peer?.dispatch("message", { data }));
    }

    close() {
      this.closed = true;
      this.readyState = "closed";
      this.dispatch("close");
    }
  }

  class MockPeer {
    constructor(configuration) {
      this.configuration = configuration;
      this.iceGatheringState = "new";
      this.channels = [];
      this.closed = false;
      instances.push(this);
    }

    createDataChannel(label, options) {
      const channel = new MockChannel(label, options.ordered);
      this.channels.push(channel);
      return channel;
    }

    async createOffer() {
      return { type: "offer", sdp: "mock-offer-with-local-candidates" };
    }

    async createAnswer() {
      return { type: "answer", sdp: "mock-answer-with-local-candidates" };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
      this.iceGatheringState = "complete";
    }

    async setRemoteDescription(description) {
      if (failOnAnswer && description.type === "answer") throw new Error("mock negotiation failure");
      this.remoteDescription = description;
      if (description.type === "offer") {
        const pilot = instances[1];
        const pilotChannel = pilot.channels[0];
        if (omitHostDataChannel) return;
        const hostChannel = new MockChannel(pilotChannel.label, pilotChannel.ordered);
        pilotChannel.peer = hostChannel;
        hostChannel.peer = pilotChannel;
        this.channels.push(hostChannel);
        if (delayHostDataChannel) {
          this.pendingHostChannel = hostChannel;
        } else {
          this.ondatachannel?.({ channel: hostChannel });
        }
      }
      if (description.type === "answer") {
        for (const peer of instances) {
          for (const channel of peer.channels) queueMicrotask(() => channel.open());
        }
        if (delayHostDataChannel) {
          const host = instances[0];
          setTimeout(() => host.ondatachannel?.({ channel: host.pendingHostChannel }), 0);
        }
      }
    }

    close() {
      this.closed = true;
      for (const channel of this.channels) channel.close();
    }
  }

  MockPeer.instances = instances;
  return MockPeer;
}

test("local P2P loopback negotiates the ordered control channel and closes resources", async () => {
  const PeerConnection = makeRtcMock();
  const statuses = [];
  const result = await runP2PLoopback({
    RTCPeerConnection: PeerConnection,
    timeoutMs: 500,
    sessionId: "unit-test",
    onStatus: status => statuses.push(status),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sequence, 1);
  assert.equal(result.channelLabel, "arsenal-controls");
  assert.equal(result.ordered, true);
  assert.ok(statuses.includes("El piloto envió hello."));
  assert.ok(statuses.includes("El host aceptó input, secuencia 1."));
  assert.ok(statuses.includes("El piloto recibió state para la secuencia 1."));
  assert.equal(PeerConnection.instances.length, 2);
  assert.ok(PeerConnection.instances.every(peer => peer.closed));
  assert.ok(PeerConnection.instances.flatMap(peer => peer.channels).every(channel => channel.closed));
  assert.ok(PeerConnection.instances.every(peer => peer.configuration.iceServers.length === 0));
});

test("local P2P loopback waits for the host channel event after negotiation", async () => {
  const PeerConnection = makeRtcMock({ delayHostDataChannel: true });
  const result = await runP2PLoopback({ RTCPeerConnection: PeerConnection, timeoutMs: 500, sessionId: "unit-delayed-channel" });

  assert.equal(result.ok, true);
  assert.equal(result.channelLabel, "arsenal-controls");
  assert.equal(result.ordered, true);
  assert.ok(PeerConnection.instances.every(peer => peer.closed));
  assert.ok(PeerConnection.instances.flatMap(peer => peer.channels).every(channel => channel.closed));
});

test("local P2P loopback times out waiting for the host channel and closes resources", async () => {
  const PeerConnection = makeRtcMock({ omitHostDataChannel: true });
  const result = await runP2PLoopback({ RTCPeerConnection: PeerConnection, timeoutMs: 50, sessionId: "unit-missing-channel" });

  assert.equal(result.ok, false);
  assert.match(result.reason, /El host no creó el canal de datos esperado dentro del tiempo límite/);
  assert.equal(PeerConnection.instances.length, 2);
  assert.ok(PeerConnection.instances.every(peer => peer.closed));
  assert.ok(PeerConnection.instances.flatMap(peer => peer.channels).every(channel => channel.closed));
});

test("local P2P loopback closes both peers and channels after negotiation failure", async () => {
  const PeerConnection = makeRtcMock({ failOnAnswer: true });
  const result = await runP2PLoopback({ RTCPeerConnection: PeerConnection, timeoutMs: 500, sessionId: "unit-failure" });

  assert.equal(result.ok, false);
  assert.match(result.reason, /negociación WebRTC local/);
  assert.equal(PeerConnection.instances.length, 2);
  assert.ok(PeerConnection.instances.every(peer => peer.closed));
  assert.ok(PeerConnection.instances.flatMap(peer => peer.channels).every(channel => channel.closed));
});

test("local P2P loopback reports missing RTC support without accessing window at import", async () => {
  const result = await runP2PLoopback({ RTCPeerConnection: null });
  assert.deepEqual(result, { ok: false, reason: "Este navegador no ofrece RTCPeerConnection." });
});
