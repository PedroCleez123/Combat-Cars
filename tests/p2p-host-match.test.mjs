import assert from "node:assert/strict";
import test from "node:test";
import { P2PHostMatch, P2P_HOST_FIXED_STEP_SECONDS } from "../src/p2p-host-match.js";
import { closeP2PResources } from "../src/p2p-host-loopback.js";
import {
  createP2PHostSnapshot,
  decodeP2PMessage,
  P2P_LOOPBACK_ROOM_ID,
  P2P_MAX_MESSAGE_BYTES,
} from "../src/p2p-session-protocol.js";

const CONTROLS = Object.freeze({ throttle: 1, steer: 0, boost: false, jump: false });

class DelayedCloseResource extends EventTarget {
  constructor(stateName, eventName, delayMs, shouldClose = true) {
    super();
    this.stateName = stateName;
    this.eventName = eventName;
    this[stateName] = "connecting";
    this.delayMs = delayMs;
    this.shouldClose = shouldClose;
    this.closeRequested = false;
  }

  close() {
    this.closeRequested = true;
    if (this.shouldClose) setTimeout(() => {
      this[this.stateName] = "closed";
      this.dispatchEvent(new Event(this.eventName));
    }, this.delayMs);
  }
}

test("P2P resource cleanup waits for delayed peer and channel closed events", async () => {
  const peers = [
    new DelayedCloseResource("connectionState", "connectionstatechange", 10),
    new DelayedCloseResource("connectionState", "connectionstatechange", 20),
  ];
  const channels = [
    new DelayedCloseResource("readyState", "close", 5),
    new DelayedCloseResource("readyState", "close", 15),
  ];

  const result = await closeP2PResources(peers, channels, 100);

  assert.deepEqual(result, { peersClosed: true });
  assert.ok([...peers, ...channels].every(resource => resource.closeRequested));
  assert.ok([...peers, ...channels].every(resource => resource.connectionState === "closed" || resource.readyState === "closed"));
});

test("P2P cleanup timeout is explicit and still requests close on every resource", async () => {
  const firstPeer = new DelayedCloseResource("connectionState", "connectionstatechange", 0, false);
  const secondPeer = new DelayedCloseResource("connectionState", "connectionstatechange", 0, false);
  const channel = new DelayedCloseResource("readyState", "close", 0, false);
  firstPeer.close = () => { firstPeer.closeRequested = true; throw new Error("partial close failure"); };

  const result = await closeP2PResources([firstPeer, secondPeer], [channel], 10);

  assert.equal(result.peersClosed, false);
  assert.match(result.reason, /superó el tiempo límite/);
  assert.ok([firstPeer, secondPeer, channel].every(resource => resource.closeRequested));
});

test("P2P host match owns a deterministic two-human, zero-bot ArenaMatch", () => {
  const first = new P2PHostMatch({ seed: 7 });
  const second = new P2PHostMatch({ seed: 7 });
  const acceptedA = first.receivePilotInput({ sequence: 1, controls: CONTROLS });
  const acceptedB = second.receivePilotInput({ sequence: 1, controls: CONTROLS });

  assert.equal(P2P_HOST_FIXED_STEP_SECONDS, 1 / 60);
  assert.equal(first.match.settings.vehicleLimit, 2);
  assert.equal(first.match.settings.botCount, 0);
  assert.equal(first.match.settings.arena, "scrapyard");
  assert.deepEqual(first.match.cars.map(car => ({ id: car.id, isBot: car.isBot })).sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "p2p-host", isBot: false },
    { id: "p2p-pilot", isBot: false },
  ]);
  assert.equal(acceptedA.accepted, true);
  assert.deepEqual(acceptedA.snapshot, acceptedB.snapshot);
  assert.equal(acceptedA.snapshot.tick, 12);
  assert.deepEqual(acceptedA.snapshot.cars.map(car => Object.keys(car).sort()), [
    ["h", "id", "team", "vh", "vx", "vz", "x", "yaw", "z"],
    ["h", "id", "team", "vh", "vx", "vz", "x", "yaw", "z"],
  ]);
  const secondInput = first.receivePilotInput({ sequence: 2, controls: CONTROLS });
  const firstPilot = acceptedA.snapshot.cars.find(car => car.id === "p2p-pilot");
  const secondPilot = secondInput.snapshot.cars.find(car => car.id === "p2p-pilot");
  assert.equal(secondInput.snapshot.tick, 24);
  assert.ok(secondPilot.x > firstPilot.x);
});

