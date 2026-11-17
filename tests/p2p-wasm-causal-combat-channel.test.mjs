import assert from "node:assert/strict";
import test from "node:test";

import {
  createP2PWasmCausalCombatCommand,
  createP2PWasmCausalCombatHello,
  createP2PWasmCausalCombatWelcome,
  decodeP2PWasmCausalCombatChannelMessage,
  P2PWasmCausalCombatHostChannelSession,
  P2PWasmCausalCombatPilotChannelSession,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-channel.mjs";
import { createP2PWasmCausalCombatEnvelope } from "../tools/wasm-spike/p2p-wasm-causal-combat-protocol.mjs";
import {
  createP2PWasmCausalCombatPresentationEnvelope,
  P2P_WASM_PRESENTATION_PROTOCOL_VERSION,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs";
import { createP2PWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-combat-host.mjs";
import { createP2PPlayerIdentityEnvelope } from "../src/p2p-player-identity.js";
import { decodeP2PMessage } from "../src/p2p-session-protocol.js";

const context = Object.freeze({ roomId: "p2p-causal-room", sessionId: "p2p-causal-session" });
const idle = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const command = (overrides = {}) => ({ controls: { ...idle }, fire: false, restart: false, targetId: null, ...overrides });

function causalSnapshot(tick) {
  const physical = [
    { id: "p2p-host", team: "blue", x: tick, z: 0, h: 1, yaw: 0, vx: 0, vz: 0, vh: 0 },
    { id: "p2p-pilot", team: "red", x: -tick, z: 0, h: 1, yaw: Math.PI, vx: 0, vz: 0, vh: 0 },
  ];
  const cars = [
    { id: "p2p-host", team: "blue", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
    { id: "p2p-pilot", team: "red", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
  ];
  return {
    tick,
    lastInputSequence: 1,
    physical,
    combat: {
      score: { blue: 0, red: 0 },
      round: { state: "active", scoreToWin: 15, winner: null, serial: 1 },
      cars,
      rockets: [],
      events: [],
      eliminated: [],
      respawns: [],
    },
  };
}

test("P2P-WASM-22 carries an actual causal host fire snapshot through ordered hello/welcome/command/snapshot boundaries", async () => {
  const host = await createP2PWasmCombatHost();
  let hostChannel;
  let pilotChannel;
  const hostFrames = [];
  const pilotFrames = [];
  try {
    hostChannel = new P2PWasmCausalCombatHostChannelSession({
      ...context,
      host,
      send: text => {
        hostFrames.push(text);
        return pilotChannel.receive(text);
      },
    });
    pilotChannel = new P2PWasmCausalCombatPilotChannelSession({
      ...context,
      send: text => {
        pilotFrames.push(text);
        return hostChannel.receive(text);
      },
    });

    const started = pilotChannel.start();
    assert.equal(started.accepted, true);
    assert.equal(hostChannel.state, "active");
    assert.equal(pilotChannel.state, "active");
    assert.equal(pilotFrames.length, 1, "the pilot sends exactly hello before commands");
    assert.equal(hostFrames.length, 1, "the host replies with exactly welcome before snapshots");

    const first = pilotChannel.sendCommand(command({ fire: true, targetId: "p2p-host" }));
    assert.equal(first.accepted, true);
    assert.equal(pilotChannel.lastSnapshot.events[0].kind, "fire");
    assert.equal(pilotChannel.lastSnapshot.rockets[0].targetId, "p2p-host");
    assert.equal(pilotChannel.lastAcknowledgedCommandSequence, 1);

    const second = pilotChannel.sendCommand(command());
    assert.equal(second.accepted, true);
    assert.equal(pilotChannel.snapshotSequence, 2);
    assert.equal(pilotChannel.lastSnapshot.lastInputSequence, 2);
    assert.equal(hostChannel.commandSequence, 2);
    assert.equal(hostChannel.snapshotSequence, 2);
    assert.equal(hostFrames.length, 3, "welcome plus one causal snapshot per accepted command");

    const causalFrame = hostFrames.at(-1);
    assert.equal(decodeP2PWasmCausalCombatChannelMessage(causalFrame, context).ok, true);
    assert.equal(decodeP2PMessage(causalFrame).ok, false, "P2P v1 must not silently accept causal frames");
  } finally {
    hostChannel?.close();
    hostChannel?.close();
  }
});

test("P2P-WASM-22 rejects pilot self-targeting, context/ordering violations and closes the authority boundary", () => {
  const received = [];
  const fakeHost = {
    closed: 0,
    receivePilotCommand() { received.push("command"); return { accepted: true, snapshot: null }; },
    close() { this.closed += 1; },
  };
  const hostChannel = new P2PWasmCausalCombatHostChannelSession({ ...context, host: fakeHost, send: () => {} });

  const beforeHello = hostChannel.receive(JSON.stringify({ type: "other" }));
  assert.equal(beforeHello.accepted, false);
  assert.equal(beforeHello.close, true);
  assert.equal(hostChannel.state, "closed");
  assert.equal(fakeHost.closed, 1);
  hostChannel.close();
  assert.equal(fakeHost.closed, 1, "authority cleanup is idempotent");
  assert.deepEqual(received, []);

  const targetSelf = command({ fire: true, targetId: "p2p-pilot" });
  assert.throws(() => createP2PWasmCausalCombatCommand({ ...context, sequence: 1, command: targetSelf }), /invalid/);
  const validHello = createP2PWasmCausalCombatHello(context);
  assert.equal(decodeP2PWasmCausalCombatChannelMessage(validHello, { ...context, expectedType: "wasm-causal-combat-hello" }).ok, true);
  assert.equal(decodeP2PWasmCausalCombatChannelMessage(validHello, { ...context, roomId: "other" }).ok, false);
});

test("ONLINE-IDENTITY-22 exchanges bounded names only after the causal handshake", async () => {
  const host = await createP2PWasmCombatHost();
  let hostChannel;
  let pilotChannel;
  const hostFrames = [];
  const pilotFrames = [];
  try {
    hostChannel = new P2PWasmCausalCombatHostChannelSession({
      ...context,
      host,
      identityName: "HOST <unsafe>",
      send: text => { hostFrames.push(text); return pilotChannel.receive(text); },
    });
    pilotChannel = new P2PWasmCausalCombatPilotChannelSession({
      ...context,
      identityName: "PILOTO 🚀",
      send: text => { pilotFrames.push(text); return hostChannel.receive(text); },
    });
    const started = pilotChannel.start();
    assert.equal(started.accepted, true);
    assert.equal(hostChannel.remoteIdentity.name, "PILOTO");
    assert.equal(pilotChannel.remoteIdentity.name, "HOST unsafe");
    assert.equal(hostFrames.length, 2, "welcome and host identity follow the handshake");
    assert.equal(pilotFrames.length, 2, "hello and pilot identity are the only pilot pre-command frames");

    const beforeHello = new P2PWasmCausalCombatHostChannelSession({ ...context, host: await createP2PWasmCombatHost(), send: () => {} });
    const identity = createP2PPlayerIdentityEnvelope({ ...context, role: "pilot", name: "Intruso" });
    assert.equal(beforeHello.receive(identity).close, true, "identity before hello is rejected");
    beforeHello.close();

    const decoded = hostChannel.receive(createP2PPlayerIdentityEnvelope({ ...context, role: "pilot", name: "second" }));
    assert.equal(decoded.close, true, "duplicate peer identity is rejected");
  } finally {
    hostChannel?.close();
    pilotChannel?.close();
  }
});

test("P2P-WASM-39 ignores duplicate snapshots and records a bounded snapshot gap", () => {
  const frames = [];
  const pilotChannel = new P2PWasmCausalCombatPilotChannelSession({
    ...context,
    send: text => frames.push(text),
  });
  assert.equal(pilotChannel.start().accepted, true);
  assert.equal(pilotChannel.receive(createP2PWasmCausalCombatWelcome(context)).accepted, true);
  assert.equal(pilotChannel.sendCommand(command()).accepted, true);

  const first = createP2PWasmCausalCombatEnvelope({ ...context, sequence: 1, snapshot: causalSnapshot(1) });
  const duplicate = pilotChannel.receive(first);
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.type, "snapshot");
  const repeated = pilotChannel.receive(first);
  assert.equal(repeated.accepted, true);
  assert.equal(repeated.type, "snapshot-ignored");
  assert.equal(pilotChannel.ignoredSnapshotCount, 1);

  const gap = pilotChannel.receive(createP2PWasmCausalCombatEnvelope({ ...context, sequence: 3, snapshot: causalSnapshot(3) }));
  assert.equal(gap.accepted, true);
  assert.equal(gap.dropped, 1);
  assert.equal(pilotChannel.droppedSnapshotCount, 1);
  assert.equal(pilotChannel.snapshotSequence, 3);
  assert.equal(pilotChannel.lastSnapshot.tick, 3);
  const staleTick = pilotChannel.receive(createP2PWasmCausalCombatEnvelope({ ...context, sequence: 4, snapshot: causalSnapshot(2) }));
  assert.equal(staleTick.accepted, true);
  assert.equal(staleTick.type, "snapshot-ignored");
  assert.equal(pilotChannel.lastSnapshot.tick, 3);
  assert.equal(pilotChannel.snapshotSequence, 3);
  assert.equal(pilotChannel.ignoredSnapshotCount, 2);
  assert.equal(pilotChannel.state, "active");
  assert.equal(frames.length, 2, "hello and the one command are the only pilot frames");
});

test("P2P-WASM-45 keeps v1 default strict while an explicit pilot accepts only ordered v2 presentation", async () => {
  const frames = [];
  const pilot = new P2PWasmCausalCombatPilotChannelSession({ ...context, presentation: true, send: text => frames.push(text) });
  assert.equal(pilot.start().accepted, true);
  assert.equal(pilot.receive(createP2PWasmCausalCombatWelcome(context)).accepted, true);
  assert.equal(pilot.sendCommand(command()).accepted, true);

  const host = await createP2PWasmCombatHost();
  try {
    const first = host.receivePilotCommand({ sequence: 1, ...command() }).snapshot;
    const extended = host.presentationSnapshot();
    const wire = createP2PWasmCausalCombatPresentationEnvelope({ ...context, sequence: 1, snapshot: extended });
    const accepted = pilot.receive(wire);
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.type, "presentation-snapshot");
    assert.equal(accepted.envelope.protocolVersion, P2P_WASM_PRESENTATION_PROTOCOL_VERSION);
    assert.equal(pilot.lastSnapshot.tick, first.tick);
    assert.equal(pilot.receive(createP2PWasmCausalCombatEnvelope({ ...context, sequence: 2, snapshot: first })).close, true, "a v1 frame cannot downgrade a v2 presentation pilot");
  } finally {
    host.close();
  }
});
