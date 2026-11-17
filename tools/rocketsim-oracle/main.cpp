// Asset-free RocketSim reference probe for Combat Cars.
// It is a development oracle only. It neither launches Rocket League nor reads
// game assets; THE_VOID receives one synthetic Bullet floor for wheel contact.

#include "RocketSim.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

using namespace RocketSim;

namespace {

constexpr int kFixedStepHz = 120;
constexpr int kSettleFrames = 120;

struct ArsenalInput {
  float throttle = 0;
  float steer = 0;
  float roll = 0;
  bool jump = false;
  bool boost = false;
  bool drift = false;
};

struct Phase {
  int frames;
  ArsenalInput input;
};

using Schedule = std::vector<Phase>;

struct ContactSetup {
  float height = 8.f;
  float pitch = 0.f;
  float roll = 0.f;
};

ArsenalInput input(float throttle = 0, float steer = 0, float roll = 0,
                   bool jump = false, bool boost = false, bool drift = false) {
  return { throttle, steer, roll, jump, boost, drift };
}

CarControls toRocketSimControls(const ArsenalInput& source) {
  CarControls controls;
  controls.throttle = source.throttle;
  controls.steer = source.steer;
  // Arsenal's W/S throttle becomes RocketSim pitch while airborne. The sign
  // maps W to lowering the nose, as in the project's control contract.
  controls.pitch = -source.throttle;
  controls.yaw = source.steer;
  controls.roll = source.roll;
  controls.jump = source.jump;
  controls.boost = source.boost;
  controls.handbrake = source.drift;
  return controls;
}

std::string jumpState(const CarState& state) {
  if (state.isOnGround) return "grounded";
  if (state.isFlipping) return "dodge";
  if (state.isJumping) return "first-jump";
  if (state.hasDoubleJumped) return "double-jump";
  return "airborne";
}

void printBool(bool value) {
  std::cout << (value ? "true" : "false");
}

void printInput(const ArsenalInput& value) {
  std::cout << "{\"throttle\":" << value.throttle
            << ",\"steer\":" << value.steer
            << ",\"jump\":";
  printBool(value.jump);
  std::cout << ",\"boost\":";
  printBool(value.boost);
  std::cout << ",\"drift\":";
  printBool(value.drift);
  std::cout << ",\"airRoll\":false,\"roll\":" << value.roll << "}";
}

void printSample(int frame, const ArsenalInput& source, const CarState& state) {
  // Arsenal uses y for altitude in its trace schema. RocketSim is z-up, so
  // map (x, y, z) to Arsenal's (x, z, y) without changing source units.
  const float dodgeForward = state.hasFlipped ? state.flipRelTorque.y : 0.f;
  const float dodgeSide = state.hasFlipped ? -state.flipRelTorque.x : 0.f;
  // Bullet stores angular velocity in world coordinates. Keep the historical
  // field for the R1 ground trace, and also expose the three controller axes
  // in the current local chassis frame for aerial calibration.
  // Arsenal stores a positive pitch rate for a nose-down rotation.  This is
  // the same controller convention once RocketSim's local right vector is
  // projected without the extra sign used by Bullet's world presentation.
  const float localPitchRate = state.rotMat.right.Dot(state.angVel);
  const float localYawRate = state.rotMat.up.Dot(state.angVel);
  const float localRollRate = -state.rotMat.forward.Dot(state.angVel);

  std::cout << "{\"frame\":" << frame
            << ",\"time\":" << (static_cast<double>(frame) / kFixedStepHz)
            << ",\"input\":";
  printInput(source);
  std::cout << ",\"state\":{"
            << "\"position\":{\"x\":" << state.pos.x
            << ",\"y\":" << state.pos.z
            << ",\"z\":" << state.pos.y << "}"
            << ",\"velocity\":{\"x\":" << state.vel.x
            << ",\"y\":" << state.vel.z
            << ",\"z\":" << state.vel.y << "}"
            << ",\"angularVelocity\":{\"pitch\":" << state.angVel.x
            << ",\"yaw\":" << state.angVel.z
            << ",\"roll\":" << state.angVel.y << "}"
            << ",\"localAngularVelocity\":{\"pitch\":" << localPitchRate
            << ",\"yaw\":" << localYawRate
            << ",\"roll\":" << localRollRate << "}"
            << ",\"orientation\":{\"forward\":{\"x\":" << state.rotMat.forward.x
            << ",\"y\":" << state.rotMat.forward.z
            << ",\"z\":" << state.rotMat.forward.y << "}"
            << ",\"up\":{\"x\":" << state.rotMat.up.x
            << ",\"y\":" << state.rotMat.up.z
            << ",\"z\":" << state.rotMat.up.y << "}}"
            << ",\"grounded\":";
  printBool(state.isOnGround);
  std::cout << ",\"jumpState\":\"" << jumpState(state) << "\""
            << ",\"jumps\":" << (state.hasFlipped || state.hasDoubleJumped ? 0 : (state.hasJumped ? 1 : 2))
            << ",\"secondJumpWindow\":" << (state.hasJumped ? std::max(0.f, 1.25f - state.airTimeSinceJump) : 0.f)
            << ",\"dodgeTime\":" << state.flipTime
            << ",\"dodgeDirection\":{\"forward\":" << dodgeForward
            << ",\"side\":" << dodgeSide << "}"
            << ",\"actionSerials\":{\"jump\":" << (state.hasJumped ? 1 : 0)
            << ",\"doubleJump\":" << (state.hasDoubleJumped ? 1 : 0)
            << ",\"dodge\":" << (state.hasFlipped ? 1 : 0)
            << ",\"respawn\":0}}}";
}

std::unique_ptr<Arena> createPracticeArena() {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));

  auto* floor = arena->_AddStaticCollisionShape(new btStaticPlaneShape(btVector3(0, 0, 1), 0));
  floor->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
  floor->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);

  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);

  Car* car = arena->AddCar(Team::BLUE);
  CarState state = car->GetState();
  state.pos = Vec(0, 0, RLConst::CAR_SPAWN_REST_Z);
  state.rotMat = RotMat::GetIdentity();
  state.vel = Vec();
  state.angVel = Vec();
  state.boost = RLConst::BOOST_MAX;
  car->SetState(state);

  car->controls = CarControls();
  arena->Step(kSettleFrames);
  return arena;
}

