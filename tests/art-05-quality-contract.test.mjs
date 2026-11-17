import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ARENA_VISUAL_QUALITIES,
  CLEAN_PRACTICE_PROFILE,
  COMBAT_ALPHA_LOW_PROFILE,
  COMBAT_ALPHA_PROFILE,
  SCRAPYARD_PROFILE,
  getArenaVisualProfile,
  normalizeArenaVisualQuality,
} from "../src/arena-visual-profile.js";
import {
  COMBAT_ALPHA_MAP,
  COMBAT_ALPHA_OBSTACLES,
  COMBAT_ALPHA_PICKUPS,
  combatAlphaMapLayout,
} from "../src/combat-alpha-map.js";
import { rocketSimArenaProfile } from "../src/rocketsim-arena-profile.js";

test("high is the default combat-alpha tier and keeps the approved industrial skin", () => {
  assert.deepEqual([...ARENA_VISUAL_QUALITIES], ["high", "low"]);
  assert.equal(normalizeArenaVisualQuality(undefined), "high");
  assert.equal(normalizeArenaVisualQuality("HIGH"), "high");
  assert.equal(normalizeArenaVisualQuality("ultra"), "high");
  assert.equal(normalizeArenaVisualQuality("low"), "low");

  assert.equal(getArenaVisualProfile("combat-alpha"), COMBAT_ALPHA_PROFILE);
  assert.equal(getArenaVisualProfile("rocketsim-combat-alpha", { quality: "high" }), COMBAT_ALPHA_PROFILE);
  assert.equal(COMBAT_ALPHA_PROFILE.quality, "high");
  assert.equal(COMBAT_ALPHA_PROFILE.surface.skin, "industrial-scrapyard");
  assert.equal(COMBAT_ALPHA_PROFILE.surface.textureManifest, "/src/assets/arena/scrapyard/manifest.json");
  assert.equal(COMBAT_ALPHA_PROFILE.surface.textureBudgetBytes, 4_194_304);
});

test("low selects only an opaque fallback while preserving combat-alpha identity", () => {
  const low = getArenaVisualProfile("rocketsim-combat-alpha", { quality: "low" });

  assert.equal(low, COMBAT_ALPHA_LOW_PROFILE);
  assert.notEqual(low, COMBAT_ALPHA_PROFILE);
  assert.equal(low.quality, "low");
  assert.equal(low.id, COMBAT_ALPHA_PROFILE.id);
  assert.equal(low.surface.opaque, true);
  assert.equal(low.surface.unified, true);
  assert.equal(low.surface.skin, "solid-fallback");
  assert.equal(low.surface.materialModel, "shared-group-standard-solid");
  assert.equal(low.surface.textureManifest, null);
  assert.equal(low.surface.textureBudgetBytes, 0);
  assert.equal(low.surface.materialColor, COMBAT_ALPHA_PROFILE.surface.materialColor);
  assert.equal(low.surface.materialRoughness, COMBAT_ALPHA_PROFILE.surface.materialRoughness);
  assert.equal(low.surface.materialMetalness, COMBAT_ALPHA_PROFILE.surface.materialMetalness);
  assert.equal(low.surface.materialEmissive, COMBAT_ALPHA_PROFILE.surface.materialEmissive);
  assert.equal(low.surface.materialEmissiveIntensity, COMBAT_ALPHA_PROFILE.surface.materialEmissiveIntensity);
});

test("explicit tier selection is limited to combat-alpha and defaults high", () => {
  assert.equal(getArenaVisualProfile("combat-alpha", { quality: "LOW" }), COMBAT_ALPHA_LOW_PROFILE);
  assert.equal(getArenaVisualProfile("combat-alpha", { quality: "bogus" }), COMBAT_ALPHA_PROFILE);
  assert.equal(getArenaVisualProfile("combat-alpha", { quality: undefined }), COMBAT_ALPHA_PROFILE);
  assert.equal(getArenaVisualProfile("scrapyard", { quality: "low" }), SCRAPYARD_PROFILE);
  assert.equal(getArenaVisualProfile("calibration", { quality: "low" }), CLEAN_PRACTICE_PROFILE);
});

