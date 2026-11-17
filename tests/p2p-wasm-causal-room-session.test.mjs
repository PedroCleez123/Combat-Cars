import assert from "node:assert/strict";
import test from "node:test";

import { P2PWasmCausalRoomSession } from "../tools/wasm-spike/p2p-wasm-causal-room-session.mjs";
import { P2P_WASM_PRESENTATION_MAX_BYTES, P2P_WASM_PRESENTATION_PROTOCOL_VERSION } from "../tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs";

const context = Object.freeze({ roomId: "p2p-causal-room", sessionId: "p2p-causal-session" });
const idle = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const command = Object.freeze({ controls: idle, fire: true, restart: false, targetId: "p2p-host" });

function signaling() {
  const listeners = new Map();
  return {
    on(type, listener) {
      const set = listeners.get(type) || new Set();
      set.add(listener);
      listeners.set(type, set);
      return () => set.delete(listener);
    },
    emit(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); },
  };
}

function manualIntervalScheduler() {
  let nextId = 0;
  const timers = new Map();
  return {
    setInterval(callback, interval) {
      const id = ++nextId;
      timers.set(id, { callback, interval });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    fireAll() { for (const { callback } of [...timers.values()]) callback(); },
    get size() { return timers.size; },
  };
}

class FakeWebRTCSession {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.state = "new";
    this.beginOfferCalls = 0;
    this.sent = [];
    this.metadataSent = [];
    this.peer = null;
    FakeWebRTCSession.instances.push(this);
  }

  start() { this.state = "negotiating"; return this; }
  beginOffer() { this.beginOfferCalls += 1; }
  open() { this.state = "channel-open"; this.options.onEvent({ type: "channel-open" }); }
  send(data) {
    this.sent.push(data);
    this.peer?.options.onEvent({ type: "channel-message", data });
  }
  sendMetadata(data) {
    this.metadataSent.push(data);
    this.peer?.options.onEvent({ type: "metadata-message", data });
    return true;
  }
  closeMetadata() {
    this.options.onEvent({ type: "metadata-channel-closed" });
    return this;
  }
  peerLeft() { this.options.onEvent({ type: "peer-left", role: this.options.role === "host" ? "guest" : "host" }); }
  close() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.options.onEvent({ type: "closed" });
  }
}

