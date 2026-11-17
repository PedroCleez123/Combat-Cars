#include "RocketSim.h"

#include "BulletCollision/CollisionShapes/btBvhTriangleMeshShape.h"
#include "BulletCollision/CollisionShapes/btBoxShape.h"
#include "BulletCollision/CollisionShapes/btConvexHullShape.h"
#include "BulletCollision/CollisionShapes/btTriangleMesh.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using namespace RocketSim;

namespace {

constexpr int kFixedStepHz = 120;
constexpr int kSettleFrames = 120;
constexpr int kBoostRegenDelayTicks = 240;
constexpr int kBoostRegenDurationTicks = 120;
constexpr float kBoostRegenStartRatePerTick = 50.f / 120.f;
constexpr float kBoostRegenEndRatePerTick = 150.f / 120.f;
constexpr float kArenaHalfExtent = 1000.f;
constexpr float kArenaHeight = 500.f;
// The clean Three.js arena is 62 x 46 x 24 Arsenal units. Keep RocketSim's
// 2300 UU/s cap in the existing 56 units/s gameplay band and build the native
// practice planes from that same scale.
constexpr float kArsenalPracticeScale = 56.f / RLConst::CAR_MAX_SPEED;
constexpr float kArsenalPracticeHalfWidth = 62.f / kArsenalPracticeScale;
constexpr float kArsenalPracticeHalfDepth = 46.f / kArsenalPracticeScale;
constexpr float kArsenalPracticeHeight = RLConst::CAR_SPAWN_REST_Z + 24.f / kArsenalPracticeScale;
// Expanded practice arena. These values are kept stable for the existing
// practice profiles; combat-alpha has a separate larger contract below.
constexpr float kArsenalExpandedHalfWidth = 72.f / kArsenalPracticeScale;
constexpr float kArsenalExpandedHalfDepth = 54.f / kArsenalPracticeScale;
constexpr float kArsenalExpandedHeight = RLConst::CAR_SPAWN_REST_Z + 30.f / kArsenalPracticeScale;
constexpr float kArsenalExpandedCurveRadius = 8.f / kArsenalPracticeScale;
// Combat-alpha is 264 × 408 × 108 Arsenal units. Keep these values mirrored
// by COMBAT_ALPHA_ARENA and the browser WASM bridge: the native cornered
// collision shell remains the sole authority for floor, curves, walls and
// ceiling.
constexpr float kCombatAlphaHalfWidth = 132.f / kArsenalPracticeScale;
constexpr float kCombatAlphaHalfDepth = 204.f / kArsenalPracticeScale;
constexpr float kCombatAlphaHeight = RLConst::CAR_SPAWN_REST_Z + 108.f / kArsenalPracticeScale;
constexpr float kCombatAlphaCurveRadius = 30.f / kArsenalPracticeScale;
constexpr float kArsenalBlockWidth = 14.f;
constexpr float kArsenalBlockDepth = 18.f;
constexpr float kArsenalBlockHeight = 3.25f;
// ARENA-06 uses one deliberately simple wedge. These are Arsenal-world
// dimensions; the native mesh is converted with the same scale as the arena.
constexpr float kArsenalRampRun = 20.f;
constexpr float kArsenalRampWidth = 18.f;
constexpr float kArsenalRampHeight = 3.5f;
// These ratios and obstacle coordinates mirror COMBAT_ALPHA_MAP. Contract
// tests keep the native and Node descriptions synchronized.
constexpr float kCombatBlockX = 0.f;
constexpr float kCombatBlockZ = -20.f;
constexpr float kCombatRampX = 0.f;
constexpr float kCombatRampZ = 20.f;
struct CombatAlphaCoverSpec {
  const char* id;
  float x;
  float z;
  float width;
  float depth;
  float height;
};

// COV-01 declarative records mirrored in the WASM wrapper. These are one
// closed static box per cover; presentation meshes never participate in this
// list or in the authoritative collision world.
constexpr CombatAlphaCoverSpec kCombatAlphaCovers[] = {
  { "container-cover-northwest", -45.f, -58.f, 10.f, 24.f, 6.f },
  { "container-cover-southwest", -45.f, 58.f, 10.f, 24.f, 6.f },
  { "container-cover-northeast", 45.f, -58.f, 10.f, 24.f, 6.f },
  { "container-cover-southeast", 45.f, 58.f, 10.f, 24.f, 6.f },
  { "tire-cover-blue", -68.f, -30.f, 8.f, 8.f, 4.8f },
  { "tire-cover-red", 68.f, 30.f, 8.f, 8.f, 4.8f },
};
constexpr float kCombatSpawnXRatio = 2.f / 3.f;
constexpr float kCombatSpawnZOffset = 90.f;
constexpr float kCombatLargePickupXRatio = .70f;
constexpr float kCombatLargePickupZRatio = .70f;
constexpr float kCombatLargeMidPickupZRatio = .47f;
constexpr float kCombatLargeLanePickupZRatio = .23f;
constexpr float kCombatMediumPickupXRatio = .52f;
constexpr float kCombatMediumPickupZRatio = .72f;
constexpr float kCombatCenterLanePickupZRatio = .48f;
constexpr float kCombatCrossLanePickupZRatio = .26f;
constexpr float kCombatDiagonalPickupXRatio = .30f;
constexpr float kCombatDiagonalPickupZRatio = .42f;
constexpr float kCombatLongDiagonalPickupZRatio = .65f;
constexpr float kCombatWideDiagonalPickupXRatio = .58f;
constexpr float kCombatWideDiagonalPickupZRatio = .48f;
constexpr float kCombatWideOuterPickupZRatio = .70f;
constexpr float kCombatInnerPickupXRatio = .12f;
constexpr float kCombatInnerPickupZRatio = .24f;
constexpr float kCombatSecondLargeXRatio = .52f;
constexpr float kCombatSecondLargeOuterZRatio = .60f;
constexpr float kCombatSecondLargeMidZRatio = .35f;
constexpr float kCombatSecondLargeInnerZRatio = .20f;
constexpr float kCombatSecondCrossXRatio = .36f;
constexpr float kCombatSecondCrossZRatio = .18f;
constexpr float kCombatSecondCrossOuterZRatio = .42f;
constexpr float kCombatSecondDiagonalXRatio = .20f;
constexpr float kCombatSecondDiagonalZRatio = .32f;
constexpr float kCombatSecondDiagonalOuterZRatio = .58f;
constexpr float kCombatSecondOuterXRatio = .46f;
constexpr float kCombatSecondOuterZRatio = .35f;
constexpr float kCombatSecondInnerXRatio = .08f;
constexpr float kCombatSecondInnerZRatio = .22f;
constexpr float kCombatAlphaVehicleClearance = 2.5f;
constexpr float kCombatAlphaPickupExtraClearance = .6f;
constexpr int kArsenalCornerSegments = 16;
// Original clean training geometry. The fillet is deliberately independent
// from Rocket League's arena meshes: it exists to validate continuous contact
// with the exact RocketSim vehicle solver without importing proprietary data.
constexpr float kArsenalCurveRadius = 256.f;
constexpr int kArsenalCurveSegments = 32;
constexpr float kPi = 3.14159265358979323846f;

bool combatAlphaSafeFloorPoint(float worldX, float worldY, float clearance) {
  const float curve = kCombatAlphaCurveRadius * kArsenalPracticeScale;
  const float maxX = kCombatAlphaHalfWidth * kArsenalPracticeScale - curve - clearance;
  const float maxY = kCombatAlphaHalfDepth * kArsenalPracticeScale - curve - clearance;
  if (std::abs(worldX) >= maxX || std::abs(worldY) >= maxY) return false;
  const float blockHalfX = kArsenalBlockWidth / 2.f + clearance;
  const float blockHalfY = kArsenalBlockDepth / 2.f + clearance;
  if (std::abs(worldX - kCombatBlockX) < blockHalfX
      && std::abs(worldY - kCombatBlockZ) < blockHalfY) return false;
  const float rampHalfX = kArsenalRampRun / 2.f + clearance;
  const float rampHalfY = kArsenalRampWidth / 2.f + clearance;
  if (std::abs(worldX - kCombatRampX) < rampHalfX
      && std::abs(worldY - kCombatRampZ) < rampHalfY) return false;
  for (const auto& cover : kCombatAlphaCovers) {
    const float halfX = cover.width / 2.f + clearance;
    const float halfY = cover.depth / 2.f + clearance;
    if (std::abs(worldX - cover.x) < halfX && std::abs(worldY - cover.z) < halfY) return false;
  }
  return true;
}

float combatAlphaCurveFloorHeight(float worldCoordinate, float halfExtent) {
  const float radius = kCombatAlphaCurveRadius * kArsenalPracticeScale;
  const float distance = std::abs(worldCoordinate);
  if (distance <= halfExtent - radius) return 0.f;
  if (distance >= halfExtent) return std::numeric_limits<float>::infinity();
  const float offset = distance - (halfExtent - radius);
  return radius - std::sqrt(std::max(0.f, radius * radius - offset * offset));
}

struct Input {
  float throttle = 0;
  float steer = 0;
  bool jump = false;
  bool boost = false;
  bool drift = false;
  bool airRoll = false;
  float roll = 0;
};

struct RequestedCar {
  int id = 0;
  std::string team;
  Input input;
};

struct NativeCar {
  int id = 0;
  Car* car = nullptr;
  int boostRegenDelayTicks = 0;
  int boostRegenTicks = 0;
  float boostBeforeStep = RLConst::BOOST_MAX;
};

// Combat-alpha owns its pickup layout here, beside the native collision
// authority. These are intentionally simple overlap volumes rather than
// visual meshes; the client receives their cooldown state in every frame.
struct CombatBoostPad {
  int id = 0;
  Vec pos;
  float radius = 185.f;
  float height = 180.f;
  float amount = 60.f;
  float cooldown = 0.f;
  float cooldownSeconds = 5.f;
  bool active = true;
};

std::vector<CombatBoostPad> combatBoostPads(const std::string& profile) {
  // Combat-alpha uses native boost regeneration; retain the legacy builder
  // below only as source history for old diagnostics, never instantiate it.
  if (profile != "combat-alpha" || profile == "combat-alpha") return {};
  const float sx = kCombatAlphaHalfWidth * kCombatLargePickupXRatio;
  const float sy = kCombatAlphaHalfDepth * kCombatLargePickupZRatio;
  const float lmy = kCombatAlphaHalfDepth * kCombatLargeMidPickupZRatio;
  const float ly = kCombatAlphaHalfDepth * kCombatLargeLanePickupZRatio;
  const float mx = kCombatAlphaHalfWidth * kCombatMediumPickupXRatio;
  const float my = kCombatAlphaHalfDepth * kCombatMediumPickupZRatio;
  const float cy = kCombatAlphaHalfDepth * kCombatCenterLanePickupZRatio;
  const float crossY = kCombatAlphaHalfDepth * kCombatCrossLanePickupZRatio;
  const float dx = kCombatAlphaHalfWidth * kCombatDiagonalPickupXRatio;
  const float dy = kCombatAlphaHalfDepth * kCombatDiagonalPickupZRatio;
  const float longDy = kCombatAlphaHalfDepth * kCombatLongDiagonalPickupZRatio;
  const float wx = kCombatAlphaHalfWidth * kCombatWideDiagonalPickupXRatio;
  const float wy = kCombatAlphaHalfDepth * kCombatWideDiagonalPickupZRatio;
  const float outerWy = kCombatAlphaHalfDepth * kCombatWideOuterPickupZRatio;
  const float ix = kCombatAlphaHalfWidth * kCombatInnerPickupXRatio;
  const float iy = kCombatAlphaHalfDepth * kCombatInnerPickupZRatio;
  const float secondLargeX = kCombatAlphaHalfWidth * kCombatSecondLargeXRatio;
  const float secondLargeOuterZ = kCombatAlphaHalfDepth * kCombatSecondLargeOuterZRatio;
  const float secondLargeMidZ = kCombatAlphaHalfDepth * kCombatSecondLargeMidZRatio;
  const float secondLargeInnerZ = kCombatAlphaHalfDepth * kCombatSecondLargeInnerZRatio;
  const float secondCrossX = kCombatAlphaHalfWidth * kCombatSecondCrossXRatio;
  const float secondCrossZ = kCombatAlphaHalfDepth * kCombatSecondCrossZRatio;
  const float secondCrossOuterZ = kCombatAlphaHalfDepth * kCombatSecondCrossOuterZRatio;
  const float secondDiagonalX = kCombatAlphaHalfWidth * kCombatSecondDiagonalXRatio;
  const float secondDiagonalZ = kCombatAlphaHalfDepth * kCombatSecondDiagonalZRatio;
  const float secondDiagonalOuterZ = kCombatAlphaHalfDepth * kCombatSecondDiagonalOuterZRatio;
  const float secondOuterX = kCombatAlphaHalfWidth * kCombatSecondOuterXRatio;
  const float secondOuterZ = kCombatAlphaHalfDepth * kCombatSecondOuterZRatio;
  const float secondInnerX = kCombatAlphaHalfWidth * kCombatSecondInnerXRatio;
  const float secondInnerZ = kCombatAlphaHalfDepth * kCombatSecondInnerZRatio;
  std::vector<CombatBoostPad> pads;
  pads.reserve(88);
  auto add = [&](float x, float y, float amount, float cooldownSeconds, float radius) {
    const float worldX = x * kArsenalPracticeScale;
    const float worldY = y * kArsenalPracticeScale;
    const float clearance = radius * kArsenalPracticeScale + kCombatAlphaPickupExtraClearance;
    if (!combatAlphaSafeFloorPoint(worldX, worldY, clearance)) {
      throw std::runtime_error("combat-alpha pickup intersects a curve or obstacle clearance zone");
    }
    pads.push_back({ static_cast<int>(pads.size()), Vec(x, y, 0.f), radius, 180.f, amount, 0.f, cooldownSeconds, true });
  };
  add(-sx, -sy, 60.f, 5.f, 210.f); add(sx, -sy, 60.f, 5.f, 210.f);
  add(-sx, sy, 60.f, 5.f, 210.f); add(sx, sy, 60.f, 5.f, 210.f);
  add(-sx, -lmy, 60.f, 5.f, 210.f); add(sx, -lmy, 60.f, 5.f, 210.f);
  add(-sx, lmy, 60.f, 5.f, 210.f); add(sx, lmy, 60.f, 5.f, 210.f);
  add(-sx, -ly, 60.f, 5.f, 210.f); add(sx, ly, 60.f, 5.f, 210.f);
  add(-sx, ly, 60.f, 5.f, 210.f); add(sx, -ly, 60.f, 5.f, 210.f);
  add(0.f, -my, 38.f, 3.5f, 165.f); add(0.f, my, 38.f, 3.5f, 165.f);
  add(0.f, -cy, 38.f, 3.5f, 165.f); add(0.f, cy, 38.f, 3.5f, 165.f);
  add(0.f, -iy, 38.f, 3.5f, 165.f); add(0.f, iy, 38.f, 3.5f, 165.f);
  add(-mx, 0.f, 38.f, 3.5f, 165.f); add(mx, 0.f, 38.f, 3.5f, 165.f);
  add(-mx, -crossY, 38.f, 3.5f, 165.f); add(mx, -crossY, 38.f, 3.5f, 165.f);
  add(-mx, crossY, 38.f, 3.5f, 165.f); add(mx, crossY, 38.f, 3.5f, 165.f);
  add(-dx, -dy, 38.f, 3.5f, 165.f); add(dx, dy, 38.f, 3.5f, 165.f);
  add(-dx, dy, 38.f, 3.5f, 165.f); add(dx, -dy, 38.f, 3.5f, 165.f);
  add(-dx, -longDy, 38.f, 3.5f, 165.f); add(dx, longDy, 38.f, 3.5f, 165.f);
  add(-dx, longDy, 38.f, 3.5f, 165.f); add(dx, -longDy, 38.f, 3.5f, 165.f);
  add(-wx, -wy, 38.f, 3.5f, 165.f); add(wx, wy, 38.f, 3.5f, 165.f);
  add(-wx, wy, 38.f, 3.5f, 165.f); add(wx, -wy, 38.f, 3.5f, 165.f);
  add(-wx, -outerWy, 38.f, 3.5f, 165.f); add(wx, outerWy, 38.f, 3.5f, 165.f);
  add(-wx, outerWy, 38.f, 3.5f, 165.f); add(wx, -outerWy, 38.f, 3.5f, 165.f);
  add(-ix, iy, 38.f, 3.5f, 165.f); add(ix, -iy, 38.f, 3.5f, 165.f);
  add(-ix, -iy, 38.f, 3.5f, 165.f); add(ix, iy, 38.f, 3.5f, 165.f);
  add(-secondLargeX, -secondLargeOuterZ, 60.f, 5.f, 210.f); add(secondLargeX, -secondLargeOuterZ, 60.f, 5.f, 210.f);
  add(-secondLargeX, secondLargeOuterZ, 60.f, 5.f, 210.f); add(secondLargeX, secondLargeOuterZ, 60.f, 5.f, 210.f);
  add(-secondLargeX, -secondLargeMidZ, 60.f, 5.f, 210.f); add(secondLargeX, -secondLargeMidZ, 60.f, 5.f, 210.f);
  add(-secondLargeX, secondLargeMidZ, 60.f, 5.f, 210.f); add(secondLargeX, secondLargeMidZ, 60.f, 5.f, 210.f);
  add(-secondLargeX, -secondLargeInnerZ, 60.f, 5.f, 210.f); add(secondLargeX, secondLargeInnerZ, 60.f, 5.f, 210.f);
  add(-secondLargeX, secondLargeInnerZ, 60.f, 5.f, 210.f); add(secondLargeX, -secondLargeInnerZ, 60.f, 5.f, 210.f);
  add(0.f, -secondLargeOuterZ, 38.f, 3.5f, 165.f); add(0.f, secondLargeOuterZ, 38.f, 3.5f, 165.f);
  add(0.f, -secondLargeMidZ, 38.f, 3.5f, 165.f); add(0.f, secondLargeMidZ, 38.f, 3.5f, 165.f);
  add(0.f, -secondLargeInnerZ, 38.f, 3.5f, 165.f); add(0.f, secondLargeInnerZ, 38.f, 3.5f, 165.f);
  add(-secondCrossX, 0.f, 38.f, 3.5f, 165.f); add(secondCrossX, 0.f, 38.f, 3.5f, 165.f);
  add(-secondCrossX, -secondCrossZ, 38.f, 3.5f, 165.f); add(secondCrossX, secondCrossZ, 38.f, 3.5f, 165.f);
  add(-secondCrossX, secondCrossZ, 38.f, 3.5f, 165.f); add(secondCrossX, -secondCrossZ, 38.f, 3.5f, 165.f);
  add(-secondCrossX, -secondCrossOuterZ, 38.f, 3.5f, 165.f); add(secondCrossX, secondCrossOuterZ, 38.f, 3.5f, 165.f);
  add(-secondCrossX, secondCrossOuterZ, 38.f, 3.5f, 165.f); add(secondCrossX, -secondCrossOuterZ, 38.f, 3.5f, 165.f);
  add(-secondDiagonalX, -secondDiagonalZ, 38.f, 3.5f, 165.f); add(secondDiagonalX, secondDiagonalZ, 38.f, 3.5f, 165.f);
  add(-secondDiagonalX, secondDiagonalZ, 38.f, 3.5f, 165.f); add(secondDiagonalX, -secondDiagonalZ, 38.f, 3.5f, 165.f);
  add(-secondDiagonalX, -secondDiagonalOuterZ, 38.f, 3.5f, 165.f); add(secondDiagonalX, secondDiagonalOuterZ, 38.f, 3.5f, 165.f);
  add(-secondDiagonalX, secondDiagonalOuterZ, 38.f, 3.5f, 165.f); add(secondDiagonalX, -secondDiagonalOuterZ, 38.f, 3.5f, 165.f);
  add(-secondOuterX, -secondOuterZ, 38.f, 3.5f, 165.f); add(secondOuterX, secondOuterZ, 38.f, 3.5f, 165.f);
  add(-secondOuterX, secondOuterZ, 38.f, 3.5f, 165.f); add(secondOuterX, -secondOuterZ, 38.f, 3.5f, 165.f);
  add(-secondInnerX, -secondInnerZ, 38.f, 3.5f, 165.f); add(secondInnerX, secondInnerZ, 38.f, 3.5f, 165.f);
  add(-secondInnerX, secondInnerZ, 38.f, 3.5f, 165.f); add(secondInnerX, -secondInnerZ, 38.f, 3.5f, 165.f);
  return pads;
}

void updateCombatBoostPads(std::vector<CombatBoostPad>& pads, const std::vector<NativeCar>& cars, float dt) {
  for (auto& pad : pads) {
    pad.cooldown = std::max(0.f, pad.cooldown - dt);
    pad.active = pad.cooldown <= 0.f;
    if (!pad.active) continue;
    for (const auto& native : cars) {
      auto state = native.car->GetState();
      if (std::hypot(state.pos.x - pad.pos.x, state.pos.y - pad.pos.y) > pad.radius) continue;
      if (std::abs(state.pos.z - pad.pos.z) > pad.height) continue;
      const float before = state.boost;
      state.boost = std::min(RLConst::BOOST_MAX, state.boost + pad.amount);
      if (state.boost > before + .001f) {
        native.car->SetState(state);
        pad.active = false;
        pad.cooldown = pad.cooldownSeconds;
        break;
      }
    }
  }
}

void updateCombatBoostRegeneration(std::vector<NativeCar>& cars, const std::string& profile) {
  if (profile != "combat-alpha") return;
  for (auto& native : cars) {
    if (!native.car) continue;
    const CarState state = native.car->GetState();
    if (state.boost < native.boostBeforeStep - .0001f) {
      native.boostRegenDelayTicks = kBoostRegenDelayTicks;
      native.boostRegenTicks = 0;
      continue;
    }
    if (state.boost >= RLConst::BOOST_MAX - .0001f) {
      native.boostRegenDelayTicks = 0;
      native.boostRegenTicks = 0;
      continue;
    }
    if (native.boostRegenDelayTicks > 1) {
      native.boostRegenDelayTicks -= 1;
      native.boostRegenTicks = 0;
      continue;
    }
    CarState updated = state;
    const int progress = std::min(native.boostRegenTicks, kBoostRegenDurationTicks - 1);
    const float ramp = static_cast<float>(progress) / static_cast<float>(kBoostRegenDurationTicks - 1);
    const float ratePerTick = kBoostRegenStartRatePerTick
      + (kBoostRegenEndRatePerTick - kBoostRegenStartRatePerTick) * ramp;
    updated.boost = std::min(RLConst::BOOST_MAX, state.boost + ratePerTick);
    native.car->SetState(updated);
    native.boostRegenDelayTicks = 0;
    native.boostRegenTicks = std::min(kBoostRegenDurationTicks, native.boostRegenTicks + 1);
  }
}

float number(const std::string& line, const std::string& key, float fallback = 0) {
  const std::string needle = "\"" + key + "\":";
  const auto start = line.find(needle);
  if (start == std::string::npos) return fallback;
  const auto valueStart = start + needle.size();
  try { return std::stof(line.substr(valueStart)); } catch (...) { return fallback; }
}

bool boolean(const std::string& line, const std::string& key, bool fallback = false) {
  const std::string needle = "\"" + key + "\":";
  const auto start = line.find(needle);
  if (start == std::string::npos) return fallback;
  const auto valueStart = start + needle.size();
  if (line.compare(valueStart, 4, "true") == 0) return true;
  if (line.compare(valueStart, 5, "false") == 0) return false;
  return fallback;
}

int integer(const std::string& line, const std::string& key, int fallback = -1) {
  const float value = number(line, key, static_cast<float>(fallback));
  if (!std::isfinite(value) || std::floor(value) != value) return fallback;
  return static_cast<int>(value);
}

std::string stringValue(const std::string& line, const std::string& key) {
  const std::string needle = "\"" + key + "\":\"";
  const auto start = line.find(needle);
  if (start == std::string::npos) return "";
  const auto valueStart = start + needle.size();
  const auto end = line.find('"', valueStart);
  return end == std::string::npos ? "" : line.substr(valueStart, end - valueStart);
}

Input readInput(const std::string& line) {
  Input input;
  input.throttle = std::clamp(number(line, "throttle"), -1.f, 1.f);
  input.steer = std::clamp(number(line, "steer"), -1.f, 1.f);
  input.jump = boolean(line, "jump");
  input.boost = boolean(line, "boost");
  input.drift = boolean(line, "drift");
  input.airRoll = boolean(line, "airRoll");
  input.roll = std::clamp(number(line, "roll"), -1.f, 1.f);
  return input;
}

bool arrayObjects(const std::string& line, const std::string& key, std::vector<std::string>& objects) {
  const std::string needle = "\"" + key + "\":";
  const auto keyStart = line.find(needle);
  if (keyStart == std::string::npos) return false;
  size_t cursor = keyStart + needle.size();
  while (cursor < line.size() && std::isspace(static_cast<unsigned char>(line[cursor]))) cursor += 1;
  if (cursor >= line.size() || line[cursor] != '[') return false;
  cursor += 1;
  while (cursor < line.size()) {
    while (cursor < line.size() && std::isspace(static_cast<unsigned char>(line[cursor]))) cursor += 1;
    if (cursor < line.size() && line[cursor] == ']') return true;
    if (cursor >= line.size() || line[cursor] != '{') return false;
    const size_t objectStart = cursor;
    int depth = 0;
    bool inString = false;
    bool escaped = false;
    for (; cursor < line.size(); cursor += 1) {
      const char current = line[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (current == '\\') escaped = true;
        else if (current == '"') inString = false;
        continue;
      }
      if (current == '"') inString = true;
      else if (current == '{') depth += 1;
      else if (current == '}') {
        depth -= 1;
        if (depth == 0) {
          objects.push_back(line.substr(objectStart, cursor - objectStart + 1));
          cursor += 1;
          break;
        }
      }
    }
    if (depth != 0) return false;
    while (cursor < line.size() && std::isspace(static_cast<unsigned char>(line[cursor]))) cursor += 1;
    if (cursor < line.size() && line[cursor] == ',') {
      cursor += 1;
      continue;
    }
    if (cursor < line.size() && line[cursor] == ']') return true;
    return false;
  }
  return false;
}

bool readCarId(const std::string& object, int& id) {
  id = integer(object, "id", 0);
  return id >= 1 && id <= 6;
}

bool uniqueIds(const std::vector<RequestedCar>& cars) {
  std::set<int> ids;
  for (const auto& car : cars) {
    if (!ids.insert(car.id).second) return false;
  }
  return true;
}

bool readInitCars(const std::string& line, std::vector<RequestedCar>& cars) {
  std::vector<std::string> objects;
  if (!arrayObjects(line, "cars", objects) || objects.empty() || objects.size() > 6) return false;
  for (const auto& object : objects) {
    RequestedCar car;
    if (!readCarId(object, car.id)) return false;
    car.team = stringValue(object, "team");
    if (car.team != "blue" && car.team != "red") return false;
    cars.push_back(car);
  }
  return uniqueIds(cars);
}

bool readTickCars(const std::string& line, std::vector<RequestedCar>& cars) {
  std::vector<std::string> objects;
  if (!arrayObjects(line, "cars", objects) || objects.empty() || objects.size() > 6) return false;
  for (const auto& object : objects) {
    RequestedCar car;
    if (!readCarId(object, car.id) || object.find("\"input\":") == std::string::npos) return false;
    car.input = readInput(object);
    cars.push_back(car);
  }
  return uniqueIds(cars);
}

struct RaySegment {
  int id = 0;
  btVector3 from;
  btVector3 to;
};

bool readVectorField(const std::string& object, const std::string& key, btVector3& vector) {
  const std::string needle = "\"" + key + "\":{\"x\":";
  const auto start = object.find(needle);
  if (start == std::string::npos) return false;
  size_t cursor = start + needle.size();
  try {
    const auto xEnd = object.find(",\"y\":", cursor);
    if (xEnd == std::string::npos) return false;
    const float x = std::stof(object.substr(cursor, xEnd - cursor));
    cursor = xEnd + 5;
    const auto yEnd = object.find(",\"z\":", cursor);
    if (yEnd == std::string::npos) return false;
    const float y = std::stof(object.substr(cursor, yEnd - cursor));
    cursor = yEnd + 5;
    const auto zEnd = object.find('}', cursor);
    if (zEnd == std::string::npos) return false;
    const float z = std::stof(object.substr(cursor, zEnd - cursor));
    // The JSONL boundary uses RocketSim-scale, y-up coordinates, matching
    // state frames emitted by vec3(). Bullet remains x/y/z and meters here.
    vector = btVector3(x * UU_TO_BT, z * UU_TO_BT, y * UU_TO_BT);
    return std::isfinite(x) && std::isfinite(y) && std::isfinite(z);
  } catch (...) { return false; }
}

bool readRaySegments(const std::string& line, std::vector<RaySegment>& segments) {
  std::vector<std::string> objects;
  if (!arrayObjects(line, "segments", objects) || objects.empty() || objects.size() > 32) return false;
  for (const auto& object : objects) {
    RaySegment segment;
    segment.id = integer(object, "id", 0);
    if (segment.id < 1 || !readVectorField(object, "from", segment.from) || !readVectorField(object, "to", segment.to)) return false;
    segments.push_back(segment);
  }
  std::set<int> ids;
  for (const auto& segment : segments) if (!ids.insert(segment.id).second) return false;
  return true;
}

struct StaticRayCallback final : btCollisionWorld::ClosestRayResultCallback {
  StaticRayCallback(const btVector3& from, const btVector3& to) : btCollisionWorld::ClosestRayResultCallback(from, to, nullptr) {}