std::unique_ptr<Arena> createContactPracticeArena(const ContactSetup& setup) {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));
  auto* floor = arena->_AddStaticCollisionShape(new btStaticPlaneShape(btVector3(0, 0, 1), 0));
  floor->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
  floor->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);

  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);

  Car* car = arena->AddCar(Team::BLUE);
  CarState state = car->GetState();
  state.pos = Vec(0, 0, RLConst::CAR_SPAWN_REST_Z + setup.height);
  state.rotMat = Angle(0.f, setup.pitch, setup.roll).ToRotMat();
  state.vel = Vec();
  state.angVel = Vec();
  state.isOnGround = setup.height == 0.f;
  state.hasJumped = false;
  state.hasDoubleJumped = false;
  state.hasFlipped = false;
  state.isJumping = false;
  state.isFlipping = false;
  state.boost = RLConst::BOOST_MAX;
  car->SetState(state);
  car->controls = CarControls();
  return arena;
}

std::unique_ptr<Arena> createAirPracticeArena() {
  auto arena = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, {}, kFixedStepHz));
  BallState ball = arena->ball->GetState();
  ball.pos = Vec(0, 0, 10000);
  ball.vel = Vec();
  arena->ball->SetState(ball);

  Car* car = arena->AddCar(Team::BLUE);
  CarState state = car->GetState();
  state.pos = Vec(0, 0, 1000);
  state.rotMat = RotMat::GetIdentity();
  state.vel = Vec();
  state.angVel = Vec();
  state.boost = RLConst::BOOST_MAX;
  car->SetState(state);
  car->controls = CarControls();
  return arena;
}

std::unique_ptr<Arena> createSecondActionAirPracticeArena() {
  auto arena = createAirPracticeArena();
  Car* car = *arena->GetCars().begin();
  CarState state = car->GetState();
  // The car has already left the ground after a first jump. Keeping it high
  // avoids a collision with the synthetic floor while measuring the second
  // action itself; no arena asset is involved.
  state.isOnGround = false;
  state.hasJumped = true;
  state.isJumping = false;
  state.hasDoubleJumped = false;
  state.hasFlipped = false;
  state.isFlipping = false;
  state.airTime = .1f;
  state.airTimeSinceJump = .1f;
  state.jumpTime = RLConst::JUMP_MAX_TIME;
  car->SetState(state);
  return arena;
}

