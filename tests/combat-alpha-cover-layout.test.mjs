import assert from "node:assert/strict";
import test from "node:test";
import * as combatAlphaMap from "../src/combat-alpha-map.js";

const {
  COMBAT_ALPHA_MAP,
  COMBAT_ALPHA_OBSTACLES,
  COMBAT_ALPHA_PICKUPS,
  COMBAT_ALPHA_SAFE_CLEARANCE,
  combatAlphaMapLayout,
  isCombatAlphaSafeFloorPoint,
} = combatAlphaMap;

const COVER_IDS = [
  "container-cover-northwest",
  "container-cover-southwest",
  "container-cover-northeast",
  "container-cover-southeast",
  "tire-cover-blue",
  "tire-cover-red",
];

const NOMINAL_COVERS = {
  "container-cover-northwest": { x: -45, z: -58, width: 10, depth: 24, height: 6, visualKind: "container" },
  "container-cover-southwest": { x: -45, z: 58, width: 10, depth: 24, height: 6, visualKind: "container" },
  "container-cover-northeast": { x: 45, z: -58, width: 10, depth: 24, height: 6, visualKind: "container" },
  "container-cover-southeast": { x: 45, z: 58, width: 10, depth: 24, height: 6, visualKind: "container" },
  "tire-cover-blue": { x: -68, z: -30, width: 8, depth: 8, height: 4.8, visualKind: "tires" },
  "tire-cover-red": { x: 68, z: 30, width: 8, depth: 8, height: 4.8, visualKind: "tires" },
};

function mapWithObstacles(obstacles) {
  return { ...COMBAT_ALPHA_MAP, obstacles };
}

function footprintFromRect(rect) {
  return {
    minX: rect.x - rect.width / 2,
    maxX: rect.x + rect.width / 2,
    minZ: rect.z - rect.depth / 2,
    maxZ: rect.z + rect.depth / 2,
  };
}

