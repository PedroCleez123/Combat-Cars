import assert from "node:assert/strict";
import test from "node:test";

import { createP2PFullWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-full-combat-host.mjs";
import { attitudeFromRocketSimOrientation } from "../src/rocketsim-practice-match.js";
import {
  createP2PWasmCausalCombatPresentationEnvelope,
  decodeP2PWasmCausalCombatPresentationEnvelope,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs";
import {
  createOnlineFullPresentationState,
  createOnlineFullPresentationStateFromEnvelope,
  ONLINE_FULL_PRESENTATION_STATE_VERSION,
} from "../src/online-full-presentation-state.js";

const context = Object.freeze({ roomId: "online-full-room", sessionId: "online-full-session" });
const idle = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });

async function hostSnapshot() {
  const host = await createP2PFullWasmCombatHost();
  try {
    assert.equal(host.setHostCommand({ controls: { ...idle }, fire: false, restart: false, targetId: "p2p-pilot" }).accepted, true);
    const result = await host.receivePilotCommand({ sequence: 1, controls: { ...idle }, fire: false, restart: false, targetId: "p2p-host" });
    assert.equal(result.accepted, true);
    return host.presentationSnapshot();
  } finally {
    host.close();
  }
}

test("online full host exposes an empty combat-alpha pickup metadata list", async () => {
  const host = await createP2PFullWasmCombatHost();
  try {
    const first = await host.advance();
    assert.equal(first.pads.length, 0, "combat-alpha no longer exposes floor pickups");
    const metadata = host.metadataSnapshot();
    assert.equal(metadata.tick, first.tick);
    assert.deepEqual(metadata.players.map(player => player.id), ["p2p-host", "p2p-pilot"]);
    assert.equal(metadata.pads.length, 0, "presentation metadata must not recreate pickups");
    assert.deepEqual(host.presentationSnapshot().pads, first.pads, "metadata derivation must not mutate the host snapshot");
  } finally {
    host.close();
  }
});

test("online full host keeps an explicit nullable targetId for an unguided launch", async () => {
  const host = await createP2PFullWasmCombatHost();
  try {
    assert.equal(host.setHostCommand({ controls: { ...idle }, fire: true, restart: false, targetId: null }).accepted, true);
    const result = await host.receivePilotCommand({ sequence: 1, controls: { ...idle }, fire: false, restart: false, targetId: null });
    const rocket = result.snapshot.combat.rockets[0];
    assert.ok(rocket, "the full host should publish the first straight launch");
    assert.equal(Object.hasOwn(rocket, "targetId"), true);
    assert.equal(rocket.targetId, null);
  } finally {
    host.close();
  }
});

test("online full presentation state adapts a real two-car host snapshot and keeps authoritative telemetry", async () => {
  const snapshot = await hostSnapshot();
  const before = structuredClone(snapshot);
  const state = createOnlineFullPresentationState(snapshot, context);
  assert.deepEqual(snapshot, before, "the adapter must not mutate the host snapshot");
  assert.equal(state.settings.onlineFullPresentationStateVersion, ONLINE_FULL_PRESENTATION_STATE_VERSION);
  assert.equal(state.time, snapshot.tick / 60);
  assert.deepEqual(state.score, snapshot.combat.score);
  assert.equal(state.inputAcknowledged, snapshot.lastInputSequence);
  assert.equal(state.cars.length, 2);
  assert.ok(Array.isArray(snapshot.pads));
  assert.deepEqual(state.pads, snapshot.pads, "the full host path must retain authoritative pickup state");
  for (const [index, car] of state.cars.entries()) {
    const physical = snapshot.physical[index];
    const telemetry = snapshot.presentation[index];
    const combat = snapshot.combat.cars[index];
    assert.equal(car.id, physical.id);
    assert.deepEqual(car.orientation, telemetry.orientation);
    assert.deepEqual(car.angularVelocity, telemetry.angularVelocity);
    assert.equal(car.boost, telemetry.boost);
    assert.equal(car.jumps, telemetry.jumps);
    assert.equal(car.jumpState, telemetry.jumpState);
    assert.deepEqual(car.actionSerials, telemetry.actionSerials);
    assert.equal(car.hp, combat.hp);
    assert.equal(car.respawn, combat.respawn);
    assert.equal(car.speed, Math.hypot(physical.vx, physical.vz, physical.vh));
  }
});

test("online full presentation derives HUD attitude with the local RocketSim quaternion policy", async () => {
  const snapshot = await hostSnapshot();
  const orientation = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  const tilted = structuredClone(snapshot);
  tilted.presentation[0].orientation = orientation;
  const expected = attitudeFromRocketSimOrientation(orientation);
  const state = createOnlineFullPresentationState(tilted, context);
  assert.equal(state.cars[0].pitch, expected.pitch);
  assert.equal(state.cars[0].roll, expected.roll);
  assert.notEqual(state.cars[0].roll, 0, "a tilted authoritative quaternion must not collapse to HUD roll zero");
});

