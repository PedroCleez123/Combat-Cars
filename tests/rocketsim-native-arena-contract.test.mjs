import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ROCKETSIM_ARENA_PROFILES } from "../src/rocketsim-arena-profile.js";
import { COMBAT_ALPHA_GEOMETRY } from "../src/generated/combat-alpha-geometry.js";

const nativeBridge = await readFile(new URL("../tools/rocketsim-bridge/main.cpp", import.meta.url), "utf8");
const wasmWrapper = await readFile(new URL("../tools/wasm-spike/wrapper.cpp", import.meta.url), "utf8");
const nativeCmake = await readFile(new URL("../tools/rocketsim-bridge/CMakeLists.txt", import.meta.url), "utf8");
const wasmCmake = await readFile(new URL("../tools/wasm-spike/CMakeLists.txt", import.meta.url), "utf8");

test("the shared arena profiles match the native bridge geometry contract", () => {
  const clean = ROCKETSIM_ARENA_PROFILES["arsenal-practice"];
  const expanded = ROCKETSIM_ARENA_PROFILES["combat-alpha"];

  assert.deepEqual(clean, {
    halfWidth: 62,
    halfDepth: 46,
    height: 24,
    curveRadius: 0,
    cornered: false,
    expanded: false,
  });
  assert.deepEqual(expanded, {
    halfWidth: 132,
    halfDepth: 204,
    height: 108,
    curveRadius: 30,
    cornered: true,
    expanded: true,
  });
  assert.equal(ROCKETSIM_ARENA_PROFILES["arsenal-curved-practice"].curveRadius, 256 * 56 / 2300);
  assert.equal(ROCKETSIM_ARENA_PROFILES["combat-lineup"], clean);

  assert.match(nativeBridge, /kArsenalPracticeHalfWidth\s*=\s*62\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kArsenalPracticeHalfDepth\s*=\s*46\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kArsenalPracticeHeight\s*=\s*RLConst::CAR_SPAWN_REST_Z\s*\+\s*24\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kArsenalExpandedHalfWidth\s*=\s*72\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kArsenalExpandedHalfDepth\s*=\s*54\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kArsenalExpandedHeight\s*=\s*RLConst::CAR_SPAWN_REST_Z\s*\+\s*30\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kArsenalExpandedCurveRadius\s*=\s*8\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kCombatAlphaHalfWidth\s*=\s*CombatCarsArenaGeometry::kCombatAlphaWidth\s*\/\s*2\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kCombatAlphaHalfDepth\s*=\s*CombatCarsArenaGeometry::kCombatAlphaDepth\s*\/\s*2\.f\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kCombatAlphaHeight\s*=\s*RLConst::CAR_SPAWN_REST_Z\s*\+\s*CombatCarsArenaGeometry::kCombatAlphaHeight\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kCombatAlphaCurveRadius\s*=\s*CombatCarsArenaGeometry::kCombatAlphaCurveRadius\s*\/\s*kArsenalPracticeScale/);
  assert.match(nativeBridge, /kCombatBlockZ\s*=\s*CombatCarsArenaGeometry::kCentralBlockZ/);
  assert.match(nativeBridge, /kCombatRampZ\s*=\s*CombatCarsArenaGeometry::kSouthRampZ/);
  assert.match(nativeBridge, /kCombatLargePickupXRatio\s*=\s*\.70f/);
  assert.match(nativeBridge, /kCombatLargePickupZRatio\s*=\s*\.70f/);
  assert.match(nativeBridge, /kCombatMediumPickupXRatio\s*=\s*\.52f/);
  assert.match(nativeBridge, /kCombatMediumPickupZRatio\s*=\s*\.72f/);
  assert.match(nativeBridge, /createCombatAlphaArena\(\)\s*\{\s*auto arena = createCorneredArena\(kCombatAlphaHalfWidth, kCombatAlphaHalfDepth, kCombatAlphaHeight, kCombatAlphaCurveRadius, true\);/s);
  assert.match(nativeBridge, /if \(largeBroadphase\) arenaConfig\.useCustomBroadphase = false;/);
  assert.match(wasmWrapper, /if \(combatAlpha \|\| combatAlphaPair\) arenaConfig\.useCustomBroadphase = false;/);
  assert.match(nativeBridge, /if \(profile == "combat-lineup"\) return createCleanArena\(\);/);
});

test("combat-alpha's readable spawn layout remains tied to the native bridge", () => {
  // These are the authoritative native transforms. The client map rounds their
  // presentation labels to -58.67/58.67 and -30/0/30 Arsenal units, but must never
  // use them to place or reset a vehicle.
  assert.match(nativeBridge, /constexpr float kCombatSpawnXRatio\s*=\s*2\.f \/ 3\.f/);
  assert.match(nativeBridge, /combatAlphaSafeFloorPoint\(worldX, worldY, kCombatAlphaVehicleClearance\)/);
  assert.match(nativeBridge, /return Vec\(side \* kCombatAlphaHalfWidth, worldY \/ kArsenalPracticeScale, RLConst::CAR_SPAWN_REST_Z\)/);
  assert.match(nativeBridge, /if \(profile == "combat-alpha"\) return index % 2 == 0 \? 0\.f : kPi;/);
});

test("combat-alpha keeps obstacle dimensions and native boost regeneration in the contract", () => {
  assert.match(nativeBridge, /constexpr float kArsenalBlockHeight = CombatCarsArenaGeometry::kCentralBlockHeight/);
  assert.match(nativeBridge, /constexpr float kArsenalRampHeight = CombatCarsArenaGeometry::kSouthRampHeight/);
  assert.match(nativeBridge, /#include "BulletCollision\/CollisionShapes\/btConvexHullShape\.h"/);
  assert.match(nativeBridge, /btConvexHullShape\* arsenalRampShape\(\)/);
  assert.match(nativeBridge, /for \(const auto& point : \{ a, b, c, d, e, f \}\) shape->addPoint\(point, false\)/);
  assert.match(nativeBridge, /kBoostRegenDelayTicks\s*=\s*240/);
  assert.match(nativeBridge, /kBoostRegenDurationTicks\s*=\s*120/);
  assert.match(nativeBridge, /kBoostRegenStartRatePerTick\s*=\s*50\.f \/ 120\.f/);
  assert.match(nativeBridge, /kBoostRegenEndRatePerTick\s*=\s*150\.f \/ 120\.f/);
  assert.match(nativeBridge, /updateCombatBoostRegeneration\(cars, activeArena\)/);
  assert.match(nativeBridge, /Combat-alpha uses native boost regeneration/);
  assert.match(nativeBridge, /recoverCombatAlphaCarsOutsideSafeFloor\(cars, activeArena\)/);
  // Pads remain as inert source history in the local bridge, but the active
  // combat-alpha tick must not reintroduce pickup collection.
  assert.doesNotMatch(nativeBridge, /updateCombatBoostPads\(pads, cars, 1\.f \/ kFixedStepHz\)/);
  assert.match(nativeBridge, /printState\(std::cout, tick, cars, pads\)/);
});

test("native and WASM bridges consume the generated arena and cover contract", () => {
  assert.match(nativeBridge, /^#include "combat_alpha_geometry.generated.hpp"/m);
  assert.match(wasmWrapper, /^#include "combat_alpha_geometry.generated.hpp"/m);
  assert.match(nativeCmake, /\.\.\/shared/);
  assert.match(wasmCmake, /\.\.\/shared/);
  for (const source of [nativeBridge, wasmWrapper]) {
    assert.match(source, /for \(const auto& cover : CombatCarsArenaGeometry::kCombatAlphaCovers\) addCombatAlphaCover/);
    assert.doesNotMatch(source, /"tire-cover-(?:blue|red)"/);
  }
  assert.deepEqual(COMBAT_ALPHA_GEOMETRY.covers.slice(-2).map(({ id, x, z, width, depth, height }) => ({ id, x, z, width, depth, height })), [
    { id: "tire-cover-blue", x: -68, z: -30, width: 8, depth: 8, height: 4.8 },
    { id: "tire-cover-red", x: 68, z: 30, width: 8, depth: 8, height: 4.8 },
  ]);
});

test("WASM wrapper mirrors the safe combat-alpha spawn and regeneration contract", () => {
  assert.match(wasmWrapper, /kCombatAlphaSpawnXRatio\s*=\s*2\.f \/ 3\.f/);
  assert.match(wasmWrapper, /kCombatAlphaSpawnZOffset\s*=\s*90\.f \/ kArsenalPracticeScale/);
  assert.match(wasmWrapper, /kCombatAlphaHalfDepth\s*=\s*CombatCarsArenaGeometry::kCombatAlphaDepth \/ 2\.f \/ kArsenalPracticeScale/);
  assert.match(wasmWrapper, /kCombatAlphaHeight\s*=\s*RocketSim::RLConst::CAR_SPAWN_REST_Z \+ CombatCarsArenaGeometry::kCombatAlphaHeight \/ kArsenalPracticeScale/);
  assert.match(wasmWrapper, /kCombatAlphaCurveRadius\s*=\s*CombatCarsArenaGeometry::kCombatAlphaCurveRadius \/ kArsenalPracticeScale/);
  assert.match(wasmWrapper, /kBoostRegenDelayTicks\s*=\s*240/);
  assert.match(wasmWrapper, /kBoostRegenDurationTicks\s*=\s*120/);
  assert.match(wasmWrapper, /kBoostRegenStartRatePerTick\s*=\s*50\.f \/ 120\.f/);
  assert.match(wasmWrapper, /kBoostRegenEndRatePerTick\s*=\s*150\.f \/ 120\.f/);
  assert.match(wasmWrapper, /updateCombatBoostRegeneration\(\)/);
  assert.match(wasmWrapper, /kCombatAlphaHalfWidth \* kCombatAlphaSpawnXRatio/);
});
