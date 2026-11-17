import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { P2PHostChannelSession, P2PPilotChannelSession } from "../src/p2p-match-channel.js";
import { resolveWasmSmokeResource } from "../tools/wasm-spike/browser-smoke-server.mjs";
import {
  createP2PWasmHostMatch,
  P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  P2P_WASM_HOST_FIXTURES,
} from "../tools/wasm-spike/p2p-wasm-host-match.mjs";
import {
  createP2PWasmSnapshotEnvelope,
  decodeP2PWasmSnapshotEnvelope,
} from "../tools/wasm-spike/p2p-wasm-snapshot-protocol.mjs";

const context = Object.freeze({ roomId: "p2p-wasm-room", sessionId: "p2p-wasm-session" });
const idle = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });

function makeOutOfContractModule() {
  const memory = new ArrayBuffer(1024);
  let wasmTick = 0;
  const freed = [];
  let destroyed = 0;
  const module = {
    HEAPU32: new Uint32Array(memory),
    HEAPF32: new Float32Array(memory),
    _malloc: (() => { let pointer = 4; return () => { const result = pointer; pointer += 40; return result; }; })(),
    _free: pointer => freed.push(pointer),
    _rs_init_trace_combat_lineup: () => 1,
    _rs_destroy: () => { destroyed += 1; },
    _rs_set_controls_for_car: () => 1,
    _rs_step: () => { wasmTick += 1; return 1; },
    _rs_snapshot_car: (index, tickPointer, statePointer) => {
      module.HEAPU32[tickPointer >>> 2] = wasmTick;
      module.HEAPF32.set([
        index === 0 ? 0 : -600,
        0,
        17,
        201,
        0,
        0,
        1,
        0,
        0,
      ], statePointer >>> 2);
      return 1;
    },
    _rs_snapshot_car_authority: (index, tickPointer, statePointer) => {
      module.HEAPU32[tickPointer >>> 2] = wasmTick;
      module.HEAPF32.set([
        0, 0, 17, 0, 0, 0,
        0, 0, 0, 1,
        100, 1, 4, 2, 0, 0, 0,
        0, 0, 0,
        1, 0, 1, 0,
        0, 0, 0, 0,
      ], statePointer >>> 2);
      return 1;
    },
  };
  return { module, freed, get destroyed() { return destroyed; } };
}

test("P2P-WASM-07 host channel sends four compact two-car WASM snapshots on the 60 Hz timeline", async () => {
  const match = await createP2PWasmHostMatch();
  const hostMessages = [];
  let host;
  const pilot = new P2PPilotChannelSession({
    ...context,
    send: serialized => host.receive(serialized),
  });
  host = new P2PHostChannelSession({
    ...context,
    match,
    send: serialized => {
      hostMessages.push(serialized);
      pilot.receive(serialized);
    },
  });

  try {
    assert.equal(pilot.start().accepted, true);
    assert.equal(host.setHostInput(idle).accepted, true);
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      const outcome = pilot.sendInput({ throttle: 0.02, steer: 0, boost: false, jump: false });
      assert.equal(outcome.accepted, true);
      assert.equal(outcome.type, "input");
    }

    const snapshots = hostMessages
      .map(serialized => JSON.parse(serialized))
      .filter(message => message.type === "snapshot");
    assert.equal(snapshots.length, 4);
    assert.deepEqual(snapshots.map(message => message.snapshot.tick), [6, 12, 18, 24]);
    assert.equal(match.tick, 24);
    assert.equal(match.wasmTick, 48, "each 60 Hz host tick must perform two 120 Hz WASM steps");
    assert.equal(pilot.lastSnapshot.tick, 24);

    for (const [index, message] of snapshots.entries()) {
      assert.ok(new TextEncoder().encode(JSON.stringify(message)).byteLength <= 2048);
      assert.equal(message.snapshot.lastInputSequence, index + 1);
      assert.deepEqual(message.snapshot.cars.map(car => car.id), ["p2p-host", "p2p-pilot"]);
      assert.deepEqual(message.snapshot.cars.map(car => car.team), ["blue", "red"]);
      assert.equal(message.snapshot.cars.length, 2);
      for (const car of message.snapshot.cars) {
        for (const velocity of [car.vx, car.vz, car.vh]) {
          assert.ok(Number.isFinite(velocity) && velocity >= -200 && velocity <= 200);
        }
      }
    }
  } finally {
    match.close();
  }

  assert.equal(match.closed, true);
});

