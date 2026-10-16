import test from "node:test";
import assert from "node:assert/strict";
import {
  ROCKETSIM_PRACTICE_REST_HEIGHT,
  ROCKETSIM_PRACTICE_SCALE,
  RocketSimPracticeMatch,
  ROCKETSIM_PRACTICE_ARENAS,
  ROCKETSIM_DEFAULT_ARENA,
  attitudeFromRocketSimOrientation,
  rocketsimPositionToArsenal,
  rocketsimVelocityToArsenal,
} from "../src/rocketsim-practice-match.js";

const identity = { x: 0, y: 0, z: 0, w: 1 };

function carFrame(overrides = {}) {
  return {
    id: 1,
    position: { x: 2300, y: ROCKETSIM_PRACTICE_REST_HEIGHT + 2300, z: -1150 },
    velocity: { x: 2300, y: -1150, z: 4600 },
    orientation: { ...identity },
    localAngularVelocity: { pitch: 0.1234, yaw: -0.2345, roll: 0.3456 },
    grounded: true,
    wheelCount: 4,
    jumps: 2,
    jumpState: "grounded",
    secondJumpWindow: 1.234,
    dodgeTime: 0.567,
    dodgeDirection: { forward: 0.75, side: -0.25 },
    actionFlags: { hasJumped: false, hasDoubleJumped: false, hasFlipped: false },
    boost: 77.777,
    ...overrides,
  };
}

class FakeBridge {
  constructor(frames = []) {
    this.frames = frames;
    this.startOptions = null;
    this.tickCalls = [];
    this.shutdownCalls = 0;
  }

  async start(options) {
    this.startOptions = options;
    return { features: { staticRaycast: true } };
  }

  async tick(tick, cars) {
    this.tickCalls.push({ tick, cars: structuredClone(cars) });
    const frame = this.frames[Math.min(this.tickCalls.length - 1, this.frames.length - 1)] || carFrame();
    return { tick, cars: [structuredClone(frame)] };
  }

  async raycast(segments) {
    this.raycastCalls = [...(this.raycastCalls || []), structuredClone(segments)];
    return { type: "raycast-state", schemaVersion: 1, tick: this.tickCalls.at(-1)?.tick || 0, hits: segments.map(segment => ({ id: segment.id, hit: false, fraction: 1, point: segment.to, normal: { x: 0, y: 0, z: 0 }, kind: "static" })) };
  }

  async shutdown() {
    this.shutdownCalls += 1;
  }
}

class MultiCarFakeBridge {
  constructor() {
    this.startOptions = null;
    this.tickCalls = [];
    this.shutdownCalls = 0;
  }

  async start(options) {
    this.startOptions = structuredClone(options);
    return { features: { staticRaycast: true } };
  }

  async tick(tick, cars) {
    this.tickCalls.push({ tick, cars: structuredClone(cars) });
    return {
      tick,
      cars: cars.map(car => carFrame({
        id: car.id,
        position: { x: car.id * 100, y: ROCKETSIM_PRACTICE_REST_HEIGHT + car.id * 10, z: 0 },
      })),
    };
  }

  async raycast(segments) {
    this.raycastCalls = [...(this.raycastCalls || []), structuredClone(segments)];
    return { type: "raycast-state", schemaVersion: 1, tick: this.tickCalls.at(-1)?.tick || 0, hits: segments.map(segment => ({ id: segment.id, hit: false, fraction: 1, point: segment.to, normal: { x: 0, y: 0, z: 0 }, kind: "static" })) };
  }

  async shutdown() {
    this.shutdownCalls += 1;
  }
}

class DuplicateFrameBridge extends MultiCarFakeBridge {
  async tick(tick, cars) {
    this.tickCalls.push({ tick, cars: structuredClone(cars) });
    return { tick, cars: [carFrame({ id: 1 }), carFrame({ id: 1 })] };
  }
}

class CombatFakeBridge extends MultiCarFakeBridge {
  async tick(tick, cars) {
    this.tickCalls.push({ tick, cars: structuredClone(cars) });
    return {
      tick,
      cars: cars.map(car => carFrame({
        id: car.id,
        position: { x: car.id === 1 ? 0 : 190, y: ROCKETSIM_PRACTICE_REST_HEIGHT, z: 0 },
      })),
    };
  }

