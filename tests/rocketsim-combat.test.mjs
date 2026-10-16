import assert from "node:assert/strict";
import test from "node:test";
import { createRocketSimCombatState, ROCKETSIM_COMBAT, ROCKETSIM_DEFAULT_COMBAT_BOUNDS, stepRocketSimCombat, winnerForRocketSimScore } from "../src/rocketsim-combat.js";

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

test("RocketSim combat keeps a rocket inside the expanded combat-alpha volume", () => {
  const state = createRocketSimCombatState();
  state.rockets.push({ id: 1, owner: "blue", team: "blue", x: 61.5, h: 1, z: 0, vx: 120, vh: 0, vz: 0, life: 1 });

  const result = stepRocketSimCombat(state, [], 1 / 60);

  assert.deepEqual(ROCKETSIM_DEFAULT_COMBAT_BOUNDS, { halfWidth: 72, halfDepth: 54, ceilingHeight: 30 });
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