test("P2P-WASM-18 selects combat-alpha-pair explicitly while retaining the 60 Hz host timeline and lifecycle", async () => {
  const match = await createP2PWasmHostMatch({
    fixture: P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR,
    ticksPerInput: 1,
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  });
  try {
    assert.equal(match.fixture, P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR);
    assert.equal(match.setHostInput({ throttle: 0.5, steer: 0, boost: false, jump: false }).accepted, true);

    let outcome = match.receivePilotInput({ sequence: 1, controls: idle });
    assert.equal(outcome.accepted, true);
    const initial = outcome.snapshot;
    assert.equal(initial.tick, 1);
    assert.equal(match.wasmTick, 2);
    assert.ok(initial.cars[0].x < -1400 && initial.cars[0].z < -1200, "host must use combat-alpha spawn one");
    assert.ok(initial.cars[1].x > 1900 && initial.cars[1].z > 1200, "pilot must use combat-alpha spawn two");
    assert.ok(Math.abs(initial.cars[0].yaw) < 0.02);
    assert.ok(Math.abs(Math.abs(initial.cars[1].yaw) - Math.PI) < 0.02);

    for (let sequence = 2; sequence <= 30; sequence += 1) {
      outcome = match.receivePilotInput({ sequence, controls: idle });
      assert.equal(outcome.accepted, true);
    }
    assert.equal(outcome.snapshot.tick, 30);
    assert.equal(match.wasmTick, 60);
    assert.ok(outcome.snapshot.cars[0].x > initial.cars[0].x, "host throttle must advance on combat-alpha too");

    const inactive = match.setCombatActive(1, false);
    assert.equal(inactive.tick, 30, "lifecycle must not advance the external host tick");
    assert.ok(inactive.cars[1].h <= -9999, "inactive pilot must leave the physical arena");
    const respawned = match.respawn(1);
    assert.equal(respawned.tick, 30, "respawn must not advance the external host tick");
    assert.ok(respawned.cars[1].x > 1900 && respawned.cars[1].z > 1200 && respawned.cars[1].h > -1000);
    assert.ok(Math.abs(Math.abs(respawned.cars[1].yaw) - Math.PI) < 0.02);
  } finally {
    match.close();
  }
});

test("ONLINE-INPUT-15 carries reverse throttle through the causal WASM host", async () => {
  const forward = await createP2PWasmHostMatch({
    fixture: P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR,
    ticksPerInput: 1,
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  });
  const reverse = await createP2PWasmHostMatch({
    fixture: P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR,
    ticksPerInput: 1,
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  });
  try {
    assert.equal(forward.setHostInput({ throttle: 1, steer: 0, boost: false, jump: false }).accepted, true);
    assert.equal(reverse.setHostInput({ throttle: -1, steer: 0, boost: false, jump: false }).accepted, true);
    const forwardStart = forward.receivePilotInput({ sequence: 1, controls: idle }).snapshot.cars[0];
    const reverseStart = reverse.receivePilotInput({ sequence: 1, controls: idle }).snapshot.cars[0];
    const forwardEnd = forward.advance(60).cars[0];
    const reverseEnd = reverse.advance(60).cars[0];
    assert.ok(forwardEnd.x > forwardStart.x, "forward throttle must advance the host along its spawn heading");
    assert.ok(reverseEnd.x < reverseStart.x, "reverse throttle must move the host opposite its spawn heading");
  } finally {
    forward.close();
    reverse.close();
  }
});

