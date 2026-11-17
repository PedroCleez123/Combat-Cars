import assert from "node:assert/strict";
import test from "node:test";

import { createP2PWasmHostMatch } from "../tools/wasm-spike/p2p-wasm-host-match.mjs";
import {
  createP2PWasmCombatDiagnosticEnvelopes,
  createP2PWasmCombatDiagnosticFixture,
  createP2PWasmCombatSnapshotEnvelope,
  decodeP2PWasmCombatSnapshotEnvelope,
  P2P_WASM_COMBAT_CAR_IDS,
  P2P_WASM_COMBAT_MAX_BYTES,
  P2P_WASM_COMBAT_MAX_HP,
  P2P_WASM_COMBAT_MAX_INPUT_SEQUENCE,
  P2P_WASM_COMBAT_MAX_TICK,
  P2P_WASM_COMBAT_MAX_VELOCITY_COMPONENT,
  P2P_WASM_COMBAT_PROTOCOL_VERSION,
  P2P_WASM_COMBAT_TYPE,
  validateP2PWasmCombatSequence,
  validateP2PWasmCombatSnapshotEnvelope,
} from "../tools/wasm-spike/p2p-wasm-combat-diagnostic.mjs";

const context = Object.freeze({ roomId: "p2p-wasm-combat-room", sessionId: "p2p-wasm-combat-session" });

function fixture() {
  return createP2PWasmCombatDiagnosticFixture({ context });
}

test("P2P-WASM-10 round-trips the exact versioned combat envelope", () => {
  const snapshot = fixture()[1];
  const text = createP2PWasmCombatSnapshotEnvelope(snapshot);
  const decoded = decodeP2PWasmCombatSnapshotEnvelope(text);

  assert.equal(decoded.protocolVersion, P2P_WASM_COMBAT_PROTOCOL_VERSION);
  assert.equal(decoded.type, P2P_WASM_COMBAT_TYPE);
  assert.deepEqual(decoded.context, context);
  assert.deepEqual(decoded.cars.map(car => car.id), P2P_WASM_COMBAT_CAR_IDS);
  assert.deepEqual(decoded.physics, snapshot.physics);
  assert.deepEqual(decoded.rockets, snapshot.rockets);
  assert.equal(decoded.events[0].kind, "hit");
  assert.equal(validateP2PWasmCombatSnapshotEnvelope(decoded), true);
  assert.ok(new TextEncoder().encode(text).byteLength <= P2P_WASM_COMBAT_MAX_BYTES);
});

test("the deterministic overlay emits fire, hit, elimination, then respawn", () => {
  const snapshots = fixture();
  assert.equal(validateP2PWasmCombatSequence(snapshots), true);
  assert.deepEqual(snapshots.map(snapshot => snapshot.events[0].kind), ["fire", "hit", "elimination", "respawn"]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.events[0].id), ["event-1", "event-2", "event-3", "event-4"]);

  const elimination = snapshots[2];
  const pilotAfterElimination = elimination.cars[1];
  assert.equal(pilotAfterElimination.hp, 0);
  assert.ok(pilotAfterElimination.respawn > 0);
  assert.equal(pilotAfterElimination.alive, false);
  assert.equal(elimination.score.blue, 1);
  assert.equal(elimination.cars[0].kills, 1);
  assert.equal(pilotAfterElimination.deaths, 1);

  const respawn = snapshots[3].cars[1];
  assert.equal(respawn.hp, P2P_WASM_COMBAT_MAX_HP);
  assert.equal(respawn.respawn, 0);
  assert.equal(respawn.alive, true);
  assert.deepEqual(snapshots.map(snapshot => snapshot.tick), [1, 2, 3, 4]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.lastInputSequence), [1, 2, 3, 4]);
});