function snapshot() {
  const physical = [
    { id: "p2p-host", team: "blue", x: 0, z: 0, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0 },
    { id: "p2p-pilot", team: "red", x: 1, z: 0, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0 },
  ];
  const cars = [
    { id: "p2p-host", team: "blue", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
    { id: "p2p-pilot", team: "red", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
  ];
  return {
    tick: 1,
    lastInputSequence: 1,
    physical,
    combat: {
      score: { blue: 0, red: 0 },
      round: { state: "active", scoreToWin: 15, winner: null, serial: 1 },
      cars,
      rockets: [{ id: 1, owner: "p2p-pilot", team: "red", x: 0, z: 0, h: 0, vx: 1, vz: 0, vh: 0, life: 1, targetId: "p2p-host" }],
      events: [{ kind: "fire", text: "Rocket fired.", at: 0 }],
      eliminated: [],
      respawns: [],
    },
  };
}

function defaultHostFactory() {
  let tick = 0;
  let lastInputSequence = 0;
  let latest = null;
  const presentation = [
    { id: "p2p-host", team: "blue" },
    { id: "p2p-pilot", team: "red" },
  ].map(car => ({
    ...car,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    boost: 100,
    grounded: true,
    wheelCount: 4,
    jumps: 2,
    jumpState: "grounded",
    actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 },
    boosting: false,
    supersonic: false,
    powerslide: 0,
    angularVelocity: { pitch: 0, yaw: 0, roll: 0 },
    wheelContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
    worldContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
  }));
  return {
    receivePilotCommand({ sequence }) {
      lastInputSequence = sequence;
      return { accepted: true, snapshot: null };
    },
    advance() {
      tick += 1;
      const value = snapshot();
      value.tick = tick;
      value.lastInputSequence = lastInputSequence;
      latest = value;
      return value;
    },
    presentationSnapshot() {
      return { ...latest, presentation };
    },
    close() {},
  };
}

function pair({ hostFactory = defaultHostFactory, onSnapshot = () => {}, onMetadata = () => {}, presentation = false, primePilotOnWelcome = false, metadata = false, metadataEveryTicks = 15 } = {}) {
  FakeWebRTCSession.instances = [];
  const hostSignaling = signaling();
  const pilotSignaling = signaling();
  const clockScheduler = manualIntervalScheduler();
  const events = { host: [], pilot: [] };
  const host = new P2PWasmCausalRoomSession({
    role: "host", signaling: hostSignaling, ...context, WebRTCSession: FakeWebRTCSession,
    hostFactory, clockScheduler, presentation, primePilotOnWelcome, metadata, metadataEveryTicks, onEvent: event => events.host.push(event), onSnapshot: (value, metadata) => onSnapshot("host", value, metadata), onMetadata: (value, metadata) => onMetadata("host", value, metadata),
  });
  const pilot = new P2PWasmCausalRoomSession({
    role: "pilot", signaling: pilotSignaling, ...context, WebRTCSession: FakeWebRTCSession,
    presentation, primePilotOnWelcome, metadata, metadataEveryTicks, onEvent: event => events.pilot.push(event), onSnapshot: (value, metadata) => onSnapshot("pilot", value, metadata), onMetadata: (value, metadata) => onMetadata("pilot", value, metadata),
  });
  host.start();
  pilot.start();
  const hostTransport = host.transport;
  const pilotTransport = pilot.transport;
  hostTransport.peer = pilotTransport;
  pilotTransport.peer = hostTransport;
  return { host, pilot, hostSignaling, pilotSignaling, hostTransport, pilotTransport, clockScheduler, events };
}

test("P2P-WASM-26 defers the host offer until peer-ready and prepares the guest receiver", () => {
  const { host, pilot, hostSignaling, hostTransport, pilotTransport } = pair();
  assert.equal(hostTransport.options.offerMode, "deferred");
  assert.equal(pilotTransport.options.offerMode, "automatic");
  assert.equal(hostTransport.beginOfferCalls, 0);
  host.beginOffer();
  assert.equal(hostTransport.beginOfferCalls, 0, "a direct call cannot bypass peer-ready");
  hostSignaling.emit("peer-ready", { role: "guest" });
  assert.equal(host.peerReady, true);
  assert.equal(hostTransport.beginOfferCalls, 1);
  hostSignaling.emit("peer-ready", { role: "guest" });
  assert.equal(hostTransport.beginOfferCalls, 1, "offer begins once");
  host.close();
  pilot.close();
});

test("v5 presentation opts into its versioned 4 KiB control-frame budget only", () => {
  const plain = pair();
  assert.equal(plain.host.transport.options.maxMessageBytes, undefined);
  plain.host.close();
  plain.pilot.close();

  const presented = pair({ presentation: true });
  assert.equal(presented.host.transport.options.maxMessageBytes, P2P_WASM_PRESENTATION_MAX_BYTES);
  assert.equal(presented.pilot.transport.options.maxMessageBytes, P2P_WASM_PRESENTATION_MAX_BYTES);
  presented.host.close();
  presented.pilot.close();
});

test("P2P-WASM-26 carries the first causal fire snapshot through the injected transports", async () => {
  const presented = [];
  const { host, pilot, hostTransport, pilotTransport, events } = pair({
    onSnapshot: (role, value, metadata) => presented.push({ role, value, metadata }),
  });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.causalSession?.state, "active");
  assert.equal(pilot.causalSession?.state, "active");
  const sent = pilot.causalSession.sendCommand(command);
  assert.equal(sent.accepted, true);
  assert.ok(pilot.causalSession.lastSnapshot, JSON.stringify({ sent, hostState: host.causalSession?.state, pilotState: pilot.causalSession?.state, hostEvents: events.host, pilotEvents: events.pilot }));
  const outcome = pilot.causalSession.lastSnapshot;
  assert.equal(outcome.events[0].kind, "fire");
  assert.equal(outcome.rockets[0].targetId, "p2p-host");
  assert.equal(pilot.causalSession.lastAcknowledgedCommandSequence, 1);
  assert.equal(host.causalSession.commandSequence, 1);
  assert.ok(hostTransport.sent.length >= 2, "welcome plus first causal snapshot");
  assert.equal(presented.length, 2, "both peers publish one normalized presentation snapshot");
  for (const item of presented) {
    assert.equal(item.value.tick, 1);
    assert.equal(item.value.cars.length, 2);
    assert.equal(item.value.rockets[0].targetId, "p2p-host");
    assert.equal(item.value.combat, undefined);
    assert.equal(item.metadata.roomId, context.roomId);
  }
  host.close();
  pilot.close();
});