function overlaps(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function requireFootprintHelper() {
  if (typeof combatAlphaMap.combatAlphaObstacleFootprint !== "function") {
    assert.fail("combatAlphaObstacleFootprint must expose the shared cover footprint contract");
  }
  return combatAlphaMap.combatAlphaObstacleFootprint;
}

test("combat-alpha declares the six approved cover descriptors without changing the native hazards", () => {
  const layout = combatAlphaMapLayout();
  const covers = layout.obstacles.filter(obstacle => obstacle.role === "cover");

  assert.deepEqual(covers.map(obstacle => obstacle.id), COVER_IDS);
  assert.deepEqual(layout.obstacles.slice(0, 2), [
    { id: "central-block", kind: "box", x: 0, z: -20, width: 14, depth: 18, height: 3.25 },
    { id: "south-ramp", kind: "closed-convex-wedge", x: 0, z: 20, run: 20, width: 18, height: 3.5 },
  ]);
  assert.equal(layout.obstacles.length, 8);
  assert.equal(COMBAT_ALPHA_MAP.obstacles, COMBAT_ALPHA_OBSTACLES);
  assert.equal(new Set(layout.obstacles.map(obstacle => obstacle.id)).size, layout.obstacles.length);

  for (const cover of covers) {
    const nominal = NOMINAL_COVERS[cover.id];
    assert.equal(cover.kind, "box");
    assert.equal(cover.role, "cover");
    assert.equal(cover.visualKind, nominal.visualKind);
    assert.equal(cover.x, nominal.x);
    assert.equal(cover.z, nominal.z);
    assert.equal(cover.width, nominal.width);
    assert.equal(cover.depth, nominal.depth);
    assert.equal(cover.height, nominal.height);
    assert.equal(typeof cover.symmetryGroup, "string");
    assert.ok(cover.symmetryGroup.length > 0);
  }
  assert.equal(COMBAT_ALPHA_PICKUPS.length, 0);
  assert.deepEqual(layout.pickups, []);
});

test("cover descriptors are exactly symmetric under x -> -x, z -> -z", () => {
  const covers = COMBAT_ALPHA_OBSTACLES.filter(obstacle => obstacle.role === "cover");
  const groups = new Map();
  for (const cover of covers) {
    const opposite = covers.find(candidate => candidate.x === -cover.x && candidate.z === -cover.z);
    assert.ok(opposite, `${cover.id} has no 180-degree opposite`);
    assert.equal(opposite.visualKind, cover.visualKind);
    assert.equal(opposite.width, cover.width);
    assert.equal(opposite.depth, cover.depth);
    assert.equal(opposite.height, cover.height);
    assert.equal(opposite.symmetryGroup, cover.symmetryGroup);
    const members = groups.get(cover.symmetryGroup) || [];
    members.push(cover.id);
    groups.set(cover.symmetryGroup, members);
  }
  assert.equal(groups.size, 3);
  for (const members of groups.values()) assert.equal(members.length, 2);
});

test("cover footprints stay inside the flat floor and clear spawns and native hazards", () => {
  const obstacleFootprint = requireFootprintHelper();
  const layout = combatAlphaMapLayout();
  const { arena, safeFloor } = layout;
  const covers = layout.obstacles.filter(obstacle => obstacle.role === "cover");
  const hazards = layout.obstacles.filter(obstacle => !obstacle.role);
  const clearance = COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius;

  for (const obstacle of layout.obstacles) {
    const footprint = obstacleFootprint(obstacle);
    assert.ok(footprint, `${obstacle.id} must have a footprint`);
    assert.ok(footprint.minX >= safeFloor.minX && footprint.maxX <= safeFloor.maxX, `${obstacle.id} exceeds safe X`);
    assert.ok(footprint.minZ >= safeFloor.minZ && footprint.maxZ <= safeFloor.maxZ, `${obstacle.id} exceeds safe Z`);
  }
  assert.deepEqual(hazards.map(obstacle => obstacle.id), ["central-block", "south-ramp"]);
  for (const spawn of layout.spawnSlots) {
    assert.ok(isCombatAlphaSafeFloorPoint(spawn, { arena, obstacles: layout.obstacles, clearance }), `${spawn.slot} is blocked`);
  }
  for (const cover of covers) {
    const coverFootprint = obstacleFootprint(cover, clearance);
    for (const hazard of hazards) {
      assert.ok(!overlaps(coverFootprint, obstacleFootprint(hazard, clearance)), `${cover.id} is too close to ${hazard.id}`);
    }
  }
});

test("central and both outer probe corridors remain free for a vehicle-sized footprint", () => {
  const obstacleFootprint = requireFootprintHelper();
  const layout = combatAlphaMapLayout();
  const clearance = COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius;

  assert.deepEqual(layout.corridors.map(corridor => corridor.id), ["central", "outer-north", "outer-south"]);
  for (const corridor of layout.corridors) {
    const corridorFootprint = footprintFromRect(corridor);
    assert.ok(corridorFootprint.minX >= -layout.arena.halfWidth + layout.arena.curveRadius);
    assert.ok(corridorFootprint.maxX <= layout.arena.halfWidth - layout.arena.curveRadius);
    assert.ok(corridorFootprint.minZ >= -layout.arena.halfDepth + layout.arena.curveRadius);
    assert.ok(corridorFootprint.maxZ <= layout.arena.halfDepth - layout.arena.curveRadius);
    for (const obstacle of layout.obstacles) {
      assert.ok(!overlaps(corridorFootprint, obstacleFootprint(obstacle, clearance)), `${obstacle.id} blocks ${corridor.id}`);
    }
  }
});

test("layout validation rejects unsafe or asymmetric obstacle declarations", () => {
  const invalid = [
    ["out-of-bounds", { id: "bad-bounds", kind: "box", x: 130, z: 0, width: 10, depth: 10, height: 2 }, /flat floor/],
    ["spawn", { id: "bad-spawn", kind: "box", x: -88, z: 0, width: 10, depth: 10, height: 2 }, /spawn/],
    ["overlap", { id: "bad-overlap", kind: "box", x: 0, z: -20, width: 14, depth: 18, height: 2 }, /overlap/],
    ["corridor", { id: "bad-corridor", kind: "box", x: 0, z: 0, width: 10, depth: 10, height: 2 }, /corridor/],
    ["descriptor", { id: "bad-cover", kind: "box", x: 0, z: 0, width: 10, depth: 10, height: 2, role: "cover", visualKind: "scrap" }, /descriptor/],
    ["duplicate", { ...COMBAT_ALPHA_OBSTACLES[0] }, /descriptor/],
  ];
  for (const [name, obstacle, pattern] of invalid) {
    assert.throws(() => combatAlphaMapLayout(mapWithObstacles([...COMBAT_ALPHA_OBSTACLES, obstacle])), pattern, name);
  }
  const asymmetric = COMBAT_ALPHA_OBSTACLES.map(obstacle => obstacle.id === "container-cover-northwest"
    ? { ...obstacle, z: -57 }
    : obstacle);
  assert.throws(() => combatAlphaMapLayout(mapWithObstacles(asymmetric)), /symmetry/);
});

test("footprint helper covers boxes, the ramp wedge, clearance, and invalid input", () => {
  const obstacleFootprint = requireFootprintHelper();
  assert.deepEqual(obstacleFootprint({ kind: "box", x: 10, z: -5, width: 8, depth: 6 }), {
    minX: 6, maxX: 14, minZ: -8, maxZ: -2,
  });
  assert.deepEqual(obstacleFootprint({ kind: "closed-convex-wedge", x: 0, z: 20, run: 20, width: 18 }, 2), {
    minX: -12, maxX: 12, minZ: 9, maxZ: 31,
  });
  assert.equal(obstacleFootprint({ kind: "box", x: 0, z: 0, width: 0, depth: 4 }), null);
  assert.equal(obstacleFootprint({ kind: "unknown", x: 0, z: 0, width: 4, depth: 4 }), null);
  assert.equal(obstacleFootprint({ kind: "box", x: 0, z: 0, width: 4, depth: 4 }, -1), null);
});