test("P2P-WASM-40 exposes authoritative presentation telemetry only through the explicit extended ABI", async () => {
  const match = await createP2PWasmHostMatch({ ticksPerInput: 1 });
  try {
    const outcome = match.receivePilotInput({ sequence: 1, controls: idle });
    assert.equal(outcome.accepted, true);
    assert.deepEqual(Object.keys(outcome.snapshot).sort(), ["cars", "lastInputSequence", "tick"], "the compact transport contract must remain byte-compatible");
    assert.equal(match.hasPresentationSnapshot(), true);

    const presentation = match.presentationSnapshot();
    assert.equal(presentation.tick, 1);
    assert.equal(presentation.lastInputSequence, 1);
    assert.equal(presentation.cars.length, 2);
    assert.equal(presentation.presentation.length, 2);
    for (const car of presentation.presentation) {
      assert.deepEqual(Object.keys(car).sort(), [
        "actionSerials", "angularVelocity", "boost", "boosting", "grounded", "id", "jumpState", "jumps", "orientation",
        "powerslide", "supersonic", "team", "wheelContact", "wheelCount", "worldContact",
      ]);
      assert.ok(Number.isFinite(car.boost) && car.boost >= 0 && car.boost <= 100);
      assert.ok(Number.isInteger(car.wheelCount) && car.wheelCount >= 0 && car.wheelCount <= 4);
      assert.ok(Number.isInteger(car.jumps) && car.jumps >= 0 && car.jumps <= 2);
      assert.ok(Math.abs(Math.hypot(car.orientation.x, car.orientation.y, car.orientation.z, car.orientation.w) - 1) < .001);
      assert.equal(typeof car.grounded, "boolean");
      assert.ok(["grounded", "first-jump", "double-jump", "dodge", "airborne"].includes(car.jumpState));
      assert.deepEqual(car.actionSerials, { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 });
      assert.equal(typeof car.wheelContact.hasContact, "boolean");
      assert.equal(typeof car.worldContact.hasContact, "boolean");
      assert.ok(Object.values(car.angularVelocity).every(Number.isFinite));
    }
  } finally {
    match.close();
  }
});

test("P2P-WASM-40 rejects overlapping WASM snapshot buffers and frees one owner once", async () => {
  const fake = makeOutOfContractModule();
  fake.module._malloc = () => 4;
  await assert.rejects(
    createP2PWasmHostMatch({ moduleFactory: async () => fake.module }),
    /buffers overlap/,
  );
  assert.deepEqual(fake.freed, [4]);
  assert.equal(fake.destroyed, 1);
});

test("P2P-WASM-40 fails closed when extended telemetry leaves its ABI contract", async () => {
  const fake = makeOutOfContractModule();
  const compact = fake.module._rs_snapshot_car;
  fake.module._rs_snapshot_car = (...args) => {
    const result = compact(...args);
    fake.module.HEAPF32[(args[2] >>> 2) + 3] = 0;
    return result;
  };
  const presentation = fake.module._rs_snapshot_car_authority;
  const match = await createP2PWasmHostMatch({ moduleFactory: async () => fake.module, ticksPerInput: 1 });
  match.receivePilotInput({ sequence: 1, controls: idle });
  fake.module._rs_snapshot_car_authority = (...args) => {
    const result = presentation(...args);
    fake.module.HEAPF32[(args[2] >>> 2) + 10] = 101;
    return result;
  };
  assert.throws(() => match.presentationSnapshot(), /outside its contract/);
  assert.equal(match.closed, true);
  assert.deepEqual(fake.freed, [44, 4]);
  assert.equal(fake.destroyed, 1);
});

test("P2P-WASM-18 rejects an unknown fixture before loading a WASM module", async () => {
  let factoryCalled = false;
  await assert.rejects(
    createP2PWasmHostMatch({ fixture: "not-a-fixture", moduleFactory: async () => { factoryCalled = true; return null; } }),
    /fixture must be combat-lineup or combat-alpha-pair/,
  );
  assert.equal(factoryCalled, false);
});

test("P2P-WASM-07 fails explicitly and releases WASM memory when velocity exceeds the protocol range", async () => {
  const fake = makeOutOfContractModule();
  const match = await createP2PWasmHostMatch({ moduleFactory: async () => fake.module, ticksPerInput: 1 });
  assert.throws(
    () => match.receivePilotInput({ sequence: 1, controls: idle }),
    /exceeds the P2P snapshot contract/,
  );
  assert.equal(match.closed, true);
  assert.deepEqual(fake.freed, [44, 4]);
  assert.equal(fake.destroyed, 1);
});

test("P2P-WASM-07 destroys the fixture and frees both buffers on explicit cleanup", async () => {
  const fake = makeOutOfContractModule();
  // Keep fake velocities valid for this lifecycle-only case.
  const snapshot = fake.module._rs_snapshot_car;
  fake.module._rs_snapshot_car = (...args) => {
    const result = snapshot(...args);
    fake.module.HEAPF32[(args[2] >>> 2) + 3] = 0;
    return result;
  };
  const match = await createP2PWasmHostMatch({ moduleFactory: async () => fake.module });
  match.cleanup();
  match.close();
  assert.equal(match.closed, true);
  assert.deepEqual(fake.freed, [44, 4]);
  assert.equal(fake.destroyed, 1);
});