  async setCombatActive(id, active) {
    this.combatCalls = [...(this.combatCalls || []), { id, active }];
    return { tick: this.tickCalls.at(-1)?.tick || 0, cars: [] };
  }

  async raycast(segments) {
    this.raycastCalls = [...(this.raycastCalls || []), structuredClone(segments)];
    return { type: "raycast-state", schemaVersion: 1, tick: this.tickCalls.at(-1)?.tick || 0, hits: segments.map(segment => ({ id: segment.id, hit: false, fraction: 1, point: segment.to, normal: { x: 0, y: 0, z: 0 }, kind: "static" })) };
  }

  async respawn(id) {
    this.respawnCalls = [...(this.respawnCalls || []), id];
    return { tick: this.tickCalls.at(-1)?.tick || 0, cars: [] };
  }
}

function bridgeFactoryFor(...plans) {
  const bridges = [];
  const bridgeFactory = () => {
    const plan = plans[Math.min(bridges.length, plans.length - 1)] || [];
    const bridge = new FakeBridge(plan);
    bridges.push(bridge);
    return bridge;
  };
  return { bridgeFactory, bridges };
}

const normalizedInput = {
  throttle: 1,
  steer: -1,
  jump: true,
  boost: true,
  drift: false,
  airRoll: true,
  roll: -1,
  fire: true,
};

const carViewKeys = [
  "id", "name", "team", "bot", "x", "z", "h", "yaw", "pitch", "roll", "orientation",
  "angularVelocity", "impactSerial", "impactSpin", "actionSerials", "speed", "velocity",
  "forwardSpeed", "steer", "powerslide", "grounded", "surfaceNormal", "contacts", "wheels",
  "surfaceType", "jumpState", "jumpHoldRemaining", "jumpHeldFor", "jumpWindowRemaining",
  "dodging", "dodgeRemaining", "dodgePitchLockRemaining", "dodgeCancelling", "dodgeDirection",
  "lastLanding", "supersonic", "hp", "boost", "jumps", "respawn", "kills", "deaths",
  "boosting", "wallNormal", "wallRide", "ceilingContact",
];


