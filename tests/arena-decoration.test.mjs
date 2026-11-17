import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildArenaDecorationSpec, createArenaDecoration } from "../src/arena-decoration.js";
import { CLEAN_PRACTICE_PROFILE, COMBAT_ALPHA_PROFILE, getArenaVisualProfile, SCRAPYARD_PROFILE } from "../src/arena-visual-profile.js";

test("combat-alpha selects the clean profile and disables external arena GLBs", () => {
  assert.equal(getArenaVisualProfile("combat-alpha"), COMBAT_ALPHA_PROFILE);
  assert.equal(getArenaVisualProfile("rocketsim-combat-alpha"), COMBAT_ALPHA_PROFILE);
  assert.equal(COMBAT_ALPHA_PROFILE.id, "combat-alpha-clean");
  assert.equal(COMBAT_ALPHA_PROFILE.id.includes("scrapyard"), false);
  assert.equal(COMBAT_ALPHA_PROFILE.id.includes("practice"), false);
  assert.equal(COMBAT_ALPHA_PROFILE.assets.enabled, false);
  assert.equal(COMBAT_ALPHA_PROFILE.assets.skybowl.url, null);
  assert.equal(COMBAT_ALPHA_PROFILE.assets.boostPads.url, null);
  assert.equal(getArenaVisualProfile("calibration"), CLEAN_PRACTICE_PROFILE);
  assert.equal(getArenaVisualProfile("scrapyard"), SCRAPYARD_PROFILE);
});

test("combat-alpha decoration derives every landmark from the expanded presentation bounds", () => {
  const spec = buildArenaDecorationSpec({ mode: "rocketsim-combat-alpha" });
  assert.equal(spec.visualOnly, true);
  assert.equal(spec.visualProfile, "combat-alpha-clean");
  assert.deepEqual(spec.arena, { halfWidth: 132, halfDepth: 204, height: 108, curveRadius: 30, cornered: true, expanded: true });
  assert.equal(spec.panels.length, 0);
  assert.equal(spec.panelEdge.visible, false);
  assert.equal(spec.beacons.length, 6);
  assert.equal(spec.laneGuides.length, 0);
  assert.deepEqual(spec.beacons.map(beacon => Math.round(beacon.x * 100) / 100), [-110, -110, -110, 110, 110, 110]);
  for (const point of [...spec.beacons, ...spec.hazards, spec.objective]) {
    assert.ok(Math.abs(point.x) < spec.arena.halfWidth);
    assert.ok(Math.abs(point.z) < spec.arena.halfDepth);
  }
  assert.ok(Object.isFrozen(spec));
  assert.ok(Object.isFrozen(spec.arena));
  assert.equal(spec.padDecorationSource, "procedural");
  assert.equal(spec.assets.enabled, false);
  assert.equal(spec.assets.skybowl.url, null);
  assert.equal(spec.assets.boostPads.url, null);
  assert.equal(spec.industrial.fixtures.length, 4);
  assert.ok(spec.industrial.fixtureHeight < spec.arena.height);
  assert.equal(COMBAT_ALPHA_PROFILE.decoration.showWallPanels, false);
  assert.equal(COMBAT_ALPHA_PROFILE.decoration.showPerimeterLine, false);
});

test("Three.js decorator builds disposable panels, lights and functional landmark handles", () => {
  const parent = new THREE.Group();
  const decoration = createArenaDecoration({ THREE, parent, mode: "rocketsim-combat-alpha" });
  assert.equal(decoration.root.parent, parent);
  assert.ok(decoration.root.children.length >= 12);
  assert.ok(decoration.root.children.some(child => child.name === "center-objective"));
  assert.equal(decoration.root.children.some(child => child.userData?.role === "arena-panel"), false);
  assert.equal(decoration.root.children.some(child => child.name === "arena-perimeter"), false);
  assert.ok(decoration.root.children.some(child => child.userData?.role === "team-beacon"));
  assert.equal(decoration.root.children.some(child => child.name === "industrial-scrapyard-perimeter"), false);
  assert.equal(decoration.root.children.some(child => child.name === "scrapyard-crane"), false);
  assert.equal(decoration.root.children.some(child => child.name === "scrap-metal-piles"), false);
  assert.equal(decoration.root.children.filter(child => child.userData?.role === "industrial-fixture").length, 4);
  assert.ok(decoration.root.getObjectByName("industrial-perimeter-frames"));
  assert.ok(decoration.root.getObjectByName("industrial-perimeter-lamps"));
  decoration.update({ time: 1.25 });
  assert.ok(decoration.root.children.some(child => child.userData?.role === "team-wash"));
  decoration.dispose();
  assert.equal(decoration.root.parent, null);
  decoration.dispose();
});

test("combat-alpha no longer decorates floor boost pickups", () => {
  const parent = new THREE.Group();
  const decoration = createArenaDecoration({ THREE, parent, mode: "rocketsim-combat-alpha" });
  const metrics = decoration.metrics();
  assert.equal(metrics.padCount, 0);
  assert.equal(metrics.padLightCount, 0);
  assert.equal(metrics.padBatchCount, 0);
  assert.equal(metrics.padDrawCalls, 0);
  assert.ok(metrics.drawCalls < 40);
  decoration.update({ pads: [] });
  assert.equal(decoration.metrics().padActiveCount, 0);
  decoration.dispose();
});

test("missing renderer namespace returns a pure no-op handle", () => {
  const decoration = createArenaDecoration({ mode: "rocketsim-combat-alpha" });
  assert.equal(decoration.root, null);
  assert.equal(decoration.spec.visualOnly, true);
  assert.equal(decoration.update(), decoration);
  decoration.dispose();
});