  btScalar addSingleResult(btCollisionWorld::LocalRayResult& rayResult, bool normalInWorldSpace) override {
    if (!rayResult.m_collisionObject || !rayResult.m_collisionObject->isStaticObject()) return 1.f;
    return btCollisionWorld::ClosestRayResultCallback::addSingleResult(rayResult, normalInWorldSpace);
  }
};

struct StaticRayHit {
  bool hit = false;
  btScalar fraction = 1.f;
  btVector3 point;
  btVector3 normal;
};

// RocketSim's voxel broadphase deliberately warns and falls back to a full
// scan for rays longer than one cell. Split bridge queries into cell-sized
// pieces so JSONL remains clean and the first static hit stays deterministic.
StaticRayHit raycastStatic(Arena& arena, const btVector3& from, const btVector3& to) {
  constexpr btScalar kChunkLength = btScalar(7.0);
  const btVector3 delta = to - from;
  const btScalar length = delta.length();
  const int chunks = std::max(1, static_cast<int>(std::ceil(length / kChunkLength)));
  StaticRayHit best;
  for (int index = 0; index < chunks; index += 1) {
    const btScalar start = btScalar(index) / btScalar(chunks);
    const btScalar end = btScalar(index + 1) / btScalar(chunks);
    const btVector3 segmentFrom = from.lerp(to, start);
    const btVector3 segmentTo = from.lerp(to, end);
    StaticRayCallback callback(segmentFrom, segmentTo);
    arena._bulletWorld.rayTest(segmentFrom, segmentTo, callback);
    if (!callback.hasHit()) continue;
    const btScalar fraction = start + callback.m_closestHitFraction * (end - start);
    if (!best.hit || fraction < best.fraction) {
      best.hit = true;
      best.fraction = fraction;
      best.point = callback.m_hitPointWorld;
      best.normal = callback.m_hitNormalWorld;
    }
  }
  return best;
}

bool hasSameIds(const std::vector<NativeCar>& nativeCars, const std::vector<RequestedCar>& requestedCars) {
  if (nativeCars.size() != requestedCars.size()) return false;
  std::set<int> expected;
  std::set<int> received;
  for (const auto& car : nativeCars) expected.insert(car.id);
  for (const auto& car : requestedCars) received.insert(car.id);
  return expected == received;
}

bool validProfile(const std::string& arena) {
  return arena == "clean-six-planes" || arena == "arsenal-practice" || arena == "arsenal-curved-practice" || arena == "arsenal-expanded-curved-practice" || arena == "arsenal-expanded-cornered-practice" || arena == "arsenal-expanded-block-practice" || arena == "arsenal-expanded-ramp-practice" || arena == "combat-alpha" || arena == "air-void" || arena == "second-action-airborne" || arena == "combat-lineup";
}

bool validInit(const std::string& line, std::vector<RequestedCar>& cars) {
  const std::string arena = stringValue(line, "arena");
  return integer(line, "schemaVersion") == 1
      && integer(line, "fixedStepHz") == kFixedStepHz
      && validProfile(arena)
      && readInitCars(line, cars);
}

CarControls toControls(const Input& source) {
  CarControls controls;
  controls.throttle = source.throttle;
  controls.steer = source.steer;
  controls.pitch = -source.throttle;
  // `roll` is already composed by the Arsenal input adapter: with free air
  // roll it includes the steer direction plus any directional-roll key. Only
  // yaw must be suppressed here, otherwise one key turns two axes at once.
  controls.yaw = source.airRoll ? 0.f : source.steer;
  controls.roll = source.roll;
  controls.jump = source.jump;
  controls.boost = source.boost;
  controls.handbrake = source.drift;
  controls.ClampFix();
  return controls;
}

void addPlane(Arena& arena, const btVector3& normal, const btVector3& position) {
  // RocketSim's public state is in Unreal Units, but this low-level Bullet
  // helper receives metres. Normals are unitless; only the plane position
  // crosses the UU -> Bullet boundary.
  const btVector3 positionBT(
    position.x() * UU_TO_BT,
    position.y() * UU_TO_BT,
    position.z() * UU_TO_BT
  );
  auto* body = arena._AddStaticCollisionShape(new btStaticPlaneShape(normal, 0), positionBT);
  body->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
  body->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);
}

