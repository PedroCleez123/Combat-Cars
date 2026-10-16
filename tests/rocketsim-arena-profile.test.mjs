import assert from "node:assert/strict";
import test from "node:test";

import {
  rocketSimArenaForWorldMode,
  rocketSimArenaProfile,
  rocketSimCombatBounds,
} from "../src/rocketsim-arena-profile.js";

test("combat-alpha uses the expanded native arena bounds", () => {
  assert.deepEqual(rocketSimCombatBounds("combat-alpha"), {
    halfWidth: 72,
    halfDepth: 54,
    ceilingHeight: 30,
  });
});

test("the client world modes resolve to the same named arena profiles as Node", () => {
  const arena = rocketSimArenaForWorldMode("rocketsim-combat-alpha");
  assert.equal(arena, "combat-alpha");
  assert.deepEqual(rocketSimArenaProfile(arena), {
    halfWidth: 72,
    halfDepth: 54,
    height: 30,
    curveRadius: 8,
    cornered: true,
    expanded: true,
  });
});
