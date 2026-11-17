import assert from "node:assert/strict";
import test from "node:test";

import { P2PHostChannelSession, P2PPilotChannelSession } from "../src/p2p-match-channel.js";
import { createP2PInput, createP2PWelcome } from "../src/p2p-session-protocol.js";

const context = Object.freeze({ roomId: "p2p-private-room", sessionId: "p2p-session" });
const controls = Object.freeze({ throttle: 1, steer: 0, boost: false, jump: false });

function pairedSessions() {
  let host;
  let pilot;
  const hostInbox = [];
  const pilotInbox = [];
  host = new P2PHostChannelSession({
    ...context,
    send: (serialized) => { hostInbox.push(serialized); pilot.receive(serialized); },
  });
  pilot = new P2PPilotChannelSession({
    ...context,
    send: (serialized) => { pilotInbox.push(serialized); host.receive(serialized); },
  });
  return { host, pilot, hostInbox, pilotInbox };
}

test("host-authoritative channel performs hello/welcome, accepts pilot input, and returns compact snapshots", () => {
  const { host, pilot, hostInbox, pilotInbox } = pairedSessions();
  const hello = pilot.start();
  assert.equal(hello.accepted, true);
  assert.equal(host.state, "active");
  assert.equal(pilot.state, "active");
  assert.equal(hostInbox.length, 1);
  assert.equal(pilotInbox.length, 1);

  const first = pilot.sendInput(controls);
  const second = pilot.sendInput({ ...controls, steer: 0.25 });
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(pilot.lastSnapshot.lastInputSequence, 2);
  assert.equal(pilot.lastSnapshot.tick, 24);
  assert.equal(pilot.snapshotSequence, 2);
  assert.equal(host.snapshotSequence, 2);
  assert.equal(pilot.lastSnapshot.cars.length, 2);
});

test("channel closes on invalid context or protocol order, but rejects duplicated pilot input without advancing", () => {
  const { host, pilot } = pairedSessions();
  pilot.start();
  const accepted = pilot.sendInput(controls);
  assert.equal(accepted.accepted, true);
  const beforeTick = pilot.lastSnapshot.tick;

  const duplicate = createP2PInput({ ...context, sequence: 1, controls });
  const rejected = host.receive(JSON.stringify(duplicate));
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.close, false);
  assert.equal(host.match.snapshot().tick, beforeTick);
  assert.equal(host.state, "active");

  const badContext = JSON.stringify({ ...createP2PWelcome(context), roomId: "other-room" });
  const bad = pilot.receive(badContext);
  assert.equal(bad.close, true);
  assert.equal(pilot.state, "closed");
});

test("host enters active state before a synchronous welcome callback can return the first input", () => {
  let host;
  let reentrantResult;
  host = new P2PHostChannelSession({
    ...context,
    send: (serialized) => {
      const message = JSON.parse(serialized);
      if (message.type === "welcome") {
        reentrantResult = host.receive(JSON.stringify(createP2PInput({ ...context, sequence: 1, controls })));
      }
    },
  });
  const hello = host.receive(JSON.stringify({ type: "hello", protocolVersion: 1, ...context, sequence: 0 }));
  assert.equal(hello.accepted, true);
  assert.equal(reentrantResult.accepted, true);
  assert.equal(host.state, "active");
  assert.equal(host.match.snapshot().tick, 12);
});

test("a fixed host tick can retain controls and emit several snapshots for one pilot input", () => {
  const hostMessages = [];
  const pilotMessages = [];
  let host;
  let pilot;
  host = new P2PHostChannelSession({
    ...context,
    advanceOnPilotInput: false,
    send: (serialized) => { hostMessages.push(serialized); pilot.receive(serialized); },
  });
  pilot = new P2PPilotChannelSession({
    ...context,
    send: (serialized) => { pilotMessages.push(serialized); host.receive(serialized); },
  });
  pilot.start();
  assert.equal(pilot.sendInput(controls).accepted, true);
  assert.equal(host.snapshotSequence, 0, "input only updates retained controls in fixed-tick mode");
  assert.equal(host.setHostInput({ throttle: 1, steer: 0, boost: false, jump: false }).accepted, true);
  assert.equal(host.advance(1).accepted, true);
  assert.equal(host.advance(1).accepted, true);
  assert.equal(host.snapshotSequence, 2);
  assert.equal(pilot.snapshotSequence, 2);
  assert.equal(pilot.lastSnapshot.lastInputSequence, 1, "several newer snapshots may acknowledge the retained input");
  assert.equal(hostMessages.length, 3);
  assert.equal(pilotMessages.length, 2);
});

test("constructor and send failures fail closed without exposing transport details", () => {
  assert.throws(() => new P2PHostChannelSession({ ...context, send: null }), TypeError);
  assert.throws(() => new P2PPilotChannelSession({ roomId: "bad room", sessionId: context.sessionId, send: () => {} }), TypeError);
  const pilot = new P2PPilotChannelSession({ ...context, send: () => { throw new Error("private transport failure"); } });
  const result = pilot.start();
  assert.equal(result.close, true);
  assert.equal(pilot.state, "closed");
  assert.equal(result.reason.includes("private transport failure"), false);
});