btVector3 curvedPoint(float x, float y, float z) {
  return btVector3(x * UU_TO_BT, y * UU_TO_BT, z * UU_TO_BT);
}

enum class CurveBoundary { PositiveX, NegativeX, PositiveY, NegativeY };

btTriangleMesh* arsenalCurveMesh(float halfWidth, float halfDepth, float radius, float height, CurveBoundary boundary, bool clipCorners) {
  // RocketSim intentionally leaves BVH shapes alive after Arena destruction.
  // Cache one mesh per boundary and geometry size for the lifetime of the
  // bridge process; repeated init commands then do not accumulate meshes.
  struct Cache {
    btTriangleMesh* meshes[4]{};
    float halfWidth = 0;
    float halfDepth = 0;
    float radius = 0;
    float height = 0;
    bool clipCorners = false;
  };
  static Cache cache;
  const bool sameGeometry = cache.meshes[0] && cache.halfWidth == halfWidth && cache.halfDepth == halfDepth && cache.radius == radius && cache.height == height && cache.clipCorners == clipCorners;
  if (sameGeometry) return cache.meshes[static_cast<int>(boundary)];
  cache = Cache{};
  cache.halfWidth = halfWidth;
  cache.halfDepth = halfDepth;
  cache.radius = radius;
  cache.height = height;
  cache.clipCorners = clipCorners;
  for (int boundaryIndex = 0; boundaryIndex < 4; boundaryIndex += 1) {
    const auto side = static_cast<CurveBoundary>(boundaryIndex);
    auto* value = new btTriangleMesh();
    const bool xBoundary = side == CurveBoundary::PositiveX || side == CurveBoundary::NegativeX;
    const float center = (side == CurveBoundary::PositiveX || side == CurveBoundary::PositiveY)
      ? (xBoundary ? halfWidth - radius : halfDepth - radius)
      : (xBoundary ? -halfWidth + radius : -halfDepth + radius);
    // Stop a radius before both corners. The four fillets therefore never
    // overlap and their undefined corner joins remain outside this story.
    const float extrusionMin = clipCorners ? (xBoundary ? -halfDepth + radius : -halfWidth + radius) : (xBoundary ? -halfDepth : -halfWidth);
    const float extrusionMax = clipCorners ? (xBoundary ? halfDepth - radius : halfWidth - radius) : (xBoundary ? halfDepth : halfWidth);
    const bool reverseWinding = side == CurveBoundary::NegativeX || side == CurveBoundary::PositiveY;
    const auto addArc = [&](float thetaStart, float thetaEnd, float centerZ, bool invertWinding) {
      for (int index = 0; index < kArsenalCurveSegments; index += 1) {
        const float theta0 = thetaStart + (thetaEnd - thetaStart) * index / kArsenalCurveSegments;
        const float theta1 = thetaStart + (thetaEnd - thetaStart) * (index + 1) / kArsenalCurveSegments;
        const auto point = [&](float theta, float extrusion) {
          const float radial = radius * std::cos(theta);
          const float arcHeight = centerZ + radius * std::sin(theta);
          if (side == CurveBoundary::PositiveX) return curvedPoint(center + radial, extrusion, arcHeight);
          if (side == CurveBoundary::NegativeX) return curvedPoint(center - radial, extrusion, arcHeight);
          if (side == CurveBoundary::PositiveY) return curvedPoint(extrusion, center + radial, arcHeight);
          return curvedPoint(extrusion, center - radial, arcHeight);
        };
        const btVector3 p00 = point(theta0, extrusionMin);
        const btVector3 p10 = point(theta1, extrusionMin);
        const btVector3 p01 = point(theta0, extrusionMax);
        const btVector3 p11 = point(theta1, extrusionMax);
        // The winding is chosen so the inside of each curve has an upward
        // floor normal and an inward wall normal at its two endpoints.
        if (reverseWinding != invertWinding) {
          value->addTriangle(p00, p01, p10, true);
          value->addTriangle(p10, p01, p11, true);
        } else {
          value->addTriangle(p00, p10, p01, true);
          value->addTriangle(p10, p11, p01, true);
        }
      }
    };
    // Lower quarter: floor -> wall. Upper quarter: wall -> ceiling.
    addArc(-0.5f * kPi, 0.f, radius, false);
    addArc(0.f, 0.5f * kPi, height - radius, true);
    cache.meshes[boundaryIndex] = value;
  }
  return cache.meshes[static_cast<int>(boundary)];
}