test("RocketSim practice maps native coordinates and orientation", () => {
  assert.equal(ROCKETSIM_PRACTICE_SCALE, 56 / 2300);
  assert.deepEqual(rocketsimPositionToArsenal({ x: 2300, y: ROCKETSIM_PRACTICE_REST_HEIGHT + 2300, z: -1150 }), {
    x: 56,
    h: 56,
    z: -28,
  });
  assert.deepEqual(rocketsimVelocityToArsenal({ x: 2300, y: -1150, z: 4600 }), {
    x: 56,
    y: -28,
    z: 112,
  });

  const identityAttitude = attitudeFromRocketSimOrientation(identity);
  assert.deepEqual(identityAttitude.forward, { x: 1, y: 0, z: 0 });
  assert.equal(identityAttitude.yaw, 0);
  assert.ok(Math.abs(identityAttitude.pitch) < 1e-12);
  assert.equal(identityAttitude.roll, 0);

  const quarterTurn = attitudeFromRocketSimOrientation({
    x: 0,
    y: Math.SQRT1_2,
    z: 0,
    w: Math.SQRT1_2,
  });
  assert.ok(Math.abs(quarterTurn.yaw + Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(quarterTurn.forward.x) < 1e-12);
  assert.ok(Math.abs(quarterTurn.forward.z + 1) < 1e-12);
});


test("RocketSim practice consumes two sequential native ticks with held normalized input", async () => {
  const { bridgeFactory, bridges } = bridgeFactoryFor([carFrame(), carFrame()]);
  const match = new RocketSimPracticeMatch({ bridgeFactory, bridgeLabel: "r19" });
  const initial = await match.start();
  assert.deepEqual(bridges[0].startOptions, {
    arena: ROCKETSIM_DEFAULT_ARENA,
    cars: [{ id: 1, team: "blue" }],
  });
  assert.deepEqual(initial.cars, []);

  assert.deepEqual(match.addHuman("pilot-uuid", "Pilot"), { id: "pilot-uuid", team: "blue" });
  match.input("pilot-uuid", { throttle: 2, steer: -2, jump: 1, boost: "yes", drift: 0, airRoll: true, roll: -2, fire: true });

  const snapshot = await match.tick();
  const bridge = bridges[0];
  assert.deepEqual(bridge.tickCalls.map(call => call.tick), [1, 2]);
  assert.deepEqual(bridge.tickCalls.map(call => call.cars[0]), [
    { id: 1, input: normalizedInput },
    { id: 1, input: normalizedInput },
  ]);
  assert.equal(snapshot.time, 0.02);
  assert.equal(snapshot.cars.length, 1);
  assert.equal(snapshot.cars[0].id, "pilot-uuid");
  assert.equal(snapshot.cars[0].name, "Pilot");
  assert.equal(snapshot.cars[0].x, 56);
  assert.equal(snapshot.cars[0].h, 56);
  assert.equal(snapshot.cars[0].z, -28);
  assert.deepEqual(snapshot.cars[0].velocity, { x: 56, y: -28, z: 112 });  assert.deepEqual(snapshot.cars[0].orientation, identity);
  assert.deepEqual(snapshot.cars[0].angularVelocity, { pitch: 0.123, yaw: -0.234, roll: 0.346 });
  assert.deepEqual(snapshot.cars[0].actionSerials, { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 });
  assert.equal(snapshot.cars[0].jumpState, "grounded");
  assert.equal(snapshot.cars[0].surfaceType, "ground");
  assert.equal(snapshot.cars[0].steer, -1);
  assert.equal(snapshot.cars[0].powerslide, 0);
  assert.equal(snapshot.cars[0].boosting, true);
  assert.deepEqual(Object.keys(snapshot.cars[0]).sort(), [...carViewKeys].sort());

  assert.equal(snapshot.settings.humans, 1);
  assert.equal(snapshot.settings.bots, 0);
  assert.equal(snapshot.settings.movementBackend, "rocketsim");
  assert.equal(snapshot.settings.bridgeLabel, "R19");
  assert.deepEqual(snapshot.rockets, []);
  assert.deepEqual(snapshot.pads, []);
  await match.shutdown();
});


test("RocketSim practice assigns independent native slots to multiple pilots", async () => {
  const bridges = [];
  const bridgeFactory = () => {
    const bridge = new MultiCarFakeBridge();
    bridges.push(bridge);
    return bridge;
  };
  const match = new RocketSimPracticeMatch({ bridgeFactory });
  await match.start();
  assert.deepEqual(match.addHuman("pilot-blue", "Blue"), { id: "pilot-blue", team: "blue" });
  assert.deepEqual(match.addHuman("pilot-red", "Red"), { id: "pilot-red", team: "red" });
  match.input("pilot-blue", { throttle: 1 });
  match.input("pilot-red", { throttle: -1 });

  const snapshot = await match.tick();
  assert.equal(bridges.length, 2, "adding a native car rebuilds the active roster once");
  assert.deepEqual(bridges[1].startOptions.cars, [
    { id: 1, team: "blue" },
    { id: 2, team: "red" },
  ]);
  assert.deepEqual(bridges[1].tickCalls[0].cars.map(car => ({ id: car.id, throttle: car.input.throttle })), [
    { id: 1, throttle: 1 },
    { id: 2, throttle: -1 },
  ]);
  assert.deepEqual(snapshot.cars.map(car => ({ id: car.id, team: car.team, x: car.x })), [
    { id: "pilot-blue", team: "blue", x: 2.43 },
    { id: "pilot-red", team: "red", x: 4.87 },
  ]);
  assert.equal(snapshot.settings.humans, 2);
  await match.shutdown();
  assert.equal(bridges[1].shutdownCalls, 1);
});

test("RocketSim queues rapid joins until the native roster contains every pilot", async () => {
  const bridges = [];
  const bridgeFactory = () => { const bridge = new MultiCarFakeBridge(); bridges.push(bridge); return bridge; };
  const match = new RocketSimPracticeMatch({ bridgeFactory, vehicleLimit: 3 });
  await match.start();
  match.addHuman("pilot-one", "One");
  match.addHuman("pilot-two", "Two");
  match.addHuman("pilot-three", "Three");
  const snapshot = await match.tick();
  assert.deepEqual(snapshot.cars.map(car => car.id), ["pilot-one", "pilot-two", "pilot-three"]);
  assert.deepEqual(bridges.at(-1).startOptions.cars.map(car => car.id), [1, 2, 3]);
  await match.shutdown();
});

test("RocketSim rebuilds the idle slot after the final native pilot disconnects", async () => {
  const bridges = [];
  const bridgeFactory = () => { const bridge = new MultiCarFakeBridge(); bridges.push(bridge); return bridge; };
  const match = new RocketSimPracticeMatch({ bridgeFactory, vehicleLimit: 2 });
  await match.start();
  match.addHuman("pilot-one", "One");
  match.addHuman("pilot-two", "Two");
  await match.tick();
  assert.deepEqual(bridges.at(-1).startOptions.cars.map(car => car.id), [1, 2]);

  match.removeHuman("pilot-one");
  await match.tick();
  assert.deepEqual(bridges.at(-1).startOptions.cars.map(car => car.id), [2]);

  match.removeHuman("pilot-two");
  await match.tick();
  assert.deepEqual(bridges.at(-1).startOptions.cars.map(car => car.id), [1]);
  assert.deepEqual(bridges.at(-1).tickCalls[0].cars.map(car => car.id), [1]);
  assert.equal(bridges.at(-1).tickCalls[0].tick, 1);
  await match.shutdown();
});

test("RocketSim validates a configurable human capacity without rebuilding active cars", async () => {
  const bridges = [];
  const bridgeFactory = () => { const bridge = new MultiCarFakeBridge(); bridges.push(bridge); return bridge; };
  const match = new RocketSimPracticeMatch({ bridgeFactory, combat: true, vehicleLimit: 2 });
  await match.start();
  assert.equal(match.snapshot().settings.vehicleLimit, 2);
  assert.equal(match.snapshot().settings.bots, 0);
  assert.equal(bridges.length, 1);
  assert.deepEqual(match.configure({ vehicleLimit: 3, botCount: 0 }).settings.vehicleLimit, 3);
  assert.equal(bridges.length, 1, "capacity alone does not replace the native bridge");
  assert.ok(match.addHuman("blue", "Blue"));
  assert.ok(match.addHuman("red", "Red"));
  assert.ok(match.addHuman("blue-2", "Blue 2"));
  assert.equal(match.addHuman("red-2", "Red 2"), null, "the authoritative capacity rejects an additional hello");
  assert.throws(() => match.configure({ vehicleLimit: 2, botCount: 0 }), /inferior a los pilotos conectados/);
  assert.throws(() => match.configure({ vehicleLimit: 3, botCount: 1 }), /bots RocketSim/);
  assert.throws(() => match.configure({ vehicleLimit: 3.5, botCount: 0 }), /capacidad RocketSim/);
  assert.equal(match.snapshot().settings.vehicleLimit, 3, "rejected settings leave the active session unchanged");
  await match.shutdown();
});

test("RocketSim practice rejects a native frame with duplicate IDs", async () => {
  const bridges = [];
  const bridgeFactory = () => { const bridge = new DuplicateFrameBridge(); bridges.push(bridge); return bridge; };
  const match = new RocketSimPracticeMatch({ bridgeFactory });
  await match.start();
  match.addHuman("pilot-blue", "Blue");
  match.addHuman("pilot-red", "Red");
  await assert.rejects(() => match.tick(), /invalid native tick/);
  await match.shutdown();
});


test("RocketSim combat mode consumes native poses while Node owns only combat rules", async () => {
  const bridges = [];
  const bridgeFactory = () => {
    const bridge = new CombatFakeBridge();
    bridges.push(bridge);
    return bridge;
  };
  const match = new RocketSimPracticeMatch({ bridgeFactory, combat: true });
  await match.start();
  match.addHuman("blue", "Blue");
  match.addHuman("red", "Red");
  match.input("blue", { fire: true });
  const snapshot = await match.tick();
  const red = snapshot.cars.find(car => car.id === "red");
  assert.equal(snapshot.rules.combat, true);
  assert.equal(snapshot.rockets.length, 0, "the close native pose receives the projectile hit during the 120 Hz combat step");
  assert.equal(red.hp, 35);
  assert.equal(red.respawn, 0);
  assert.equal(bridges[1].tickCalls[0].cars.some(car => car.input.fire), false, "fire stays in Node combat rules and never becomes a vehicle input");
  await match.shutdown();
});

test("RocketSim practice can select the original curved arena profile", async () => {
  assert.equal(ROCKETSIM_PRACTICE_ARENAS.has("arsenal-curved-practice"), true);
  const { bridgeFactory, bridges } = bridgeFactoryFor([carFrame(), carFrame()]);
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "arsenal-curved-practice" });
  const initial = await match.start();
  assert.deepEqual(bridges[0].startOptions, {
    arena: "arsenal-curved-practice",
    cars: [{ id: 1, team: "blue" }],
  });
  assert.equal(initial.settings.practiceArena, "arsenal-curved-practice");
  await match.shutdown();
});