void printTrace(const std::string& id, const Schedule& schedule, bool airborne = false, bool secondActionReady = false) {
  auto arena = secondActionReady ? createSecondActionAirPracticeArena()
             : airborne ? createAirPracticeArena() : createPracticeArena();
  Car* car = *arena->GetCars().begin();
  int frame = 0;
  bool first = true;

  std::cout << "\"" << id << "\":{\"name\":\"" << id
            << "\",\"fixedStepHz\":" << kFixedStepHz
            << ",\"durationSeconds\":1.2,\"markers\":[],\"samples\":[";
  for (const Phase& phase : schedule) {
    for (int i = 0; i < phase.frames; ++i) {
      car->controls = toRocketSimControls(phase.input);
      arena->Step();
      if (!first) std::cout << ',';
      first = false;
      printSample(++frame, phase.input, car->GetState());
    }
  }
  std::cout << "]}";
}

void printContactSample(int frame, const ArsenalInput& source, Car* car, const CarState& state) {
  int loadedWheelCount = 0;
  for (bool inContact : state.wheelsWithContact) loadedWheelCount += inContact ? 1 : 0;
  const bool bodyContact = state.worldContact.hasContact;
  const bool wheelSupport = loadedWheelCount >= 2;
  const bool floorContact = bodyContact || loadedWheelCount > 0;
  const Vec normal = bodyContact ? state.worldContact.contactNormal : Vec(0, 0, 1);
  const float normalSpeed = state.vel.Dot(normal);
  const float tangentSpeed = std::sqrt(std::max(0.f, state.vel.LengthSq() - normalSpeed * normalSpeed));

  std::cout << "{\"frame\":" << frame
            << ",\"time\":" << (static_cast<double>(frame) / kFixedStepHz)
            << ",\"input\":";
  printInput(source);
  std::cout << ",\"state\":{"
            << "\"position\":{\"x\":" << state.pos.x
            << ",\"y\":" << state.pos.z
            << ",\"z\":" << state.pos.y << "}"
            << ",\"velocity\":{\"x\":" << state.vel.x
            << ",\"y\":" << state.vel.z
            << ",\"z\":" << state.vel.y << "}"
            << ",\"angularVelocity\":{\"pitch\":" << state.angVel.x
            << ",\"yaw\":" << state.angVel.z
            << ",\"roll\":" << state.angVel.y << "}"
            << ",\"localAngularVelocity\":{\"pitch\":" << state.rotMat.right.Dot(state.angVel)
            << ",\"yaw\":" << state.rotMat.up.Dot(state.angVel)
            << ",\"roll\":" << -state.rotMat.forward.Dot(state.angVel) << "}"
            << ",\"orientation\":{\"forward\":{\"x\":" << state.rotMat.forward.x
            << ",\"y\":" << state.rotMat.forward.z
            << ",\"z\":" << state.rotMat.forward.y << "}"
            << ",\"up\":{\"x\":" << state.rotMat.up.x
            << ",\"y\":" << state.rotMat.up.z
            << ",\"z\":" << state.rotMat.up.y << "}}"
            << ",\"grounded\":";
  printBool(state.isOnGround);
  std::cout << ",\"jumpState\":\"" << jumpState(state) << "\""
            << ",\"jumps\":" << (state.hasFlipped || state.hasDoubleJumped ? 0 : (state.hasJumped ? 1 : 2))
            << ",\"bodyContact\":";
  printBool(bodyContact);
  std::cout << ",\"wheelSupport\":";
  printBool(wheelSupport);
  std::cout << ",\"loadedWheelCount\":" << loadedWheelCount
            << ",\"normalSpeed\":" << normalSpeed
            << ",\"tangentSpeed\":" << tangentSpeed
            << ",\"contacts\":[";
  if (floorContact) {
    std::cout << "{\"kind\":\"floor\",\"normal\":{\"x\":" << normal.x
              << ",\"y\":" << normal.z
              << ",\"z\":" << normal.y
              << "},\"wheelCount\":" << loadedWheelCount
              << ",\"bodyContact\":";
    printBool(bodyContact);
    std::cout << "}";
  }
  std::cout << "],\"wheels\":[";
  const char* wheelNames[] = { "frontLeft", "frontRight", "rearLeft", "rearRight" };
  for (int i = 0; i < 4; ++i) {
    if (i) std::cout << ',';
    const auto& wheel = car->_bulletVehicle.getWheelInfo(i);
    const float restLength = wheel.getSuspensionRestLength();
    const float suspensionLength = wheel.m_raycastInfo.m_suspensionLength;
    const float compression = std::max(0.f, restLength - suspensionLength);
    const float maxTravel = std::max(0.0001f, wheel.m_maxSuspensionTravelCm / 100.f);
    std::cout << "{\"id\":\"" << wheelNames[i] << "\",\"kind\":";
    if (state.wheelsWithContact[i]) std::cout << "\"floor\"";
    else std::cout << "null";
    std::cout << ",\"loaded\":";
    printBool(state.wheelsWithContact[i]);
    std::cout << ",\"suspensionLength\":" << suspensionLength
              << ",\"restLength\":" << restLength
              << ",\"compression\":" << compression
              << ",\"normalizedCompression\":" << std::min(1.f, compression / maxTravel)
              << ",\"suspensionForce\":" << wheel.m_wheelsSuspensionForce
              << "}";
  }
  std::cout << "]}}";
}