btBvhTriangleMeshShape* arsenalCurveShape(float halfWidth, float halfDepth, float radius, float height, CurveBoundary boundary, bool clipCorners) {
  struct Cache { btBvhTriangleMeshShape* shapes[4]{}; float halfWidth = 0; float halfDepth = 0; float radius = 0; float height = 0; bool clipCorners = false; };
  static Cache cache;
  const int index = static_cast<int>(boundary);
  const bool sameGeometry = cache.shapes[0] && cache.halfWidth == halfWidth && cache.halfDepth == halfDepth && cache.radius == radius && cache.height == height && cache.clipCorners == clipCorners;
  if (!sameGeometry) {
    // RocketSim keeps BVH shapes alive after an Arena is destroyed. Forget all
    // old entries before populating the new geometry so a later boundary can
    // never return a shape from the previous arena profile.
    cache = Cache{};
    cache.halfWidth = halfWidth;
    cache.halfDepth = halfDepth;
    cache.radius = radius;
    cache.height = height;
    cache.clipCorners = clipCorners;
  }
  if (!cache.shapes[index]) {
    cache.shapes[index] = new btBvhTriangleMeshShape(arsenalCurveMesh(halfWidth, halfDepth, radius, height, boundary, clipCorners), true);
    cache.shapes[index]->setMargin(0.04f);
  }
  return cache.shapes[index];
}

void addQuarterPipe(Arena& arena, float halfWidth, float halfDepth, float radius, float height, CurveBoundary boundary, bool clipCorners = true) {
  arena._AddStaticCollisionShape(arsenalCurveShape(halfWidth, halfDepth, radius, height, boundary, clipCorners));
}

btBvhTriangleMeshShape* arsenalCornerShape(float halfWidth, float halfDepth, float radius, int corner) {
  struct Cache { btBvhTriangleMeshShape* shapes[4]{}; float halfWidth = 0; float halfDepth = 0; float radius = 0; };
  static Cache cache;
  const bool sameGeometry = cache.shapes[0] && cache.halfWidth == halfWidth && cache.halfDepth == halfDepth && cache.radius == radius;
  if (!sameGeometry) { cache = Cache{}; cache.halfWidth = halfWidth; cache.halfDepth = halfDepth; cache.radius = radius; }
  if (cache.shapes[corner]) return cache.shapes[corner];
  const int sx = (corner == 0 || corner == 3) ? 1 : -1;
  const int sy = (corner == 0 || corner == 1) ? 1 : -1;
  const bool reverseWinding = sx * sy < 0;
  const float centerX = sx * (halfWidth - radius);
  const float centerY = sy * (halfDepth - radius);
  auto* mesh = new btTriangleMesh();
  for (int thetaIndex = 0; thetaIndex < kArsenalCurveSegments; thetaIndex += 1) {
    const float theta0 = -0.5f * kPi + 0.5f * kPi * thetaIndex / kArsenalCurveSegments;
    const float theta1 = -0.5f * kPi + 0.5f * kPi * (thetaIndex + 1) / kArsenalCurveSegments;
    for (int phiIndex = 0; phiIndex < kArsenalCornerSegments; phiIndex += 1) {
      const float phi0 = 0.5f * kPi * phiIndex / kArsenalCornerSegments;
      const float phi1 = 0.5f * kPi * (phiIndex + 1) / kArsenalCornerSegments;
      const auto point = [&](float theta, float phi) {
        const float radial = radius * std::cos(theta);
        return curvedPoint(centerX + sx * radial * std::cos(phi), centerY + sy * radial * std::sin(phi), radius + radius * std::sin(theta));
      };
      const btVector3 p00 = point(theta0, phi0), p10 = point(theta1, phi0), p01 = point(theta0, phi1), p11 = point(theta1, phi1);
      if (reverseWinding) {
        mesh->addTriangle(p00, p01, p10, true);
        mesh->addTriangle(p10, p01, p11, true);
      } else {
        mesh->addTriangle(p00, p10, p01, true);
        mesh->addTriangle(p10, p11, p01, true);
      }
    }
  }
  cache.shapes[corner] = new btBvhTriangleMeshShape(mesh, true);
  cache.shapes[corner]->setMargin(0.04f);
  return cache.shapes[corner];
}