test("RocketSim practice can select the expanded four-curve arena profile", async () => {
  assert.equal(ROCKETSIM_PRACTICE_ARENAS.has("arsenal-expanded-curved-practice"), true);
  const { bridgeFactory, bridges } = bridgeFactoryFor([carFrame(), carFrame()]);
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "arsenal-expanded-curved-practice" });
  const initial = await match.start();
  assert.equal(bridges[0].startOptions.arena, "arsenal-expanded-curved-practice");
  assert.equal(initial.settings.practiceArena, "arsenal-expanded-curved-practice");
  await match.shutdown();
});

test("RocketSim practice can select the isolated cornered arena profile", async () => {
  assert.equal(ROCKETSIM_PRACTICE_ARENAS.has("arsenal-expanded-cornered-practice"), true);
  const { bridgeFactory, bridges } = bridgeFactoryFor([carFrame(), carFrame()]);
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "arsenal-expanded-cornered-practice" });
  const initial = await match.start();
  assert.equal(bridges[0].startOptions.arena, "arsenal-expanded-cornered-practice");
  assert.equal(initial.settings.practiceArena, "arsenal-expanded-cornered-practice");
  await match.shutdown();
});

test("RocketSim practice can select the isolated block arena profile", async () => {
  assert.equal(ROCKETSIM_PRACTICE_ARENAS.has("arsenal-expanded-block-practice"), true);
  const bridges = [];
  const bridgeFactory = () => { const bridge = new FakeBridge(); bridges.push(bridge); return bridge; };
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "arsenal-expanded-block-practice" });
  await match.start();
  match.addHuman("pilot-1");
  const initial = match.snapshot();
  assert.equal(bridges[0].startOptions.arena, "arsenal-expanded-block-practice");
  assert.equal(initial.settings.practiceArena, "arsenal-expanded-block-practice");
  await match.shutdown();
});

