import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeBridgeInit,
  encodeBridgeCombatActive,
  encodeBridgeRespawn,
  encodeBridgeShutdown,
  encodeBridgeTick,
  encodeBridgeRaycast,
  normalizeBridgeStateFrame,
  normalizeBridgeRaycastFrame,
  parseBridgeLine,
  summarizeBridgeFrame,
} from "../src/rocketsim-protocol.js";
import { createRocketSimProcessEnv, ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS } from "../src/rocketsim-backend.js";
import { RocketSimWasmBridge } from "../src/rocketsim-wasm-backend.js";

test("RocketSim bridge leaves enough startup budget for a Windows watcher restart", () => {
  assert.equal(ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS, 250);
  assert.ok(ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS > 100);
});

test("RocketSim child environment keeps native runtime variables and drops online secrets", () => {
  const env = createRocketSimProcessEnv({
    Path: "C:\\native-bin",
    SystemRoot: "C:\\Windows",
    ARSENAL_ONLINE_AUTH_SECRET: "do-not-forward",
    ARSENAL_ONLINE_ALLOWED_ORIGINS: "https://play.example.test",
    UNRELATED_SECRET: "do-not-forward",
  }, {
    PATH: "C:\\native-bin;C:\\Windows\\System32",
    ARSENAL_ONLINE_TLS_TERMINATED: "true",
  });
  assert.equal(env.Path, "C:\\native-bin");
  assert.equal(env.PATH, "C:\\native-bin;C:\\Windows\\System32");
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.ARSENAL_ONLINE_AUTH_SECRET, undefined);
  assert.equal(env.ARSENAL_ONLINE_ALLOWED_ORIGINS, undefined);
  assert.equal(env.ARSENAL_ONLINE_TLS_TERMINATED, undefined);
  assert.equal(env.UNRELATED_SECRET, undefined);
});

test("RocketSim bridge protocol keeps the fixed-step contract", () => {
  const init = JSON.parse(encodeBridgeInit());
  assert.deepEqual(init, {
    type: "init",
    schemaVersion: 1,
    fixedStepHz: 120,
    arena: "clean-six-planes",
    cars: [{ id: 1, team: "blue" }],
  });
  const tick = JSON.parse(encodeBridgeTick(7, [{ id: 1, input: { throttle: 1, steer: -.25, jump: true, roll: .5 } }]));
  assert.equal(tick.type, "tick");
  assert.equal(tick.tick, 7);
  assert.deepEqual(tick.cars[0].input, {
    throttle: 1,
    steer: -.25,
    jump: true,
    boost: false,
    drift: false,
    airRoll: false,
    roll: .5,
  });
  assert.deepEqual(JSON.parse(encodeBridgeShutdown()), { type: "shutdown" });
  assert.deepEqual(JSON.parse(encodeBridgeRespawn(1)), { type: "respawn", id: 1 });
  assert.deepEqual(JSON.parse(encodeBridgeCombatActive(1, false)), { type: "combat-state", id: 1, active: false });
  const raycast = JSON.parse(encodeBridgeRaycast([{ id: 1, from: { x: -10, y: 0, z: 17 }, to: { x: 10, y: 0, z: 17 } }]));
  assert.deepEqual(raycast, { type: "raycast", segments: [{ id: 1, from: { x: -10, y: 0, z: 17 }, to: { x: 10, y: 0, z: 17 } }] });
});

test("RocketSim bridge protocol preserves independent IDs for a multicar tick", () => {
  const init = JSON.parse(encodeBridgeInit({ cars: [{ id: 1, team: "blue" }, { id: 2, team: "red" }] }));
  assert.deepEqual(init.cars, [{ id: 1, team: "blue" }, { id: 2, team: "red" }]);
  const tick = JSON.parse(encodeBridgeTick(1, [
    { id: 2, input: { throttle: -1, steer: .5 } },
    { id: 1, input: { throttle: 1, steer: -.5 } },
  ]));
  assert.deepEqual(tick.cars.map(car => car.id), [2, 1]);
  assert.equal(tick.cars[0].input.throttle, -1);
  assert.equal(tick.cars[1].input.throttle, 1);
  assert.throws(() => encodeBridgeInit({ cars: [{ id: 1, team: "blue" }, { id: 1, team: "red" }] }), /duplicate/);
  assert.throws(() => encodeBridgeTick(1, [{ id: 7, input: {} }]), /invalid/);
  assert.throws(() => encodeBridgeRespawn(7), /invalid/);
  assert.throws(() => encodeBridgeCombatActive(7, false), /invalid/);
  assert.throws(() => encodeBridgeRaycast([{ id: 1, from: { x: 0, y: 0, z: 0 }, to: { x: Infinity, y: 0, z: 0 } }]), /not finite/);
});

