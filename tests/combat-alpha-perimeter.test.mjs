import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import {
  buildArenaDecorationSpec,
  combatAlphaObstacleVisualSpec,
  createArenaDecoration,
} from "../src/arena-decoration.js";
import { COMBAT_ALPHA_PROFILE } from "../src/arena-visual-profile.js";

test("combat-alpha perimeter modules live in the declared upper-shell band", () => {
  const spec = buildArenaDecorationSpec({ mode: "rocketsim-combat-alpha" });
  assert.ok(spec.upperShellBand);
  assert.equal(spec.perimeter?.modules.length, 4);
  assert.equal(spec.perimeter.instanced, true);
  assert.equal(spec.perimeter.sharedGeometry, true);
  for (const module of spec.perimeter.modules) {
    assert.equal(module.visualOnly, true);
    assert.ok(module.y >= spec.upperShellBand.minY, `${module.id} is below the upper-shell band`);
    assert.ok(module.y <= spec.upperShellBand.maxY, `${module.id} is above the upper-shell band`);
    assert.ok(Math.abs(module.x) < spec.arena.halfWidth);
    assert.ok(Math.abs(module.z) < spec.arena.halfDepth);
  }
  assert.equal("colliders" in spec, false);
  assert.equal("bodies" in spec, false);
});

test("perimeter frames and lamps are instanced, emissive and add no point lights", () => {
  const decoration = createArenaDecoration({
    THREE,
    parent: new THREE.Group(),
    mode: "rocketsim-combat-alpha",
  });
  const frames = decoration.root.getObjectByName("industrial-perimeter-frames");
  const lamps = decoration.root.getObjectByName("industrial-perimeter-lamps");

  assert.ok(frames?.isInstancedMesh);
  assert.ok(lamps?.isInstancedMesh);
  assert.equal(frames.count, 4);
  assert.equal(lamps.count, 4);
  assert.equal(frames.userData.visualOnly, true);
  assert.equal(lamps.userData.visualOnly, true);
  assert.ok(lamps.material.emissiveIntensity > 0);

  let perimeterLights = 0;
  decoration.root.traverse((object) => {
    if (object.isLight && String(object.userData?.role || "").startsWith("perimeter")) perimeterLights += 1;
  });
  assert.equal(perimeterLights, 0);

  const metrics = decoration.metrics();
  assert.equal(metrics.perimeterModuleCount, 4);
  assert.equal(metrics.perimeterDrawCalls, 2);
  assert.equal(metrics.perimeterInstanced, true);
  decoration.dispose();
});

test("every decoration object is visual-only", () => {
  const decoration = createArenaDecoration({
    THREE,
    parent: new THREE.Group(),
    mode: "rocketsim-combat-alpha",
  });
  decoration.root.traverse((object) => {
    assert.equal(object.userData?.visualOnly, true, `${object.name || object.type} is not visual-only`);
  });
  decoration.dispose();
});

test("combat obstacle finish preserves native dimensions and narrows hazard to the base band", () => {
  const visual = combatAlphaObstacleVisualSpec();
  assert.deepEqual(visual.block, { x: 0, z: -20, width: 14, height: 3.25, depth: 18 });
  assert.deepEqual(visual.ramp, { x: 0, z: 20, run: 10, width: 9, height: 3.5 });

  const finish = COMBAT_ALPHA_PROFILE.obstacles;
  assert.ok(Number.isFinite(finish.hazardBandHeight));
  assert.ok(finish.hazardBandHeight > 0 && finish.hazardBandHeight <= .5);
  assert.ok(finish.capMetalness > finish.bodyMetalness);
  assert.notEqual(finish.cap, COMBAT_ALPHA_PROFILE.palette?.hazard);
});

test("client consumes the obstacle spec and ART-03 material without changing obstacle geometry", async () => {
  const client = await readFile(new URL("../src/client.js", import.meta.url), "utf8");
  const material = await readFile(new URL("../src/arena-scrapyard-material.js", import.meta.url), "utf8");
  assert.match(client, /combatAlphaObstacleVisualSpec/);
  assert.match(client, /obstacleFinish\.hazardBandHeight/);
  assert.match(client, /createScrapyardShellMaterial/);
  assert.match(client, /const block = box\(world, \[width, height, depth\], \[x, height \/ 2, z\], bodyMaterial\);/);
  assert.match(client, /box\(world, \[width \+ \.2, \.16, depth \+ \.2\], \[x, height \+ \.08, z\], capMaterial\);/);
  assert.match(client, /-run, 0, -width,  run, 0, -width,  -run, 0, width,\s+run, 0, width,   run, height, -width,  run, height, width,/);
  assert.match(material, /smoothstep\(0\.8, 3\.2, scrapyardPosition\.y\)/);
  assert.match(client, /smoothstep\(0\.8, 3\.2, scrapyardPosition\.y\)/);
});