void printContactTrace(const std::string& id, const ContactSetup& setup,
                       const Schedule& schedule, int frames = 300) {
  auto arena = createContactPracticeArena(setup);
  Car* car = *arena->GetCars().begin();
  int frame = 0;
  bool first = true;

  std::cout << "\"" << id << "\":{\"name\":\"" << id
            << "\",\"fixedStepHz\":" << kFixedStepHz
            << ",\"durationSeconds\":" << (static_cast<double>(frames) / kFixedStepHz)
            << ",\"setup\":{\"height\":" << setup.height
            << ",\"pitch\":" << setup.pitch
            << ",\"roll\":" << setup.roll << "},\"samples\":[";
  for (const Phase& phase : schedule) {
    for (int i = 0; i < phase.frames && frame < frames; ++i) {
      car->controls = toRocketSimControls(phase.input);
      arena->Step();
      if (!first) std::cout << ',';
      first = false;
      printContactSample(++frame, phase.input, car, car->GetState());
    }
  }
  while (frame < frames) {
    const ArsenalInput neutral = input();
    car->controls = toRocketSimControls(neutral);
    arena->Step();
    if (!first) std::cout << ',';
    first = false;
    printContactSample(++frame, neutral, car, car->GetState());
  }
  std::cout << "]}";
}

} // namespace

