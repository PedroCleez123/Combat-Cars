import assert from "node:assert/strict";
import test from "node:test";
import { COMBAT_ALPHA_MAP, COMBAT_ALPHA_OBSTACLES, COMBAT_ALPHA_PICKUPS, combatAlphaMapLayout } from "../src/combat-alpha-map.js";

test("combat-alpha map declares one readable route with symmetric team landmarks", () => {
  const layout = combatAlphaMapLayout();
  assert.equal(COMBAT_ALPHA_MAP.teamAxis, "x");
  assert.equal(COMBAT_ALPHA_MAP.route.objective, "center-ring");
  assert.deepEqual(COMBAT_ALPHA_MAP.route.risk, ["central-block", "south-ramp", "wall-ceiling"]);
  assert.equal(layout.beacons.length, 6);
  assert.equal(layout.beacons.filter(beacon => beacon.team === "blue").length, 3);
  assert.equal(layout.beacons.filter(beacon => beacon.team === "red").length, 3);
  assert.deepEqual(layout.beacons.map(beacon => Math.round(beacon.x * 100) / 100), [-110, -110, -110, 110, 110, 110]);
});

test("combat-alpha map keeps visual landmarks inside the shared native profile", () => {
  const layout = combatAlphaMapLayout();
  for (const landmark of [...layout.beacons, ...layout.spawnSlots, ...layout.hazards]) {
    assert.ok(Math.abs(landmark.x) < layout.arena.halfWidth);
    assert.ok(Math.abs(landmark.z) < layout.arena.halfDepth);
  }
});

test("combat-alpha map exposes native obstacle dimensions and no pickup contract", () => {
  const layout = combatAlphaMapLayout();
  assert.equal(COMBAT_ALPHA_MAP.obstacles, COMBAT_ALPHA_OBSTACLES);
  assert.equal(COMBAT_ALPHA_MAP.pickups, COMBAT_ALPHA_PICKUPS);
  assert.equal(layout.obstacles.length, 8);
  assert.deepEqual(layout.obstacles.slice(0, 2), [
    { id: "central-block", kind: "box", x: 0, z: -20, width: 14, depth: 18, height: 3.25 },
    { id: "south-ramp", kind: "closed-convex-wedge", x: 0, z: 20, run: 20, width: 18, height: 3.5 },
  ]);
  assert.equal(COMBAT_ALPHA_PICKUPS.length, 0);
  assert.deepEqual(layout.pickups, []);
  assert.ok(layout.safeFloor.minX < layout.spawnSlots[0].x && layout.spawnSlots[0].x < layout.safeFloor.maxX);
  assert.ok(layout.safeFloor.minZ < layout.spawnSlots[0].z && layout.spawnSlots[0].z < layout.safeFloor.maxZ);
});

test("combat-alpha map records native spawn reading without becoming spawn authority", () => {
  const layout = combatAlphaMapLayout();
  assert.deepEqual(layout.spawnSlots.map(spawn => Math.round(spawn.x * 100) / 100), [-88, 88, -88, 88, -88, 88]);
  assert.deepEqual(layout.spawnSlots.map(spawn => spawn.z), [-90, 90, 90, -90, 0, 0]);
  assert.deepEqual(layout.spawnSlots.map(spawn => spawn.yaw), [0, Math.PI, 0, Math.PI, 0, Math.PI]);
  assert.equal(COMBAT_ALPHA_MAP.spawnSlots[0].xRatio, -2 / 3);
});