test("presentation primes one neutral pilot command so both peers receive a two-car frame before controls", async () => {
  const presented = [];
  const { host, pilot, hostTransport, pilotTransport } = pair({
    presentation: true,
    primePilotOnWelcome: true,
    onSnapshot: (role, value) => presented.push({ role, value }),
  });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.causalSession?.state, "active");
  assert.equal(pilot.causalSession?.state, "active");
  assert.equal(host.causalSession.commandSequence, 1, "the bounded idle prime reaches the host");
  assert.equal(pilot.causalSession.commandSequence, 1, "the prime is the pilot's first sequence");
  assert.equal(presented.length, 2, "host and pilot each receive the initial frame");
  for (const item of presented) {
    assert.equal(item.value.type, "wasm-causal-combat-presentation");
    assert.equal(item.value.snapshot.physical.length, 2);
    assert.equal(item.value.presentation.length, 2);
    assert.equal(item.value.snapshot.lastInputSequence, 1);
  }
  host.close();
  pilot.close();
});

test("P2P-WASM-45 carries the opt-in v2 presentation envelope without changing the v1 default", async () => {
  const presented = [];
  const { host, pilot, hostTransport, pilotTransport, events } = pair({
    presentation: true,
    onSnapshot: (role, value, metadata) => presented.push({ role, value, metadata }),
  });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  const sent = pilot.causalSession.sendCommand(command);
  assert.equal(sent.accepted, true);
  assert.equal(presented.length, 2, "host and pilot each receive one v2 presentation envelope");
  for (const item of presented) {
    assert.equal(item.value.type, "wasm-causal-combat-presentation");
    assert.equal(item.value.protocolVersion, P2P_WASM_PRESENTATION_PROTOCOL_VERSION);
    assert.equal(item.value.roomId, context.roomId);
    assert.equal(item.value.sessionId, context.sessionId);
    assert.equal(item.value.presentation.length, 2);
    assert.equal(item.value.snapshot.combat, undefined);
    assert.equal(item.metadata.roomId, context.roomId);
  }
  assert.equal(pilot.causalSession.lastPresentationEnvelope.type, "wasm-causal-combat-presentation");
  host.close();
  pilot.close();
});

test("P2P-WASM-37 accepts host intent without allowing it to advance WASM", async () => {
  let hostCommands = 0;
  const { host, pilot, hostTransport, pilotTransport } = pair({
    hostFactory: () => ({
      setHostCommand(value) { hostCommands += 1; return { accepted: value?.controls?.throttle === 1 }; },
      receivePilotCommand() { return { accepted: true, snapshot: null }; },
      advance() { return snapshot(); },
      close() {},
    }),
  });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  const result = host.setHostCommand({ controls: { throttle: 1, steer: 0, boost: false, jump: false }, fire: false, restart: false, targetId: null });
  assert.deepEqual(result, { accepted: true, reason: undefined });
  assert.equal(hostCommands, 1);
  host.close();
  pilot.close();
});

test("P2P-WASM-31 keeps presentation observer faults outside causal authority", async () => {
  const { host, pilot, hostTransport, pilotTransport, events } = pair({
    onSnapshot: () => { throw new Error("renderer unavailable"); },
  });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pilot.causalSession.sendCommand(command).accepted, true);
  assert.equal(host.closed, false);
  assert.equal(pilot.closed, false);
  assert.equal(events.host.filter(event => event.type === "presentation-error").length, 1);
  assert.equal(events.pilot.filter(event => event.type === "presentation-error").length, 1);
  host.close();
  pilot.close();
});