test("RocketSim raycast frames normalize finite static hits", () => {
  const frame = normalizeBridgeRaycastFrame({ type: "raycast-state", schemaVersion: 1, tick: 0, hits: [{ id: 1, hit: true, fraction: .5, point: { x: 0, y: 0, z: 17 }, normal: { x: -1, y: 0, z: 0 }, kind: "static" }] });
  assert.equal(frame.hits[0].fraction, .5);
  assert.equal(frame.hits[0].normal.x, -1);
  assert.throws(() => normalizeBridgeRaycastFrame({ type: "raycast-state", schemaVersion: 1, tick: 0, hits: [{ id: 1, hit: false, fraction: 2, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } }] }), /fraction is invalid/);
});

test("RocketSim state is normalized at the Node y-up boundary", () => {
  const frame = normalizeBridgeStateFrame({
    type: "state",
    schemaVersion: 1,
    fixedStepHz: 120,
    tick: 4,
    cars: [{
      id: 1,
      position: { x: 1, y: 2, z: 3 },
      velocity: { x: 4, y: 5, z: 6 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      localAngularVelocity: { pitch: 0, yaw: 0, roll: 0 },
      worldContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
      wheelContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
      grounded: true,
      wheelCount: 4,
      jumps: 2,
      jumpState: "grounded",
      secondJumpWindow: 0,
      dodgeTime: 0,
      dodgeDirection: { forward: 0, side: 0 },
      actionFlags: { hasJumped: false, hasDoubleJumped: false, hasFlipped: false },
      boost: 100,
    }],
    pads: [{ id: 0, active: false, cooldown: 4.25 }],
  });
  assert.equal(frame.fixedStepHz, 120);
  assert.equal(frame.cars[0].grounded, true);
  assert.equal(frame.cars[0].position.y, 2);
  assert.deepEqual(frame.cars[0].worldContact, { hasContact: true, normal: { x: 0, y: 1, z: 0 } });
  assert.deepEqual(frame.cars[0].wheelContact, { hasContact: true, normal: { x: 0, y: 1, z: 0 } });
  assert.deepEqual(frame.pads, [{ id: 0, active: false, cooldown: 4.25 }]);
  assert.equal(summarizeBridgeFrame(frame), summarizeBridgeFrame(frame));
});

test("RocketSim bridge rejects malformed frames", () => {
  assert.throws(() => parseBridgeLine("{}"), /no type/);
  assert.throws(() => normalizeBridgeStateFrame({ type: "state", schemaVersion: 1, fixedStepHz: 120, tick: 1, cars: {} }), /cars is invalid/);
  assert.throws(() => normalizeBridgeStateFrame({
    type: "state", schemaVersion: 1, fixedStepHz: 120, tick: 1,
    cars: [{ id: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 0 }, jumpState: "airborne" }],
  }), /zero magnitude/);
  assert.throws(() => normalizeBridgeStateFrame({
    type: "state", schemaVersion: 1, fixedStepHz: 120, tick: 1,
    cars: [{ id: 1, position: { x: null, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, jumpState: "airborne" }],
  }), /position.x is not finite/);
});

test("RocketSim WASM lifecycle suppresses controls on an inactive combat slot until respawn", async () => {
  const controls = [];
  const containment = [];
  const authorityRules = [];
  let nativeTick = 0;
  let nextPointer = 4;
  const module = {
    HEAPU32: new Uint32Array(4096),
    HEAPF32: new Float32Array(4096),
    _malloc(size) { const pointer = nextPointer; nextPointer += size; return pointer; },
    _free() {},
    _rs_destroy() {},
    _rs_init_combat_alpha_roster(count) { return count === 2 ? 1 : 0; },
    _rs_boost_regeneration_contract() { return 1; },
    _rs_set_authority_rules(enabled) { authorityRules.push(enabled); return 1; },
    _rs_set_controls_for_car_full(slot, ...input) { controls.push({ slot, input }); return 1; },
    _rs_step() { nativeTick += 1; return 1; },
    _rs_snapshot_car_authority(slot, tickPointer, statePointer) {
      module.HEAPU32[tickPointer >>> 2] = nativeTick;
      module.HEAPF32.fill(0, statePointer >>> 2, (statePointer >>> 2) + 40);
      module.HEAPF32[(statePointer >>> 2) + 9] = 1;
      return slot < 2 ? 1 : 0;
    },
    _rs_snapshot_combat_pads(countPointer) { module.HEAPU32[countPointer >>> 2] = 0; return 1; },
    _rs_raycast_static() { return 1; },
    _rs_set_combat_active_car() { return 1; },
    _rs_respawn_car() { return 1; },
    _rs_contain_car(slot) { containment.push(slot); return 1; },
  };
  const bridge = new RocketSimWasmBridge({ moduleFactory: async () => module });
  const command = [{ id: 1, input: { throttle: 1, steer: .2, boost: true } }, { id: 2, input: { throttle: -1, steer: -.2, jump: true } }];
  try {
    await bridge.start({ arena: "combat-alpha", cars: [{ id: 1, team: "blue" }, { id: 2, team: "red" }] });
    assert.deepEqual(authorityRules, [1], "combat bridge leaves kills and respawns to the shared online authority");
    await bridge.tick(1, command);
    await bridge.contain(1);
    assert.deepEqual(containment, [0], "the adapter forwards containment to the authoritative native slot");
    await bridge.setCombatActive(2, false);
    await bridge.tick(2, command);
    assert.deepEqual(controls.at(-1), { slot: 1, input: [0, 0, 0, 0, 0, 0, 0, 0] });
    await bridge.respawn(2);
    await bridge.tick(3, command);
    assert.deepEqual(controls.at(-1), { slot: 1, input: [-1, -.2, 1, -.2, 0, 1, 0, 0] });
  } finally {
    await bridge.shutdown();
  }
});

test("RocketSim WASM enables no-demo rules for a waiting lobby as well", async () => {
  const authorityRules = [];
  let nextPointer = 4;
  const module = {
    HEAPU32: new Uint32Array(4096),
    HEAPF32: new Float32Array(4096),
    _malloc(size) { const pointer = nextPointer; nextPointer += size; return pointer; },
    _free() {},
    _rs_destroy() {},
    _rs_init_combat_alpha_roster() { return 1; },
    _rs_boost_regeneration_contract() { return 1; },
    _rs_set_authority_rules(enabled) { authorityRules.push(enabled); return 1; },
    _rs_set_controls_for_car_full() { return 1; },
    _rs_step() { return 1; },
    _rs_snapshot_car_authority(slot, tickPointer, statePointer) {
      module.HEAPU32[tickPointer >>> 2] = 0;
      module.HEAPF32.fill(0, statePointer >>> 2, (statePointer >>> 2) + 40);
      module.HEAPF32[(statePointer >>> 2) + 9] = 1;
      return slot === 0 ? 1 : 0;
    },
    _rs_snapshot_combat_pads(countPointer) { module.HEAPU32[countPointer >>> 2] = 0; return 1; },
    _rs_raycast_static() { return 1; },
    _rs_set_combat_active_car() { return 1; },
    _rs_respawn_car() { return 1; },
    _rs_contain_car() { return 1; },
  };
  const bridge = new RocketSimWasmBridge({ moduleFactory: async () => module });
  try {
    const ready = await bridge.start({ arena: "combat-alpha", cars: [{ id: 1, team: "blue" }], lobby: true });
    assert.deepEqual(authorityRules, [1]);
    assert.equal(ready.features.lobbyRules, true);
    assert.equal(ready.features.nativeDemos, false);
  } finally {
    await bridge.shutdown();
  }
});