void addCornerFillet(Arena& arena, float halfWidth, float halfDepth, float radius, int corner) {
  arena._AddStaticCollisionShape(arsenalCornerShape(halfWidth, halfDepth, radius, corner));
}

btBvhTriangleMeshShape* arsenalCeilingCornerShape(float halfWidth, float halfDepth, float radius, float height, int corner) {
  struct Cache { btBvhTriangleMeshShape* shapes[4]{}; float halfWidth = 0; float halfDepth = 0; float radius = 0; float height = 0; };
  static Cache cache;
  const bool sameGeometry = cache.shapes[0] && cache.halfWidth == halfWidth && cache.halfDepth == halfDepth && cache.radius == radius && cache.height == height;
  if (!sameGeometry) { cache = Cache{}; cache.halfWidth = halfWidth; cache.halfDepth = halfDepth; cache.radius = radius; cache.height = height; }
  if (cache.shapes[corner]) return cache.shapes[corner];
  const int sx = (corner == 0 || corner == 3) ? 1 : -1;
  const int sy = (corner == 0 || corner == 1) ? 1 : -1;
  const bool reverseWinding = sx * sy < 0;
  const float centerX = sx * (halfWidth - radius);
  const float centerY = sy * (halfDepth - radius);
  auto* mesh = new btTriangleMesh();
  for (int thetaIndex = 0; thetaIndex < kArsenalCurveSegments; thetaIndex += 1) {
    const float theta0 = 0.5f * kPi * thetaIndex / kArsenalCurveSegments;
    const float theta1 = 0.5f * kPi * (thetaIndex + 1) / kArsenalCurveSegments;
    for (int phiIndex = 0; phiIndex < kArsenalCornerSegments; phiIndex += 1) {
      const float phi0 = 0.5f * kPi * phiIndex / kArsenalCornerSegments;
      const float phi1 = 0.5f * kPi * (phiIndex + 1) / kArsenalCornerSegments;
      const auto point = [&](float theta, float phi) {
        const float radial = radius * std::cos(theta);
        return curvedPoint(centerX + sx * radial * std::cos(phi), centerY + sy * radial * std::sin(phi), height - radius + radius * std::sin(theta));
      };
      const btVector3 p00 = point(theta0, phi0), p10 = point(theta1, phi0), p01 = point(theta0, phi1), p11 = point(theta1, phi1);
      if (reverseWinding) {
        mesh->addTriangle(p00, p01, p10, true);
        mesh->addTriangle(p10, p01, p11, true);
      } else {
        mesh->addTriangle(p00, p10, p01, true);
        mesh->addTriangle(p10, p11, p01, true);
      }
    }
  }
  cache.shapes[corner] = new btBvhTriangleMeshShape(mesh, true);
  cache.shapes[corner]->setMargin(0.04f);
  return cache.shapes[corner];
}

void addCeilingCornerFillet(Arena& arena, float halfWidth, float halfDepth, float radius, float height, int corner) {
  arena._AddStaticCollisionShape(arsenalCeilingCornerShape(halfWidth, halfDepth, radius, height, corner));
}

btBvhTriangleMeshShape* arsenalVerticalCornerShape(float halfWidth, float halfDepth, float radius, float height, int corner) {
  struct Cache { btBvhTriangleMeshShape* shapes[4]{}; float halfWidth = 0; float halfDepth = 0; float radius = 0; float height = 0; };
  static Cache cache;
  const bool sameGeometry = cache.shapes[0] && cache.halfWidth == halfWidth && cache.halfDepth == halfDepth && cache.radius == radius && cache.height == height;
  if (!sameGeometry) {
    cache = Cache{};
    cache.halfWidth = halfWidth;
    cache.halfDepth = halfDepth;
    cache.radius = radius;
    cache.height = height;
  }
  if (cache.shapes[corner]) return cache.shapes[corner];
  const int sx = (corner == 0 || corner == 3) ? 1 : -1;
  const int sy = (corner == 0 || corner == 1) ? 1 : -1;
  const bool reverseWinding = sx * sy < 0;
  const float centerX = sx * (halfWidth - radius);
  const float centerY = sy * (halfDepth - radius);
  auto* mesh = new btTriangleMesh();
  const auto point = [&](float phi, float z) {
    return curvedPoint(centerX + sx * radius * std::cos(phi), centerY + sy * radius * std::sin(phi), z);
  };
  for (int index = 0; index < kArsenalCornerSegments; index += 1) {
    const float phi0 = 0.5f * kPi * index / kArsenalCornerSegments;
    const float phi1 = 0.5f * kPi * (index + 1) / kArsenalCornerSegments;
    const btVector3 p00 = point(phi0, radius), p10 = point(phi0, height - radius), p01 = point(phi1, radius), p11 = point(phi1, height - radius);
    if (reverseWinding) {
      mesh->addTriangle(p00, p01, p10, true);
      mesh->addTriangle(p10, p01, p11, true);
    } else {
      mesh->addTriangle(p00, p10, p01, true);
      mesh->addTriangle(p10, p11, p01, true);
    }
  }
  cache.shapes[corner] = new btBvhTriangleMeshShape(mesh, true);
  cache.shapes[corner]->setMargin(0.04f);
  return cache.shapes[corner];
}

void addVerticalCornerFillet(Arena& arena, float halfWidth, float halfDepth, float radius, float height, int corner) {
  arena._AddStaticCollisionShape(arsenalVerticalCornerShape(halfWidth, halfDepth, radius, height, corner));
}

void addExpandedWallPanels(Arena& arena, float halfWidth, float halfDepth, float curveRadius, float height) {
  // Static planes are infinite, so they overlap a corner patch after the
  // vehicle reaches the vertical wall. These four finite panels start above
  // the lower curve, end below the upper curve, and stop before both corners.
  const float w = halfWidth, d = halfDepth;
  const float r = curveRadius, h = height;
  const auto addPanel = [&](const btVector3& p00, const btVector3& p10, const btVector3& p01, bool reverse) {
    auto* mesh = new btTriangleMesh();
    if (reverse) {
      mesh->addTriangle(curvedPoint(p00.x(), p00.y(), p00.z()), curvedPoint(p01.x(), p01.y(), p01.z()), curvedPoint(p10.x(), p10.y(), p10.z()), true);
      mesh->addTriangle(curvedPoint(p10.x(), p10.y(), p10.z()), curvedPoint(p01.x(), p01.y(), p01.z()), curvedPoint(p10.x() + (p01.x() - p00.x()), p10.y() + (p01.y() - p00.y()), p10.z() + (p01.z() - p00.z())), true);
    } else {
      mesh->addTriangle(curvedPoint(p00.x(), p00.y(), p00.z()), curvedPoint(p10.x(), p10.y(), p10.z()), curvedPoint(p01.x(), p01.y(), p01.z()), true);
      mesh->addTriangle(curvedPoint(p10.x(), p10.y(), p10.z()), curvedPoint(p10.x() + (p01.x() - p00.x()), p10.y() + (p01.y() - p00.y()), p10.z() + (p01.z() - p00.z())), curvedPoint(p01.x(), p01.y(), p01.z()), true);
    }
    auto* shape = new btBvhTriangleMeshShape(mesh, true);
    shape->setMargin(0.04f);
    arena._AddStaticCollisionShape(shape);
  };
  // +X/-X panels span Y; +Y/-Y panels span X. The winding faces inside.
  addPanel(btVector3(w, -d + r, r), btVector3(w, -d + r, h - r), btVector3(w, d - r, r), false);
  addPanel(btVector3(-w, -d + r, r), btVector3(-w, -d + r, h - r), btVector3(-w, d - r, r), true);
  addPanel(btVector3(-w + r, d, r), btVector3(-w + r, d, h - r), btVector3(w - r, d, r), true);
  addPanel(btVector3(-w + r, -d, r), btVector3(-w + r, -d, h - r), btVector3(w - r, -d, r), false);
}

btVector3 arsenalArenaPoint(float x, float y, float height) {
  return btVector3(
    (x / kArsenalPracticeScale) * UU_TO_BT,
    (y / kArsenalPracticeScale) * UU_TO_BT,
    (height / kArsenalPracticeScale) * UU_TO_BT
  );
}

void addArsenalBlock(Arena& arena, float x = 0, float y = 0) {
  const btVector3 halfExtents(
    (kArsenalBlockWidth / kArsenalPracticeScale) * UU_TO_BT / 2.f,
    (kArsenalBlockDepth / kArsenalPracticeScale) * UU_TO_BT / 2.f,
    (kArsenalBlockHeight / kArsenalPracticeScale) * UU_TO_BT / 2.f
  );
  auto* shape = new btBoxShape(halfExtents);
  auto* body = arena._AddStaticCollisionShape(shape, arsenalArenaPoint(x, y, kArsenalBlockHeight / 2.f));
  body->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
  body->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);
}

btVector3 arsenalRampPoint(float x, float y, float height) {
  // RocketSim's native horizontal plane is x/y and its vertical axis is z.
  return arsenalArenaPoint(x, y, height);
}

btConvexHullShape* arsenalRampShape() {
  // The wedge used to be a triangle mesh. Its sloped face rendered and
  // raycast correctly, but a vehicle could enter through a lateral edge in
  // the native solver. A convex hull gives RocketSim one closed support
  // volume for the same six visual vertices.
  static btConvexHullShape* shape = nullptr;
  if (shape) return shape;
  const float run = kArsenalRampRun / 2.f;
  const float width = kArsenalRampWidth / 2.f;
  const auto a = arsenalRampPoint(-run, -width, 0);
  const auto b = arsenalRampPoint(run, -width, 0);
  const auto c = arsenalRampPoint(-run, width, 0);
  const auto d = arsenalRampPoint(run, width, 0);
  const auto e = arsenalRampPoint(run, -width, kArsenalRampHeight);
  const auto f = arsenalRampPoint(run, width, kArsenalRampHeight);
  shape = new btConvexHullShape();
  for (const auto& point : { a, b, c, d, e, f }) shape->addPoint(point, false);
  shape->optimizeConvexHull();
  shape->recalcLocalAabb();
  shape->setMargin(0.04f);
  return shape;
}

void addArsenalRamp(Arena& arena, float x = 0, float y = 0) {
  auto* body = arena._AddStaticCollisionShape(arsenalRampShape(), arsenalArenaPoint(x, y, 0));
  body->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
  body->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);
}