test("RocketSim practice can select the isolated ramp arena profile", async () => {
  assert.equal(ROCKETSIM_PRACTICE_ARENAS.has("arsenal-expanded-ramp-practice"), true);
  const { bridgeFactory, bridges } = bridgeFactoryFor([carFrame(), carFrame()]);
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "arsenal-expanded-ramp-practice" });
  const initial = await match.start();
  assert.equal(bridges[0].startOptions.arena, "arsenal-expanded-ramp-practice");
  assert.equal(initial.settings.practiceArena, "arsenal-expanded-ramp-practice");
  await match.shutdown();
});

test("RocketSim combat can select the composed combat-alpha arena profile", async () => {
  assert.equal(ROCKETSIM_PRACTICE_ARENAS.has("combat-alpha"), true);
  const { bridgeFactory, bridges } = bridgeFactoryFor([carFrame(), carFrame()]);
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "combat-alpha", combat: true });
  const initial = await match.start();
  assert.equal(bridges[0].startOptions.arena, "combat-alpha");
  assert.equal(initial.settings.practiceArena, "combat-alpha");
  await match.shutdown();
});

test("RocketSim combat accepts its native-only lineup profile", async () => {
  const { bridgeFactory, bridges } = bridgeFactoryFor([carFrame(), carFrame()]);
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "combat-lineup", combat: true });
  await match.start();
  assert.equal(bridges[0].startOptions.arena, "combat-lineup");
  assert.equal(match.snapshot().settings.practiceArena, "combat-lineup");
  await match.shutdown();
});

test("RocketSim practice rejects an unknown native arena profile", () => {
  const { bridgeFactory } = bridgeFactoryFor();
  assert.throws(() => new RocketSimPracticeMatch({ bridgeFactory, arena: "soccar-assets" }), /unsupported/);
});


