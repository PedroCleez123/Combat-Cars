import assert from "node:assert/strict";
import test from "node:test";
import { combatViewFor, createRocketSimCombatState, ROCKETSIM_COMBAT, ROCKETSIM_DEFAULT_COMBAT_BOUNDS, stepRocketSimCombat, winnerForRocketSimScore } from "../src/rocketsim-combat.js";

const identity = { x: 0, y: 0, z: 0, w: 1 };
const car = (id, team, x, overrides = {}) => ({
  id, name: `${team}-${id}`, team, x, h: 0, z: 0,
  velocity: { x: 0, y: 0, z: 0 }, orientation: identity,
  ...overrides,
});

test("RocketSim combat exposes one explicit score target and winner", () => {
  assert.equal(ROCKETSIM_COMBAT.scoreToWin, 15);
  assert.equal(winnerForRocketSimScore({ blue: 14, red: 14 }), null);
  assert.equal(winnerForRocketSimScore({ blue: 15, red: 14 }), "blue");
  assert.equal(winnerForRocketSimScore({ blue: 14, red: 15 }), "red");
});

test("FFA treats every other pilot as a target and awards the elimination to its owner", () => {
  const state = createRocketSimCombatState({ mode: "ffa" });
  const shooter = car("pilot-a", "blue", 0);
  const victim = car("pilot-b", "blue", 4.5);
  // One direct hit removes the remaining armour, proving that native colour
  // allocation never turns into an FFA friendly-fire rule.
  state.players.set(victim.id, { hp: ROCKETSIM_COMBAT.rocketDamage, cooldown: 0, fireHeld: false, respawn: 0, kills: 0, deaths: 0 });
  const result = stepRocketSimCombat(state, [shooter, victim], 1 / 60, new Map([[shooter.id, { fire: true, targetId: victim.id }]]), { halfWidth: 1000, halfDepth: 1000 });
  assert.equal(result.score[shooter.id], 1);
  assert.equal(result.score[victim.id], 0);
  assert.equal(state.players.get(victim.id).deaths, 1);
  assert.equal(winnerForRocketSimScore({ "pilot-a": 15, "pilot-b": 14 }, 15, "ffa"), "pilot-a");
});

test("RocketSim combat keeps a rocket inside the expanded combat-alpha volume", () => {
  const state = createRocketSimCombatState();
  state.rockets.push({ id: 1, owner: "blue", team: "blue", x: 61.5, h: 1, z: 0, vx: 120, vh: 0, vz: 0, life: 1 });

  const result = stepRocketSimCombat(state, [], 1 / 60);

  assert.deepEqual(ROCKETSIM_DEFAULT_COMBAT_BOUNDS, { halfWidth: 132, halfDepth: 204, ceilingHeight: 108 });
  assert.equal(result.rockets.length, 1, "the former 62-unit fallback must not remove a live combat-alpha rocket");
  assert.ok(result.rockets[0].x > 62);
});

test("RocketSim combat applies one direct rocket hit from a native pose", () => {
  const state = createRocketSimCombatState();
  const cars = [car("blue", "blue", 0), car("red", "red", 4.5)];
  const result = stepRocketSimCombat(state, cars, 1 / 60, new Map([["blue", { fire: true }]]), { halfWidth: 1000, halfDepth: 1000 });
  assert.equal(result.rockets.length, 0, "the rocket is consumed by the direct hit");
  assert.equal(state.players.get("red").hp, 100 - ROCKETSIM_COMBAT.rocketDamage);
  assert.equal(result.events.some(item => item.kind === "hit"), true);
});

test("RocketSim combat turns one host-authoritative high-speed ram into one elimination", () => {
  const state = createRocketSimCombatState();
  const cars = [
    car("blue", "blue", 0, { velocity: { x: 54, y: 0, z: 0 } }),
    car("red", "red", 3),
  ];
  const result = stepRocketSimCombat(state, cars, 1 / 60, new Map(), {
    halfWidth: 1000,
    halfDepth: 1000,
    ramHits: [{ attackerId: "blue", victimId: "red", impactSpeed: 54, relativeSpeed: 54 }],
  });
  assert.deepEqual(result.eliminated, ["red"]);
  assert.equal(state.players.get("blue").kills, 1);
  assert.equal(state.players.get("red").deaths, 1);
  assert.equal(result.score.blue, 1);
  assert.equal(result.events.filter(event => event.kind === "elimination").length, 1);
  const repeated = stepRocketSimCombat(state, cars, 1 / 60, new Map(), {
    halfWidth: 1000,
    halfDepth: 1000,
    ramHits: [{ attackerId: "blue", victimId: "red", impactSpeed: 54, relativeSpeed: 54 }],
  });
  assert.deepEqual(repeated.eliminated, []);
  assert.equal(state.players.get("blue").kills, 1);
});