void addCombatAlphaCover(Arena& arena, const CombatAlphaCoverSpec& cover) {
  const btVector3 halfExtents(
    (cover.width / kArsenalPracticeScale) * UU_TO_BT / 2.f,
    (cover.depth / kArsenalPracticeScale) * UU_TO_BT / 2.f,
    (cover.height / kArsenalPracticeScale) * UU_TO_BT / 2.f
  );
  auto* body = arena._AddStaticCollisionShape(
    new btBoxShape(halfExtents),
    arsenalArenaPoint(cover.x, cover.z, cover.height / 2.f)
  );
  body->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
  body->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);
}

void addCombatAlphaCovers(Arena& arena) {
  for (const auto& cover : kCombatAlphaCovers) addCombatAlphaCover(arena, cover);
}

std::unique_ptr<Arena> createCleanArena() {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));
  addPlane(*arena, btVector3(0, 0, 1), btVector3(0, 0, 0));
  addPlane(*arena, btVector3(0, 0, -1), btVector3(0, 0, kArenaHeight));
  addPlane(*arena, btVector3(1, 0, 0), btVector3(-kArenaHalfExtent, 0, 0));
  addPlane(*arena, btVector3(-1, 0, 0), btVector3(kArenaHalfExtent, 0, 0));
  addPlane(*arena, btVector3(0, 1, 0), btVector3(0, -kArenaHalfExtent, 0));
  addPlane(*arena, btVector3(0, -1, 0), btVector3(0, kArenaHalfExtent, 0));

  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);

  return arena;
}

std::unique_ptr<Arena> createArsenalPracticeArena() {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));
  addPlane(*arena, btVector3(0, 0, 1), btVector3(0, 0, 0));
  addPlane(*arena, btVector3(0, 0, -1), btVector3(0, 0, kArsenalPracticeHeight));
  addPlane(*arena, btVector3(1, 0, 0), btVector3(-kArsenalPracticeHalfWidth, 0, 0));
  addPlane(*arena, btVector3(-1, 0, 0), btVector3(kArsenalPracticeHalfWidth, 0, 0));
  addPlane(*arena, btVector3(0, 1, 0), btVector3(0, -kArsenalPracticeHalfDepth, 0));
  addPlane(*arena, btVector3(0, -1, 0), btVector3(0, kArsenalPracticeHalfDepth, 0));

  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);

  return arena;
}

std::unique_ptr<Arena> createArsenalCurvedPracticeArena() {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));
  addPlane(*arena, btVector3(0, 0, 1), btVector3(0, 0, 0));
  addPlane(*arena, btVector3(0, 0, -1), btVector3(0, 0, kArsenalPracticeHeight));
  // Keep the positive X wall as the continuation of the fillet. The mesh
  // handles the quarter turn and this plane catches the vertical section.
  addQuarterPipe(*arena, kArsenalPracticeHalfWidth, kArsenalPracticeHalfDepth, kArsenalCurveRadius, kArsenalPracticeHeight, CurveBoundary::PositiveX, false);
  addPlane(*arena, btVector3(-1, 0, 0), btVector3(kArsenalPracticeHalfWidth, 0, kArsenalPracticeHeight / 2));
  addPlane(*arena, btVector3(1, 0, 0), btVector3(-kArsenalPracticeHalfWidth, 0, 0));
  addPlane(*arena, btVector3(0, 1, 0), btVector3(0, -kArsenalPracticeHalfDepth, 0));
  addPlane(*arena, btVector3(0, -1, 0), btVector3(0, kArsenalPracticeHalfDepth, 0));

  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);

  return arena;
}

std::unique_ptr<Arena> createArsenalExpandedCurvedPracticeArena() {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));
  addPlane(*arena, btVector3(0, 0, 1), btVector3(0, 0, 0));
  addPlane(*arena, btVector3(0, 0, -1), btVector3(0, 0, kArsenalExpandedHeight));
  addQuarterPipe(*arena, kArsenalExpandedHalfWidth, kArsenalExpandedHalfDepth, kArsenalExpandedCurveRadius, kArsenalExpandedHeight, CurveBoundary::PositiveX);
  addQuarterPipe(*arena, kArsenalExpandedHalfWidth, kArsenalExpandedHalfDepth, kArsenalExpandedCurveRadius, kArsenalExpandedHeight, CurveBoundary::NegativeX);
  addQuarterPipe(*arena, kArsenalExpandedHalfWidth, kArsenalExpandedHalfDepth, kArsenalExpandedCurveRadius, kArsenalExpandedHeight, CurveBoundary::PositiveY);
  addQuarterPipe(*arena, kArsenalExpandedHalfWidth, kArsenalExpandedHalfDepth, kArsenalExpandedCurveRadius, kArsenalExpandedHeight, CurveBoundary::NegativeY);
  addPlane(*arena, btVector3(-1, 0, 0), btVector3(kArsenalExpandedHalfWidth, 0, kArsenalExpandedHeight / 2));
  addPlane(*arena, btVector3(1, 0, 0), btVector3(-kArsenalExpandedHalfWidth, 0, 0));
  addPlane(*arena, btVector3(0, -1, 0), btVector3(0, kArsenalExpandedHalfDepth, kArsenalExpandedHeight / 2));
  addPlane(*arena, btVector3(0, 1, 0), btVector3(0, -kArsenalExpandedHalfDepth, 0));

  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);
  return arena;
}

std::unique_ptr<Arena> createCorneredArena(float halfWidth, float halfDepth, float height, float curveRadius, bool largeBroadphase = false) {
  ArenaConfig arenaConfig;
  if (largeBroadphase) arenaConfig.useCustomBroadphase = false;
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, arenaConfig, kFixedStepHz));
  addPlane(*arena, btVector3(0, 0, 1), btVector3(0, 0, 0));
  addPlane(*arena, btVector3(0, 0, -1), btVector3(0, 0, height));
  addQuarterPipe(*arena, halfWidth, halfDepth, curveRadius, height, CurveBoundary::PositiveX);
  addQuarterPipe(*arena, halfWidth, halfDepth, curveRadius, height, CurveBoundary::NegativeX);
  addQuarterPipe(*arena, halfWidth, halfDepth, curveRadius, height, CurveBoundary::PositiveY);
  addQuarterPipe(*arena, halfWidth, halfDepth, curveRadius, height, CurveBoundary::NegativeY);
  for (int corner = 0; corner < 4; corner += 1) addCornerFillet(*arena, halfWidth, halfDepth, curveRadius, corner);
  for (int corner = 0; corner < 4; corner += 1) addCeilingCornerFillet(*arena, halfWidth, halfDepth, curveRadius, height, corner);
  for (int corner = 0; corner < 4; corner += 1) addVerticalCornerFillet(*arena, halfWidth, halfDepth, curveRadius, height, corner);
  addExpandedWallPanels(*arena, halfWidth, halfDepth, curveRadius, height);
  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);
  return arena;
}

std::unique_ptr<Arena> createArsenalExpandedCorneredPracticeArena() {
  return createCorneredArena(kArsenalExpandedHalfWidth, kArsenalExpandedHalfDepth, kArsenalExpandedHeight, kArsenalExpandedCurveRadius);
}

std::unique_ptr<Arena> createArsenalExpandedBlockPracticeArena() {
  auto arena = createArsenalExpandedCorneredPracticeArena();
  addArsenalBlock(*arena);
  return arena;
}

std::unique_ptr<Arena> createArsenalExpandedRampPracticeArena() {
  auto arena = createArsenalExpandedCorneredPracticeArena();
  addArsenalRamp(*arena);
  return arena;
}

std::unique_ptr<Arena> createCombatAlphaArena() {
  auto arena = createCorneredArena(kCombatAlphaHalfWidth, kCombatAlphaHalfDepth, kCombatAlphaHeight, kCombatAlphaCurveRadius, true);
  // ARENA-07 composes only the accepted resources. The open middle lane and
  // mirrored z positions make cover and bypass scenarios reproducible.
  addArsenalBlock(*arena, kCombatBlockX, kCombatBlockZ);
  addArsenalRamp(*arena, kCombatRampX, kCombatRampZ);
  addCombatAlphaCovers(*arena);
  return arena;
}

std::unique_ptr<Arena> createAirVoidArena() {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));
  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);

  return arena;
}

std::unique_ptr<Arena> createSecondActionAirborneArena() {
  return createAirVoidArena();
}

std::unique_ptr<Arena> createArenaForProfile(const std::string& profile) {
  if (profile == "arsenal-practice") return createArsenalPracticeArena();
  if (profile == "arsenal-curved-practice") return createArsenalCurvedPracticeArena();
  if (profile == "arsenal-expanded-curved-practice") return createArsenalExpandedCurvedPracticeArena();
  if (profile == "arsenal-expanded-cornered-practice") return createArsenalExpandedCorneredPracticeArena();
  if (profile == "arsenal-expanded-block-practice") return createArsenalExpandedBlockPracticeArena();
  if (profile == "arsenal-expanded-ramp-practice") return createArsenalExpandedRampPracticeArena();
  if (profile == "combat-alpha") return createCombatAlphaArena();
  if (profile == "air-void") return createAirVoidArena();
  if (profile == "second-action-airborne") return createSecondActionAirborneArena();
  // This is a non-navigable test profile. It intentionally uses the same
  // physical planes as the clean arena; only native initial spawns differ so
  // a WebSocket probe can exercise combat-state and respawn without Node
  // supplying a transform.
  if (profile == "combat-lineup") return createCleanArena();
  return createCleanArena();
}

Team nativeTeam(const std::string& team) {
  return team == "red" ? Team::ORANGE : Team::BLUE;
}