test("P2P-WASM-26 preserves peer-left and closes each resource idempotently", async () => {
  let hostClosed = 0;
  const { host, pilot, hostTransport, pilotTransport, events } = pair({
    hostFactory: () => ({ receivePilotCommand() { return { accepted: true, snapshot: null }; }, advance() { return snapshot(); }, close() { hostClosed += 1; } }),
  });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  hostTransport.peerLeft();
  host.close();
  host.close();
  pilot.close();
  pilot.close();
  assert.equal(events.host.filter(event => event.type === "peer-left").length, 1);
  assert.equal(events.host.filter(event => event.type === "closed").length, 1);
  assert.equal(hostClosed, 1);
});

test("P2P-WASM-38 keeps the host timeline moving after the pilot stops sending input", async () => {
  const { host, pilot, hostTransport, pilotTransport, clockScheduler } = pair();
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pilot.causalSession.sendCommand({ ...command, fire: false }).accepted, true);
  const firstTick = pilot.causalSession.lastSnapshot.tick;
  assert.equal(clockScheduler.size, 1);
  // 300 fixed 60 Hz wakes represent five seconds of pilot silence. The
  // transport must not be required to deliver another command for the host to
  // keep advancing its authoritative timeline.
  for (let wake = 0; wake < 300; wake += 1) clockScheduler.fireAll();
  assert.equal(pilot.causalSession.lastSnapshot.tick, firstTick + 300);
  assert.equal(host.causalSession.commandSequence, 1, "no network packet is needed for fixed clock ticks");
  host.close();
  pilot.close();
  assert.equal(clockScheduler.size, 0);
});

test("optional metadata publishes only bounded presentation players/pads and is received independently", async () => {
  const received = [];
  const baseFactory = defaultHostFactory();
  const { host, pilot, hostTransport, pilotTransport } = pair({
    metadata: true,
    presentation: true,
    metadataEveryTicks: 15,
    hostFactory: () => ({
      ...baseFactory,
      presentationSnapshot() {
        return baseFactory.presentationSnapshot();
      },
      metadataSnapshot() {
        return {
          tick: baseFactory.presentationSnapshot().tick,
          players: [
            { id: "p2p-host", team: "blue", name: "Host" },
            { id: "p2p-pilot", team: "red", name: "Pilot" },
          ],
          pads: [{ id: "pad-01", x: 2, h: 0, z: -3, amount: 100, cooldown: 0, active: true }],
          secret: "must-not-cross",
        };
      },
    }),
    onMetadata: (role, value) => received.push({ role, value }),
  });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pilot.causalSession.sendCommand(command).accepted, true);
  assert.equal(host.closed, false);
  assert.equal(pilot.closed, false);
  assert.equal(received.length, 2, "the host and pilot render the same validated metadata");
  // The fake transport delivers its RTC frame synchronously, so the remote
  // pilot observes it before the host's local presentation observer. Both
  // roles must still receive the same validated envelope.
  assert.deepEqual(received.map(item => item.role), ["pilot", "host"]);
  for (const item of received) {
    assert.deepEqual(item.value.players.map(player => player.name), ["Host", "Pilot"]);
    assert.deepEqual(item.value.pads, [{ id: "pad-01", x: 2, h: 0, z: -3, amount: 100, cooldown: 0, active: true }]);
    assert.equal("secret" in item.value, false);
  }
  assert.equal(hostTransport.metadataSent.length, 1);
  host.close();
  pilot.close();
});

test("invalid metadata is isolated from causal controls", async () => {
  const { host, pilot, hostTransport, pilotTransport, events } = pair({ metadata: true });
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  pilotTransport.options.onEvent({ type: "metadata-message", data: "not-json" });
  assert.equal(host.closed, false);
  assert.equal(pilot.closed, false);
  assert.equal(events.pilot.some(event => event.type === "metadata-error"), true);
  assert.equal(events.pilot.some(event => event.type === "error"), false);
  host.close();
  pilot.close();
});

test("metadata send failures do not stop the causal host clock", async () => {
  const { host, pilot, hostTransport, pilotTransport, events } = pair({ metadata: true });
  hostTransport.sendMetadata = () => { throw new Error("metadata unavailable"); };
  hostTransport.open();
  pilotTransport.open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pilot.causalSession.sendCommand({ ...command, fire: false }).accepted, true);
  assert.equal(host.closed, false);
  assert.equal(pilot.closed, false);
  assert.equal(events.host.some(event => event.type === "metadata-error"), true);
  assert.equal(events.host.some(event => event.type === "error"), false);
  host.close();
  pilot.close();
});
