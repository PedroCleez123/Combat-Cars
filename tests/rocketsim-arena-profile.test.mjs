import assert from "node:assert/strict";
import test from "node:test";

import {
  rocketSimArenaCameraFar,
  rocketSimArenaForWorldMode,
  rocketSimArenaProfile,
  rocketSimArenaRequiresR20,
  rocketSimArenaSurfaceFootprint,
  rocketSimArenaVisualSpec,
  rocketSimBridgeSupportsArena,
  rocketSimCombatBounds,
} from "../src/rocketsim-arena-profile.js";

test("combat-alpha uses the expanded native arena bounds", () => {
  assert.deepEqual(rocketSimCombatBounds("combat-alpha"), {
    halfWidth: 132,
    halfDepth: 204,
    ceilingHeight: 108,
  });
});

test("camera far plane covers the complete expanded combat-alpha arena", () => {
  assert.equal(rocketSimArenaCameraFar(rocketSimArenaProfile("combat-alpha")), 816);
  assert.equal(rocketSimArenaCameraFar(rocketSimArenaProfile("arsenal-practice")), 250);
  assert.equal(rocketSimArenaCameraFar(null), 250);
});

test("combat-alpha expansion does not resize opt-in practice arenas", () => {
  assert.deepEqual(rocketSimCombatBounds("arsenal-expanded-cornered-practice"), {
    halfWidth: 72,
    halfDepth: 54,
    ceilingHeight: 30,
  });
});

test("the native-only combat lineup uses the clean arena bounds", () => {
  assert.deepEqual(rocketSimCombatBounds("combat-lineup"), {
    halfWidth: 62,
    halfDepth: 46,
    ceilingHeight: 24,
  });
});

test("the client world modes resolve to the same named arena profiles as Node", () => {
  const arena = rocketSimArenaForWorldMode("rocketsim-combat-alpha");
  assert.equal(arena, "combat-alpha");
  assert.deepEqual(rocketSimArenaProfile(arena), {
    halfWidth: 132,
    halfDepth: 204,
    height: 108,
    curveRadius: 30,
    cornered: true,
    expanded: true,
  });
});

test("expanded arenas reject bridges older than R20 before the server starts", () => {
  assert.equal(rocketSimArenaRequiresR20("combat-alpha"), true);
  assert.equal(rocketSimBridgeSupportsArena("combat-alpha", "R13"), false);
  assert.equal(rocketSimBridgeSupportsArena("combat-alpha", "R19"), false);
  assert.equal(rocketSimBridgeSupportsArena("combat-alpha", "R20"), true);
  assert.equal(rocketSimBridgeSupportsArena("combat-alpha", "R21"), true);
  assert.equal(rocketSimBridgeSupportsArena("combat-lineup", "R13"), true);
  assert.equal(rocketSimBridgeSupportsArena("combat-alpha", "NATIVE"), false);
});

test("visual spec mirrors the native single-side curved practice arena", () => {
  const spec = rocketSimArenaVisualSpec(rocketSimArenaProfile("arsenal-curved-practice"));
  assert.deepEqual(spec.curvedSides, ["positiveX"]);
  assert.equal(spec.clipCurveEnds, false);
  assert.equal(spec.cornerFillets, false);
  assert.equal(spec.wallSegments.find(segment => segment.side === "positiveX").minY, spec.curveRadius);
  assert.equal(spec.wallSegments.find(segment => segment.side === "negativeX").minY, 0);
  assert.equal(spec.wallSegments.find(segment => segment.side === "positiveX").min, -46);
  assert.equal(spec.wallSegments.find(segment => segment.side === "positiveX").max, 46);
});

test("expanded curved practice clips all four native curves and straight wall panels", () => {
  const spec = rocketSimArenaVisualSpec(rocketSimArenaProfile("arsenal-expanded-curved-practice"));
  assert.deepEqual(spec.curvedSides, ["positiveX", "negativeX", "positiveZ", "negativeZ"]);
  assert.equal(spec.clipCurveEnds, true);
  assert.equal(spec.cornerFillets, false);
  assert.ok(spec.wallSegments.every(segment => segment.minY === 8 && segment.maxY === 22));
  assert.deepEqual(spec.wallSegments[0], {
    side: "positiveX", axis: "z", fixed: 72, min: -46, max: 46, minY: 8, maxY: 22,
  });
  assert.deepEqual(spec.wallSegments[2], {
    side: "positiveZ", axis: "x", fixed: 54, min: -64, max: 64, minY: 8, maxY: 22,
  });
});

test("combat-alpha keeps all native curves and lower, upper, and vertical corner fillets", () => {
  const spec = rocketSimArenaVisualSpec(rocketSimArenaProfile("combat-alpha"));
  assert.deepEqual(spec.curvedSides, ["positiveX", "negativeX", "positiveZ", "negativeZ"]);
  assert.equal(spec.clipCurveEnds, true);
  assert.equal(spec.cornerFillets, true);
  assert.ok(spec.wallSegments.every(segment => segment.minY === 30 && segment.maxY === 78));
  assert.deepEqual([spec.wallSegments[0].min, spec.wallSegments[0].max], [-174, 174]);
  assert.deepEqual([spec.wallSegments[2].min, spec.wallSegments[2].max], [-102, 102]);
});

test("cornered native arenas use a non-overlapping central floor and side strips", () => {
  const spec = rocketSimArenaVisualSpec(rocketSimArenaProfile("combat-alpha"));
  const footprint = rocketSimArenaSurfaceFootprint(spec);
  assert.equal(footprint.length, 5);
  assert.deepEqual(footprint[0], { x: 0, z: 0, width: 204, depth: 348 });
  assert.equal(footprint.slice(1).reduce((sum, rectangle) => sum + rectangle.width * rectangle.depth, 0), 33120);
});

test("curved native arenas without corner fillets keep a complete floor footprint", () => {
  const spec = rocketSimArenaVisualSpec(rocketSimArenaProfile("arsenal-expanded-curved-practice"));
  assert.deepEqual(rocketSimArenaSurfaceFootprint(spec), [{ x: 0, z: 0, width: 144, depth: 108 }]);
});
