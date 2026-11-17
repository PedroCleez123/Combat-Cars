import test from "node:test";
import assert from "node:assert/strict";
import { CLEAN_PRACTICE_PROFILE, COMBAT_ALPHA_PROFILE, SCRAPYARD_PROFILE, getArenaFogSettings, getArenaVisualProfile } from "../src/arena-visual-profile.js";

test("the clean RocketSim practice profiles use the brighter legibility theme", () => {
  for (const mode of ["calibration", "rocketsim-curved-practice", "rocketsim-expanded-curved-practice", "rocketsim-expanded-cornered-practice", "rocketsim-expanded-block-practice", "rocketsim-expanded-ramp-practice"]) {
    assert.equal(getArenaVisualProfile(mode), CLEAN_PRACTICE_PROFILE);
  }
  assert.notEqual(getArenaVisualProfile("combat-alpha"), CLEAN_PRACTICE_PROFILE);
  assert.notEqual(getArenaVisualProfile("rocketsim-combat-alpha"), CLEAN_PRACTICE_PROFILE);
  assert.ok(CLEAN_PRACTICE_PROFILE.fogFar > CLEAN_PRACTICE_PROFILE.fogNear);
  assert.ok(CLEAN_PRACTICE_PROFILE.fogNear > SCRAPYARD_PROFILE.fogNear);
  assert.ok(CLEAN_PRACTICE_PROFILE.ceilingOpacity > SCRAPYARD_PROFILE.ceilingOpacity);
  assert.ok(CLEAN_PRACTICE_PROFILE.wallOpacity > 0 && CLEAN_PRACTICE_PROFILE.wallOpacity < .5);
  assert.ok(CLEAN_PRACTICE_PROFILE.curveOpacity > 0 && CLEAN_PRACTICE_PROFILE.curveOpacity < .5);
  assert.ok(CLEAN_PRACTICE_PROFILE.boundaryGlowIntensity > 0);
  assert.notEqual(CLEAN_PRACTICE_PROFILE.floor, CLEAN_PRACTICE_PROFILE.steel);
  assert.notEqual(CLEAN_PRACTICE_PROFILE.steel, CLEAN_PRACTICE_PROFILE.ceiling);
  assert.notEqual(CLEAN_PRACTICE_PROFILE.landmark, CLEAN_PRACTICE_PROFILE.floor);
  assert.notEqual(CLEAN_PRACTICE_PROFILE.blueZone, CLEAN_PRACTICE_PROFILE.redZone);
  assert.notEqual(CLEAN_PRACTICE_PROFILE.combatBlueWash, CLEAN_PRACTICE_PROFILE.combatRedWash);
  assert.ok(CLEAN_PRACTICE_PROFILE.combatWashOpacity > 0 && CLEAN_PRACTICE_PROFILE.combatWashOpacity < .2);
  assert.ok(CLEAN_PRACTICE_PROFILE.perimeterOpacity > .4 && CLEAN_PRACTICE_PROFILE.perimeterOpacity <= 1);
  assert.ok(CLEAN_PRACTICE_PROFILE.lighting.hemisphere > SCRAPYARD_PROFILE.lighting.hemisphere);
  assert.ok(CLEAN_PRACTICE_PROFILE.lighting.sun > SCRAPYARD_PROFILE.lighting.sun);
  assert.ok(CLEAN_PRACTICE_PROFILE.lighting.wash > SCRAPYARD_PROFILE.lighting.wash);
});

test("combat-alpha modes use the clean combat profile", () => {
  assert.equal(getArenaVisualProfile("combat-alpha"), COMBAT_ALPHA_PROFILE);
  assert.equal(getArenaVisualProfile("rocketsim-combat-alpha"), COMBAT_ALPHA_PROFILE);
  assert.notEqual(COMBAT_ALPHA_PROFILE, CLEAN_PRACTICE_PROFILE);
  assert.equal(COMBAT_ALPHA_PROFILE.id, "combat-alpha-clean");
  assert.ok(COMBAT_ALPHA_PROFILE.wallOpacity >= .9);
  assert.ok(COMBAT_ALPHA_PROFILE.curveOpacity >= .9);
  assert.ok(COMBAT_ALPHA_PROFILE.ceilingOpacity >= .9);
  assert.equal(COMBAT_ALPHA_PROFILE.showGrid, false);
  assert.equal(COMBAT_ALPHA_PROFILE.showCurveOverlay, false);
  assert.equal(COMBAT_ALPHA_PROFILE.opacity, 1);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.opaque, true);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.unified, true);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.opaque, true);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.materialColor, 0x496f78);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.materialModel, "shared-group-world-space-standard");
  assert.equal(COMBAT_ALPHA_PROFILE.surface.skin, "industrial-scrapyard");
  assert.equal(COMBAT_ALPHA_PROFILE.surface.textureManifest, "/src/assets/arena/scrapyard/manifest.json");
  assert.equal(COMBAT_ALPHA_PROFILE.surface.textureBudgetBytes, 4_194_304);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.showFloorGrid, false);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.showCeilingGrid, false);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.showCurveLines, false);
  assert.equal(COMBAT_ALPHA_PROFILE.surface.showBoundaryDebugLines, false);
  assert.equal(COMBAT_ALPHA_PROFILE.fogEnabled, false);
  assert.equal(getArenaFogSettings(COMBAT_ALPHA_PROFILE), null);
  assert.ok(COMBAT_ALPHA_PROFILE.fogFar > SCRAPYARD_PROFILE.fogFar);
  assert.ok(COMBAT_ALPHA_PROFILE.lighting.hemisphere > SCRAPYARD_PROFILE.lighting.hemisphere);
  assert.ok(COMBAT_ALPHA_PROFILE.lighting.sun > SCRAPYARD_PROFILE.lighting.sun);
  assert.ok(COMBAT_ALPHA_PROFILE.lighting.hemisphereGround > SCRAPYARD_PROFILE.lighting.hemisphereGround, "combat ceiling fill must be brighter than the dark legacy ground fill");
  assert.equal(COMBAT_ALPHA_PROFILE.decoration.industrial.enabled, true);
});

test("non-practice modes retain the scrapyard visual profile", () => {
  assert.equal(getArenaVisualProfile(), SCRAPYARD_PROFILE);
  assert.equal(getArenaVisualProfile("scrapyard"), SCRAPYARD_PROFILE);
  assert.equal(getArenaVisualProfile("unknown-mode"), SCRAPYARD_PROFILE);
  assert.deepEqual(SCRAPYARD_PROFILE.lighting, { hemisphere: 2.1, hemisphereSky: 0xb8d8eb, hemisphereGround: 0x102018, sun: 3.45, wash: 28, exposure: 1.1 });
  assert.deepEqual(getArenaFogSettings(SCRAPYARD_PROFILE), {
    color: SCRAPYARD_PROFILE.fog,
    near: SCRAPYARD_PROFILE.fogNear,
    far: SCRAPYARD_PROFILE.fogFar,
  });
});