test("online full presentation carries RocketSim jump edges and ignores legacy round reset fields", async () => {
  const host = await createP2PFullWasmCombatHost();
  const command = (controls, { restart = false } = {}) => ({ controls, fire: false, restart, targetId: "p2p-pilot" });
  const pilotCommand = sequence => ({ sequence, controls: { ...idle }, fire: false, restart: false, targetId: "p2p-host" });
  try {
    assert.equal(host.setHostCommand(command({ ...idle })).accepted, true);
    assert.equal((await host.receivePilotCommand(pilotCommand(1))).accepted, true);
    assert.equal(host.setHostCommand(command({ ...idle, jump: true })).accepted, true);
    const jumped = (await host.receivePilotCommand(pilotCommand(2))).snapshot;
    const hostCar = jumped.presentation.find(car => car.id === "p2p-host");
    assert.equal(hostCar.actionSerials.jump, 1, "the host must derive the jump edge from native RocketSim flags");

    const jumpedEnvelope = decodeP2PWasmCausalCombatPresentationEnvelope(
      createP2PWasmCausalCombatPresentationEnvelope({ ...context, sequence: 2, snapshot: jumped }),
    );
    const jumpedState = createOnlineFullPresentationStateFromEnvelope(jumpedEnvelope, context);
    assert.deepEqual(jumpedState.cars.find(car => car.id === "p2p-host").actionSerials, hostCar.actionSerials);

    assert.equal(host.setHostCommand(command({ ...idle }, { restart: true })).accepted, true);
    const ignored = (await host.receivePilotCommand(pilotCommand(3))).snapshot;
    const unchangedCar = ignored.presentation.find(car => car.id === "p2p-host");
    assert.equal(ignored.combat.round.serial, 1);
    assert.deepEqual(unchangedCar.actionSerials, hostCar.actionSerials);
    const resetState = createOnlineFullPresentationStateFromEnvelope(
      decodeP2PWasmCausalCombatPresentationEnvelope(
        createP2PWasmCausalCombatPresentationEnvelope({ ...context, sequence: 3, snapshot: ignored }),
      ),
      context,
    );
    assert.equal(resetState.settings.roundSerial, 1);
    assert.deepEqual(resetState.cars.find(car => car.id === "p2p-host").actionSerials, unchangedCar.actionSerials);
  } finally {
    host.close();
  }
});

test("online full presentation state rejects stale explicit pads and malformed source or context", async () => {
  const snapshot = await hostSnapshot();
  const withPads = { ...snapshot, pads: [{ id: 0, active: false, cooldown: 1.25, timer: 1.25 }] };
  const state = createOnlineFullPresentationState(withPads, context);
  assert.deepEqual(state.pads, [], "combat-alpha must not render legacy floor pads");
  assert.equal(state.rules.pads, false);
  assert.throws(() => createOnlineFullPresentationState({ ...snapshot, tick: 0 }, context), /forma versionada/);
  assert.throws(() => createOnlineFullPresentationState(snapshot, { ...context, roomId: "bad room" }), /roomId/);
  assert.throws(() => createOnlineFullPresentationState(snapshot, { sessionId: context.sessionId }), /roomId/);
  assert.throws(() => createOnlineFullPresentationState({ ...snapshot, extra: true }, context), /forma versionada/);
});

test("online full presentation suppresses stale boost-pad events", async () => {
  const snapshot = await hostSnapshot();
  snapshot.combat.events = [{ kind: "pad", text: "PILOTO recoge nitro.", at: 0.1 }];
  const state = createOnlineFullPresentationState(snapshot, context);
  assert.equal(state.events.length, 0);
});

test("online full host never emits legacy pickup events after boost regeneration", async () => {
  const host = await createP2PFullWasmCombatHost();
  try {
    let pickupSeen = false;
    for (let sequence = 1; sequence <= 700; sequence += 1) {
      const controls = {
        throttle: 1, steer: 0, pitch: 0, yaw: 0, roll: 0,
        boost: sequence % 10 === 0, jump: false, drift: false, airRoll: false, handbrake: false,
      };
      host.receivePilotCommand({ sequence, controls, fire: sequence % 15 === 0, restart: false, targetId: "p2p-host" }, { advance: false });
      await host.advance(1);
      const snapshot = host.presentationSnapshot();
      pickupSeen ||= snapshot.combat.events.some(event => event.kind === "pad");
    }
    assert.equal(pickupSeen, false, "the full combat host must not emit pickup events");
  } finally {
    host.close();
  }
});

test("online full presentation state accepts the decoded v5 envelope used by the public render buffer", async () => {
  const snapshot = await hostSnapshot();
  const envelope = decodeP2PWasmCausalCombatPresentationEnvelope(
    createP2PWasmCausalCombatPresentationEnvelope({ ...context, sequence: 1, snapshot }),
  );
  const before = structuredClone(envelope);
  const state = createOnlineFullPresentationStateFromEnvelope(envelope, context);
  assert.deepEqual(envelope, before, "the public-envelope adapter must not mutate network data");
  assert.equal(state.settings.roomId, context.roomId);
  assert.equal(state.settings.sessionId, context.sessionId);
  assert.equal(state.settings.onlineFullPresentationStateVersion, ONLINE_FULL_PRESENTATION_STATE_VERSION);
  assert.equal(state.cars.length, 2);
  assert.deepEqual(state.pads, [], "v5 deliberately omits pads until a later wire-contract version carries them");
  assert.deepEqual(state.cars.map(car => car.jumpState), envelope.presentation.map(car => car.jumpState));
  assert.deepEqual(state.cars.map(car => car.actionSerials), envelope.presentation.map(car => car.actionSerials));
  assert.throws(() => createOnlineFullPresentationStateFromEnvelope({ ...envelope, sequence: 0 }, context), /no cumple/);
});