test("P2P host rejects duplicate, out-of-order and malformed pilot inputs without advancing", () => {
  const host = new P2PHostMatch();
  const first = host.receivePilotInput({ sequence: 3, controls: CONTROLS });
  assert.equal(first.accepted, true);
  const before = host.snapshot();
  assert.equal(host.receivePilotInput({ sequence: 3, controls: CONTROLS }).accepted, false);
  assert.equal(host.receivePilotInput({ sequence: 2, controls: CONTROLS }).accepted, false);
  assert.equal(host.receivePilotInput({ sequence: 4, controls: { ...CONTROLS, extra: 1 } }).accepted, false);
  assert.deepEqual(host.snapshot(), before);
});

test("P2P host can retain both players' controls and advance on a fixed host tick", () => {
  const host = new P2PHostMatch({ seed: 17 });
  assert.equal(host.setHostInput({ throttle: 1, steer: 0, boost: false, jump: false }).accepted, true);
  const input = host.receivePilotInput({ sequence: 1, controls: { throttle: 1, steer: 0, boost: false, jump: false } }, { advance: false });
  assert.equal(input.accepted, true);
  assert.equal(input.snapshot, null);
  const before = host.snapshot();
  const snapshot = host.advance(2);
  assert.equal(snapshot.tick, 4);
  assert.ok(snapshot.cars.find(car => car.id === "p2p-host").x < before.cars.find(car => car.id === "p2p-host").x);
  assert.ok(snapshot.cars.find(car => car.id === "p2p-pilot").x > before.cars.find(car => car.id === "p2p-pilot").x);
  assert.throws(() => host.advance(0), TypeError);
  assert.equal(host.setHostInput({ throttle: -1, steer: 0, boost: false, jump: false }).accepted, false);
});

test("snapshot wire messages validate exact compact cars, bounds, context and sequencing", () => {
  const host = new P2PHostMatch();
  const result = host.receivePilotInput({ sequence: 1, controls: CONTROLS });
  const snapshot = createP2PHostSnapshot({ roomId: P2P_LOOPBACK_ROOM_ID, sessionId: "test-session", sequence: 1, snapshot: result.snapshot });
  const encoded = JSON.stringify(snapshot);
  assert.ok(new TextEncoder().encode(encoded).byteLength < P2P_MAX_MESSAGE_BYTES);
  const decoded = decodeP2PMessage(encoded, { expectedType: "snapshot", roomId: P2P_LOOPBACK_ROOM_ID, sessionId: "test-session" });
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.message, snapshot);
  assert.equal(decodeP2PMessage(encoded, { roomId: "other", sessionId: "test-session" }).ok, false);

  const malformed = JSON.parse(encoded);
  malformed.snapshot.cars[0].x = 10001;
  assert.equal(decodeP2PMessage(JSON.stringify(malformed)).ok, false);
  const extraField = JSON.parse(encoded);
  extraField.snapshot.cars[0].internalState = {};
  assert.equal(decodeP2PMessage(JSON.stringify(extraField)).ok, false);
  const duplicateCar = JSON.parse(encoded);
  duplicateCar.snapshot.cars[1].id = duplicateCar.snapshot.cars[0].id;
  assert.equal(decodeP2PMessage(JSON.stringify(duplicateCar)).ok, false);
  assert.equal(decodeP2PMessage("x".repeat(P2P_MAX_MESSAGE_BYTES + 1)).ok, false);
  assert.throws(() => createP2PHostSnapshot({ roomId: P2P_LOOPBACK_ROOM_ID, sessionId: "test-session", sequence: 0, snapshot: result.snapshot }));
});
