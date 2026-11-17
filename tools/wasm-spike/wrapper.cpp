#include <cmath>
#include <cstdint>
#include <algorithm>
#include <memory>
#include <vector>

#include "RocketSim.h"
#include "combat_alpha_geometry.generated.hpp"
#include "BulletCollision/CollisionDispatch/btCollisionWorld.h"
#include "BulletCollision/CollisionShapes/btBoxShape.h"
#include "BulletCollision/CollisionShapes/btConvexHullShape.h"
#include "BulletCollision/CollisionShapes/btTriangleMesh.h"

namespace {
std::unique_ptr<RocketSim::Arena> arena;
std::vector<RocketSim::Car*> cars;
RocketSim::Car* car = nullptr;

constexpr uint32_t kMaxTraceCars = 6;
constexpr float kCleanArenaHalfExtent = 1000.f;
constexpr float kCleanArenaHeight = 500.f;
// Keep this isolated geometry byte-for-byte equivalent to the native
// `arsenal-curved-practice` bridge profile. The scale is the same Arsenal
// world conversion used by tools/rocketsim-bridge/main.cpp.
constexpr float kArsenalPracticeScale = 56.f / RocketSim::RLConst::CAR_MAX_SPEED;
constexpr float kArsenalPracticeHalfWidth = 62.f / kArsenalPracticeScale;
constexpr float kArsenalPracticeHalfDepth = 46.f / kArsenalPracticeScale;
constexpr float kArsenalPracticeHeight = RocketSim::RLConst::CAR_SPAWN_REST_Z + 24.f / kArsenalPracticeScale;
// Mirror the 264 × 408 × 108 native combat-alpha shell. These dimensions are shared
// with the profile and local RocketSim bridge so render geometry never grows
// beyond its real collision volume.
constexpr float kCombatAlphaHalfWidth = CombatCarsArenaGeometry::kCombatAlphaWidth / 2.f / kArsenalPracticeScale;
constexpr float kCombatAlphaHalfDepth = CombatCarsArenaGeometry::kCombatAlphaDepth / 2.f / kArsenalPracticeScale;
constexpr float kCombatAlphaHeight = RocketSim::RLConst::CAR_SPAWN_REST_Z + CombatCarsArenaGeometry::kCombatAlphaHeight / kArsenalPracticeScale;
constexpr float kCombatAlphaCurveRadius = CombatCarsArenaGeometry::kCombatAlphaCurveRadius / kArsenalPracticeScale;
// Lobby contacts are solved by RocketSim. This small native guard only repairs
// a body if a very fast discrete step escapes the whole static arena volume;
// valid quarter-pipe contacts remain untouched. It deliberately preserves
// orientation, angular velocity, boost and jump state instead of invoking the
// combat respawn lifecycle.
constexpr float kLobbyContainVehicleRadius = 2.5f / kArsenalPracticeScale;
constexpr float kLobbyContainBounce = 0.35f;
constexpr float kLobbyContainFloorMargin = 8.f;
// Bullet's CCD is opt-in per rigid body. A 120 Hz RocketSim step can still
// cross a thin static wall after a car-to-car impulse, so enable the swept
// sphere path for combat-alpha cars. Normal contacts remain solver-owned;
// `rs_contain_car` is only a last-resort repair for an already invalid state.
constexpr float kLobbyCcdMotionThresholdBT = 0.05f;
constexpr float kLobbyCcdSweptRadiusBT = 0.30f;
// Combat boost is native and fixed-step: two seconds idle, then one second
// from empty to full with a gentle linear rate ramp. The browser never
// predicts or patches this value.
constexpr uint32_t kBoostRegenDelayTicks = 240;
constexpr uint32_t kBoostRegenDurationTicks = 120;
constexpr float kBoostRegenStartRatePerTick = 50.f / 120.f;
constexpr float kBoostRegenEndRatePerTick = 150.f / 120.f;
constexpr float kArsenalBlockWidth = CombatCarsArenaGeometry::kCentralBlockWidth;
constexpr float kArsenalBlockDepth = CombatCarsArenaGeometry::kCentralBlockDepth;
constexpr float kArsenalBlockHeight = CombatCarsArenaGeometry::kCentralBlockHeight;
constexpr float kArsenalRampRun = CombatCarsArenaGeometry::kSouthRampRun;
constexpr float kArsenalRampWidth = CombatCarsArenaGeometry::kSouthRampWidth;
constexpr float kArsenalRampHeight = CombatCarsArenaGeometry::kSouthRampHeight;
constexpr float kCombatBlockX = CombatCarsArenaGeometry::kCentralBlockX;
constexpr float kCombatBlockY = CombatCarsArenaGeometry::kCentralBlockZ;
constexpr float kCombatRampX = CombatCarsArenaGeometry::kSouthRampX;
constexpr float kCombatRampY = CombatCarsArenaGeometry::kSouthRampZ;
constexpr float kCombatAlphaSpawnXRatio = 2.f / 3.f;
constexpr float kCombatAlphaSpawnZOffset = 90.f / kArsenalPracticeScale;
// This pair is a diagnostic-only fixture, deliberately positioned near the
// enlarged shell so its bounded projectile trace still reaches real static
// geometry. Keep initialization and lifecycle respawns on these exact poses.
constexpr float kCombatAlphaPairHostSpawnX = -1500.f;
constexpr float kCombatAlphaPairHostSpawnY = -1230.f;
constexpr float kCombatAlphaPairPilotSpawnX = 1970.f;
constexpr float kCombatAlphaPairPilotSpawnY = 1230.f;
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
constexpr float kArsenalCurveRadius = 256.f;
constexpr int kArsenalCurveSegments = 32;
constexpr int kArsenalCornerSegments = 16;
constexpr float kPi = 3.14159265358979323846f;

enum class ActiveFixture : uint8_t {
  None,
  Generic,
  AirVoid,
  CleanGround,
  CleanWallContact,
  CurvedPractice,
  CombatLineup,
  CombatAlpha,
  CombatAlphaPair,
};

ActiveFixture activeFixture = ActiveFixture::None;

struct CombatBoostPad {
  int id = 0;
  RocketSim::Vec pos;
  float radius = 185.f;
  float height = 180.f;
  float amount = 60.f;
  float cooldown = 0.f;
  float cooldownSeconds = 5.f;
  bool active = true;
};

std::vector<CombatBoostPad> combatPads;
int combatPadLayoutError = -1;
std::vector<uint32_t> boostRegenDelayTicks;
std::vector<uint32_t> boostRegenTicks;
std::vector<float> boostBeforeStep;

bool combatAlphaSafeFloorPoint(float worldX, float worldY, float clearance) {
  const float curve = kCombatAlphaCurveRadius * kArsenalPracticeScale;
  const float maxX = kCombatAlphaHalfWidth * kArsenalPracticeScale - curve - clearance;
  const float maxY = kCombatAlphaHalfDepth * kArsenalPracticeScale - curve - clearance;
  if (std::abs(worldX) >= maxX || std::abs(worldY) >= maxY) return false;
  const float blockHalfX = kArsenalBlockWidth / 2.f + clearance;
  const float blockHalfY = kArsenalBlockDepth / 2.f + clearance;
  if (std::abs(worldX - kCombatBlockX) < blockHalfX && std::abs(worldY - kCombatBlockY) < blockHalfY) return false;
  const float rampHalfX = kArsenalRampRun / 2.f + clearance;
  const float rampHalfY = kArsenalRampWidth / 2.f + clearance;
  if (std::abs(worldX - kCombatRampX) < rampHalfX && std::abs(worldY - kCombatRampY) < rampHalfY) return false;
  for (const auto& cover : CombatCarsArenaGeometry::kCombatAlphaCovers) {
    const float halfX = cover.width / 2.f + clearance;
    const float halfY = cover.depth / 2.f + clearance;
    if (std::abs(worldX - cover.x) < halfX && std::abs(worldY - cover.z) < halfY) return false;
  }
  return true;
}

std::vector<CombatBoostPad> createCombatPads() {
  combatPadLayoutError = -1;
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
  int candidateId = 0;
  auto add = [&](float x, float y, float amount, float cooldownSeconds, float radius) {
    const int id = candidateId++;
    const float clearance = radius * kArsenalPracticeScale + .6f;
    if (!combatAlphaSafeFloorPoint(x * kArsenalPracticeScale, y * kArsenalPracticeScale, clearance)) {
      if (combatPadLayoutError < 0) combatPadLayoutError = id;
      return;
    }
    pads.push_back({ id, RocketSim::Vec(x, y, 0.f), radius, 180.f, amount, 0.f, cooldownSeconds, true });
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

void updateCombatPads(float dt) {
  for (auto& pad : combatPads) {
    pad.cooldown = std::max(0.f, pad.cooldown - dt);
    pad.active = pad.cooldown <= 0.f;
    if (!pad.active) continue;
    for (auto* selected : cars) {
      if (!selected) continue;
      const RocketSim::CarState state = selected->GetState();
      if (std::hypot(state.pos.x - pad.pos.x, state.pos.y - pad.pos.y) > pad.radius) continue;
      if (std::abs(state.pos.z - pad.pos.z) > pad.height) continue;
      const float before = state.boost;
      const float nextBoost = std::min(RocketSim::RLConst::BOOST_MAX, before + pad.amount);
      if (nextBoost <= before + .001f) continue;
      RocketSim::CarState updated = state;
      updated.boost = nextBoost;
      selected->SetState(updated);
      pad.active = false;
      pad.cooldown = pad.cooldownSeconds;
      break;
    }
  }
}

void captureCombatBoostBeforeStep() {
  boostBeforeStep.resize(cars.size(), RocketSim::RLConst::BOOST_MAX);
  for (size_t index = 0; index < cars.size(); index += 1) {
    boostBeforeStep[index] = cars[index] ? cars[index]->GetState().boost : RocketSim::RLConst::BOOST_MAX;
  }
}

void updateCombatBoostRegeneration() {
  boostRegenDelayTicks.resize(cars.size(), 0);
  boostRegenTicks.resize(cars.size(), 0);
  for (size_t index = 0; index < cars.size(); index += 1) {
    if (!cars[index]) continue;
    const RocketSim::CarState state = cars[index]->GetState();
    const float before = index < boostBeforeStep.size() ? boostBeforeStep[index] : state.boost;
    const float current = state.boost;
    if (current < before - .0001f) {
      boostRegenDelayTicks[index] = kBoostRegenDelayTicks;
      boostRegenTicks[index] = 0;
      continue;
    }
    if (current >= RocketSim::RLConst::BOOST_MAX - .0001f) {
      boostRegenDelayTicks[index] = 0;
      boostRegenTicks[index] = 0;
      continue;
    }
    if (boostRegenDelayTicks[index] > 1) {
      boostRegenDelayTicks[index] -= 1;
      boostRegenTicks[index] = 0;
      continue;
    }
    RocketSim::CarState updated = state;
    const uint32_t progress = std::min(boostRegenTicks[index], kBoostRegenDurationTicks - 1);
    const float ramp = static_cast<float>(progress) / static_cast<float>(kBoostRegenDurationTicks - 1);
    const float ratePerTick = kBoostRegenStartRatePerTick
      + (kBoostRegenEndRatePerTick - kBoostRegenStartRatePerTick) * ramp;
    updated.boost = std::min(RocketSim::RLConst::BOOST_MAX, current + ratePerTick);
    cars[index]->SetState(updated);
    boostRegenDelayTicks[index] = 0;
    boostRegenTicks[index] = std::min(kBoostRegenDurationTicks, boostRegenTicks[index] + 1);
  }
}

void addCleanArenaPlane(RocketSim::Arena& target, const btVector3& normal, const btVector3& position);

btVector3 curvedPoint(float x, float y, float z) {
  return btVector3(x * UU_TO_BT, y * UU_TO_BT, z * UU_TO_BT);
}

// This is the native bridge's lower +X quarter-pipe copied without changing
// segment count, winding, coordinate conversion, or BVH margin. The cache is
// intentionally process-lifetime: RocketSim does not own BVH shapes, so a
// later fixture can safely reuse this immutable shape after Arena destruction.
btBvhTriangleMeshShape* arsenalCurvedPracticeShape() {
  static btBvhTriangleMeshShape* shape = nullptr;
  if (shape) return shape;

  auto* mesh = new btTriangleMesh();
  const float center = kArsenalPracticeHalfWidth - kArsenalCurveRadius;
  const float extrusionMin = -kArsenalPracticeHalfDepth;
  const float extrusionMax = kArsenalPracticeHalfDepth;
  const auto addArc = [&](float thetaStart, float thetaEnd, float centerZ, bool invertWinding) {
    for (int index = 0; index < kArsenalCurveSegments; index += 1) {
      const float theta0 = thetaStart + (thetaEnd - thetaStart) * index / kArsenalCurveSegments;
      const float theta1 = thetaStart + (thetaEnd - thetaStart) * (index + 1) / kArsenalCurveSegments;
      const auto point = [&](float theta, float extrusion) {
        const float radial = kArsenalCurveRadius * std::cos(theta);
        const float arcHeight = centerZ + kArsenalCurveRadius * std::sin(theta);
        return curvedPoint(center + radial, extrusion, arcHeight);
      };
      const btVector3 p00 = point(theta0, extrusionMin);
      const btVector3 p10 = point(theta1, extrusionMin);
      const btVector3 p01 = point(theta0, extrusionMax);
      const btVector3 p11 = point(theta1, extrusionMax);
      // Positive-X uses reverseWinding=false in the native bridge.
      if (!invertWinding) {
        mesh->addTriangle(p00, p10, p01, true);
        mesh->addTriangle(p10, p11, p01, true);
      } else {
        mesh->addTriangle(p00, p01, p10, true);
        mesh->addTriangle(p10, p01, p11, true);
      }
    }
  };
  addArc(-0.5f * kPi, 0.f, kArsenalCurveRadius, false);
  // The upper arc is part of the exact native mesh even though this bounded
  // trace only drives through the lower floor-to-wall transition.
  addArc(0.f, 0.5f * kPi, kArsenalPracticeHeight - kArsenalCurveRadius, true);
  shape = new btBvhTriangleMeshShape(mesh, true);
  shape->setMargin(0.04f);
  return shape;
}

void addArsenalCurvedPracticeArena(RocketSim::Arena& target) {
  addCleanArenaPlane(target, btVector3(0, 0, 1), btVector3(0, 0, 0));
  addCleanArenaPlane(target, btVector3(0, 0, -1), btVector3(0, 0, kArsenalPracticeHeight));
  target._AddStaticCollisionShape(arsenalCurvedPracticeShape());
  // Keep the positive X wall as the continuation of the fillet, exactly as
  // the native `arsenal-curved-practice` profile does.
  addCleanArenaPlane(target, btVector3(-1, 0, 0), btVector3(kArsenalPracticeHalfWidth, 0, kArsenalPracticeHeight / 2.f));
  addCleanArenaPlane(target, btVector3(1, 0, 0), btVector3(-kArsenalPracticeHalfWidth, 0, 0));
  addCleanArenaPlane(target, btVector3(0, 1, 0), btVector3(0, -kArsenalPracticeHalfDepth, 0));
  addCleanArenaPlane(target, btVector3(0, -1, 0), btVector3(0, kArsenalPracticeHalfDepth, 0));
}

void addCleanArenaPlane(RocketSim::Arena& target, const btVector3& normal, const btVector3& position) {
  const btVector3 positionBT(position.x() * UU_TO_BT, position.y() * UU_TO_BT, position.z() * UU_TO_BT);
  auto* body = target._AddStaticCollisionShape(new btStaticPlaneShape(normal, 0), positionBT);
  body->setFriction(RocketSim::RLConst::ARENA_COLLISION_BASE_FRICTION);
  body->setRestitution(RocketSim::RLConst::ARENA_COLLISION_BASE_RESTITUTION);
}

enum class CombatCurveBoundary { PositiveX, NegativeX, PositiveY, NegativeY };

btBvhTriangleMeshShape* combatAlphaCurveShape(CombatCurveBoundary side) {
  static btBvhTriangleMeshShape* shapes[4]{};
  const int index = static_cast<int>(side);
  if (shapes[index]) return shapes[index];
  auto* mesh = new btTriangleMesh();
  const bool xBoundary = side == CombatCurveBoundary::PositiveX || side == CombatCurveBoundary::NegativeX;
  const float center = (side == CombatCurveBoundary::PositiveX || side == CombatCurveBoundary::PositiveY)
    ? (xBoundary ? kCombatAlphaHalfWidth - kCombatAlphaCurveRadius : kCombatAlphaHalfDepth - kCombatAlphaCurveRadius)
    : (xBoundary ? -kCombatAlphaHalfWidth + kCombatAlphaCurveRadius : -kCombatAlphaHalfDepth + kCombatAlphaCurveRadius);
  const float extrusionMin = xBoundary ? -kCombatAlphaHalfDepth + kCombatAlphaCurveRadius : -kCombatAlphaHalfWidth + kCombatAlphaCurveRadius;
  const float extrusionMax = xBoundary ? kCombatAlphaHalfDepth - kCombatAlphaCurveRadius : kCombatAlphaHalfWidth - kCombatAlphaCurveRadius;
  const bool reverseWinding = side == CombatCurveBoundary::NegativeX || side == CombatCurveBoundary::PositiveY;
  const auto addArc = [&](float thetaStart, float thetaEnd, float centerZ, bool invertWinding) {
    for (int segment = 0; segment < kArsenalCurveSegments; segment += 1) {
      const float theta0 = thetaStart + (thetaEnd - thetaStart) * segment / kArsenalCurveSegments;
      const float theta1 = thetaStart + (thetaEnd - thetaStart) * (segment + 1) / kArsenalCurveSegments;
      const auto point = [&](float theta, float extrusion) {
        const float radial = kCombatAlphaCurveRadius * std::cos(theta);
        const float arcHeight = centerZ + kCombatAlphaCurveRadius * std::sin(theta);
        if (side == CombatCurveBoundary::PositiveX) return curvedPoint(center + radial, extrusion, arcHeight);
        if (side == CombatCurveBoundary::NegativeX) return curvedPoint(center - radial, extrusion, arcHeight);
        if (side == CombatCurveBoundary::PositiveY) return curvedPoint(extrusion, center + radial, arcHeight);
        return curvedPoint(extrusion, center - radial, arcHeight);
      };
      const btVector3 p00 = point(theta0, extrusionMin), p10 = point(theta1, extrusionMin);
      const btVector3 p01 = point(theta0, extrusionMax), p11 = point(theta1, extrusionMax);
      if (reverseWinding != invertWinding) {
        mesh->addTriangle(p00, p01, p10, true); mesh->addTriangle(p10, p01, p11, true);
      } else {
        mesh->addTriangle(p00, p10, p01, true); mesh->addTriangle(p10, p11, p01, true);
      }
    }
  };
  addArc(-0.5f * kPi, 0.f, kCombatAlphaCurveRadius, false);
  addArc(0.f, 0.5f * kPi, kCombatAlphaHeight - kCombatAlphaCurveRadius, true);
  shapes[index] = new btBvhTriangleMeshShape(mesh, true);
  shapes[index]->setMargin(0.04f);
  return shapes[index];
}

btBvhTriangleMeshShape* combatAlphaCornerShape(float radius, float height, int corner, int kind) {
  static btBvhTriangleMeshShape* shapes[3][4]{};
  if (shapes[kind][corner]) return shapes[kind][corner];
  const int sx = (corner == 0 || corner == 3) ? 1 : -1;
  const int sy = (corner == 0 || corner == 1) ? 1 : -1;
  const bool reverseWinding = sx * sy < 0;
  const float centerX = sx * (kCombatAlphaHalfWidth - radius);
  const float centerY = sy * (kCombatAlphaHalfDepth - radius);
  auto* mesh = new btTriangleMesh();
  if (kind == 2) {
    const auto point = [&](float phi, float z) {
      return curvedPoint(centerX + sx * radius * std::cos(phi), centerY + sy * radius * std::sin(phi), z);
    };
    for (int index = 0; index < kArsenalCornerSegments; index += 1) {
      const float phi0 = 0.5f * kPi * index / kArsenalCornerSegments;
      const float phi1 = 0.5f * kPi * (index + 1) / kArsenalCornerSegments;
      const btVector3 p00 = point(phi0, radius), p10 = point(phi0, height - radius);
      const btVector3 p01 = point(phi1, radius), p11 = point(phi1, height - radius);
      if (reverseWinding) { mesh->addTriangle(p00, p01, p10, true); mesh->addTriangle(p10, p01, p11, true); }
      else { mesh->addTriangle(p00, p10, p01, true); mesh->addTriangle(p10, p11, p01, true); }
    }
  } else {
    for (int thetaIndex = 0; thetaIndex < kArsenalCurveSegments; thetaIndex += 1) {
      const float theta0 = (kind == 0 ? -0.5f : 0.f) * kPi + 0.5f * kPi * thetaIndex / kArsenalCurveSegments;
      const float theta1 = (kind == 0 ? -0.5f : 0.f) * kPi + 0.5f * kPi * (thetaIndex + 1) / kArsenalCurveSegments;
      for (int phiIndex = 0; phiIndex < kArsenalCornerSegments; phiIndex += 1) {
        const float phi0 = 0.5f * kPi * phiIndex / kArsenalCornerSegments;
        const float phi1 = 0.5f * kPi * (phiIndex + 1) / kArsenalCornerSegments;
        const auto point = [&](float theta, float phi) {
          const float radial = radius * std::cos(theta);
          const float z = kind == 0 ? radius + radius * std::sin(theta) : height - radius + radius * std::sin(theta);
          return curvedPoint(centerX + sx * radial * std::cos(phi), centerY + sy * radial * std::sin(phi), z);
        };
        const btVector3 p00 = point(theta0, phi0), p10 = point(theta1, phi0);
        const btVector3 p01 = point(theta0, phi1), p11 = point(theta1, phi1);
        if (reverseWinding) { mesh->addTriangle(p00, p01, p10, true); mesh->addTriangle(p10, p01, p11, true); }
        else { mesh->addTriangle(p00, p10, p01, true); mesh->addTriangle(p10, p11, p01, true); }
      }
    }
  }
  shapes[kind][corner] = new btBvhTriangleMeshShape(mesh, true);
  shapes[kind][corner]->setMargin(0.04f);
  return shapes[kind][corner];
}

btBvhTriangleMeshShape* combatAlphaPanel(int panel) {
  static btBvhTriangleMeshShape* shapes[4]{};
  if (shapes[panel]) return shapes[panel];
  const float w = kCombatAlphaHalfWidth, d = kCombatAlphaHalfDepth, r = kCombatAlphaCurveRadius, h = kCombatAlphaHeight;
  btVector3 p00, p10, p01; bool reverse = false;
  if (panel == 0) { p00 = btVector3(w, -d + r, r); p10 = btVector3(w, -d + r, h - r); p01 = btVector3(w, d - r, r); }
  else if (panel == 1) { p00 = btVector3(-w, -d + r, r); p10 = btVector3(-w, -d + r, h - r); p01 = btVector3(-w, d - r, r); reverse = true; }
  else if (panel == 2) { p00 = btVector3(-w + r, d, r); p10 = btVector3(-w + r, d, h - r); p01 = btVector3(w - r, d, r); reverse = true; }
  else { p00 = btVector3(-w + r, -d, r); p10 = btVector3(-w + r, -d, h - r); p01 = btVector3(w - r, -d, r); }
  const btVector3 p11 = p10 + (p01 - p00);
  auto* mesh = new btTriangleMesh();
  if (reverse) { mesh->addTriangle(curvedPoint(p00.x(), p00.y(), p00.z()), curvedPoint(p01.x(), p01.y(), p01.z()), curvedPoint(p10.x(), p10.y(), p10.z()), true); mesh->addTriangle(curvedPoint(p10.x(), p10.y(), p10.z()), curvedPoint(p01.x(), p01.y(), p01.z()), curvedPoint(p11.x(), p11.y(), p11.z()), true); }
  else { mesh->addTriangle(curvedPoint(p00.x(), p00.y(), p00.z()), curvedPoint(p10.x(), p10.y(), p10.z()), curvedPoint(p01.x(), p01.y(), p01.z()), true); mesh->addTriangle(curvedPoint(p10.x(), p10.y(), p10.z()), curvedPoint(p11.x(), p11.y(), p11.z()), curvedPoint(p01.x(), p01.y(), p01.z()), true); }
  shapes[panel] = new btBvhTriangleMeshShape(mesh, true);
  shapes[panel]->setMargin(0.04f);
  return shapes[panel];
}

btVector3 combatAlphaArenaPoint(float x, float y, float height) {
  return btVector3((x / kArsenalPracticeScale) * UU_TO_BT,
                   (y / kArsenalPracticeScale) * UU_TO_BT,
                   (height / kArsenalPracticeScale) * UU_TO_BT);
}

btConvexHullShape* combatAlphaRampShape() {
  static btConvexHullShape* shape = nullptr;
  if (shape) return shape;
  const float run = kArsenalRampRun / 2.f, width = kArsenalRampWidth / 2.f;
  const auto point = [&](float x, float y, float z) { return combatAlphaArenaPoint(x, y, z); };
  const auto a = point(-run, -width, 0), b = point(run, -width, 0), c = point(-run, width, 0);
  const auto d = point(run, width, 0), e = point(run, -width, kArsenalRampHeight), f = point(run, width, kArsenalRampHeight);
  shape = new btConvexHullShape();
  for (const auto& value : { a, b, c, d, e, f }) shape->addPoint(value, false);
  shape->optimizeConvexHull(); shape->recalcLocalAabb(); shape->setMargin(0.04f);
  return shape;
}

void addCombatAlphaCover(RocketSim::Arena& target, const CombatCarsArenaGeometry::CoverSpec& cover) {
  const btVector3 halfExtents(
    (cover.width / kArsenalPracticeScale) * UU_TO_BT / 2.f,
    (cover.depth / kArsenalPracticeScale) * UU_TO_BT / 2.f,
    (cover.height / kArsenalPracticeScale) * UU_TO_BT / 2.f
  );
  auto* body = target._AddStaticCollisionShape(
    new btBoxShape(halfExtents),
    combatAlphaArenaPoint(cover.x, cover.z, cover.height / 2.f)
  );
  body->setFriction(RocketSim::RLConst::ARENA_COLLISION_BASE_FRICTION);
  body->setRestitution(RocketSim::RLConst::ARENA_COLLISION_BASE_RESTITUTION);
}

void addCombatAlphaCovers(RocketSim::Arena& target) {
  for (const auto& cover : CombatCarsArenaGeometry::kCombatAlphaCovers) addCombatAlphaCover(target, cover);
}

void addCombatAlphaArena(RocketSim::Arena& target) {
  addCleanArenaPlane(target, btVector3(0, 0, 1), btVector3(0, 0, 0));
  addCleanArenaPlane(target, btVector3(0, 0, -1), btVector3(0, 0, kCombatAlphaHeight));
  // The side boundary is the native cornered-arena topology below: four
  // quarter-pipes, lower/upper corner fillets, vertical corner fillets and
  // finite wall panels. Do not add infinite side planes here. They overlap
  // the quarter-pipes and corner meshes at the floor/wall transition, so a
  // high-speed car-to-car impulse can be solved against two contradictory
  // surfaces and get ejected or tunnel under the curve.
  for (int side = 0; side < 4; side += 1) target._AddStaticCollisionShape(combatAlphaCurveShape(static_cast<CombatCurveBoundary>(side)));
  for (int corner = 0; corner < 4; corner += 1) {
    target._AddStaticCollisionShape(combatAlphaCornerShape(kCombatAlphaCurveRadius, kCombatAlphaHeight, corner, 0));
    target._AddStaticCollisionShape(combatAlphaCornerShape(kCombatAlphaCurveRadius, kCombatAlphaHeight, corner, 1));
    target._AddStaticCollisionShape(combatAlphaCornerShape(kCombatAlphaCurveRadius, kCombatAlphaHeight, corner, 2));
  }
  for (int panel = 0; panel < 4; panel += 1) target._AddStaticCollisionShape(combatAlphaPanel(panel));
  const btVector3 blockHalf((kArsenalBlockWidth / kArsenalPracticeScale) * UU_TO_BT / 2.f,
                            (kArsenalBlockDepth / kArsenalPracticeScale) * UU_TO_BT / 2.f,
                            (kArsenalBlockHeight / kArsenalPracticeScale) * UU_TO_BT / 2.f);
  auto* block = target._AddStaticCollisionShape(new btBoxShape(blockHalf), combatAlphaArenaPoint(kCombatBlockX, kCombatBlockY, kArsenalBlockHeight / 2.f));
  block->setFriction(RocketSim::RLConst::ARENA_COLLISION_BASE_FRICTION); block->setRestitution(RocketSim::RLConst::ARENA_COLLISION_BASE_RESTITUTION);
  auto* ramp = target._AddStaticCollisionShape(combatAlphaRampShape(), combatAlphaArenaPoint(kCombatRampX, kCombatRampY, 0));
  ramp->setFriction(RocketSim::RLConst::ARENA_COLLISION_BASE_FRICTION); ramp->setRestitution(RocketSim::RLConst::ARENA_COLLISION_BASE_RESTITUTION);
  addCombatAlphaCovers(target);
}

void resetCombatCar(uint32_t index) {
  RocketSim::Car* selected = cars[index];
  RocketSim::CarState state = selected->GetState();
  state.pos = index == 0
    ? RocketSim::Vec(0.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z)
    : RocketSim::Vec(-600.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z);
  state.rotMat = RocketSim::RotMat::GetIdentity();
  state.vel = RocketSim::Vec();
  state.angVel = RocketSim::Vec();
  state.boost = RocketSim::RLConst::BOOST_MAX;
  state.isOnGround = true;
  state.hasJumped = false;
  state.isJumping = false;
  state.hasDoubleJumped = false;
  state.hasFlipped = false;
  state.isFlipping = false;
  state.airTime = 0;
  state.airTimeSinceJump = 0;
  state.jumpTime = 0;
  selected->SetState(state);
  selected->controls = RocketSim::CarControls();
}

void resetCombatAlphaCar(uint32_t index) {
  if (index >= cars.size() || !cars[index]) return;
  static const RocketSim::Vec positions[] = {
    RocketSim::Vec(-kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, -kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
    RocketSim::Vec(kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
    RocketSim::Vec(-kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
    RocketSim::Vec(kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, -kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
    RocketSim::Vec(-kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z),
    RocketSim::Vec(kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z),
  };
  RocketSim::Car* selected = cars[index];
  RocketSim::CarState state = selected->GetState();
  state.pos = positions[index];
  state.rotMat = RocketSim::Angle(index % 2 == 0 ? 0.f : kPi, 0.f, 0.f).ToRotMat();
  state.vel = RocketSim::Vec();
  state.angVel = RocketSim::Vec();
  state.boost = RocketSim::RLConst::BOOST_MAX;
  state.isOnGround = true;
  state.hasJumped = false;
  state.isJumping = false;
  state.hasDoubleJumped = false;
  state.hasFlipped = false;
  state.isFlipping = false;
  state.airTime = 0;
  state.airTimeSinceJump = 0;
  state.jumpTime = 0;
  selected->SetState(state);
  selected->controls = RocketSim::CarControls();
}

void containCombatAlphaLobbyCar(uint32_t index) {
  if (index >= cars.size() || !cars[index]) return;
  RocketSim::Car* selected = cars[index];
  RocketSim::CarState state = selected->GetState();
  bool changed = false;

  // RocketSim's contact solver owns the curved floor-to-wall transition. The
  // previous guard projected every sample onto a rectangular inset and then
  // reflected velocity at `halfExtent - vehicleRadius`; that is inside the
  // valid quarter-pipe arc, so calling this ABI after every lobby step stopped
  // cars at the curve and could turn a normal bump into a visible jump.
  // Containment is now a last-resort repair for a body that escaped the whole
  // static volume. Valid curve contacts are left byte-for-byte untouched.
  const auto containAxis = [&](float& position, float& velocity, float halfExtent) {
    const float hardLimit = halfExtent + kLobbyContainFloorMargin;
    if (std::abs(position) <= hardLimit) return;
    const float wallLimit = halfExtent - kLobbyContainVehicleRadius;
    position = position < 0.f ? -wallLimit : wallLimit;
    if ((position > 0.f && velocity > 0.f) || (position < 0.f && velocity < 0.f)) {
      velocity = -velocity * kLobbyContainBounce;
    }
    changed = true;
  };
  containAxis(state.pos.x, state.vel.x, kCombatAlphaHalfWidth);
  containAxis(state.pos.y, state.vel.y, kCombatAlphaHalfDepth);

  const float floorLimit = -kLobbyContainFloorMargin;
  const float ceilingLimit = kCombatAlphaHeight + kLobbyContainFloorMargin;
  if (state.pos.z < floorLimit) {
    state.pos.z = RocketSim::RLConst::CAR_SPAWN_REST_Z;
    if (state.vel.z < 0.f) state.vel.z = -state.vel.z * kLobbyContainBounce;
    state.isOnGround = true;
    changed = true;
  } else if (state.pos.z > ceilingLimit) {
    state.pos.z = ceilingLimit;
    if (state.vel.z > 0.f) state.vel.z = -state.vel.z * kLobbyContainBounce;
    changed = true;
  }
  if (changed) selected->SetState(state);
}

void resetCombatAlphaPairCar(uint32_t index) {
  RocketSim::Car* selected = cars[index];
  RocketSim::CarState state = selected->GetState();
  state.pos = index == 0
    ? RocketSim::Vec(kCombatAlphaPairHostSpawnX, kCombatAlphaPairHostSpawnY, RocketSim::RLConst::CAR_SPAWN_REST_Z)
    : RocketSim::Vec(kCombatAlphaPairPilotSpawnX, kCombatAlphaPairPilotSpawnY, RocketSim::RLConst::CAR_SPAWN_REST_Z);
  state.rotMat = RocketSim::Angle(index == 0 ? 0.f : kPi, 0.f, 0.f).ToRotMat();
  state.vel = RocketSim::Vec();
  state.angVel = RocketSim::Vec();
  state.boost = RocketSim::RLConst::BOOST_MAX;
  state.isOnGround = true;
  state.hasJumped = false;
  state.isJumping = false;
  state.hasDoubleJumped = false;
  state.hasFlipped = false;
  state.isFlipping = false;
  state.airTime = 0;
  state.airTimeSinceJump = 0;
  state.jumpTime = 0;
  selected->SetState(state);
  selected->controls = RocketSim::CarControls();
}

void deactivateCombatCar(uint32_t index) {
  RocketSim::Car* selected = cars[index];
  RocketSim::CarState state = selected->GetState();
  state.pos = RocketSim::Vec(0.f, 0.f, -10000.f);
  state.rotMat = RocketSim::RotMat::GetIdentity();
  state.vel = RocketSim::Vec();
  state.angVel = RocketSim::Vec();
  state.isOnGround = false;
  state.isJumping = false;
  state.isFlipping = false;
  selected->SetState(state);
  selected->controls = RocketSim::CarControls();
}

bool initArena(bool traceAirVoid, uint32_t carCount = 1, bool cleanGround = false, bool cleanWallContact = false, bool curvedPractice = false, bool combatLineup = false, bool combatAlpha = false, bool combatAlphaPair = false) {
  if (combatLineup && (traceAirVoid || cleanGround || cleanWallContact || curvedPractice || carCount != 2)) return false;
  if (curvedPractice && (traceAirVoid || cleanGround || cleanWallContact || combatLineup || combatAlphaPair || carCount != 1)) return false;
  // The one-car initializer remains the static-geometry diagnostic. The
  // roster initializer below uses the same arena and native spawn contract
  // for the full 1..6 car online authority.
  if (combatAlpha && (traceAirVoid || cleanGround || cleanWallContact || curvedPractice || combatLineup || combatAlphaPair || carCount < 1 || carCount > kMaxTraceCars)) return false;
  if (combatAlphaPair && (traceAirVoid || cleanGround || cleanWallContact || curvedPractice || combatLineup || combatAlpha || carCount != 2)) return false;
  const ActiveFixture requestedFixture = cleanWallContact
    ? ActiveFixture::CleanWallContact
    : cleanGround
      ? ActiveFixture::CleanGround
      : curvedPractice
        ? ActiveFixture::CurvedPractice
      : combatLineup
          ? ActiveFixture::CombatLineup
          : combatAlphaPair ? ActiveFixture::CombatAlphaPair
          : combatAlpha ? ActiveFixture::CombatAlpha
          : traceAirVoid ? ActiveFixture::AirVoid : ActiveFixture::Generic;
  // The ABI is intentionally single-arena. A caller must destroy before
  // requesting a different fixture so a successful status can never label an
  // old scene as clean-ground or air-void by accident.
  if (arena) return activeFixture == requestedFixture && !cars.empty() && cars.size() == carCount;
  if (carCount == 0 || carCount > kMaxTraceCars) return false;

  RocketSim::InitFromMem({}, true);
  // RocketSim's voxel broadphase is sized for its default arena. The expanded
  // combat-alpha shell exceeds those bounds, silently dropping far walls and
  // upper curves from contacts and ray queries. Use Bullet's tree broadphase
  // for the oversized production volume.
  RocketSim::ArenaConfig arenaConfig;
  if (combatAlpha || combatAlphaPair) arenaConfig.useCustomBroadphase = false;
  arena.reset(RocketSim::Arena::Create(RocketSim::GameMode::THE_VOID, arenaConfig, 120.0f));
  combatPads.clear();
  boostRegenDelayTicks.clear();
  boostRegenTicks.clear();
  boostBeforeStep.clear();
  if (!arena) {
    activeFixture = ActiveFixture::None;
    return false;
  }
  if (curvedPractice) {
    addArsenalCurvedPracticeArena(*arena);
  } else if (combatAlpha || combatAlphaPair) {
    addCombatAlphaArena(*arena);
  } else if (cleanGround || cleanWallContact || combatLineup) {
    addCleanArenaPlane(*arena, btVector3(0, 0, 1), btVector3(0, 0, 0));
    addCleanArenaPlane(*arena, btVector3(0, 0, -1), btVector3(0, 0, kCleanArenaHeight));
    addCleanArenaPlane(*arena, btVector3(1, 0, 0), btVector3(-kCleanArenaHalfExtent, 0, 0));
    addCleanArenaPlane(*arena, btVector3(-1, 0, 0), btVector3(kCleanArenaHalfExtent, 0, 0));
    addCleanArenaPlane(*arena, btVector3(0, 1, 0), btVector3(0, -kCleanArenaHalfExtent, 0));
    addCleanArenaPlane(*arena, btVector3(0, -1, 0), btVector3(0, kCleanArenaHalfExtent, 0));
  }
  if (combatAlpha) {
    // Keep boost consumption byte-for-byte aligned with the native R20
    // combat-alpha bridge. Without this mutator adjustment the position
    // trace still looks plausible, but boost diverges as soon as thrust is
    // applied, which hides authority mismatches behind matching geometry.
    auto mutator = arena->GetMutatorConfig();
    mutator.boostUsedPerSecond *= .78f;
    arena->SetMutatorConfig(mutator);
  }
  if (traceAirVoid || cleanGround || cleanWallContact || curvedPractice || combatLineup || combatAlpha || combatAlphaPair) {
    // Keep the ball outside this isolated fixture, matching the native bridge.
    // RocketSim uses x/y/z internally; the JSON adapter converts it to y-up.
    RocketSim::BallState ballState = arena->ball->GetState();
    ballState.pos = RocketSim::Vec(0.f, 0.f, 10000.f);
    ballState.vel = RocketSim::Vec();
    arena->ball->SetState(ballState);
  }

  cars.reserve(carCount);
  for (uint32_t index = 0; index < carCount; ++index) {
    const RocketSim::Team team = combatLineup || combatAlphaPair
      ? RocketSim::Team::BLUE
      : combatAlpha
        ? (index % 2 == 0 ? RocketSim::Team::BLUE : RocketSim::Team::ORANGE)
      : index % 2 == 0 ? RocketSim::Team::BLUE : RocketSim::Team::ORANGE;
    RocketSim::Car* next = arena->AddCar(team);
    if (!next) {
      cars.clear();
      car = nullptr;
      arena.reset();
      activeFixture = ActiveFixture::None;
      return false;
    }
    if (combatAlpha) {
      next->_rigidBody.setCcdMotionThreshold(kLobbyCcdMotionThresholdBT);
      next->_rigidBody.setCcdSweptSphereRadius(kLobbyCcdSweptRadiusBT);
    }
    cars.push_back(next);
    boostRegenDelayTicks.push_back(0);
    boostRegenTicks.push_back(0);
    boostBeforeStep.push_back(RocketSim::RLConst::BOOST_MAX);
    if (traceAirVoid || cleanGround || cleanWallContact || curvedPractice || combatLineup || combatAlpha || combatAlphaPair) {
      RocketSim::CarState state = next->GetState();
      if (combatLineup) {
        // Match the R20 `combat-lineup` harness exactly: a stationary target
        // at the origin and a same-team pursuer 600 UU behind, both facing +X.
        state.pos = index == 0
          ? RocketSim::Vec(0.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z)
          : RocketSim::Vec(-600.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z);
      } else if (curvedPractice || combatAlpha) {
        if (combatAlpha && carCount > 1) {
          static const RocketSim::Vec positions[] = {
            RocketSim::Vec(-kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, -kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
            RocketSim::Vec(kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
            RocketSim::Vec(-kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
            RocketSim::Vec(kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, -kCombatAlphaSpawnZOffset, RocketSim::RLConst::CAR_SPAWN_REST_Z),
            RocketSim::Vec(-kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z),
            RocketSim::Vec(kCombatAlphaHalfWidth * kCombatAlphaSpawnXRatio, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z),
          };
          state.pos = positions[index];
        } else {
          state.pos = RocketSim::Vec(0.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z);
        }
      } else if (combatAlphaPair) {
        // This isolated, diagnostic-only pair stays clear of the central
        // props but starts close enough to the enlarged wall that a normal
        // 2.1 s projectile lifetime reaches a real static curve. It is not
        // used for public roster spawns.
        state.pos = index == 0
          ? RocketSim::Vec(kCombatAlphaPairHostSpawnX, kCombatAlphaPairHostSpawnY, RocketSim::RLConst::CAR_SPAWN_REST_Z)
          : RocketSim::Vec(kCombatAlphaPairPilotSpawnX, kCombatAlphaPairPilotSpawnY, RocketSim::RLConst::CAR_SPAWN_REST_Z);
      } else {
        // Keep capacity/ground fixtures from accidentally becoming a
        // collision test. Preserve the pre-existing air-void reference.
        state.pos = (cleanGround || cleanWallContact)
          ? RocketSim::Vec(static_cast<float>(index) * 700.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z)
          : carCount == 1
            ? RocketSim::Vec(-1250.f, 0.f, 1000.f)
            : RocketSim::Vec(-3000.f + static_cast<float>(index) * 1200.f,
                             static_cast<float>(index % 2) * 900.f,
                             1000.f + static_cast<float>(index % 3) * 150.f);
      }
      state.rotMat = (combatAlphaPair || (combatAlpha && carCount > 1))
        ? RocketSim::Angle(index % 2 == 0 ? 0.f : kPi, 0.f, 0.f).ToRotMat()
        : RocketSim::RotMat::GetIdentity();
      state.vel = RocketSim::Vec();
      state.angVel = RocketSim::Vec();
      state.boost = RocketSim::RLConst::BOOST_MAX;
      if (combatAlphaPair || (combatAlpha && carCount > 1)) {
        state.isOnGround = true;
        state.hasJumped = false;
        state.isJumping = false;
        state.hasDoubleJumped = false;
        state.hasFlipped = false;
        state.isFlipping = false;
        state.airTime = 0;
        state.airTimeSinceJump = 0;
        state.jumpTime = 0;
      }
      next->SetState(state);
      next->controls = RocketSim::CarControls();
    }
  }
  car = cars.front();
  if (cleanGround || cleanWallContact || curvedPractice || combatLineup || combatAlpha || combatAlphaPair) {
    arena->Step(120);
    // The public bridge labels the first post-settle request as tick 1. Keep
    // this opt-in trace on that same external timeline without changing the
    // production bridge or simulation step contract.
    arena->tickCount = 0;
  }
  // Combat-alpha deliberately has no pickup colliders. Boost regeneration is
  // applied after each RocketSim step and is visible in the same native
  // snapshot as movement and contacts.
  activeFixture = requestedFixture;
  return true;
}
}

struct PresentationQuaternion {
  float x = 0;
  float y = 0;
  float z = 0;
  float w = 1;
};

PresentationQuaternion quaternionFromArsenalBasis(const RocketSim::RotMat& basis) {
  // RocketSim is Z-up; Combat Cars exposes an Arsenal/Three.js Y-up basis.
  // Keep this conversion identical to the native bridge so online presentation
  // never has to reconstruct an attitude from yaw alone.
  const RocketSim::Vec forward(basis.forward.x, basis.forward.z, basis.forward.y);
  const RocketSim::Vec up(basis.up.x, basis.up.z, basis.up.y);
  const RocketSim::Vec right(basis.right.x, basis.right.z, basis.right.y);
  const float m00 = forward.x, m01 = up.x, m02 = right.x;
  const float m10 = forward.y, m11 = up.y, m12 = right.y;
  const float m20 = forward.z, m21 = up.z, m22 = right.z;
  PresentationQuaternion result;
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

extern "C" {

int rs_set_controls_for_car(uint32_t index, float forward, float steer, float jump, float boost);
int rs_snapshot_car(uint32_t index, uint32_t* tick, float* out9);
int rs_snapshot_car_presentation(uint32_t index, uint32_t* tick, float* out28);

int rs_init() {
  return initArena(false) ? 1 : 0;
}

// This opt-in initializer exists only for comparing the isolated WASM binary
// with the native bridge's non-navigable `air-void` fixture.
int rs_init_trace_air_void() {
  return initArena(true) ? 1 : 0;
}

// Capacity-only fixture for the browser gate. It deliberately remains in
// THE_VOID until the real arena ABI and contact contract are validated.
int rs_init_trace_air_void_cars(uint32_t carCount) {
  return initArena(true, carCount) ? 1 : 0;
}

int rs_init_trace_clean_ground() {
  return initArena(false, 1, true) ? 1 : 0;
}

// Reuses the clean six-plane arena and its 120-step settle, while assigning a
// distinct fixture identity for the isolated +X wall-contact trace.
int rs_init_trace_clean_wall_contact() {
  return initArena(false, 1, false, true) ? 1 : 0;
}

// P2P-WASM-09: exact lower +X quarter-pipe from the native
// `arsenal-curved-practice` bridge profile. The initializer is opt-in so all
// pre-existing THE_VOID and six-plane fixtures retain their ABI behavior.
int rs_init_trace_curved_practice() {
  return initArena(false, 1, false, false, true) ? 1 : 0;
}

// P2P-WASM-06 compares same-team car bump impulse transfer against the R20
// `combat-lineup` fixture. The event is a state-based proxy, not carContact
// callback telemetry.
int rs_init_trace_combat_lineup() {
  return initArena(false, 2, false, false, false, true) ? 1 : 0;
}

// Deterministic contact fixtures reuse the production combat-alpha shell and
// only choose a stable starting pose for wall/ramp regression probes.
int rs_init_trace_combat_alpha_wall() {
  if (!initArena(false, 1, false, false, false, false, true) || !cars[0]) return 0;
  RocketSim::CarState state = cars[0]->GetState();
  state.pos = RocketSim::Vec(0.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z);
  state.rotMat = RocketSim::RotMat::GetIdentity();
  state.vel = RocketSim::Vec();
  state.angVel = RocketSim::Vec();
  state.isOnGround = true;
  cars[0]->SetState(state);
  cars[0]->controls = RocketSim::CarControls();
  return 1;
}

int rs_init_trace_combat_alpha_ramp() {
  if (!initArena(false, 1, false, false, false, false, true) || !cars[0]) return 0;
  RocketSim::CarState state = cars[0]->GetState();
  state.pos = RocketSim::Vec(-40.f / kArsenalPracticeScale,
                             20.f / kArsenalPracticeScale,
                             RocketSim::RLConst::CAR_SPAWN_REST_Z);
  state.rotMat = RocketSim::RotMat::GetIdentity();
  state.vel = RocketSim::Vec();
  state.angVel = RocketSim::Vec();
  state.isOnGround = true;
  cars[0]->SetState(state);
  cars[0]->controls = RocketSim::CarControls();
  return 1;
}

// COV-02: deterministic high-speed contact with the north container. The
// authored Arsenal coordinates are converted through the same scale used by
// the production combat-alpha shell, so this probes the real RocketSim box
// rather than a renderer-only placeholder.
int rs_init_trace_combat_alpha_cover_contact() {
  if (!initArena(false, 1, false, false, false, false, true) || !cars[0]) return 0;
  RocketSim::CarState state = cars[0]->GetState();
  state.pos = RocketSim::Vec(-90.f / kArsenalPracticeScale,
                             -58.f / kArsenalPracticeScale,
                             RocketSim::RLConst::CAR_SPAWN_REST_Z);
  state.rotMat = RocketSim::RotMat::GetIdentity();
  state.vel = RocketSim::Vec(RocketSim::RLConst::CAR_MAX_SPEED, 0.f, 0.f);
  state.angVel = RocketSim::Vec();
  state.isOnGround = true;
  cars[0]->SetState(state);
  cars[0]->controls = RocketSim::CarControls();
  return 1;
}

// COV-04: two-car lobby bump probe on the real combat-alpha shell. The
// production roster keeps its diagonal spawn contract; this test-only pose
// places both cars in the clear central lane so the probe exercises car-to-car
// RocketSim contact rather than the new cover boxes. It does not change the
// public host path or the authoritative lobby spawn layout.
int rs_init_trace_combat_alpha_lobby_bump() {
  if (!initArena(false, 2, false, false, false, false, true) || cars.size() < 2) return 0;
  static const RocketSim::Vec positions[] = {
    RocketSim::Vec(-600.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z),
    RocketSim::Vec(600.f, 0.f, RocketSim::RLConst::CAR_SPAWN_REST_Z),
  };
  for (uint32_t index = 0; index < 2; ++index) {
    RocketSim::CarState state = cars[index]->GetState();
    state.pos = positions[index];
    state.rotMat = index == 0
      ? RocketSim::RotMat::GetIdentity()
      : RocketSim::Angle(kPi, 0.f, 0.f).ToRotMat();
    state.vel = RocketSim::Vec();
    state.angVel = RocketSim::Vec();
    state.isOnGround = true;
    state.hasJumped = false;
    state.isJumping = false;
    state.hasDoubleJumped = false;
    state.hasFlipped = false;
    state.isFlipping = false;
    state.airTime = 0;
    state.airTimeSinceJump = 0;
    state.jumpTime = 0;
    state.boost = RocketSim::RLConst::BOOST_MAX;
    cars[index]->SetState(state);
    cars[index]->controls = RocketSim::CarControls();
  }
  return 1;
}

// P2P-WASM-15: full combat-alpha static geometry fixture. It intentionally
// exposes one neutral car only; the gate is for static ray parity, not combat.
int rs_init_trace_combat_alpha() {
  return initArena(false, 1, false, false, false, false, true) ? 1 : 0;
}

// P2P-WASM-MIGRATION-01: initialize the real combat-alpha roster. The arena
// geometry and native spawn layout are shared with the R20 local bridge; the
// caller chooses the active roster size (1..6) while the browser-side combat
// rules remain a separate, versioned layer until their C++ port is complete.
int rs_init_combat_alpha_roster(uint32_t carCount) {
  return initArena(false, carCount, false, false, false, false, true) ? 1 : 0;
}

// P2P-WASM-17: two BLUE cars on the native R20 combat-alpha spawn pair. This
// fixture has its own identity so the P2P15 single neutral car remains stable.
int rs_init_trace_combat_alpha_pair() {
  return initArena(false, 2, false, false, false, false, false, true) ? 1 : 0;
}

// P2P-WASM-11: test-only physical lifecycle parity for the native R20
// combat-lineup fixture. Indices are zero-based WASM car slots; the bridge's
// requested car id 2 is slot 1.
int rs_set_combat_active_car(uint32_t index, uint32_t active) {
  const bool supportsCombatLifecycle = activeFixture == ActiveFixture::CombatLineup
    || activeFixture == ActiveFixture::CombatAlphaPair
    || activeFixture == ActiveFixture::CombatAlpha;
  if (!arena || !supportsCombatLifecycle || index >= cars.size() || !cars[index] || active > 1) return 0;
  if (active == 1) {
    if (activeFixture == ActiveFixture::CombatAlpha) resetCombatAlphaCar(index);
    else if (activeFixture == ActiveFixture::CombatAlphaPair) resetCombatAlphaPairCar(index);
    else resetCombatCar(index);
  }
  else deactivateCombatCar(index);
  return 1;
}

int rs_respawn_car(uint32_t index) {
  const bool supportsCombatLifecycle = activeFixture == ActiveFixture::CombatLineup
    || activeFixture == ActiveFixture::CombatAlphaPair
    || activeFixture == ActiveFixture::CombatAlpha;
  if (!arena || !supportsCombatLifecycle || index >= cars.size() || !cars[index]) return 0;
  if (activeFixture == ActiveFixture::CombatAlpha) resetCombatAlphaCar(index);
  else if (activeFixture == ActiveFixture::CombatAlphaPair) resetCombatAlphaPairCar(index);
  else resetCombatCar(index);
  return 1;
}

// Movement-only lobby recovery. This is intentionally distinct from
// rs_respawn_car: it never chooses a spawn, clears action state, or emits a
// combat lifecycle transition. It only contains a tunneled body at the
// authoritative arena boundary and reflects its outward velocity.
int rs_contain_car(uint32_t index) {
  if (!arena || activeFixture != ActiveFixture::CombatAlpha || index >= cars.size() || !cars[index]) return 0;
  containCombatAlphaLobbyCar(index);
  return 1;
}

// The browser owns every online kill and respawn through its versioned combat
// authority. RocketSim's NORMAL demo mode would otherwise run a second,
// independent demolish/respawn cycle after the same superspeed impact. Keep
// its bump impulse, but let the browser decide whether that contact is a kill
// (active match) or merely a shove (waiting lobby).
int rs_set_authority_rules(uint32_t disableNativeDemos) {
  if (!arena || activeFixture != ActiveFixture::CombatAlpha || disableNativeDemos > 1) return 0;
  auto mutator = arena->GetMutatorConfig();
  mutator.demoMode = disableNativeDemos ? RocketSim::DemoMode::DISABLED : RocketSim::DemoMode::NORMAL;
  arena->SetMutatorConfig(mutator);
  return 1;
}

// Versioned capability guard for the Pages host. A pre-regeneration module
// with combat pickup logic must never silently run under the boost-regeneration
// game rules.
int rs_boost_regeneration_contract() {
  return activeFixture == ActiveFixture::CombatAlpha ? 1 : 0;
}

// Warm-up-only authority hook. The browser must never emulate this by
// changing its HUD: the refill mutates the native CarState and is therefore
// observable by every subsequent authoritative snapshot. Combat code does not
// call this operation once the roster has been promoted to an active round.
int rs_refill_car_boost(uint32_t index) {
  if (!arena || index >= cars.size() || !cars[index]) return 0;
  RocketSim::CarState state = cars[index]->GetState();
  state.boost = RocketSim::RLConst::BOOST_MAX;
  cars[index]->SetState(state);
  if (index < boostRegenDelayTicks.size()) boostRegenDelayTicks[index] = 0;
  if (index < boostRegenTicks.size()) boostRegenTicks[index] = 0;
  return 1;
}

void rs_destroy() {
  car = nullptr;
  cars.clear();
  combatPads.clear();
  boostRegenDelayTicks.clear();
  boostRegenTicks.clear();
  boostBeforeStep.clear();
  arena.reset();
  activeFixture = ActiveFixture::None;
}

int rs_set_controls(float forward, float steer, float jump, float boost) {
  return rs_set_controls_for_car(0, forward, steer, jump, boost);
}

int rs_set_controls_for_car(uint32_t index, float forward, float steer, float jump, float boost) {
  if (!arena || index >= cars.size() || !cars[index]) return 0;
  RocketSim::Car* selected = cars[index];
  selected->controls.throttle = forward;
  selected->controls.steer = steer;
  // Keep this compact ABI aligned with the bridge's four shared inputs. In
  // RocketSim, throttle also controls airborne pitch and steer controls yaw.
  selected->controls.pitch = -forward;
  selected->controls.yaw = steer;
  selected->controls.jump = jump >= 0.5f;
  selected->controls.boost = boost >= 0.5f;
  selected->controls.ClampFix();
  return 1;
}

// Full gameplay ABI. The legacy four-field function above remains intact for
// existing diagnostic fixtures; the online authority uses this entrypoint so
// air pitch/yaw, directional roll and handbrake are not silently discarded.
int rs_set_controls_for_car_full(uint32_t index, float throttle, float steer, float pitch, float yaw, float roll, float jump, float boost, float handbrake) {
  if (!arena || index >= cars.size() || !cars[index]) return 0;
  RocketSim::Car* selected = cars[index];
  selected->controls.throttle = std::clamp(throttle, -1.f, 1.f);
  selected->controls.steer = std::clamp(steer, -1.f, 1.f);
  selected->controls.pitch = std::clamp(pitch, -1.f, 1.f);
  selected->controls.yaw = std::clamp(yaw, -1.f, 1.f);
  selected->controls.roll = std::clamp(roll, -1.f, 1.f);
  selected->controls.jump = jump >= 0.5f;
  selected->controls.boost = boost >= 0.5f;
  selected->controls.handbrake = handbrake >= 0.5f;
  selected->controls.ClampFix();
  return 1;
}

int rs_step() {
  if (!arena || cars.empty()) return 0;
  if (activeFixture == ActiveFixture::CombatAlpha) captureCombatBoostBeforeStep();
  arena->Step(1);
  if (activeFixture == ActiveFixture::CombatAlpha) updateCombatBoostRegeneration();
  return 1;
}

// Writes [position xyz, velocity xyz, forward xyz] and the low 32 tick bits.
// The caller supplies linear memory; no RocketSim pointer or C++ object crosses the ABI.
int rs_snapshot(uint32_t* tick, float* out9) {
  return rs_snapshot_car(0, tick, out9);
}

int rs_snapshot_car(uint32_t index, uint32_t* tick, float* out9) {
  if (!arena || index >= cars.size() || !cars[index] || !tick || !out9) return 0;
  const RocketSim::CarState state = cars[index]->GetState();
  *tick = static_cast<uint32_t>(arena->tickCount);
  const float values[9] = {
    state.pos.x, state.pos.y, state.pos.z,
    state.vel.x, state.vel.y, state.vel.z,
    state.rotMat.forward.x, state.rotMat.forward.y, state.rotMat.forward.z
  };
  for (int i = 0; i < 9; ++i) {
    if (!std::isfinite(values[i])) return 0;
    out9[i] = values[i];
  }
  return 1;
}

// P2P-WASM-40: authoritative physical telemetry for the future online
// renderer. The legacy nine-float ABI remains unchanged. The extended layout
// is [position xyz, velocity xyz, quaternion xyzw, boost, grounded,
// wheelCount, jumpsRemaining, boosting, supersonic, handbrake,
// localAngular pitch/yaw/roll, wheelContact, wheelNormal xyz,
// worldContact, worldNormal xyz]. Position, velocity, quaternion and normals
// use the public Arsenal Y-up basis; localAngular is explicitly a chassis-
// local component and is not a world-space vector.
int rs_snapshot_car_presentation(uint32_t index, uint32_t* tick, float* out28) {
  if (!arena || index >= cars.size() || !cars[index] || !tick || !out28) return 0;
  const RocketSim::CarState state = cars[index]->GetState();
  const PresentationQuaternion orientation = quaternionFromArsenalBasis(state.rotMat);
  uint32_t wheelCount = 0;
  for (bool contact : state.wheelsWithContact) wheelCount += contact ? 1u : 0u;
  const btVector3 wheelNormal = cars[index]->_bulletVehicle.getUpwardsDirFromWheelContacts();
  const float localPitch = state.rotMat.right.Dot(state.angVel);
  const float localYaw = state.rotMat.up.Dot(state.angVel);
  const float localRoll = -state.rotMat.forward.Dot(state.angVel);
  const float jumpsRemaining = state.hasFlipped || state.hasDoubleJumped
    ? 0.f : (state.hasJumped ? 1.f : 2.f);
  const float values[28] = {
    state.pos.x, state.pos.z, state.pos.y,
    state.vel.x, state.vel.z, state.vel.y,
    orientation.x, orientation.y, orientation.z, orientation.w,
    state.boost,
    state.isOnGround ? 1.f : 0.f,
    static_cast<float>(wheelCount),
    jumpsRemaining,
    state.isBoosting ? 1.f : 0.f,
    state.isSupersonic ? 1.f : 0.f,
    state.handbrakeVal,
    localPitch, localYaw, localRoll,
    wheelCount > 0 ? 1.f : 0.f,
    wheelNormal.x(), wheelNormal.z(), wheelNormal.y(),
    state.worldContact.hasContact ? 1.f : 0.f,
    state.worldContact.contactNormal.x,
    state.worldContact.contactNormal.z,
    state.worldContact.contactNormal.y,
  };
  *tick = static_cast<uint32_t>(arena->tickCount);
  for (float value : values) if (!std::isfinite(value)) return 0;
  for (int index = 0; index < 28; index += 1) out28[index] = values[index];
  return 1;
}

// P2P-WASM-MIGRATION-02: the full authority layout keeps the presentation
// prefix byte-compatible and appends the RocketSim action state that the
// native bridge exposes to the local client.
// [28] hasJumped, [29] hasDoubleJumped, [30] hasFlipped,
// [31] secondJumpWindow, [32] dodgeTime, [33] dodgeForward, [34] dodgeSide,
// [35] isJumping, [36] isFlipping, [37] airTime, [38] airTimeSinceJump,
// [39] jumpTime.
int rs_snapshot_car_authority(uint32_t index, uint32_t* tick, float* out40) {
  if (!arena || index >= cars.size() || !cars[index] || !tick || !out40) return 0;
  if (rs_snapshot_car_presentation(index, tick, out40) != 1) return 0;
  const RocketSim::CarState state = cars[index]->GetState();
  const float values[12] = {
    state.hasJumped ? 1.f : 0.f,
    state.hasDoubleJumped ? 1.f : 0.f,
    state.hasFlipped ? 1.f : 0.f,
    state.hasJumped ? std::max(0.f, 1.25f - state.airTimeSinceJump) : 0.f,
    state.flipTime,
    state.hasFlipped ? state.flipRelTorque.y : 0.f,
    state.hasFlipped ? -state.flipRelTorque.x : 0.f,
    state.isJumping ? 1.f : 0.f,
    state.isFlipping ? 1.f : 0.f,
    state.airTime,
    state.airTimeSinceJump,
    state.jumpTime,
  };
  for (int offset = 0; offset < 12; offset += 1) {
    if (!std::isfinite(values[offset])) return 0;
    out40[28 + offset] = values[offset];
  }
  return 1;
}

// Compatibility ABI: combat-alpha no longer has pickup colliders.
int rs_snapshot_combat_pads(uint32_t* count, float* out30) {
  if (!arena || !count || !out30 || activeFixture != ActiveFixture::CombatAlpha) return 0;
  *count = 0;
  return 1;
}

} // extern "C"

struct StaticRayCallback final : btCollisionWorld::ClosestRayResultCallback {
  StaticRayCallback(const btVector3& from, const btVector3& to)
      : btCollisionWorld::ClosestRayResultCallback(from, to, nullptr) {}

  btScalar addSingleResult(btCollisionWorld::LocalRayResult& rayResult,
                           bool normalInWorldSpace) override {
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

StaticRayHit raycastStatic(RocketSim::Arena& target, const btVector3& from, const btVector3& to) {
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
    target._bulletWorld.rayTest(segmentFrom, segmentTo, callback);
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

extern "C" {

// P2P-WASM-13: query one static segment in the same public RocketSim Y-up
// coordinates used by the JSON bridge. The output is eight floats:
// [hit(0/1), fraction, point xyz, normal xyz]. The query never advances time,
// never considers dynamic cars and never exposes Bullet/RocketSim pointers.
int rs_raycast_static(float fromX, float fromY, float fromZ,
                      float toX, float toY, float toZ, float* out8) {
  if (!arena || !out8) return 0;
  const float inputs[6] = { fromX, fromY, fromZ, toX, toY, toZ };
  for (float value : inputs) if (!std::isfinite(value)) return 0;
  const btVector3 from(fromX * UU_TO_BT, fromZ * UU_TO_BT, fromY * UU_TO_BT);
  const btVector3 to(toX * UU_TO_BT, toZ * UU_TO_BT, toY * UU_TO_BT);
  const StaticRayHit result = raycastStatic(*arena, from, to);
  const btVector3 point = result.hit ? result.point : to;
  const btVector3 normal = result.hit ? result.normal : btVector3(0, 0, 0);
  const float values[8] = {
    result.hit ? 1.f : 0.f,
    static_cast<float>(result.fraction),
    point.x() / UU_TO_BT, point.z() / UU_TO_BT, point.y() / UU_TO_BT,
    normal.x(), normal.z(), normal.y(),
  };
  for (float value : values) if (!std::isfinite(value)) return 0;
  for (int index = 0; index < 8; index += 1) out8[index] = values[index];
  return 1;
}

int rs_is_grounded_car(uint32_t index) {
  if (!arena || index >= cars.size() || !cars[index]) return 0;
  return cars[index]->GetState().isOnGround ? 1 : 0;
}

// Contact telemetry is an independent ABI. Keep the nine-float snapshot
// layout stable; normals remain in RocketSim's native z-up basis here.
int rs_body_contact_car(uint32_t index, uint32_t* outHasContact, float* outNormal3) {
  if (!arena || index >= cars.size() || !cars[index] || !outHasContact || !outNormal3) return 0;
  const RocketSim::CarState state = cars[index]->GetState();
  const float normal[3] = { state.worldContact.contactNormal.x, state.worldContact.contactNormal.y, state.worldContact.contactNormal.z };
  for (int component = 0; component < 3; ++component) {
    if (!std::isfinite(normal[component])) return 0;
    outNormal3[component] = normal[component];
  }
  *outHasContact = state.worldContact.hasContact ? 1u : 0u;
  return 1;
}

// Writes the bridge-compatible wheel-support telemetry. The normal is kept in
// RocketSim's native z-up basis; the curved trace contract performs the same
// y/z exchange as the JSON bridge before comparing samples.
int rs_wheel_contact_car(uint32_t index, uint32_t* outHasContact, uint32_t* outWheelCount, float* outNormal3) {
  if (!arena || index >= cars.size() || !cars[index] || !outHasContact || !outWheelCount || !outNormal3) return 0;
  const RocketSim::CarState state = cars[index]->GetState();
  uint32_t wheelCount = 0;
  for (bool contact : state.wheelsWithContact) wheelCount += contact ? 1u : 0u;
  const btVector3 normal = cars[index]->_bulletVehicle.getUpwardsDirFromWheelContacts();
  const float values[3] = { normal.x(), normal.y(), normal.z() };
  for (int component = 0; component < 3; ++component) {
    if (!std::isfinite(values[component])) return 0;
    outNormal3[component] = values[component];
  }
  *outWheelCount = wheelCount;
  *outHasContact = wheelCount > 0 ? 1u : 0u;
  return 1;
}

}
