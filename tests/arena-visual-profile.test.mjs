import test from "node:test";
import assert from "node:assert/strict";
import { CLEAN_PRACTICE_PROFILE, SCRAPYARD_PROFILE, getArenaVisualProfile } from "../src/arena-visual-profile.js";

test("the clean RocketSim practice profiles use the brighter legibility theme", () => {
  for (const mode of ["calibration", "rocketsim-curved-practice", "rocketsim-expanded-curved-practice", "rocketsim-expanded-cornered-practice", "rocketsim-expanded-block-practice", "rocketsim-expanded-ramp-practice", "rocketsim-combat-alpha"]) {
    assert.equal(getArenaVisualProfile(mode), CLEAN_PRACTICE_PROFILE);
  }
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

test("non-practice modes retain the scrapyard visual profile", () => {
  assert.equal(getArenaVisualProfile(), SCRAPYARD_PROFILE);
  assert.equal(getArenaVisualProfile("scrapyard"), SCRAPYARD_PROFILE);
  assert.equal(getArenaVisualProfile("unknown-mode"), SCRAPYARD_PROFILE);
  assert.deepEqual(SCRAPYARD_PROFILE.lighting, { hemisphere: 2.1, sun: 3.45, wash: 28, exposure: 1.1 });
});