int main() {
  RocketSim::InitFromMem({}, true);
  std::cout << std::fixed << std::setprecision(6);

  const Schedule groundControl = {
    { 48, input(1) },
    { 24, input(1, 1) },
    { 24, input(1, 1, 0, false, false, true) },
    { 48, input() }
  };
  const Schedule firstJump = {
    { 24, input(0, 0, 0, true) },
    { 120, input() }
  };
  const Schedule doubleJump = {
    { 1, input(0, 0, 0, true) },
    { 10, input() },
    { 1, input(0, 0, 0, true) },
    { 132, input() }
  };
  const Schedule dodgeForward = {
    { 1, input(0, 0, 0, true) },
    { 10, input() },
    { 1, input(1, 0, 0, true) },
    { 132, input() }
  };
  const Schedule dodgeSide = {
    { 1, input(0, 0, 0, true) },
    { 10, input() },
    { 1, input(0, 1, 0, true) },
    { 132, input() }
  };
  const Schedule dodgeDiagonalRoll = {
    { 1, input(0, 0, 0, true) },
    { 10, input() },
    { 1, input(1, 1, 1, true) },
    { 132, input() }
  };
  const Schedule airAxes = {
    { 36, input(1, 1, 1) },
    { 36, input() },
    { 36, input(-1, -1, -1) },
    { 36, input() }
  };
  const Schedule airPitch = {
    { 36, input(1) }, { 36, input() },
    { 36, input(-1) }, { 36, input() }
  };
  const Schedule airYaw = {
    { 36, input(0, 1) }, { 36, input() },
    { 36, input(0, -1) }, { 36, input() }
  };
  const Schedule airRoll = {
    { 36, input(0, 0, 1) }, { 36, input() },
    { 36, input(0, 0, -1) }, { 36, input() }
  };
  const Schedule airSecondAction = {
    { 11, input() }, { 1, input(0, 0, 0, true) }, { 132, input() }
  };
  const Schedule airDodgeForward = {
    { 11, input() }, { 1, input(1, 0, 0, true) }, { 132, input() }
  };
  const Schedule airDodgeSide = {
    { 11, input() }, { 1, input(0, 1, 0, true) }, { 132, input() }
  };
  const Schedule airDodgeDiagonalRoll = {
    { 11, input() }, { 1, input(1, 1, 1, true) }, { 132, input() }
  };

  std::cout << "{\"schemaVersion\":1"
            << ",\"source\":\"RocketSim asset-free R1/R4 oracle\""
            << ",\"fixedStepHz\":" << kFixedStepHz
            << ",\"profile\":\"the-void-synthetic-floor\""
            << ",\"notes\":[\"No Rocket League executable or assets were used.\",\"THE_VOID uses a synthetic Bullet floor only for wheel-contact smoke validation.\",\"R4 contact traces use the same floor and six transition schedules as Arsenal M4-01.\"]"
            << ",\"traces\":{";
  printTrace("groundControl", groundControl);
  std::cout << ',';
  printTrace("firstJump", firstJump);
  std::cout << ',';
  printTrace("doubleJump", doubleJump);
  std::cout << ',';
  printTrace("dodgeForward", dodgeForward);
  std::cout << ',';
  printTrace("dodgeSide", dodgeSide);
  std::cout << ',';
  printTrace("dodgeDiagonalRoll", dodgeDiagonalRoll);
  std::cout << ',';
  printTrace("airAxes", airAxes, true);
  std::cout << ',';
  printTrace("airPitch", airPitch, true);
  std::cout << ',';
  printTrace("airYaw", airYaw, true);
  std::cout << ',';
  printTrace("airRoll", airRoll, true);
  std::cout << ',';
  printTrace("airDoubleJump", airSecondAction, false, true);
  std::cout << ',';
  printTrace("airDodgeForward", airDodgeForward, false, true);
  std::cout << ',';
  printTrace("airDodgeSide", airDodgeSide, false, true);
  std::cout << ',';
  printTrace("airDodgeDiagonalRoll", airDodgeDiagonalRoll, false, true);
  const Schedule contactDrop = { { 300, input() } };
  const Schedule contactDodgeForward = {
    { 1, input(0, 0, 0, true) }, { 10, input() },
    { 1, input(1, 0, 0, true) }, { 288, input() }
  };
  const Schedule contactDodgeSide = {
    { 1, input(0, 0, 0, true) }, { 10, input() },
    { 1, input(0, 1, 0, true) }, { 288, input() }
  };
  const Schedule contactDodgeDiagonalRoll = {
    { 1, input(0, 0, 0, true) }, { 10, input() },
    { 1, input(1, 1, 1, true) }, { 288, input() }
  };
  std::cout << "},\"contactTraces\":{";
  printContactTrace("flat-drop", { 30.f, 0.f, 0.f }, contactDrop);
  std::cout << ',';
  printContactTrace("pitch-drop", { 30.f, .28f, 0.f }, contactDrop);
  std::cout << ',';
  printContactTrace("roll-drop", { 30.f, 0.f, -.24f }, contactDrop);
  std::cout << ',';
  printContactTrace("dodge-forward-landing", { 0.f, 0.f, 0.f }, contactDodgeForward);
  std::cout << ',';
  printContactTrace("dodge-side-landing", { 0.f, 0.f, 0.f }, contactDodgeSide);
  std::cout << ',';
  printContactTrace("dodge-diagonal-roll-landing", { 0.f, 0.f, 0.f }, contactDodgeDiagonalRoll);
  std::cout << "}}\n";
}