test("P2P-WASM-07 browser smoke is allowlisted as exact GET resources", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-p2p-host-smoke.html", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-07/);
  assert.match(page, /__arsenalWasmBrowserP2PHostSmoke/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-host-smoke.html"), "browser-p2p-host-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-host-match.mjs"), "p2p-wasm-host-match.mjs");
  assert.equal(resolveWasmSmokeResource("POST", "/browser-p2p-host-smoke.html"), null);
  for (const deniedPath of [
    "/browser-p2p-host-smoke.html?cache=1",
    "/browser-p2p-host-smoke.html#fragment",
    "/../package.json",
    "//localhost/browser-p2p-host-smoke.html",
  ]) assert.equal(resolveWasmSmokeResource("GET", deniedPath), null, `${deniedPath} should be denied`);
});

test("P2P-WASM-19 browser smoke is opt-in and allowlisted as one exact combat-alpha host route", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-p2p-combat-alpha-host-smoke.html", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-19/);
  assert.match(page, /combat-alpha-pair/);
  assert.match(page, /__arsenalWasmBrowserP2PCombatAlphaHostSmoke/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-combat-alpha-host-smoke.html"), "browser-p2p-combat-alpha-host-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-combat-alpha-host-smoke.html?fixture=combat-alpha-pair"), null);
  assert.equal(resolveWasmSmokeResource("POST", "/browser-p2p-combat-alpha-host-smoke.html"), null);
});

test("P2P-WASM-08 carries a measured collision through the versioned diagnostic envelope without clipping", async () => {
  const match = await createP2PWasmHostMatch({
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  });
  let impactSnapshot = null;
  try {
    // The fixture's 108-WASM-step impact is 54 external 60 Hz ticks, i.e. the
    // ninth six-tick input window. Capture immediately after that transfer so
    // a later rebound cannot hide the measured impulse.
    for (let sequence = 1; sequence <= 9; sequence += 1) {
      const outcome = match.receivePilotInput({
        sequence,
        controls: { throttle: 1, steer: 0, boost: false, jump: false },
      });
      assert.equal(outcome.accepted, true);
      impactSnapshot = outcome.snapshot;
    }

    const impactVelocity = impactSnapshot.cars[0].vx;
    assert.ok(impactVelocity > 500, `expected the target impact velocity to be measurable, got ${impactVelocity}`);
    assert.ok(impactVelocity <= P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT);
    const text = createP2PWasmSnapshotEnvelope(impactSnapshot, context);
    const decoded = decodeP2PWasmSnapshotEnvelope(text);
    assert.equal(decoded.type, "wasm-snapshot");
    assert.equal(decoded.cars[0].vx, impactVelocity, "the envelope must not clamp the measured velocity");
  } finally {
    match.close();
  }
});

test("P2P-WASM-13 exposes deterministic static raycasts without advancing the host", async () => {
  const match = await createP2PWasmHostMatch({ ticksPerInput: 1 });
  try {
    assert.equal(match.receivePilotInput({ sequence: 1, controls: idle }).accepted, true);
    assert.equal(match.hasStaticRaycast(), true);
    const floor = match.raycastStatic({ from: { x: 0, y: 100, z: 0 }, to: { x: 0, y: -100, z: 0 } });
    assert.equal(floor.hit, true);
    assert.ok(floor.fraction > 0 && floor.fraction < 1);
    assert.ok(floor.normal.y > 0.9);
    const wall = match.raycastStatic({ from: { x: -1200, y: 50, z: 0 }, to: { x: 1200, y: 50, z: 0 } });
    assert.equal(wall.hit, true);
    assert.ok(wall.normal.x < -0.9);
    const clear = match.raycastStatic({ from: { x: 0, y: 50, z: -500 }, to: { x: 0, y: 50, z: 500 } });
    assert.equal(clear.hit, false);
    assert.deepEqual(clear.point, { x: 0, y: 50, z: 500 });
    assert.equal(match.snapshot().tick, 1, "a raycast must not advance the physical timeline");
    assert.throws(() => match.raycastStatic({ from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, extra: true }), /invalid/);
  } finally {
    match.close();
  }
});