Vec spawnPosition(size_t index, const std::string& profile) {
  if (profile == "arsenal-expanded-block-practice") {
    if (index == 0) return Vec(-1800.f, 0, RLConst::CAR_SPAWN_REST_Z);
    if (index == 1) return Vec(1800.f, 0, RLConst::CAR_SPAWN_REST_Z);
    if (index == 2) return Vec(-1800.f, 900.f, RLConst::CAR_SPAWN_REST_Z);
  }
  if (profile == "arsenal-expanded-ramp-practice") {
    if (index == 0) return Vec(-1600.f, 0, RLConst::CAR_SPAWN_REST_Z);
    if (index == 1) return Vec(1600.f, 0, RLConst::CAR_SPAWN_REST_Z);
    if (index == 2) return Vec(-1600.f, 1200.f, RLConst::CAR_SPAWN_REST_Z);
  }
  if (profile == "combat-alpha") {
    const float side = index % 2 == 0 ? -kCombatSpawnXRatio : kCombatSpawnXRatio;
    const float worldX = side * kCombatAlphaHalfWidth * kArsenalPracticeScale;
    const float worldY = index == 0 ? -kCombatSpawnZOffset
      : index == 1 ? kCombatSpawnZOffset
      : index == 2 ? kCombatSpawnZOffset
      : index == 3 ? -kCombatSpawnZOffset : 0.f;
    if (index < 6 && combatAlphaSafeFloorPoint(worldX, worldY, kCombatAlphaVehicleClearance)) {
      return Vec(side * kCombatAlphaHalfWidth, worldY / kArsenalPracticeScale, RLConst::CAR_SPAWN_REST_Z);
    }
    if (index < 6) throw std::runtime_error("combat-alpha spawn intersects a curve or obstacle clearance zone");
  }
  if (profile == "arsenal-expanded-cornered-practice") {
    static const Vec positions[] = {
      Vec(2200.f, 1500.f, RLConst::CAR_SPAWN_REST_Z), Vec(-2200.f, 1500.f, RLConst::CAR_SPAWN_REST_Z),
      Vec(-2200.f, -1500.f, RLConst::CAR_SPAWN_REST_Z), Vec(2200.f, -1500.f, RLConst::CAR_SPAWN_REST_Z),
    };
    if (index < 4) return positions[index];
  }
  if (profile == "arsenal-expanded-curved-practice" || profile == "arsenal-expanded-cornered-practice") {
    // The four-car native probe starts one car on each centre line. The
    // offsets keep the cars apart along the curve extrusion while each nose
    // points at a different floor-to-wall transition.
    if (index == 0) return Vec(0, -1200.f, RLConst::CAR_SPAWN_REST_Z);
    if (index == 1) return Vec(0, 1200.f, RLConst::CAR_SPAWN_REST_Z);
    if (index == 2) return Vec(-1400.f, 0, RLConst::CAR_SPAWN_REST_Z);
    if (index == 3) return Vec(1400.f, 0, RLConst::CAR_SPAWN_REST_Z);
  }
  if (profile == "air-void" || profile == "second-action-airborne") {
    return Vec((static_cast<float>(index) - 2.5f) * 500.f, 0, 1000.f);
  }
  if (profile == "combat-lineup") {
    // Both cars face +X. The second pilot therefore has a direct, native
    // line of fire to the first without overlapping either hitbox.
    if (index == 0) return Vec(0, 0, RLConst::CAR_SPAWN_REST_Z);
    if (index == 1) return Vec(-600.f, 0, RLConst::CAR_SPAWN_REST_Z);
  }
  if (index == 0) return Vec(0, 0, RLConst::CAR_SPAWN_REST_Z);
  const int column = static_cast<int>((index - 1) % 3) - 1;
  const int row = static_cast<int>((index - 1) / 3);
  return Vec(static_cast<float>(column) * 700.f, row == 0 ? -650.f : 650.f, RLConst::CAR_SPAWN_REST_Z);
}

float spawnYaw(size_t index, const std::string& profile) {
  if (profile == "combat-alpha") return index % 2 == 0 ? 0.f : kPi;
  if (profile == "arsenal-expanded-block-practice" || profile == "arsenal-expanded-ramp-practice") return index == 1 ? kPi : 0.f;
  if (profile == "arsenal-expanded-cornered-practice") {
    return index == 0 ? 0.25f * kPi : index == 1 ? 0.75f * kPi : index == 2 ? -0.75f * kPi : -0.25f * kPi;
  }
  if (profile == "arsenal-expanded-curved-practice") return index == 0 ? 0.f : index == 1 ? kPi : index == 2 ? 0.5f * kPi : -0.5f * kPi;
  return 0.f;
}

std::vector<NativeCar> addConfiguredCars(Arena& arena, const std::vector<RequestedCar>& requestedCars, const std::string& profile) {
  std::vector<NativeCar> result;
  result.reserve(requestedCars.size());
  for (size_t index = 0; index < requestedCars.size(); index += 1) {
    const auto& requested = requestedCars[index];
    Car* car = arena.AddCar(nativeTeam(requested.team));
    CarState state = car->GetState();
    state.pos = spawnPosition(index, profile);
    if ((profile == "arsenal-expanded-curved-practice" || profile == "arsenal-expanded-cornered-practice" || profile == "arsenal-expanded-block-practice" || profile == "arsenal-expanded-ramp-practice" || profile == "combat-alpha") && index < 6) {
      state.rotMat = Angle(spawnYaw(index, profile), 0.f, 0.f).ToRotMat();
    } else {
      state.rotMat = RotMat::GetIdentity();
    }
    state.vel = Vec();
    state.angVel = Vec();
    state.boost = RLConst::BOOST_MAX;
    if (profile == "second-action-airborne") {
      // This matches the reference harness: a first jump has completed, so
      // the next edge selects a vertical double jump or a directed dodge.
      state.isOnGround = false;
      state.hasJumped = true;
      state.isJumping = false;
      state.hasDoubleJumped = false;
      state.hasFlipped = false;
      state.isFlipping = false;
      state.airTime = .1f;
      state.airTimeSinceJump = .1f;
      state.jumpTime = RLConst::JUMP_MAX_TIME;
    }
    car->SetState(state);
    car->controls = CarControls();
    result.push_back({ requested.id, car });
  }
  if (profile != "air-void" && profile != "second-action-airborne") {
    // Match the published curve harness before recording frame 1. The settle
    // phase is outside every trace and applies equally to every configured car.
    arena.Step(kSettleFrames);
  }
  return result;
}

void resetNativeCar(NativeCar& nativeCar, size_t index, const std::string& profile) {
  CarState state = nativeCar.car->GetState();
  state.pos = spawnPosition(index, profile);
  state.rotMat = Angle(spawnYaw(index, profile), 0.f, 0.f).ToRotMat();
  state.vel = Vec();
  state.angVel = Vec();
  state.boost = RLConst::BOOST_MAX;
  state.isOnGround = true;
  state.hasJumped = false;
  state.isJumping = false;
  state.hasDoubleJumped = false;
  state.hasFlipped = false;
  state.isFlipping = false;
  state.airTime = 0;
  state.airTimeSinceJump = 0;
  state.jumpTime = 0;
  nativeCar.car->SetState(state);
  nativeCar.car->controls = CarControls();
}

// Recover only the failure mode reported by the online arena: a vehicle can
// be pushed below the floor-to-wall quarter-pipe or beyond the low wall edge.
// The geometry checks above prevent normal placement there; this watchdog is
// an authoritative last resort after a collision/precision failure.
void recoverCombatAlphaCarsOutsideSafeFloor(std::vector<NativeCar>& cars, const std::string& profile) {
  if (profile != "combat-alpha") return;
  const float halfWidth = kCombatAlphaHalfWidth * kArsenalPracticeScale;
  const float halfDepth = kCombatAlphaHalfDepth * kArsenalPracticeScale;
  for (size_t index = 0; index < cars.size(); index += 1) {
    const auto state = cars[index].car->GetState();
    const float worldX = state.pos.x * kArsenalPracticeScale;
    const float worldY = state.pos.y * kArsenalPracticeScale;
    const float height = (state.pos.z - RLConst::CAR_SPAWN_REST_Z) * kArsenalPracticeScale;
    const float floorFromX = combatAlphaCurveFloorHeight(worldX, halfWidth);
    const float floorFromY = combatAlphaCurveFloorHeight(worldY, halfDepth);
    const float expectedFloor = std::max(floorFromX, floorFromY);
    const bool belowCurve = std::isfinite(expectedFloor) && height + 1.5f < expectedFloor;
    const bool beyondLowEdge = (std::abs(worldX) > halfWidth + kCombatAlphaVehicleClearance
      || std::abs(worldY) > halfDepth + kCombatAlphaVehicleClearance) && height < 5.f;
    if (belowCurve || beyondLowEdge) resetNativeCar(cars[index], index, profile);
  }
}

void deactivateNativeCar(NativeCar& nativeCar) {
  CarState state = nativeCar.car->GetState();
  // Node can request only this named inactive state. It cannot submit a pose
  // or velocity, so collision removal remains a bounded native operation.
  state.pos = Vec(0, 0, -10000.f);
  state.rotMat = RotMat::GetIdentity();
  state.vel = Vec();
  state.angVel = Vec();
  state.isOnGround = false;
  state.isJumping = false;
  state.isFlipping = false;
  nativeCar.car->SetState(state);
  nativeCar.car->controls = CarControls();
}

std::string jumpState(const CarState& state) {
  if (state.isOnGround) return "grounded";
  if (state.isFlipping) return "dodge";
  if (state.isJumping) return "first-jump";
  if (state.hasDoubleJumped) return "double-jump";
  return "airborne";
}

void vec3(std::ostream& out, const Vec& value) {
  out << "{\"x\":" << value.x << ",\"y\":" << value.z << ",\"z\":" << value.y << "}";
}

void vec3(std::ostream& out, const btVector3& value) {
  out << "{\"x\":" << value.x() << ",\"y\":" << value.z() << ",\"z\":" << value.y() << "}";
}

void angularVec3(std::ostream& out, const Vec& value) {
  // y/z exchange is a reflection. Angular velocity is an axial vector, so
  // its external y-up representation is -P * omega rather than P * omega.
  out << "{\"x\":" << -value.x << ",\"y\":" << -value.z << ",\"z\":" << -value.y << "}";
}

void orientationVec(std::ostream& out, const Vec& value) { vec3(out, value); }

struct Quaternion {
  float x = 0;
  float y = 0;
  float z = 0;
  float w = 1;
};

Quaternion quaternionFromBasis(const RotMat& basis) {
  // RotMat is column-major with forward/right/up as its basis. Arsenal's
  // Three.js chassis uses forward/up/right as its local x/y/z columns.
  const Vec forward(basis.forward.x, basis.forward.z, basis.forward.y);
  const Vec up(basis.up.x, basis.up.z, basis.up.y);
  const Vec right(basis.right.x, basis.right.z, basis.right.y);
  const float m00 = forward.x, m01 = up.x, m02 = right.x;
  const float m10 = forward.y, m11 = up.y, m12 = right.y;
  const float m20 = forward.z, m21 = up.z, m22 = right.z;
  Quaternion result;
  const float trace = m00 + m11 + m22;
  if (trace > 0) {
    const float s = std::sqrt(trace + 1.f) * 2.f;
    result.w = .25f * s;
    result.x = (m21 - m12) / s;
    result.y = (m02 - m20) / s;
    result.z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const float s = std::sqrt(std::max(.000001f, 1.f + m00 - m11 - m22)) * 2.f;
    result.w = (m21 - m12) / s;
    result.x = .25f * s;
    result.y = (m01 + m10) / s;
    result.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const float s = std::sqrt(std::max(.000001f, 1.f + m11 - m00 - m22)) * 2.f;
    result.w = (m02 - m20) / s;
    result.x = (m01 + m10) / s;
    result.y = .25f * s;
    result.z = (m12 + m21) / s;
  } else {
    const float s = std::sqrt(std::max(.000001f, 1.f + m22 - m00 - m11)) * 2.f;
    result.w = (m10 - m01) / s;
    result.x = (m02 + m20) / s;
    result.y = (m12 + m21) / s;
    result.z = .25f * s;
  }
  return result;
}