test("RocketSim combat cooldown rejects a second fire edge", () => {
  const state = createRocketSimCombatState();
  const cars = [car("blue", "blue", 0), car("red", "red", 80)];
  const fire = new Map([["blue", { fire: true }]]);
  stepRocketSimCombat(state, cars, 1 / 60, fire, { halfWidth: 1000, halfDepth: 1000 });
  stepRocketSimCombat(state, cars, 1 / 60, new Map([["blue", { fire: false }]]), { halfWidth: 1000, halfDepth: 1000 });
  stepRocketSimCombat(state, cars, 1 / 60, fire, { halfWidth: 1000, halfDepth: 1000 });
  assert.equal(state.rockets.length, 1, "the first rocket remains and the cooldown blocks the second edge");
  assert.equal(state.events.some(item => item.kind === "fire"), false);
});

test("RocketSim combat exposes the remaining rocket cooldown to the HUD", () => {
  const state = createRocketSimCombatState();
  const pilot = car("blue", "blue", 0);
  state.players.set(pilot.id, { hp: 100, cooldown: 0.721, fireHeld: false, respawn: 0, kills: 0, deaths: 0 });
  assert.equal(combatViewFor(state, pilot).rocketCooldown, 0.72);
});

test("RocketSim combat consumes a rocket at a static hit before a vehicle", () => {
  const state = createRocketSimCombatState();
  const cars = [car("blue", "blue", 0), car("red", "red", 80)];
  const result = stepRocketSimCombat(state, cars, 1 / 60, new Map([["blue", { fire: true }]]), {
    halfWidth: 1000, halfDepth: 1000, staticHits: new Map([[1, { hit: true, fraction: .2 }]]),
  });
  assert.equal(result.rockets.length, 0);
  assert.equal(state.players.get("red").hp, 100, "an occluded shot does not damage a distant vehicle");
  assert.equal(result.events.some(item => item.kind === "miss" && item.text === "COHETE INTERCEPTADO"), true);
});

test("COV-02 cover-family static hits intercept without damage or score, while bypass stays live", () => {
  for (const coverId of ["container-cover-northwest", "container-cover-southeast", "tire-cover-blue", "tire-cover-red"]) {
    const state = createRocketSimCombatState();
    const cars = [car("blue", "blue", 0), car("red", "red", 80)];
    const result = stepRocketSimCombat(state, cars, 1 / 60, new Map([["blue", { fire: true }]]), {
      halfWidth: 1000,
      halfDepth: 1000,
      staticHits: new Map([[1, { id: coverId, hit: true, fraction: .2 }]]),
    });
    assert.equal(result.rockets.length, 0, `${coverId} should consume the rocket`);
    assert.equal(state.players.get("red").hp, 100, `${coverId} must not damage a car behind cover`);
    assert.equal(result.score.blue, 0, `${coverId} must not award a score`);
    assert.ok(result.events.some(event => event.kind === "miss" && event.text === "COHETE INTERCEPTADO"));
  }

  const bypassState = createRocketSimCombatState();
  const bypassCars = [car("blue", "blue", 0), car("red", "red", 3.4)];
  const bypass = stepRocketSimCombat(bypassState, bypassCars, 1 / 60, new Map([["blue", { fire: true }]]), {
    halfWidth: 1000,
    halfDepth: 1000,
    staticHits: new Map([[1, { id: "bypass", hit: false, fraction: 1 }]]),
  });
  assert.equal(bypassState.players.get("red").hp, 100 - ROCKETSIM_COMBAT.rocketDamage);
  assert.ok(bypass.events.some(event => event.kind === "hit"), "a bypass must remain eligible for a vehicle hit");
});

test("guided target intent is validated for rival, range and a conservative front cone", () => {
  const fireAt = (target, targetId = "red") => {
    const state = createRocketSimCombatState();
    if (target.hp === 0) state.players.set(target.id, { hp: 0, cooldown: 0, fireHeld: false, respawn: 0, kills: 0, deaths: 0 });
    const shooter = car("blue", "blue", 0);
    const result = stepRocketSimCombat(state, [shooter, target], 1 / 120, new Map([["blue", { fire: true, targetId }]]), { halfWidth: 1000, halfDepth: 1000 });
    return result.rockets[0];
  };
  assert.equal(fireAt(car("red", "red", 50)).targetId, "red");
  assert.equal(fireAt(car("red", "red", 110)).targetId, undefined, "out of range falls back to straight fire");
  assert.equal(fireAt(car("red", "red", -20)).targetId, undefined, "behind the shooter falls back to straight fire");
  assert.equal(fireAt(car("red", "blue", 20)).targetId, undefined, "same-team targets are rejected");
  assert.equal(fireAt(car("red", "red", 20, { hp: 0 })).targetId, undefined, "dead targets are rejected");
});