test("the overlay accepts the physical two-car sequence from createP2PWasmHostMatch", async () => {
  const match = await createP2PWasmHostMatch({ ticksPerInput: 1 });
  const physicalSnapshots = [];
  try {
    assert.equal(match.setHostInput({ throttle: 0, steer: 0, boost: false, jump: false }).accepted, true);
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      const outcome = match.receivePilotInput({
        sequence,
        controls: { throttle: 0.02, steer: 0, boost: false, jump: false },
      });
      assert.equal(outcome.accepted, true);
      physicalSnapshots.push(outcome.snapshot);
    }
  } finally {
    match.close();
  }

  const snapshots = createP2PWasmCombatDiagnosticFixture({ physicalSnapshots, context });
  assert.equal(validateP2PWasmCombatSequence(snapshots), true);
  assert.deepEqual(snapshots[0].physics, physicalSnapshots[0].cars);
  assert.deepEqual(snapshots.map(snapshot => snapshot.tick), [1, 2, 3, 4]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.physics[0].id), ["p2p-host", "p2p-host", "p2p-host", "p2p-host"]);
});

test("strict validation rejects mutation, overflow, ordering, extra keys, and unsafe JSON", () => {
  const valid = JSON.parse(createP2PWasmCombatSnapshotEnvelope(fixture()[0]));
  const mutations = [
    value => { value.extra = true; },
    value => { value.score.blue = 1_000_001; },
    value => { value.cars[0].hp = NaN; },
    value => { value.cars[0].team = "red"; },
    value => { value.cars.reverse(); },
    value => { value.rockets[0].vx = P2P_WASM_COMBAT_MAX_VELOCITY_COMPONENT + 1; },
    value => { value.events[0].tick = 0; },
    value => { value.events[0].kind = "rocket"; },
    value => { value.physics[0].id = "other-car"; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.equal(validateP2PWasmCombatSnapshotEnvelope(candidate), false);
    assert.throws(() => decodeP2PWasmCombatSnapshotEnvelope(JSON.stringify(candidate)), /outside its versioned contract/);
  }

  assert.throws(() => createP2PWasmCombatSnapshotEnvelope({ ...fixture()[0], tick: P2P_WASM_COMBAT_MAX_TICK + 1 }), /outside its versioned envelope contract/);
  assert.throws(() => createP2PWasmCombatSnapshotEnvelope({ ...fixture()[0], lastInputSequence: P2P_WASM_COMBAT_MAX_INPUT_SEQUENCE + 1 }), /outside its versioned envelope contract/);
  const polluted = createP2PWasmCombatSnapshotEnvelope(fixture()[0]).replace('"context":', '"__proto__":{},"context":');
  assert.equal(validateP2PWasmCombatSnapshotEnvelope(JSON.parse(polluted)), false);
  assert.throws(() => decodeP2PWasmCombatSnapshotEnvelope(polluted), /outside its versioned contract/);
  assert.throws(() => decodeP2PWasmCombatSnapshotEnvelope("{"), SyntaxError);
  assert.throws(() => decodeP2PWasmCombatSnapshotEnvelope({}), TypeError);
});

test("the UTF-8 limit is inclusive and deterministic replay produces identical envelopes", () => {
  const first = createP2PWasmCombatDiagnosticEnvelopes({ context });
  const second = createP2PWasmCombatDiagnosticEnvelopes({ context });
  assert.deepEqual(first, second);
  for (const text of first) {
    const bytes = new TextEncoder().encode(text).byteLength;
    assert.ok(bytes <= P2P_WASM_COMBAT_MAX_BYTES);
    const atLimit = `${text}${" ".repeat(P2P_WASM_COMBAT_MAX_BYTES - bytes)}`;
    assert.equal(new TextEncoder().encode(atLimit).byteLength, P2P_WASM_COMBAT_MAX_BYTES);
    assert.equal(decodeP2PWasmCombatSnapshotEnvelope(atLimit).type, P2P_WASM_COMBAT_TYPE);
    assert.throws(() => decodeP2PWasmCombatSnapshotEnvelope(`${atLimit} `), RangeError);
  }
});