void printCarState(std::ostream& out, int id, Car& car, const CarState& state) {
  const float localPitch = state.rotMat.right.Dot(state.angVel);
  const float localYaw = state.rotMat.up.Dot(state.angVel);
  const float localRoll = -state.rotMat.forward.Dot(state.angVel);
  const float dodgeForward = state.hasFlipped ? state.flipRelTorque.y : 0.f;
  const float dodgeSide = state.hasFlipped ? -state.flipRelTorque.x : 0.f;
  int wheelCount = 0;
  for (bool contact : state.wheelsWithContact) wheelCount += contact ? 1 : 0;
  const btVector3 wheelNormal = car._bulletVehicle.getUpwardsDirFromWheelContacts();
  const Quaternion orientation = quaternionFromBasis(state.rotMat);
  out << "{\"id\":" << id << ",\"position\":";
  vec3(out, state.pos);
  out << ",\"velocity\":";
  vec3(out, state.vel);
  out << ",\"orientation\":{\"x\":" << orientation.x
      << ",\"y\":" << orientation.y
      << ",\"z\":" << orientation.z
      << ",\"w\":" << orientation.w
      << ",\"forward\":";
  orientationVec(out, state.rotMat.forward);
  out << ",\"up\":";
  orientationVec(out, state.rotMat.up);
  out << ",\"right\":";
  orientationVec(out, state.rotMat.right);
  out << "},\"angularVelocity\":";
  angularVec3(out, state.angVel);
  out << ",\"localAngularVelocity\":{\"pitch\":" << localPitch
      << ",\"yaw\":" << localYaw << ",\"roll\":" << localRoll << "}"
      << ",\"grounded\":" << (state.isOnGround ? "true" : "false")
      << ",\"worldContact\":{\"hasContact\":" << (state.worldContact.hasContact ? "true" : "false") << ",\"normal\":";
  vec3(out, state.worldContact.contactNormal);
  out << "}"
      << ",\"wheelCount\":" << wheelCount
      << ",\"wheelContact\":{\"hasContact\":" << (wheelCount > 0 ? "true" : "false") << ",\"normal\":";
  vec3(out, wheelNormal);
  out << "}"
      << ",\"jumps\":" << (state.hasFlipped || state.hasDoubleJumped ? 0 : (state.hasJumped ? 1 : 2))
      << ",\"jumpState\":\"" << jumpState(state) << "\""
      << ",\"secondJumpWindow\":" << (state.hasJumped ? std::max(0.f, 1.25f - state.airTimeSinceJump) : 0.f)
      << ",\"dodgeTime\":" << state.flipTime
      << ",\"dodgeDirection\":{\"forward\":" << dodgeForward
      << ",\"side\":" << dodgeSide << "}"
      << ",\"actionFlags\":{\"hasJumped\":" << (state.hasJumped ? "true" : "false")
      << ",\"hasDoubleJumped\":" << (state.hasDoubleJumped ? "true" : "false")
      << ",\"hasFlipped\":" << (state.hasFlipped ? "true" : "false") << "}"
      << ",\"boost\":" << state.boost << "}";
}

void printState(std::ostream& out, int tick, const std::vector<NativeCar>& cars, const std::vector<CombatBoostPad>& pads) {
  out << "{\"type\":\"state\",\"schemaVersion\":1,\"fixedStepHz\":" << kFixedStepHz
      << ",\"tick\":" << tick << ",\"cars\":[";
  for (size_t index = 0; index < cars.size(); index += 1) {
    if (index) out << ',';
    printCarState(out, cars[index].id, *cars[index].car, cars[index].car->GetState());
  }
  out << "],\"pads\":[";
  for (size_t index = 0; index < pads.size(); index += 1) {
    if (index) out << ',';
    out << "{\"id\":" << pads[index].id << ",\"active\":" << (pads[index].active ? "true" : "false")
        << ",\"cooldown\":" << pads[index].cooldown << "}";
  }
  out << "]}\n";
}

void printReady(std::ostream& out, const std::string& arena, const std::vector<NativeCar>& cars) {
  out << "{\"type\":\"ready\",\"schemaVersion\":1,\"fixedStepHz\":" << kFixedStepHz
      << ",\"arena\":\"" << arena << "\",\"features\":{\"staticRaycast\":true},\"cars\":[";
  for (size_t index = 0; index < cars.size(); index += 1) {
    if (index) out << ',';
    out << "{\"id\":" << cars[index].id << "}";
  }
  out << "]}\n";
}

void printRaycast(std::ostream& out, int tick, Arena& arena, const std::vector<RaySegment>& segments) {
  out << "{\"type\":\"raycast-state\",\"schemaVersion\":1,\"tick\":" << tick << ",\"hits\":[";
  for (size_t index = 0; index < segments.size(); index += 1) {
    if (index) out << ',';
    const auto& segment = segments[index];
    const auto result = raycastStatic(arena, segment.from, segment.to);
    const auto point = result.hit ? result.point : segment.to;
    out << "{\"id\":" << segment.id << ",\"hit\":" << (result.hit ? "true" : "false")
        << ",\"fraction\":" << (result.hit ? result.fraction : 1.f)
        << ",\"point\":{\"x\":" << point.x() / UU_TO_BT
        << ",\"y\":" << point.z() / UU_TO_BT << ",\"z\":" << point.y() / UU_TO_BT << "},\"normal\":{\"x\":";
    if (result.hit) {
      out << result.normal.x() << ",\"y\":" << result.normal.z() << ",\"z\":" << result.normal.y();
    } else {
      out << "0,\"y\":0,\"z\":0";
    }
    out << "},\"kind\":\"static\"}";
  }
  out << "]}\n";
}

} // namespace

int main() {
  RocketSim::InitFromMem({}, true);
  std::cout << std::fixed << std::setprecision(6);
  std::unique_ptr<Arena> arena;
  std::vector<NativeCar> cars;
  std::vector<CombatBoostPad> pads;
  int tick = 0;
  std::string activeArena;
  std::string line;

  while (std::getline(std::cin, line)) {
    if (line.find("\"type\":\"init\"") != std::string::npos) {
      std::vector<RequestedCar> requestedCars;
      if (!validInit(line, requestedCars)) {
        std::cout << "{\"type\":\"error\",\"message\":\"unsupported bridge init\"}\n";
        std::cout.flush();
        continue;
      }
      activeArena = stringValue(line, "arena");
      arena = createArenaForProfile(activeArena);
      cars = addConfiguredCars(*arena, requestedCars, activeArena);
      pads = combatBoostPads(activeArena);
      // A modestly lower drain makes the new pickups meaningful without
      // turning combat-alpha into unlimited boost. RocketSim remains the
      // authority for consumption and acceleration.
      if (activeArena == "combat-alpha") {
        auto mutator = arena->GetMutatorConfig();
        mutator.boostUsedPerSecond *= .78f;
        arena->SetMutatorConfig(mutator);
      }
      tick = 0;
      printReady(std::cout, activeArena, cars);
      std::cout.flush();
      continue;
    }
    if (line.find("\"type\":\"tick\"") != std::string::npos) {
      if (!arena || cars.empty()) {
        std::cout << "{\"type\":\"error\",\"message\":\"bridge is not initialized\"}\n";
        std::cout.flush();
        continue;
      }
      const int requestedTick = integer(line, "tick");
      std::vector<RequestedCar> requestedCars;
      if (requestedTick != tick + 1 || !readTickCars(line, requestedCars) || !hasSameIds(cars, requestedCars)) {
        std::cout << "{\"type\":\"error\",\"message\":\"tick must advance by one with the configured car IDs\"}\n";
        std::cout.flush();
        continue;
      }
      for (const auto& requested : requestedCars) {
        const auto native = std::find_if(cars.begin(), cars.end(), [&](const NativeCar& candidate) { return candidate.id == requested.id; });
        native->car->controls = toControls(requested.input);
      }
      for (auto& native : cars) native.boostBeforeStep = native.car->GetState().boost;
      arena->Step();
      recoverCombatAlphaCarsOutsideSafeFloor(cars, activeArena);
      updateCombatBoostRegeneration(cars, activeArena);
      tick = requestedTick;
      printState(std::cout, tick, cars, pads);
      std::cout.flush();
      continue;
    }
    if (line.find("\"type\":\"raycast\"") != std::string::npos) {
      if (!arena || cars.empty()) {
        std::cout << "{\"type\":\"error\",\"message\":\"bridge is not initialized\"}\n";
        std::cout.flush();
        continue;
      }
      std::vector<RaySegment> segments;
      if (!readRaySegments(line, segments)) {
        std::cout << "{\"type\":\"error\",\"message\":\"raycast segments are invalid\"}\n";
        std::cout.flush();
        continue;
      }
      printRaycast(std::cout, tick, *arena, segments);
      std::cout.flush();
      continue;
    }
    if (line.find("\"type\":\"respawn\"") != std::string::npos) {
      const int id = integer(line, "id", 0);
      const auto native = std::find_if(cars.begin(), cars.end(), [&](const NativeCar& candidate) { return candidate.id == id; });
      if (!arena || native == cars.end()) {
        std::cout << "{\"type\":\"error\",\"message\":\"respawn needs a configured car\"}\n";
        std::cout.flush();
        continue;
      }
      const size_t index = static_cast<size_t>(std::distance(cars.begin(), native));
      resetNativeCar(*native, index, activeArena);
      printState(std::cout, tick, cars, pads);
      std::cout.flush();
      continue;
    }
    if (line.find("\"type\":\"combat-state\"") != std::string::npos) {
      const int id = integer(line, "id", 0);
      const auto native = std::find_if(cars.begin(), cars.end(), [&](const NativeCar& candidate) { return candidate.id == id; });
      if (!arena || native == cars.end()) {
        std::cout << "{\"type\":\"error\",\"message\":\"combat-state needs a configured car\"}\n";
        std::cout.flush();
        continue;
      }
      if (boolean(line, "active", true)) {
        const size_t index = static_cast<size_t>(std::distance(cars.begin(), native));
        resetNativeCar(*native, index, activeArena);
      } else deactivateNativeCar(*native);
      printState(std::cout, tick, cars, pads);
      std::cout.flush();
      continue;
    }
    if (line.find("\"type\":\"shutdown\"") != std::string::npos) {
      std::cout << "{\"type\":\"stopped\",\"tick\":" << tick << "}\n";
      std::cout.flush();
      break;
    }
    std::cout << "{\"type\":\"error\",\"message\":\"unknown bridge message\"}\n";
    std::cout.flush();
  }
  return 0;
}