test("RocketSim practice action serials increment only on rising native flags", async () => {
  const rising = { hasJumped: true, hasDoubleJumped: true, hasFlipped: true };
  const { bridgeFactory } = bridgeFactoryFor([
    carFrame(),
    carFrame({ actionFlags: { hasJumped: true, hasDoubleJumped: false, hasFlipped: false } }),
    carFrame({ actionFlags: { hasJumped: true, hasDoubleJumped: false, hasFlipped: false } }),
    carFrame(),
    carFrame({ actionFlags: rising }),
    carFrame({ actionFlags: rising }),
  ]);
  const match = new RocketSimPracticeMatch({ bridgeFactory });
  await match.start();
  match.addHuman("pilot");

  assert.deepEqual((await match.tick()).cars[0].actionSerials, { jump: 1, doubleJump: 0, dodge: 0, respawn: 0 });
  assert.deepEqual((await match.tick()).cars[0].actionSerials, { jump: 1, doubleJump: 0, dodge: 0, respawn: 0 });
  assert.deepEqual((await match.tick()).cars[0].actionSerials, { jump: 2, doubleJump: 1, dodge: 1, respawn: 0 });
  await match.shutdown();
});


test("RocketSim practice restart replaces the bridge and raises the respawn serial", async () => {
  const { bridgeFactory, bridges } = bridgeFactoryFor(
    [carFrame(), carFrame()],
    [carFrame({ position: { x: 0, y: ROCKETSIM_PRACTICE_REST_HEIGHT, z: 0 } }), carFrame({ position: { x: 0, y: ROCKETSIM_PRACTICE_REST_HEIGHT, z: 0 } })],
  );
  const match = new RocketSimPracticeMatch({ bridgeFactory });
  await match.start();
  match.addHuman("pilot");
  assert.equal((await match.tick()).cars[0].actionSerials.respawn, 0);

  const restarted = await match.restart();
  assert.deepEqual(restarted.cars, []);
  assert.equal(bridges.length, 2);
  assert.equal(bridges[0].shutdownCalls, 1);
  assert.deepEqual(bridges[1].startOptions, {
    arena: ROCKETSIM_DEFAULT_ARENA,
    cars: [{ id: 1, team: "blue" }],
  });

  const afterRestart = await match.tick();
  assert.equal(bridges[1].tickCalls[0].tick, 1);
  assert.deepEqual(afterRestart.cars[0].actionSerials, { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 });
  assert.equal(afterRestart.cars[0].actionSerials.respawn, 1);
  await match.shutdown();
  assert.equal(bridges[1].shutdownCalls, 1);
});

test("RocketSim restart recovers when a failed roster rebuild detached the bridge", async () => {
  const { bridgeFactory, bridges } = bridgeFactoryFor();
  const match = new RocketSimPracticeMatch({ bridgeFactory, arena: "combat-alpha", combat: true, vehicleLimit: 2 });
  await match.start();
  match.bridge = null;
  const restarted = await match.restart();
  assert.equal(bridges.length, 2);
  assert.equal(restarted.settings.movementBackend, "rocketsim");
  await match.shutdown();
});

test("RocketSim combat session publishes waiting, active, complete, and restart states", async () => {
  const bridges = [];
  const bridgeFactory = () => {
    const bridge = new MultiCarFakeBridge();
    bridges.push(bridge);
    return bridge;
  };
  const match = new RocketSimPracticeMatch({ bridgeFactory, combat: true, arena: "combat-alpha" });
  await match.start();
  match.addHuman("blue", "Blue");
  assert.equal(match.snapshot().settings.roundState, "waiting");
  match.addHuman("red", "Red");
  const active = await match.tick();
  assert.equal(active.settings.roundState, "active");
  assert.equal(active.settings.scoreToWin, 15);
  match.combatState.score.blue = 15;
  const complete = match.snapshot();
  assert.equal(complete.winner, "blue");
  assert.equal(complete.settings.roundState, "complete");
  const restarted = await match.restart();
  assert.deepEqual(restarted.score, { blue: 0, red: 0 });
  assert.equal(restarted.winner, null);
  assert.equal(restarted.settings.roundState, "active");
  await match.shutdown();
  assert.ok(bridges.length >= 3);
});