test("a validated guided launch aligns with its captured target and keeps the stronger bounded turn", () => {
  const state = createRocketSimCombatState();
  const shooter = car("blue", "blue", 0, { velocity: { x: 0, y: 0, z: 12 } });
  const target = car("red", "red", 50, { z: 20 });
  stepRocketSimCombat(state, [shooter, target], 1 / 120, new Map([["blue", { fire: true, targetId: "red" }]]), { halfWidth: 1000, halfDepth: 1000 });
  const rocket = state.rockets[0];
  const toTarget = { x: target.x - rocket.x, y: target.h - rocket.h, z: target.z - rocket.z };
  const targetLength = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
  const launchLength = Math.hypot(rocket.vx, rocket.vh, rocket.vz);
  const alignment = (rocket.vx * toTarget.x + rocket.vh * toTarget.y + rocket.vz * toTarget.z) / (launchLength * targetLength);
  assert.ok(alignment > .995);
  assert.equal(rocket.targetTeam, "red");
  assert.ok(ROCKETSIM_COMBAT.guidanceTurnRadiansPerSecond > Math.PI / 3);
  assert.ok(ROCKETSIM_COMBAT.guidanceMaxCorrectionRadians > Math.PI / 12);
});

test("rocket guidance turns gently, preserves speed, and never retargets", () => {
  const state = createRocketSimCombatState();
  const shooter = car("blue", "blue", 0);
  const target = car("red", "red", 50, { z: 22 });
  const cars = [shooter, target];
  stepRocketSimCombat(state, cars, 1 / 120, new Map([["blue", { fire: true, targetId: "red" }]]), { halfWidth: 1000, halfDepth: 1000 });
  const rocket = state.rockets[0];
  const initialSpeed = Math.hypot(rocket.vx, rocket.vh, rocket.vz);
  for (let i = 0; i < 90; i += 1) stepRocketSimCombat(state, cars, 1 / 120, new Map(), { halfWidth: 1000, halfDepth: 1000 });
  const directionDot = rocket.vx / initialSpeed;
  assert.ok(rocket.vz > 0, "the rocket bends slightly toward the captured target");
  assert.ok(directionDot >= Math.cos(ROCKETSIM_COMBAT.guidanceMaxCorrectionRadians) - .001, "total deviation remains inside the initial correction cap");
  assert.ok(Math.abs(Math.hypot(rocket.vx, rocket.vh, rocket.vz) - initialSpeed) < .001, "guidance preserves speed magnitude");
  const capturedTargetId = rocket.targetId;
  stepRocketSimCombat(state, [shooter], 1 / 120, new Map(), { halfWidth: 1000, halfDepth: 1000 });
  assert.equal(rocket.targetId, capturedTargetId, "a vanished target is not replaced by another rival");
  const straightVelocity = [rocket.vx, rocket.vh, rocket.vz];
  stepRocketSimCombat(state, [shooter, car("other-red", "red", -10)], 1 / 120, new Map(), { halfWidth: 1000, halfDepth: 1000 });
  assert.deepEqual([rocket.vx, rocket.vh, rocket.vz], straightVelocity, "lost target leaves the rocket on its current straight trajectory");
});

test("RocketSim combat preserves a vehicle hit that occurs before static geometry", () => {
  const state = createRocketSimCombatState();
  const cars = [car("blue", "blue", 0), car("red", "red", 3.4)];
  const result = stepRocketSimCombat(state, cars, 1 / 60, new Map([["blue", { fire: true }]]), {
    halfWidth: 1000, halfDepth: 1000, staticHits: new Map([[1, { hit: true, fraction: .9 }]]),
  });
  assert.equal(result.rockets.length, 0);
  assert.equal(state.players.get("red").hp, 100 - ROCKETSIM_COMBAT.rocketDamage);
  assert.equal(result.events.some(item => item.kind === "hit"), true);
});

test("RocketSim combat respawn restores health after the native deactivation window", () => {
  const state = createRocketSimCombatState();
  const cars = [car("blue", "blue", 0), car("red", "red", 4.5)];
  stepRocketSimCombat(state, cars, 1 / 60, new Map([["blue", { fire: true }]]), { halfWidth: 1000, halfDepth: 1000 });
  const target = state.players.get("red");
  target.hp = 0;
  target.respawn = 0;
  const result = stepRocketSimCombat(state, cars, 1 / 60, new Map(), { halfWidth: 1000, halfDepth: 1000 });
  assert.deepEqual(result.respawns, ["red"]);
  assert.equal(target.hp, ROCKETSIM_COMBAT.maxHealth);
});

test("RocketSim combat never fires from a car whose respawn has just expired", () => {
  const state = createRocketSimCombatState();
  state.players.set("blue", { hp: 0, cooldown: 0, fireHeld: false, respawn: 1 / 60, kills: 0, deaths: 1 });
  const cars = [car("blue", "blue", 0), car("red", "red", 80)];
  const result = stepRocketSimCombat(state, cars, 1 / 60, new Map([["blue", { fire: true }]]), { halfWidth: 1000, halfDepth: 1000 });
  assert.equal(result.rockets.length, 0);
  assert.equal(state.players.get("blue").hp, ROCKETSIM_COMBAT.maxHealth);
  assert.equal(result.events.some(item => item.kind === "fire"), false);
});