test("tier selection cannot mutate arena, simulation contracts, or pickups", () => {
  const arenaBefore = rocketSimArenaProfile("combat-alpha");
  const layoutBefore = combatAlphaMapLayout();
  const highSurfaceBefore = { ...COMBAT_ALPHA_PROFILE.surface };

  const low = getArenaVisualProfile("combat-alpha", { quality: "low" });
  const high = getArenaVisualProfile("combat-alpha", { quality: "high" });

  assert.equal(high, COMBAT_ALPHA_PROFILE);
  assert.deepEqual(rocketSimArenaProfile("combat-alpha"), arenaBefore);
  assert.deepEqual(combatAlphaMapLayout(), layoutBefore);
  assert.equal(COMBAT_ALPHA_MAP.obstacles, COMBAT_ALPHA_OBSTACLES);
  assert.deepEqual(COMBAT_ALPHA_MAP.pickups, []);
  assert.equal(COMBAT_ALPHA_PICKUPS.length, 0);
  assert.deepEqual(COMBAT_ALPHA_PROFILE.surface, highSurfaceBefore);

  for (const key of ["colliders", "bodies", "physics", "tick", "snapshots", "network", "authority", "pickups"]) {
    assert.equal(key in low, false, `low tier must not expose ${key}`);
    assert.equal(key in low.surface, false, `low surface must not expose ${key}`);
  }
});

test("low tier preserves team, car, projectile, HUD, and regenerable-nitro legibility", async () => {
  const low = getArenaVisualProfile("combat-alpha", { quality: "low" });
  const high = COMBAT_ALPHA_PROFILE;
  for (const key of [
    "background", "fog", "fogNear", "fogFar", "floor", "steel", "ceiling",
    "boundaryGlow", "gridMajor", "gridMinor", "curve", "curveStripe",
    "combatBlueWash", "combatRedWash", "landmark", "blueZone", "redZone",
    "perimeter", "perimeterOpacity",
  ]) {
    assert.equal(low[key], high[key], `${key} must remain identical across tiers`);
  }
  assert.equal(low.lighting, high.lighting);
  assert.equal(low.decoration.teamWashIntensity, high.decoration.teamWashIntensity);
  assert.equal(low.decoration.beaconHeight, high.decoration.beaconHeight);
  assert.equal(low.decoration.beaconRadius, high.decoration.beaconRadius);
  assert.equal(low.decoration.objectiveRadius, high.decoration.objectiveRadius);

  const layout = combatAlphaMapLayout();
  assert.equal(layout.beacons.length, 6);
  assert.equal(layout.beacons.filter(beacon => beacon.team === "blue").length, 3);
  assert.equal(layout.beacons.filter(beacon => beacon.team === "red").length, 3);
  assert.equal(layout.obstacles.length, 8);
  assert.equal(layout.pickups.length, 0);

  const [html, client] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/client.js", import.meta.url), "utf8"),
  ]);
  for (const selector of ["#combat-loading", "#readout", "#events", "#performance-readout", ".scoreboard"]) {
    assert.match(html, new RegExp(`(?:id|class)=["']${selector.slice(1)}["']`), `missing HUD/loading surface ${selector}`);
  }
  assert.match(client, /createLegacyCar/);
  assert.match(client, /NITRO/);
  assert.match(client, /setNitroState/);
  assert.match(client, /updateRockets/);
  assert.match(client, /audioMixer/);
});

test("client resolves the tier from the quality query and passes it to profile, material, and diagnostics", async () => {
  const client = await readFile(new URL("../src/client.js", import.meta.url), "utf8");
  assert.match(client, /normalizeArenaVisualQuality\(new URLSearchParams\(location\.search\)\.get\("quality"\)\)/);
  assert.match(client, /getArenaVisualProfile\(mode, \{ quality: visualQuality \}\)/);
  assert.match(client, /createScrapyardShellMaterial\(\{ THREE, renderer, quality: visualQuality \}\)/);
  assert.match(client, /readRendererInfo\(renderer, frameMetrics, \{ qualityTier: visualQuality \}\)/);
  assert.match(client, /visualProfile\.surface\?\.skin === "industrial-scrapyard"/);
});
