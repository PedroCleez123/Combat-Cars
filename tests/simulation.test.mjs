import assert from "node:assert/strict";
import test from "node:test";
import { ArenaMatch, ARENA, driveTorqueFactorFromSpeed, powerslideSteeringAngleFromSpeed, steeringAngleFromSpeed } from "../src/simulation.js";
import { runMobilityProbes } from "../src/mobility-probes.js";
import { runContactTransitionProbes } from "../src/contact-transition-probes.js";

function isolate(match, car) {
  for (const other of match.cars) if (other !== car) other.respawn = 99;
}

function rotateByQuaternion(q, v) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

test("the default arena seeds five bots and completes a 3v3 roster for the first pilot", () => {
  const match = new ArenaMatch();
  assert.equal(match.cars.length, 5);
  assert.equal(match.cars.filter(car => car.isBot).length, 5);
  const pilot = match.addHuman("pilot-1", "PEDRO");
  assert.equal(pilot.isBot, false);
  assert.equal(match.cars.length, 6);
  assert.equal(match.cars.filter(car => car.isBot).length, 5);
  assert.equal(match.cars.filter(car => !car.isBot).length, 1);
});

test("match settings support a solo practice session and a selected bot count", () => {
  const match = new ArenaMatch(1, { vehicleLimit: 1, botCount: 0 });
  assert.equal(match.cars.length, 0);
  const pilot = match.addHuman("pilot-1");
  assert.equal(match.cars.length, 1);
  assert.equal(match.cars[0].isBot, false);
  assert.deepEqual(match.snapshot().settings, { vehicleLimit: 1, botCount: 0, arena: "scrapyard", humans: 1, bots: 0, profile: "DESGUACE" });

  match.configure({ vehicleLimit: 4, botCount: 2 });
  assert.equal(match.cars.length, 3);
  assert.equal(match.cars.filter(car => car.isBot).length, 2);
  assert.deepEqual(match.snapshot().settings, { vehicleLimit: 4, botCount: 2, arena: "scrapyard", humans: 1, bots: 2, profile: "DESGUACE" });
});

test("the calibration profile is a clean solo arena with continuous boost", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 6, botCount: 5 });
  assert.equal(match.cars.length, 0, "calibration must not seed bots");
  assert.equal(match.pads.length, 0, "calibration must not seed boost pads");
  const car = match.addHuman("pilot-1");
  const state = match.snapshot();
  assert.deepEqual(state.settings, { vehicleLimit: 1, botCount: 0, arena: "calibration", humans: 1, bots: 0, profile: "CALIBRACIÓN LIMPIA" });
  assert.deepEqual(state.rules, { pads: false, combat: false, unlimitedBoost: true, ramps: false, covers: false });

  // This is a legacy ramp position. In CAL-01 it must still be flat floor.
  Object.assign(car, { x: -31, z: -8, h: 0, vx: 0, vz: 0, vh: 0, boost: 12 });
  const flatMatch = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const flatCar = flatMatch.addHuman("flat-reference");
  Object.assign(flatCar, { h: 0, vx: 0, vz: 0, vh: 0 });
  match.input(car.id, { boost: true, fire: true });
  flatMatch.input(flatCar.id, {});
  match.tick(.05); flatMatch.tick(.05);
  assert.ok(Math.abs(car.h - flatCar.h) < .01,
    `a disabled ramp must match flat-floor suspension height, ramp=${car.h}, flat=${flatCar.h}`);
  assert.equal(car.boost, 12, "continuous boost must not consume the practice fuel value");
  assert.equal(match.rockets.length, 0, "combat is disabled in calibration");

  // This crosses the location of a legacy cover. It must be unobstructed.
  Object.assign(car, { x: -24, z: -19, h: 0, yaw: 0, vx: 42, vz: 0, vh: 0, boost: 12 });
  match.input(car.id, {});
  for (let i = 0; i < 20; i += 1) match.tick(1 / 120);
  assert.ok(car.x > -20, `disabled cover interfered with calibration, x=${car.x}`);
});

test("calibration chassis rests on the shared floor contact without vibration", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("floor-rest");
  match.input(car.id, {});
  for (let i = 0; i < 1200; i += 1) match.tick(1 / 120);

  assert.ok(Math.abs(car.h) < .002, `resting root height drifted to ${car.h}`);
  assert.ok(Math.abs(car.vh) < .002, `resting vertical velocity drifted to ${car.vh}`);
  const contact = match.snapshot().cars[0].contacts.find(item => item.kind === "floor");
  assert.ok(contact, "resting car must report a floor contact");
  assert.deepEqual(contact.normal, { x: 0, y: 1, z: 0 });
  assert.ok(Math.abs(contact.point.y) < .01, `floor contact point must lie on y=0, got ${contact.point.y}`);
  assert.ok(contact.wheelCount > 0, "FIS-12B floor support must be derived from wheel contacts");
});

test("calibration suspension settles after a flat drop and keeps four supported wheels", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("flat-drop");
  Object.assign(car, { h: 8, vh: 0 });
  match.input(car.id, {});

  let landed = false;
  const settleHeights = [];
  for (let frame = 0; frame < 600; frame += 1) {
    match.tick(1 / 120);
    landed ||= car.grounded;
    if (frame >= 540) settleHeights.push(car.h);
  }

  const state = match.snapshot().cars[0];
  const floor = state.contacts.find(item => item.kind === "floor");
  assert.ok(landed, "a falling car must regain support");
  assert.equal(state.grounded, true);
  assert.ok(Math.abs(car.vh) < .08, `suspension oscillation was not damped: vh=${car.vh}`);
  assert.ok(Math.max(...settleHeights) - Math.min(...settleHeights) < .025,
    `resting height still oscillates: ${Math.max(...settleHeights) - Math.min(...settleHeights)}`);
  assert.ok(floor, "settled snapshot must retain floor support");
  assert.ok(floor.wheelCount >= 2, `flat rest should load multiple wheels, got ${floor.wheelCount}`);
});

test("calibration lands with pitch or roll without crossing the floor and recovers attitude", () => {
  const cases = [
    { label: "pitch", axis: "z", angle: .28, key: "pitch" },
    { label: "roll", axis: "x", angle: -.24, key: "roll" }
  ];

  for (const scenario of cases) {
    const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(`${scenario.label}-landing`);
    const half = scenario.angle / 2;
    const orientation = scenario.axis === "x"
      ? { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) }
      : { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
    Object.assign(car, { h: 7, vh: 0, orientation, [scenario.key]: scenario.angle });
    match.input(car.id, {});

    let lowestChassisSeparation = Infinity;
    for (let frame = 0; frame < 600; frame += 1) {
      match.tick(1 / 120);
      const floor = car.contacts.find(item => item.kind === "floor");
      if (floor) lowestChassisSeparation = Math.min(lowestChassisSeparation, floor.separation);
    }

    const state = match.snapshot().cars[0];
    const floor = state.contacts.find(item => item.kind === "floor");
    assert.ok(lowestChassisSeparation >= -.002, `${scenario.label} landing crossed the floor: ${lowestChassisSeparation}`);
    assert.equal(state.grounded, true, `${scenario.label} landing did not regain support`);
    assert.ok(Math.abs(car[scenario.key]) < .08, `${scenario.label} attitude did not settle: ${car[scenario.key]}`);
    assert.ok(floor?.wheelCount >= 2, `${scenario.label} landing did not load multiple wheels`);
  }
});

test("calibration wheel support restores both jumps after a landing", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("wheel-jumps");

  match.input(car.id, { jump: true }); match.tick(1 / 120);
  assert.equal(car.jumps, 1);
  match.input(car.id, {}); match.tick(.08);
  match.input(car.id, { jump: true }); match.tick(1 / 120);
  assert.equal(car.jumps, 0, "the airborne second jump must consume the remaining jump");

  match.input(car.id, {});
  for (let frame = 0; frame < 360 && !car.grounded; frame += 1) match.tick(1 / 120);
  const state = match.snapshot().cars[0];
  const floor = state.contacts.find(item => item.kind === "floor");
  assert.equal(state.grounded, true, "landing must re-establish wheel support");
  assert.equal(car.jumps, 2, "wheel support must replenish both jumps");
  assert.ok(floor?.wheelCount >= 2, `jump reset had no multi-wheel support: ${floor?.wheelCount}`);
});

test("calibration floor and wall contacts resolve together at a corner", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("floor-wall-corner");
  Object.assign(car, { x: ARENA.halfWidth - 2.4, z: 0, h: 2, vx: 16, vz: 0, vh: -2 });
  match.input(car.id, {});
  for (let frame = 0; frame < 240; frame += 1) match.tick(1 / 120);

  const state = match.snapshot().cars[0];
  const floor = state.contacts.find(item => item.kind === "floor");
  const wall = state.contacts.find(item => item.kind === "wall");
  assert.ok(car.x <= ARENA.halfWidth - 1.7 + .02, `car crossed the wall at the corner: x=${car.x}`);
  assert.ok(state.grounded, "floor support must remain active while touching the wall");
  assert.ok(floor && wall, "the corner snapshot must report floor and wall contacts together");
  assert.ok(floor.wheelCount > 0, "floor contact at the corner must use wheel support");
  assert.deepEqual(wall.normal, { x: -1, y: 0, z: 0 });
});

test("calibration impacts against all four walls preserve tangential speed", () => {
  const cases = [
    { axis: "x", tangent: "z", position: 60, speed: 20, tangentSpeed: 8, wall: 1, normal: { x: -1, y: 0, z: 0 } },
    { axis: "x", tangent: "z", position: -60, speed: -20, tangentSpeed: 8, wall: -1, normal: { x: 1, y: 0, z: 0 } },
    { axis: "z", tangent: "x", position: 44.8, speed: 20, tangentSpeed: 8, wall: 1, normal: { x: 0, y: 0, z: -1 } },
    { axis: "z", tangent: "x", position: -44.8, speed: -20, tangentSpeed: 8, wall: -1, normal: { x: 0, y: 0, z: 1 } }
  ];

  for (const scenario of cases) {
    const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(`wall-${scenario.axis}-${scenario.wall}`);
    Object.assign(car, { h: 5, [scenario.axis]: scenario.position, [scenario.axis === "x" ? "z" : "x"]: 0 });
    Object.assign(car, { [scenario.axis === "x" ? "vx" : "vz"]: scenario.speed, [scenario.tangent === "x" ? "vx" : "vz"]: scenario.tangentSpeed });
    match.input(car.id, {});
    match.tick(1 / 120); match.tick(1 / 120);

    const state = match.snapshot().cars[0];
    const contact = state.contacts.find(item => item.kind === "wall");
    assert.ok(contact, `${scenario.axis} wall contact was not reported`);
    assert.deepEqual(contact.normal, scenario.normal);
    assert.ok(Math.abs(car[scenario.axis === "x" ? "vx" : "vz"]) < .01,
      `wall solver should remove inward normal speed only, got ${car.vx},${car.vz}`);
    assert.ok(car[scenario.tangent === "x" ? "vx" : "vz"] > scenario.tangentSpeed - .05,
      `wall solver lost tangent speed, got ${car.vx},${car.vz}`);
    assert.equal(state.wallNormal[scenario.axis], scenario.wall);
    assert.equal(car.wallRide, false, "FIS-12A collision reporting does not enable wall driving");
    assert.ok(Math.abs(contact.point[scenario.axis] - scenario.wall * (scenario.axis === "x" ? ARENA.halfWidth : ARENA.halfDepth)) < .01,
      "reported contact point must lie on the arena wall plane");
  }
});

test("calibration ceiling contact uses the oriented chassis extent and removes only normal speed", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("ceiling-contact");
  Object.assign(car, { h: 23.5, vx: 9, vz: 0, vh: 32 });
  match.input(car.id, {}); match.tick(1 / 120);

  const state = match.snapshot().cars[0];
  const contact = state.contacts.find(item => item.kind === "ceiling");
  assert.ok(contact, "the ceiling plane must report a common contact record");
  assert.deepEqual(contact.normal, { x: 0, y: -1, z: 0 });
  assert.equal(car.ceilingContact, true);
  assert.ok(car.h <= ARENA.ceilingHeight - 1.8 + .01, `oriented body exceeded the ceiling: h=${car.h}`);
  assert.ok(Math.abs(car.vh) < .01, `ceiling solver should remove only incoming normal velocity, vh=${car.vh}`);
  assert.ok(car.vx > 8.9, `ceiling solver changed tangent speed, vx=${car.vx}`);
  assert.ok(Math.abs(contact.point.y - ARENA.ceilingHeight) < .01);
});

test("calibration wall support uses the full quaternion rather than yaw-only bounds", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("pitched-wall-contact");
  Object.assign(car, {
    x: 61.98, h: 5, yaw: 0,
    orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
    vx: 0, vz: 0, vh: 0
  });
  match.input(car.id, {}); match.tick(1 / 120);
  const contact = match.snapshot().cars[0].contacts.find(item => item.kind === "wall");
  assert.ok(contact, "pitched chassis must contact using its rotated vertical extent");
  assert.ok(car.x > 61.8, `pitched chassis was clamped using its unrotated length: x=${car.x}`);
  assert.ok(car.x < 62, `pitched chassis crossed the wall: x=${car.x}`);
});

test("calibration contacts are identical for fixed steps and grouped input intervals", () => {
  const fixed = new ArenaMatch(7, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const grouped = new ArenaMatch(7, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const fixedCar = fixed.addHuman("same-pilot");
  const groupedCar = grouped.addHuman("same-pilot");
  Object.assign(fixedCar, { h: 6, x: 55, vx: 15, vz: 4 });
  Object.assign(groupedCar, { h: 6, x: 55, vx: 15, vz: 4 });
  fixed.input(fixedCar.id, {}); grouped.input(groupedCar.id, {});
  for (let i = 0; i < 120; i += 1) fixed.tick(1 / 120);
  for (let i = 0; i < 20; i += 1) grouped.tick(.05);
  assert.deepEqual(grouped.snapshot().cars[0], fixed.snapshot().cars[0]);
});

test("mobility probes are deterministic and cover the calibration control set", () => {
  const first = runMobilityProbes();
  const second = runMobilityProbes();
  assert.deepEqual(second, first);
  assert.equal(first.fixedStepHz, 120);
  assert.equal(first.profile, "calibration");
  assert.equal(Object.keys(first.dodges).length, 8);
  assert.equal(first.contacts.floorAfterTenSeconds.contact.kind, "floor");
  assert.deepEqual(Object.keys(first.contacts.walls), ["east", "west", "south", "north"]);
  assert.equal(first.contacts.ceiling.contact.normal.y, -1);
  assert.ok(first.ground.speedAtOneSecond > 0);
  assert.ok(first.ground.speedAtTwoSeconds >= first.ground.speedAtOneSecond);
  assert.ok(first.jump.apex > 0 && first.jump.airtime > 0);
  assert.ok(first.boost.speedAfterOneSecond > 0);
  for (const landing of Object.values(first.suspension.attitudeLandings)) {
    assert.ok(Number.isInteger(landing.firstSupportFrame) && landing.firstSupportFrame > 0,
      "attitude landing must expose its first supported frame");
    assert.ok(landing.firstSupportSeconds > 0,
      "attitude landing must expose the time of its first supported frame");
    assert.ok(Number.isFinite(landing.angleAtFirstSupport),
      "attitude landing must expose the angle at first support");
    assert.ok(landing.impact && Number.isFinite(landing.impact.normalSpeed),
      "attitude landing must retain the pre-recovery impact observation");
  }
  const yawRollLanding = first.jumpActions.yawRollDodgeLanding;
  assert.ok(yawRollLanding.direction.forward > 0 && yawRollLanding.direction.side > yawRollLanding.direction.forward,
    "yaw plus direct roll must commit a diagonal dodge direction");
  assert.ok(yawRollLanding.firstSupport?.frame > 0 && yawRollLanding.firstSupport?.floorContact?.wheelCount >= 2,
    "a yaw-roll dodge must recover on loaded wheel support");
  assert.ok(yawRollLanding.impact && Number.isFinite(yawRollLanding.impact.normalSpeed),
    "a yaw-roll dodge landing must retain its impact observation");
  assert.equal(yawRollLanding.final.grounded, true,
    "the measured yaw-roll dodge must settle with wheel support");
  assert.equal(yawRollLanding.final.jumps, 2,
    "the measured yaw-roll dodge must restore both jumps");
  assert.ok(Math.abs(yawRollLanding.final.pitch) < .08
    && Math.abs(yawRollLanding.final.roll) < .08,
    `the measured yaw-roll dodge retained too much landing attitude: ${JSON.stringify(yawRollLanding.final)}`);
});

test("M4-01 contact transition probes are deterministic and preserve support ordering", () => {
  const first = runContactTransitionProbes();
  const second = runContactTransitionProbes();
  assert.deepEqual(second, first);
  assert.equal(first.fixedStepHz, 120);
  assert.deepEqual(Object.keys(first.traces), [
    "flat-drop", "pitch-drop", "roll-drop",
    "dodge-forward-landing", "dodge-side-landing", "dodge-diagonal-roll-landing"
  ]);

  for (const trace of Object.values(first.traces)) {
    assert.equal(trace.samples.length, 300);
    assert.deepEqual(first.groupedFinals[trace.id], trace.summary.final);
    assert.ok(trace.summary.firstBodyContactFrame > 0,
      `${trace.id} must observe a body contact`);
    assert.ok(trace.summary.firstWheelSupportFrame >= trace.summary.firstBodyContactFrame,
      `${trace.id} wheel support cannot precede body contact`);
    assert.ok(trace.summary.firstGroundedFrame >= trace.summary.firstWheelSupportFrame,
      `${trace.id} grounded state cannot precede wheel support`);
    assert.ok(trace.summary.minimumFloorSeparation >= -.002,
      `${trace.id} penetrated the floor: ${trace.summary.minimumFloorSeparation}`);
    assert.equal(trace.summary.final.grounded, true, `${trace.id} must settle grounded`);
    assert.equal(trace.summary.final.jumps, 2, `${trace.id} must restore both jumps`);
    assert.ok(trace.summary.final.loadedWheelCount >= 2,
      `${trace.id} must finish with at least two loaded wheels`);
  }
});

test("calibration ground drive accelerates, brakes, and reverses through loaded wheels", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("wheel-drive");
  Object.assign(car, { x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 } });

  match.input(car.id, { throttle: 1 }); match.tick(1 / 120);
  assert.ok(car.vx > 0 && car.vx < 1, `wheel drive should build speed over time, got ${car.vx}`);
  for (let frame = 1; frame < 120; frame += 1) match.tick(1 / 120);
  const forwardSpeed = car.vx;
  assert.ok(forwardSpeed > 20 && forwardSpeed < 39, `motor curve should approach instead of set target speed, got ${forwardSpeed}`);

  match.input(car.id, { throttle: -1 }); match.tick(1 / 120);
  assert.ok(car.vx < forwardSpeed && car.vx > 0, "braking must remove speed before entering reverse");
  for (let frame = 0; frame < 120; frame += 1) match.tick(1 / 120);
  assert.ok(car.vx < 0, `reverse force did not change direction, got ${car.vx}`);
});

test("calibration steering follows the RocketSim speed-angle curve", () => {
  const speedForReference = referenceSpeed => referenceSpeed * 56 / 2300;
  assert.ok(Math.abs(steeringAngleFromSpeed(0) - .53356) < 1e-6);
  assert.ok(Math.abs(steeringAngleFromSpeed(speedForReference(500)) - .31930) < 1e-6);
  assert.ok(Math.abs(steeringAngleFromSpeed(speedForReference(1500)) - .10570) < 1e-6);
  assert.ok(Math.abs(steeringAngleFromSpeed(speedForReference(3000)) - .03454) < 1e-6);

  const quarterTurnRadius = forwardSpeed => {
    const match = new ArenaMatch(91, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(`steer-${forwardSpeed}`);
    Object.assign(car, { x: 0, z: 0, h: 0, vx: forwardSpeed, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0,
      orientation: { x: 0, y: 0, z: 0, w: 1 } });
    let distance = 0, previous = { x: car.x, z: car.z };
    for (let frame = 0; frame < 180 && car.yaw < Math.PI / 4; frame += 1) {
      match.input(car.id, { throttle: 1, steer: 1 }); match.tick(1 / 120);
      distance += Math.hypot(car.x - previous.x, car.z - previous.z);
      previous = { x: car.x, z: car.z };
    }
    return distance / Math.max(car.yaw, .0001);
  };
  const lowSpeedRadius = quarterTurnRadius(12);
  const highSpeedRadius = quarterTurnRadius(42);
  assert.ok(highSpeedRadius > lowSpeedRadius * 4,
    `front wheel geometry must open its turn at high speed, got ${lowSpeedRadius} / ${highSpeedRadius}`);
});

test("calibration drive and powerslide curves follow the public RocketSim contract", () => {
  const speedForReference = referenceSpeed => referenceSpeed * 56 / 2300;
  assert.ok(Math.abs(driveTorqueFactorFromSpeed(0) - 1) < 1e-6);
  assert.ok(Math.abs(driveTorqueFactorFromSpeed(speedForReference(1400)) - .1) < 1e-6);
  assert.equal(driveTorqueFactorFromSpeed(speedForReference(1410)), 0);
  assert.ok(Math.abs(powerslideSteeringAngleFromSpeed(0) - .39235) < 1e-6);
  assert.ok(Math.abs(powerslideSteeringAngleFromSpeed(speedForReference(2500)) - .12610) < 1e-6);

  const match = new ArenaMatch(92, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("handbrake-ramp");
  match.input(car.id, { drift: true }); match.tick(1 / 120);
  assert.ok(car.handbrake > 0 && car.handbrake < .1,
    `powerslide must begin progressively, got ${car.handbrake}`);
  for (let frame = 1; frame < 24; frame += 1) match.tick(1 / 120);
  assert.ok(car.handbrake >= .999, "powerslide must reach full effect after its rise window");
  match.input(car.id, {}); match.tick(1 / 120);
  assert.ok(car.handbrake > .9 && car.handbrake < 1,
    `releasing powerslide must preserve a short decay, got ${car.handbrake}`);
});

test("calibration steering and tire grip create a gradual deterministic turn", () => {
  const configure = match => {
    const car = match.addHuman("wheel-steer");
    Object.assign(car, { x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0,
      orientation: { x: 0, y: 0, z: 0, w: 1 } });
    return car;
  };
  const match = new ArenaMatch(2, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = configure(match);
  match.input(car.id, { throttle: 1 });
  for (let frame = 0; frame < 120; frame += 1) match.tick(1 / 120);
  match.input(car.id, { throttle: 1, steer: 1 }); match.tick(1 / 120);
  assert.ok(car.yaw > 0 && car.yaw < .01, `steering must start through a small wheel moment, got yaw=${car.yaw}`);
  assert.ok(car.vz > 0 && car.vz < 1, `tire force should start a gradual lateral response, got vz=${car.vz}`);
  for (let frame = 1; frame < 120; frame += 1) match.tick(1 / 120);
  assert.ok(car.yaw > .5, `front-wheel steering did not rotate the chassis, got yaw=${car.yaw}`);
  assert.ok(car.z > 5, `turning did not change the travelled path, z=${car.z}`);

  const slipping = new ArenaMatch(3, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const slipCar = configure(slipping);
  Object.assign(slipCar, { vx: 18, vz: 8 });
  slipping.input(slipCar.id, {}); slipping.tick(1 / 120);
  assert.ok(Math.abs(slipCar.vz) < 8 && Math.abs(slipCar.vz) > 0,
    `tire grip must reduce lateral speed without deleting it instantly, got ${slipCar.vz}`);

  const fixed = new ArenaMatch(4, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const grouped = new ArenaMatch(4, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const fixedCar = configure(fixed), groupedCar = configure(grouped);
  fixed.input(fixedCar.id, { throttle: 1, steer: 1 }); grouped.input(groupedCar.id, { throttle: 1, steer: 1 });
  for (let frame = 0; frame < 120; frame += 1) fixed.tick(1 / 120);
  for (let frame = 0; frame < 20; frame += 1) grouped.tick(.05);
  assert.deepEqual(grouped.snapshot().cars[0], fixed.snapshot().cars[0]);
});

test("calibration powerslide releases rear grip, preserves momentum, and recovers deterministically", () => {
  const setup = (seed, name) => {
    const match = new ArenaMatch(seed, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(name);
    Object.assign(car, { x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0,
      orientation: { x: 0, y: 0, z: 0, w: 1 } });
    for (let frame = 0; frame < 120; frame += 1) {
      match.input(car.id, { throttle: 1 }); match.tick(1 / 120);
    }
    return { match, car };
  };
  const sideSpeed = car => -car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
  const grip = setup(5, "grip-turn");
  const slide = setup(5, "slide-turn");
  for (let frame = 0; frame < 60; frame += 1) {
    grip.match.input(grip.car.id, { throttle: 1, steer: 1 }); grip.match.tick(1 / 120);
    slide.match.input(slide.car.id, { throttle: 1, steer: 1, drift: true }); slide.match.tick(1 / 120);
  }
  assert.ok(slide.car.yaw > grip.car.yaw + .4,
    `powerslide should rotate more freely than grip turn, slide=${slide.car.yaw}, grip=${grip.car.yaw}`);
  assert.ok(Math.abs(sideSpeed(slide.car)) > Math.abs(sideSpeed(grip.car)) + 4,
    `powerslide should retain lateral slip, slide=${sideSpeed(slide.car)}, grip=${sideSpeed(grip.car)}`);
  const sideAtRelease = Math.abs(sideSpeed(slide.car));
  slide.match.input(slide.car.id, { throttle: 1 }); slide.match.tick(1 / 120);
  assert.ok(Math.abs(sideSpeed(slide.car)) > sideAtRelease * .8,
    "releasing Shift must not delete the existing lateral momentum in one step");
  for (let frame = 1; frame < 120; frame += 1) slide.match.tick(1 / 120);
  assert.ok(Math.abs(sideSpeed(slide.car)) < .1, `tire grip did not recover after powerslide: ${sideSpeed(slide.car)}`);
  assert.ok(Math.abs(slide.car.yawRate) < .01, `yaw should settle after powerslide: ${slide.car.yawRate}`);

  const fixed = setup(6, "same-slide");
  const grouped = setup(6, "same-slide");
  for (let frame = 0; frame < 120; frame += 1) {
    fixed.match.input(fixed.car.id, { throttle: 1, steer: -1, drift: true }); fixed.match.tick(1 / 120);
  }
  grouped.match.input(grouped.car.id, { throttle: 1, steer: -1, drift: true });
  for (let frame = 0; frame < 20; frame += 1) grouped.match.tick(.05);
  assert.deepEqual(grouped.match.snapshot().cars[0], fixed.match.snapshot().cars[0]);
});

test("calibration jump actions use explicit windows and capture a committed dodge direction", () => {
  const match = new ArenaMatch(8, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("jump-state");
  assert.equal(match.snapshot().cars[0].jumpState, "grounded");

  match.input(car.id, { jump: true }); match.tick(1 / 120);
  let state = match.snapshot().cars[0];
  assert.equal(state.jumpState, "first-jump");
  assert.equal(state.jumps, 1);
  assert.deepEqual(state.actionSerials, { jump: 1, doubleJump: 0, dodge: 0, respawn: 0 });
  assert.ok(state.jumpHoldRemaining > 0 && state.jumpWindowRemaining === 0,
    "the second-action window must wait for the sustained jump to end");
  match.input(car.id, { jump: true }); match.tick(1 / 120);
  assert.equal(match.snapshot().cars[0].actionSerials.jump, 1, "holding jump must not emit another action");

  match.input(car.id, {}); for (let frame = 0; frame < 5; frame += 1) match.tick(1 / 120);
  match.input(car.id, { jump: true, throttle: 1, steer: 1 }); match.tick(1 / 120);
  state = match.snapshot().cars[0];
  assert.equal(state.jumpState, "dodge");
  assert.equal(state.jumps, 0);
  assert.deepEqual(state.actionSerials, { jump: 1, doubleJump: 0, dodge: 1, respawn: 0 });
  const capturedDirection = { forward: car.dodgeForward, side: car.dodgeSide };
  assert.ok(Math.abs(capturedDirection.forward - Math.SQRT1_2) < .001);
  assert.ok(Math.abs(capturedDirection.side - Math.SQRT1_2) < .001);

  match.input(car.id, { throttle: -1, steer: -1 }); match.tick(1 / 120);
  assert.deepEqual({ forward: car.dodgeForward, side: car.dodgeSide }, capturedDirection,
    "later input must not change the committed dodge direction");
  for (let frame = 0; frame < 80; frame += 1) match.tick(1 / 120);
  assert.notEqual(match.snapshot().cars[0].jumpState, "dodge", "dodge state must expire before normal air control or landing");

  for (let frame = 0; frame < 360 && !car.grounded; frame += 1) match.tick(1 / 120);
  state = match.snapshot().cars[0];
  assert.equal(state.jumpState, "grounded");
  assert.equal(state.jumps, 2);

  const doubleMatch = new ArenaMatch(9, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const doubleCar = doubleMatch.addHuman("double-state");
  doubleMatch.input(doubleCar.id, { jump: true }); doubleMatch.tick(1 / 120);
  doubleMatch.input(doubleCar.id, {}); doubleMatch.tick(.08);
  const beforeDouble = doubleCar.vh;
  doubleMatch.input(doubleCar.id, { jump: true }); doubleMatch.tick(1 / 120);
  const doubleState = doubleMatch.snapshot().cars[0];
  assert.equal(doubleState.jumpState, "double-jump");
  assert.equal(doubleState.jumpHoldRemaining, 0, "only the first jump can receive held lift");
  assert.ok(doubleCar.vh > beforeDouble);
});

test("the first jump keeps RocketSim's minimum pulse before opening the second-action window", () => {
  const match = new ArenaMatch(10, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("jump-pulse");
  match.input(car.id, { jump: true }); match.tick(1 / 120);
  match.input(car.id, {}); match.tick(1 / 120);
  match.input(car.id, {}); match.tick(1 / 120);
  assert.equal(car.jumpState, "first-jump");
  assert.equal(car.secondJumpWindow, 0, "the minimum pulse must complete before the window starts");
  match.input(car.id, {}); match.tick(1 / 120);
  assert.equal(car.jumpState, "airborne");
  assert.ok(car.secondJumpWindow > 1.24 && car.secondJumpWindow <= 1.25);
});

test("a car has two jumps and regains them on landing", () => {
  const match = new ArenaMatch();
  const car = match.addHuman("pilot-1");
  isolate(match, car);
  match.input(car.id, { jump: true }); match.tick(.016);
  assert.equal(car.jumps, 1); assert.ok(car.h > 0);
  match.input(car.id, { jump: false }); match.tick(.05);
  match.input(car.id, { jump: true }); match.tick(.016);
  assert.equal(car.jumps, 0);
  for (let i = 0; i < 200; i += 1) match.tick(.016);
  assert.equal(car.h, 0); assert.equal(car.jumps, 2);
});

test("boost spends fuel, does not passively refill, and is restored by pads", () => {
  const match = new ArenaMatch();
  const car = match.addHuman("pilot-1");
  car.boost = 50; match.input(car.id, { boost: true, throttle: 1 }); match.tick(.5);
  assert.ok(car.boost < 50);
  const afterBoost = car.boost;
  match.input(car.id, {});
  // The public solver guarantees a short minimum boost pulse. Release it
  // fully before checking that the idle branch does not refill fuel.
  for (let i = 0; i < 4; i += 1) match.tick(.05);
  const afterRelease = car.boost;
  assert.ok(afterRelease <= afterBoost, "the release pulse may spend fuel but must not refill it");
  match.tick(.05);
  assert.equal(car.boost, afterRelease);
  const pad = match.pads[0]; car.x = pad.x; car.z = pad.z; car.padCooldown = 0; car.boost = 20; match.tick(.016);
  assert.ok(car.boost >= 58);
});

test("the contextual drift input changes ground handling and directional air roll", () => {
  const match = new ArenaMatch();
  const car = match.addHuman("pilot-1");
  car.vx = 18; car.vz = 0; car.yaw = 0;
  match.input(car.id, { throttle: 1, steer: 1, drift: true, roll: 1 }); match.tick(.1);
  assert.ok(car.yaw > 0);
  match.input(car.id, { jump: true }); match.tick(.016);
  match.input(car.id, { jump: false, airRoll: true, roll: 1 }); match.tick(.1);
  assert.ok(car.roll > 0);
  match.input(car.id, { airRoll: true, roll: -1 }); match.tick(.2);
  assert.ok(car.rollRate < 0);
});

test("free air roll suppresses yaw while directional roll preserves it", () => {
  const makeAirCar = (name, input) => {
    const match = new ArenaMatch(29, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(name);
    Object.assign(car, { h: 20, vh: 0, yaw: 0, pitch: 0, roll: 0, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    for (let frame = 0; frame < 36; frame += 1) { match.input(car.id, input); match.tick(1 / 120); }
    return car;
  };
  const free = makeAirCar("free-roll", { steer: 1, airRoll: true, roll: 1 });
  const directional = makeAirCar("directional-roll", { steer: 1, airRoll: false, roll: 1 });
  assert.ok(Math.abs(free.yawRate) < .02, `free air roll should release yaw, got ${free.yawRate}`);
  assert.ok(directional.yawRate > .1, `directional roll should preserve yaw, got ${directional.yawRate}`);
  assert.ok(free.rollRate > .1 && directional.rollRate > .1, "both roll paths should rotate around the local nose axis");
});

test("a directionless second jump gives lift while a directed second jump dodges", () => {
  const match = new ArenaMatch();
  const car = match.addHuman("pilot-1");
  match.input(car.id, { jump: true }); match.tick(.016);
  match.input(car.id, { jump: false }); match.tick(.08);
  const beforeDoubleJump = car.vh;
  match.input(car.id, { jump: true }); match.tick(.016);
  assert.equal(car.jumps, 0); assert.ok(car.vh > beforeDoubleJump);
  assert.equal(match.snapshot().cars.find(view => view.id === car.id).actionSerials.doubleJump, 1);
  const dodgeMatch = new ArenaMatch(); const dodger = dodgeMatch.addHuman("pilot-2");
  dodgeMatch.input(dodger.id, { jump: true }); dodgeMatch.tick(.016);
  dodgeMatch.input(dodger.id, { jump: false }); dodgeMatch.tick(.08);
  dodgeMatch.input(dodger.id, { jump: true, throttle: 1, steer: 1 }); dodgeMatch.tick(.016);
  assert.ok(dodger.vx > 8);
  assert.ok(Math.abs(dodger.yawRate) < .08,
    `a forward dodge may retain only the damped steering edge, got ${dodger.yawRate}`);
  assert.ok(dodger.pitchRate > 0,
    "a forward dodge must rotate nose-down around the local pitch axis");
});

test("aerial dodge direction combines yaw and direct air roll without double-counting free roll", () => {
  const makeDodge = (input) => {
    const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman("pilot");
    match.input(car.id, { jump: true }); match.tick(1 / 120);
    match.input(car.id, { jump: false }); match.tick(.08);
    match.input(car.id, { jump: true, ...input }); match.tick(1 / 120);
    return car;
  };
  const yawOnly = makeDodge({ throttle: 1, steer: 1 });
  const yawAndRoll = makeDodge({ throttle: 1, steer: 1, roll: 1 });
  const freeRoll = makeDodge({ throttle: 1, steer: 1, airRoll: true, roll: 1 });
  assert.ok(yawAndRoll.dodgeSide > yawOnly.dodgeSide,
    "direct air roll must contribute to the lateral dodge axis");
  assert.ok(Math.abs(freeRoll.dodgeSide - (1 / Math.SQRT2)) < 1e-6,
    "free air roll must use roll once while steering is no longer yaw");
  assert.ok(yawAndRoll.dodgeSide <= 1 && freeRoll.dodgeSide <= 1,
    "dodge direction must remain normalized");
});

test("the second-jump edge captures W/S and air-roll direction in the current chassis basis", () => {
  const makeDodge = (input, pitch, roll) => {
    const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(`pilot-${pitch}-${roll}`);
    match.input(car.id, { jump: true }); match.tick(1 / 120);
    match.input(car.id, {}); for (let i = 0; i < 8; i += 1) match.tick(1 / 120);
    Object.assign(car, { pitch, roll });
    // Keep each fixture's attitude and heading explicit while preserving yaw 0.
    // The simulation's Euler convention uses -pitch around local Z and roll
    // around local X.
    car.orientation = pitch
      ? { x: 0, y: 0, z: -Math.sin(pitch / 2), w: Math.cos(pitch / 2) }
      : roll
        ? { x: Math.sin(roll / 2), y: 0, z: 0, w: Math.cos(roll / 2) }
        : { x: 0, y: 0, z: 0, w: 1 };
    const before = { x: car.vx, z: car.vz, h: car.vh };
    match.input(car.id, { jump: true, ...input }); match.tick(1 / 120);
    return { car, delta: { x: car.vx - before.x, z: car.vz - before.z, h: car.vh - before.h } };
  };
  const forward = makeDodge({ throttle: 1 }, 0, 0);
  const reverse = makeDodge({ throttle: -1 }, 0, 0);
  const yaw = makeDodge({ steer: 1 }, 0, 0);
  const directionalRoll = makeDodge({ roll: 1 }, 0, 0);
  const diagonal = makeDodge({ throttle: 1, steer: 1, roll: 1 }, 0, 0);
  const pitchedForward = makeDodge({ throttle: 1 }, .9, 0);

  assert.equal(forward.car.dodgeForward, 1);
  assert.equal(reverse.car.dodgeForward, -1);
  assert.equal(yaw.car.dodgeSide, 1);
  assert.equal(directionalRoll.car.dodgeSide, 1,
    "directional air roll held on the second jump must select a lateral dodge");
  assert.ok(Math.abs(Math.hypot(diagonal.car.dodgeForward, diagonal.car.dodgeSide) - 1) < 1e-9,
    "combined W/A-D/directional-roll input must not gain dodge magnitude");
  assert.ok(Math.abs(pitchedForward.delta.x - forward.delta.x) < .1
    && Math.abs(pitchedForward.delta.z - forward.delta.z) < .1,
    "the initial dodge impulse must stay in the flattened chassis plane");
});

test("a level directional dodge uses a horizontal impulse while a vertical double jump supplies lift", () => {
  const activateSecondAction = (input, name) => {
    const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(name);
    match.input(car.id, { jump: true }); match.tick(1 / 120);
    match.input(car.id, {}); for (let i = 0; i < 10; i += 1) match.tick(1 / 120);
    const verticalBefore = car.vh;
    match.input(car.id, { jump: true, ...input }); match.tick(1 / 120);
    return { match, car, verticalChange: car.vh - verticalBefore };
  };
  const vertical = activateSecondAction({}, "pilot-double-jump");
  const forward = activateSecondAction({ throttle: 1 }, "pilot-forward-dodge");
  const side = activateSecondAction({ steer: 1 }, "pilot-side-dodge");

  assert.equal(vertical.car.dodgeTime, 0);
  assert.ok(vertical.verticalChange > forward.verticalChange,
    `vertical double jump must lift more than a forward dodge (${vertical.verticalChange} <= ${forward.verticalChange})`);
  assert.ok(forward.verticalChange <= 0, `forward dodge must not invent vertical lift: ${forward.verticalChange}`);
  assert.ok(side.verticalChange <= 0, `side dodge must not invent vertical lift: ${side.verticalChange}`);
  assert.ok(Math.abs(forward.verticalChange - side.verticalChange) < .03,
    "level forward and side dodges must begin with the same baseline lift");
  assert.ok(forward.car.dodgeTime > 0 && side.car.dodgeTime > 0);

  const afterActivation = side.car.vh;
  side.match.input(side.car.id, {}); side.match.tick(1 / 120);
  const nextChange = side.car.vh - afterActivation;
  assert.ok(nextChange < 0 && nextChange > -.15,
    `the flip must not add a second vertical force: ${nextChange}`);
});

test("a late directional second action remains recoverable before its window expires", () => {
  const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("pilot-late-dodge");
  match.input(car.id, { jump: true }); match.tick(1 / 120);
  match.input(car.id, {}); for (let frame = 0; frame < 55; frame += 1) match.tick(1 / 120);
  assert.ok(car.secondJumpWindow > .5 && !car.grounded, "fixture must remain within the aerial second-action window");
  match.input(car.id, { jump: true, steer: 1 }); match.tick(1 / 120);
  assert.ok(car.dodgeTime > 0);
  assert.ok(car.vh < 1, `late directed dodge should not inject vertical velocity, got ${car.vh}`);
});

test("re-pressing jump cannot reactivate the released first-jump hold", () => {
  const activateDodge = (clearFirstHold) => {
    const match = new ArenaMatch(1, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(clearFirstHold ? "pilot-clear-hold" : "pilot-live-hold");
    match.input(car.id, { jump: true }); match.tick(1 / 120);
    match.input(car.id, {}); match.tick(.05);
    if (clearFirstHold) car.jumpHold = 0;
    const beforeSecondPress = car.vh;
    match.input(car.id, { jump: true, steer: 1 }); match.tick(1 / 120);
    return { car, verticalChange: car.vh - beforeSecondPress };
  };
  const withUnusedHold = activateDodge(false);
  const withoutUnusedHold = activateDodge(true);
  assert.ok(withUnusedHold.car.dodgeTime > 0 && withoutUnusedHold.car.dodgeTime > 0);
  assert.ok(Math.abs(withUnusedHold.verticalChange - withoutUnusedHold.verticalChange) < 1e-9,
    "a re-press must use only the second-action lift, never the released first-jump hold");
});

test("the dodge deadzone keeps a slight second-jump input vertical", () => {
  const softMatch = new ArenaMatch();
  const softCar = softMatch.addHuman("pilot-soft");
  isolate(softMatch, softCar);
  softMatch.input(softCar.id, { jump: true }); softMatch.tick(.016);
  softMatch.input(softCar.id, { jump: false }); softMatch.tick(.08);
  const liftBefore = softCar.vh;
  softMatch.input(softCar.id, { jump: true, throttle: .19 }); softMatch.tick(.016);
  assert.equal(softCar.jumps, 0);
  assert.equal(softCar.dodgeTime, 0);
  assert.ok(softCar.vh > liftBefore);

  const thresholdMatch = new ArenaMatch();
  const thresholdCar = thresholdMatch.addHuman("pilot-threshold");
  isolate(thresholdMatch, thresholdCar);
  thresholdMatch.input(thresholdCar.id, { jump: true }); thresholdMatch.tick(.016);
  thresholdMatch.input(thresholdCar.id, { jump: false }); thresholdMatch.tick(.08);
  thresholdMatch.input(thresholdCar.id, { jump: true, throttle: .5 }); thresholdMatch.tick(.016);
  assert.equal(thresholdCar.jumps, 0);
  assert.ok(thresholdCar.dodgeTime > 0);
});

test("a dodge has a short committed follow-through and expires after the aerial window", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  match.input(car.id, { jump: true }); match.tick(.016);
  match.input(car.id, { jump: false }); match.tick(.08);
  match.input(car.id, { jump: true, throttle: 1 }); match.tick(.016);
  const initialBurst = car.vx;
  match.input(car.id, {}); match.tick(.1);
  assert.ok(car.vx <= initialBurst && car.vx > initialBurst - .1,
    "dodge should not add a second linear acceleration stream");

  const expiry = new ArenaMatch(); const lateCar = expiry.addHuman("pilot-2"); isolate(expiry, lateCar);
  expiry.input(lateCar.id, { jump: true }); expiry.tick(.016);
  Object.assign(lateCar, { h: 10, vh: 0 });
  expiry.input(lateCar.id, {});
  for (let i = 0; i < 82; i += 1) expiry.tick(.016);
  expiry.input(lateCar.id, { jump: true, throttle: 1 }); expiry.tick(.016);
  assert.equal(lateCar.jumps, 1, "the second jump should not remain available for the full flight");
});

test("a dodge owns its rotation, can be pitch-cancelled, and stays stable across packet cadence", () => {
  const triggerForwardDodge = (match, car) => {
    match.input(car.id, { jump: true }); match.tick(1 / 120);
    match.input(car.id, { jump: false }); match.tick(.05);
    match.input(car.id, { jump: true, throttle: 1 }); match.tick(1 / 120);
    return { ...car.orientation };
  };
  const turnFrom = (start, car) => 1 - Math.abs(
    start.x * car.orientation.x + start.y * car.orientation.y + start.z * car.orientation.z + start.w * car.orientation.w
  );

  const freeMatch = new ArenaMatch(); const freeCar = freeMatch.addHuman("free"); isolate(freeMatch, freeCar);
  const cancelMatch = new ArenaMatch(); const cancelCar = cancelMatch.addHuman("cancel"); isolate(cancelMatch, cancelCar);
  const freeStart = triggerForwardDodge(freeMatch, freeCar);
  const cancelStart = triggerForwardDodge(cancelMatch, cancelCar);
  const cancelBurst = cancelCar.vx;
  for (let i = 0; i < 10; i += 1) {
    freeMatch.input(freeCar.id, { jump: false }); freeMatch.tick(1 / 120);
    cancelMatch.input(cancelCar.id, { jump: false, throttle: -1 }); cancelMatch.tick(1 / 120);
  }
  const freeTurn = turnFrom(freeStart, freeCar), cancelledTurn = turnFrom(cancelStart, cancelCar);
  const freeView = freeMatch.snapshot().cars.find(view => view.id === freeCar.id);
  const cancelView = cancelMatch.snapshot().cars.find(view => view.id === cancelCar.id);
  assert.ok(freeTurn > .01, "releasing controls should not stop the dodge rotation");
  assert.ok(cancelledTurn < freeTurn * .1, "opposite throttle should cancel a forward dodge pitch rotation");
  assert.ok(cancelCar.dodgeX > 0 && Math.abs(cancelCar.dodgeZ) < .01,
    "pitch cancellation must keep the committed dodge impulse");
  assert.equal(freeView.dodging, true); assert.ok(freeView.dodgeRemaining > 0);
  assert.equal(cancelView.dodgeCancelling, true);

  const sideMatch = new ArenaMatch(); const sideCar = sideMatch.addHuman("side-input"); isolate(sideMatch, sideCar);
  triggerForwardDodge(sideMatch, sideCar);
  sideMatch.input(sideCar.id, { jump: false, steer: 1 }); sideMatch.tick(1 / 120);
  const sideView = sideMatch.snapshot().cars.find(view => view.id === sideCar.id);
  assert.equal(sideView.dodgeCancelling, false, "lateral steering must not cancel a committed pitch flip");

  const steady = new ArenaMatch(); const bursty = new ArenaMatch();
  const steadyCar = steady.addHuman("steady-dodge"), burstyCar = bursty.addHuman("bursty-dodge");
  isolate(steady, steadyCar); isolate(bursty, burstyCar);
  triggerForwardDodge(steady, steadyCar); triggerForwardDodge(bursty, burstyCar);
  steady.input(steadyCar.id, { jump: false }); bursty.input(burstyCar.id, { jump: false });
  for (let i = 0; i < 12; i += 1) steady.tick(1 / 120);
  for (let i = 0; i < 3; i += 1) bursty.tick(1 / 30);
  const alignment = Math.abs(
    steadyCar.orientation.x * burstyCar.orientation.x + steadyCar.orientation.y * burstyCar.orientation.y
    + steadyCar.orientation.z * burstyCar.orientation.z + steadyCar.orientation.w * burstyCar.orientation.w
  );
  assert.ok(alignment > .999999, `dodge attitude diverged across packet cadence: ${alignment}`);
});

test("reverse input pitches up for an aerial boost and unheld drift preserves aerial yaw", () => {
  const match = new ArenaMatch();
  const car = match.addHuman("pilot-1");
  match.input(car.id, { jump: true }); match.tick(.016);
  Object.assign(car, { h: 6, vh: 0 });
  match.input(car.id, { jump: false, throttle: -1 });
  for (let i = 0; i < 32; i += 1) match.tick(.016);
  assert.ok(car.pitch < 0);
  const upwardBefore = car.vh;
  match.input(car.id, { boost: true });
  for (let i = 0; i < 12; i += 1) match.tick(.016);
  assert.ok(car.vh > upwardBefore);
  const yawBefore = car.yaw;
  match.input(car.id, { steer: 1, drift: false }); match.tick(.1);
  assert.ok(car.yaw > yawBefore);
});

test("forward input pitches the nose down and adds only the small chassis air force", () => {
  const match = new ArenaMatch();
  const car = match.addHuman("pilot-1");
  isolate(match, car);
  match.input(car.id, { jump: true }); match.tick(.016);
  match.input(car.id, { jump: false, throttle: 1 });
  for (let i = 0; i < 32; i += 1) match.tick(.016);
  assert.ok(car.pitch > .1);
  assert.ok(Math.hypot(car.vx, car.vz) > .2 && Math.hypot(car.vx, car.vz) < 1.2);
  const beforeBoost = car.vh;
  match.input(car.id, { boost: true }); match.tick(.1);
  assert.ok(car.vh < beforeBoost);
});

test("air throttle stays far below the nose-aligned boost force", () => {
  const throttle = new ArenaMatch(); const throttleCar = throttle.addHuman("air-throttle"); isolate(throttle, throttleCar);
  const boost = new ArenaMatch(); const boostCar = boost.addHuman("air-boost"); isolate(boost, boostCar);
  Object.assign(throttleCar, { h: 20, vh: 0 }); Object.assign(boostCar, { h: 20, vh: 0 });
  for (let i = 0; i < 12; i += 1) {
    throttle.input(throttleCar.id, { throttle: 1 }); throttle.tick(1 / 120);
    boost.input(boostCar.id, { boost: true }); boost.tick(1 / 120);
  }
  const throttleSpeed = Math.hypot(throttleCar.vx, throttleCar.vz);
  const boostSpeed = Math.hypot(boostCar.vx, boostCar.vz);
  assert.ok(throttleSpeed > 0 && boostSpeed > throttleSpeed * 10,
    `air throttle must remain a support force (${throttleSpeed} vs ${boostSpeed})`);
});

test("combined local air controls keep a normalized, usable car attitude", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  match.input(car.id, { jump: true }); match.tick(.016);
  match.input(car.id, { jump: false, throttle: 1, steer: 1, airRoll: false, roll: 1 });
  for (let i = 0; i < 28; i += 1) match.tick(.016);
  const norm = Math.hypot(car.orientation.x, car.orientation.y, car.orientation.z, car.orientation.w);
  assert.ok(Math.abs(norm - 1) < 1e-8);
  assert.ok(Number.isFinite(car.pitch) && Number.isFinite(car.yaw) && Number.isFinite(car.roll));
  assert.ok(Math.abs(car.pitch) + Math.abs(car.yaw) + Math.abs(car.roll) > .15);
});

test("air torque is bounded as one local vector and damps after release", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { h: 20, vh: 0 });
  match.input(car.id, { throttle: 1, steer: 1, airRoll: false, roll: 1 });
  for (let i = 0; i < 90; i += 1) match.tick(1 / 120);
  const driven = match.snapshot().cars.find(view => view.id === car.id).angularVelocity;
  const drivenMagnitude = Math.hypot(driven.pitch, driven.yaw, driven.roll);
  assert.ok(drivenMagnitude <= 5.5 + .001, `combined local angular velocity exceeds cap: ${drivenMagnitude}`);
  assert.ok(Math.abs(driven.pitch) > 0 && Math.abs(driven.yaw) > 0 && Math.abs(driven.roll) > 0,
    "each driven local input must contribute before the common angular cap");
  match.input(car.id, {});
  for (let i = 0; i < 48; i += 1) match.tick(1 / 120);
  const released = match.snapshot().cars.find(view => view.id === car.id).angularVelocity;
  assert.ok(Math.abs(released.pitch) < Math.abs(driven.pitch));
  assert.ok(Math.abs(released.yaw) < Math.abs(driven.yaw));
  assert.ok(Math.abs(released.roll) < Math.abs(driven.roll));
});

test("calibration air axes use Rocket League control directions and boost follows the nose", () => {
  const makeAirCar = name => {
    const match = new ArenaMatch(17, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
    const car = match.addHuman(name);
    Object.assign(car, { h: 12, vh: 0, yaw: 0, pitch: 0, roll: 0, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    return { match, car };
  };
  const advance = (match, car, frames, input) => {
    for (let frame = 0; frame < frames; frame += 1) { match.input(car.id, input); match.tick(1 / 120); }
  };
  const down = makeAirCar("pitch-down");
  advance(down.match, down.car, 36, { throttle: 1 });
  assert.ok(down.car.pitch > .1, "forward input must lower the nose");
  const up = makeAirCar("pitch-up");
  advance(up.match, up.car, 36, { throttle: -1 });
  assert.ok(up.car.pitch < -.1, "reverse input must raise the nose");
  const yaw = makeAirCar("yaw-right");
  advance(yaw.match, yaw.car, 36, { steer: 1 });
  assert.ok(yaw.car.yaw > .1, "right steering must yaw right in the local chassis frame");
  const roll = makeAirCar("roll-right");
  advance(roll.match, roll.car, 36, { airRoll: true, roll: 1 });
  assert.ok(roll.car.roll > .1, "positive directional air roll must rotate around the local forward axis");
  const beforeBoost = up.car.vh;
  advance(up.match, up.car, 24, { boost: true });
  assert.ok(up.car.vh > beforeBoost, "boost must add vertical velocity after pitching the nose upward");
});

test("calibration flight maneuver records reversal, combined axes, release, and nose-aligned boost", () => {
  const maneuver = runMobilityProbes().airManeuver;
  assert.equal(maneuver.cadenceMatches, true, "the maneuver trace must survive grouped input delivery");
  const phase = Object.fromEntries(maneuver.trace.map(sample => [sample.label, sample]));
  assert.ok(phase.pitchDown.angularVelocity.pitch > 0, "forward input must begin a downward pitch");
  assert.ok(phase.pitchReverse.angularVelocity.pitch < 0, "reverse input must carry the pitch rate through zero");
  assert.ok(phase.rightYawRoll.angularVelocity.yaw > 0 && phase.rightYawRoll.angularVelocity.roll > 0,
    "right yaw and roll must share the local chassis frame");
  assert.ok(phase.leftYawRoll.angularVelocity.yaw < 0 && phase.leftYawRoll.angularVelocity.roll < 0,
    "reversed yaw and roll inputs must reverse their local rates");
  assert.ok(Math.abs(phase.release.angularVelocity.roll) < Math.abs(phase.leftYawRoll.angularVelocity.roll),
    "released roll must damp rather than stop discontinuously");
  assert.ok(phase.noseUp.forward.y > 0, "the final pre-boost phase must aim the nose upward");
  assert.ok(phase.boost.velocity.y > phase.noseUp.velocity.y,
    "boost must increase vertical velocity when the captured nose is upward");
});

test("fixed substeps keep local air torque stable across packet cadence", () => {
  const steady = new ArenaMatch(); const bursty = new ArenaMatch();
  const steadyCar = steady.addHuman("steady"), burstyCar = bursty.addHuman("bursty");
  isolate(steady, steadyCar); isolate(bursty, burstyCar);
  Object.assign(steadyCar, { h: 18, vh: 0 });
  Object.assign(burstyCar, { h: 18, vh: 0 });
  const input = { throttle: .7, steer: -.45, airRoll: false, roll: .8 };
  steady.input(steadyCar.id, input); bursty.input(burstyCar.id, input);
  for (let i = 0; i < 120; i += 1) steady.tick(1 / 120);
  for (let i = 0; i < 30; i += 1) bursty.tick(1 / 30);
  const alignment = Math.abs(
    steadyCar.orientation.x * burstyCar.orientation.x + steadyCar.orientation.y * burstyCar.orientation.y
    + steadyCar.orientation.z * burstyCar.orientation.z + steadyCar.orientation.w * burstyCar.orientation.w
  );
  assert.ok(alignment > .999999, `air attitude diverged across packet cadence: ${alignment}`);
  assert.ok(Math.abs(steadyCar.pitchRate - burstyCar.pitchRate) < 1e-8);
  assert.ok(Math.abs(steadyCar.yawRate - burstyCar.yawRate) < 1e-8);
  assert.ok(Math.abs(steadyCar.rollRate - burstyCar.rollRate) < 1e-8);
});

test("fixed simulation substeps keep driving results stable across packet cadence", () => {
  const steady = new ArenaMatch(); const bursty = new ArenaMatch();
  const steadyCar = steady.addHuman("steady"), burstyCar = bursty.addHuman("bursty");
  isolate(steady, steadyCar); isolate(bursty, burstyCar);
  steady.input(steadyCar.id, { throttle: 1, steer: .35 });
  bursty.input(burstyCar.id, { throttle: 1, steer: .35 });
  for (let i = 0; i < 120; i += 1) steady.tick(1 / 120);
  for (let i = 0; i < 30; i += 1) bursty.tick(1 / 30);
  assert.ok(Math.abs(steadyCar.x - burstyCar.x) < .02);
  assert.ok(Math.abs(steadyCar.z - burstyCar.z) < .02);
  assert.ok(Math.abs(steadyCar.yaw - burstyCar.yaw) < .002);
});

test("ramp surfaces carry the car upward and release it into a natural fall", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: -31, z: -8, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0 });
  match.input(car.id, {}); match.tick(.05);
  assert.ok(car.h > .9, `expected ramp contact height, got ${car.h}`);
  // Start far enough beyond the raised end that the whole chassis leaves the
  // ramp during this step; the separate rear-support test covers the edge case.
  Object.assign(car, { x: -20.5, z: -8, h: 2.43, vx: 39, vz: 0, vh: 0 });
  match.tick(.05);
  assert.ok(car.h > .1 && car.vh < 0, "leaving the raised end should begin a gravity-driven fall");
});

test("surface contact exposes a flat or ramp normal through the authoritative state", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  match.input(car.id, {}); match.tick(.016);
  assert.equal(car.grounded, true);
  assert.deepEqual(match.snapshot().cars.find(view => view.id === car.id).surfaceNormal, { x: 0, y: 1, z: 0 });
  Object.assign(car, { x: -31, z: -8, h: 1.05, vx: 0, vz: 0, vh: 0 });
  match.tick(.016);
  assert.ok(car.grounded && car.surfaceNormalX < -.1 && car.surfaceNormalY < 1);
});

test("ramp contact samples the chassis corners before its centre enters", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  // Centre is just before the ramp; the nose is already on its lower edge.
  Object.assign(car, { x: -39.1, z: -8, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0 });
  match.input(car.id, {}); match.tick(.016);
  assert.ok(car.h > .08, `front chassis support did not raise the car: h=${car.h}`);
});

test("ramp contact persists under the rear chassis until every support point leaves", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: -22.1, z: -8, h: 2.43, yaw: 0, vx: 39, vz: 0, vh: 0 });
  match.input(car.id, {}); match.tick(1 / 120);
  assert.ok(car.h > 2, `rear ramp support was lost too early: h=${car.h}`);
  const normalVelocity = car.vx * car.surfaceNormalX + car.vh * car.surfaceNormalY + car.vz * car.surfaceNormalZ;
  assert.ok(Math.abs(normalVelocity) < .02, `rear ramp support should cancel normal velocity: ${normalVelocity}`);
  for (let i = 0; i < 12; i += 1) match.tick(1 / 120);
  assert.ok(!car.grounded && car.h > 0 && car.vh < 0, `car should fall only after every support point leaves: h=${car.h}, vh=${car.vh}`);
});

test("ground driving follows a ramp tangent and preserves uphill velocity", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: -31, z: -8, h: 1.3, yaw: 0, vx: 25, vz: 0, vh: 0 });
  match.input(car.id, { throttle: 1 });
  for (let i = 0; i < 8; i += 1) match.tick(1 / 120);
  const normalVelocity = car.vx * car.surfaceNormalX + car.vh * car.surfaceNormalY + car.vz * car.surfaceNormalZ;
  assert.ok(car.grounded && car.vh > 0, `ramp tangent should carry the car uphill, vh=${car.vh}`);
  assert.ok(Math.abs(normalVelocity) < .02, `ground velocity should stay tangent to the ramp, normal=${normalVelocity}`);
});

test("boost follows the chassis forward axis over a ramp", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: -31, z: -8, h: 1.3, yaw: 0, vx: 12, vz: 0, vh: 0, boost: 100 });
  match.input(car.id, { throttle: 1, boost: true }); match.tick(1 / 120);
  const normalVelocity = car.vx * car.surfaceNormalX + car.vh * car.surfaceNormalY + car.vz * car.surfaceNormalZ;
  assert.ok(car.vh > 0, `boost should preserve the uphill component, vh=${car.vh}`);
  assert.ok(Math.abs(normalVelocity) < .02, `boost should remain tangent to the ramp, normal=${normalVelocity}`);
  assert.ok(car.boost < 100);
});

test("sustained boost reaches the supersonic travel band", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: -48, z: -35, yaw: 0, vx: 0, vz: 0, vh: 0, h: 0, boost: 100 });
  match.input(car.id, { throttle: 1, boost: true });
  // Stop before reaching the arena boundary: this measures acceleration,
  // rather than the deliberately damped wall rebound.
  for (let i = 0; i < 100; i += 1) match.tick(.016);
  const view = match.snapshot().cars.find(candidate => candidate.id === car.id);
  assert.ok(view.speed > 53, `expected supersonic speed, got ${view.speed}`);
  assert.equal(view.supersonic, true);
});

test("boost uses public ground-air acceleration and a minimum pulse while respecting the speed cap", () => {
  const grounded = new ArenaMatch(); const groundCar = grounded.addHuman("ground"); isolate(grounded, groundCar);
  Object.assign(groundCar, { x: 0, z: 0, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0, boost: 100, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  grounded.input(groundCar.id, { boost: true }); grounded.tick(1 / 120);

  const airborne = new ArenaMatch(); const airCar = airborne.addHuman("air"); isolate(airborne, airCar);
  Object.assign(airCar, { x: 0, z: 0, h: 10, yaw: 0, vx: 0, vz: 0, vh: 0, boost: 100, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  airborne.input(airCar.id, { boost: true }); airborne.tick(1 / 120);
  assert.ok(airCar.vx > groundCar.vx, `air boost must exceed ground boost slightly, got ${airCar.vx} / ${groundCar.vx}`);
  assert.ok(Math.abs(groundCar.vx / airCar.vx - 2975 / 3175) < 1e-8,
    "ground and air boost must preserve the public acceleration relationship");
  grounded.input(groundCar.id, {});
  for (let frame = 0; frame < 10; frame += 1) grounded.tick(1 / 120);
  assert.equal(groundCar.boosting, true, "releasing boost before 0.1 seconds must retain the minimum pulse");
  for (let frame = 0; frame < 10 && groundCar.boosting; frame += 1) grounded.tick(1 / 120);
  assert.equal(groundCar.boosting, false, "boost must end once the minimum pulse is satisfied and input is released");

  Object.assign(groundCar, { boost: .01, boosting: true, boostTime: 0, vx: 0, vz: 0, vh: 0 });
  grounded.input(groundCar.id, { boost: true }); grounded.tick(1 / 120);
  assert.equal(groundCar.boost, 0, "the final resource fraction may power its current fixed step");
  grounded.tick(1 / 120);
  assert.equal(groundCar.boosting, false, "an empty boost meter must end the pulse even before its minimum time");

  Object.assign(airCar, { h: 10, vx: 55.95, vz: 0, vh: 0, boost: 100, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  airborne.input(airCar.id, { boost: true });
  for (let i = 0; i < 60; i += 1) {
    airborne.tick(1 / 120);
    assert.ok(Math.hypot(airCar.vx, airCar.vz, airCar.vh) <= 56 + 1e-8, "speed cap must apply after gravity");
  }
});

test("arena walls keep the car body inside the playable volume and rebound it", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: 61, z: 0, h: 0, yaw: 0, vx: 32, vz: 0, vh: 0 });
  match.input(car.id, {}); match.tick(.016);
  assert.ok(car.x <= 60.31, `car body crossed arena wall at x=${car.x}`);
  assert.ok(car.vx < 0, `expected a damped rebound, got vx=${car.vx}`);
});

test("wall contact preserves tangential motion and exposes its normal", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: 61, z: 0, h: 4, yaw: 0, vx: 32, vz: 14, vh: 0 });
  match.input(car.id, {}); match.tick(.016);
  assert.ok(car.x <= 60.23, `chassis crossed the wall at x=${car.x}`);
  assert.ok(car.vx < 0, `normal velocity should rebound, got vx=${car.vx}`);
  assert.ok(car.vz > 13, `tangential velocity was lost, got vz=${car.vz}`);
  assert.equal(car.wallNormalX, 1);
  assert.equal(match.snapshot().cars.find(view => view.id === car.id).wallNormal.x, 1);
});

test("a driven airborne wall contact becomes a short wall ride without losing tangent speed", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: 61, z: 0, h: 4, yaw: 0, vx: 32, vz: 14, vh: -2 });
  match.input(car.id, { throttle: 1 }); match.tick(.016);
  assert.equal(car.wallRide, true);
  assert.equal(car.wallNormalX, 1);
  assert.ok(car.x > 61 && car.x <= 61.1, `aligned chassis should use its side footprint at the wall, x=${car.x}`);
  assert.ok(Math.abs(car.vx) < .01, "wall ride should remove only the velocity into the wall");
  assert.ok(car.vz > 13, `wall tangent speed should survive, got vz=${car.vz}`);
  assert.ok(car.vh < 0 && car.vh > -3, `wall ride should slide under reduced gravity, got vh=${car.vh}`);
  const wallUp = rotateByQuaternion(car.orientation, { x: 0, y: 1, z: 0 });
  assert.ok(wallUp.x < -.98, `chassis roof should face into the arena and wheels toward the wall, got ${JSON.stringify(wallUp)}`);
  const view = match.snapshot().cars.find(candidate => candidate.id === car.id);
  assert.equal(view.wallRide, true);
  assert.ok(Math.abs(Math.hypot(view.orientation.x, view.orientation.y, view.orientation.z, view.orientation.w) - 1) < .03);
  const tangentSpeed = car.vz;
  match.tick(1 / 120);
  assert.ok(car.vz > tangentSpeed, `throttle should drive along the wall tangent, got ${car.vz} after ${tangentSpeed}`);
  for (let i = 0; i < 30; i += 1) match.tick(1 / 120);
  assert.equal(car.wallRide, true, "continued tangential drive should refresh wall contact beyond the initial grace window");
  assert.ok(car.wallRideTime > .15);
});

test("jumping from a wall detaches into the arena and consumes one remaining jump", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: 61, z: 0, h: 4, yaw: 0, vx: 32, vz: 14, vh: -2, jumps: 1 });
  match.input(car.id, { throttle: 1 }); match.tick(.016);
  assert.equal(car.wallRide, true);
  const xAtWall = car.x;
  match.input(car.id, { jump: true }); match.tick(1 / 120);
  assert.equal(car.jumps, 0);
  assert.equal(car.wallRide, false);
  assert.ok(car.vx < -8, `wall jump should push away from the positive X wall, vx=${car.vx}`);
  assert.ok(car.x < xAtWall, `wall jump should move the car back into the arena, x=${car.x}`);
  assert.ok(car.vh > 0, `wall jump should also provide lift, vh=${car.vh}`);
});

test("ceiling contact caps vertical motion and reports the contact", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: 0, z: 0, h: ARENA.ceilingHeight - .02, vx: 0, vz: 0, vh: 40 });
  match.input(car.id, {}); match.tick(.016);
  assert.ok(car.h <= ARENA.ceilingHeight);
  assert.ok(car.vh < 0, `ceiling should reverse upward velocity, got vh=${car.vh}`);
  assert.equal(car.ceilingContact, true);
  assert.equal(match.snapshot().cars.find(view => view.id === car.id).ceilingContact, true);
});

test("a rotated chassis reaches a wall according to its side footprint", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  // The rendered body is long along local X and narrow along local Z. At 90°
  // to the X wall its X support must use the narrow side, not a fixed circle.
  Object.assign(car, { x: 60.9, z: 0, h: 0, yaw: Math.PI / 2, vx: 0, vz: 0, vh: 0 });
  match.input(car.id, {}); match.tick(.016);
  assert.ok(car.x > 60.75, `side footprint was clamped like a circle at x=${car.x}`);
  assert.ok(car.x <= 61.09, `rotated chassis crossed the arena wall at x=${car.x}`);
});

test("longitudinal chassis footprints resolve a contact beyond the old circular diameter", () => {
  const match = new ArenaMatch();
  const a = match.addHuman("pilot-a");
  const b = match.addHuman("pilot-b");
  isolate(match, a); b.respawn = 0;
  Object.assign(a, { x: 0, z: 0, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0 });
  Object.assign(b, { x: 3.48, z: 0, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0 });
  match.input(a.id, {}); match.input(b.id, {}); match.tick(.016);
  assert.ok(b.x - a.x >= 3.54, `longitudinal chassis remained overlapped at ${b.x - a.x}`);
});

test("a fast opposing-car ram applies one bounded damage hit", () => {
  const match = new ArenaMatch(); const attacker = match.addHuman("pilot-1"); isolate(match, attacker);
  const victim = match.cars.find(car => car.team === "red");
  victim.respawn = 0;
  Object.assign(attacker, { x: 0, z: 0, h: 0, yaw: 0, vx: 56, vz: 0, vh: 0, invulnerable: 0, ramCooldown: 0 });
  Object.assign(victim, { x: 3.2, z: 0, h: 0, yaw: Math.PI, vx: 0, vz: 0, vh: 0, hp: 100, invulnerable: 0, ramCooldown: 0 });
  match.input(attacker.id, {}); match.tick(.016);
  assert.ok(victim.hp < 100 && victim.hp >= 72, `unexpected ram damage result: ${victim.hp}`);
  assert.ok(match.events.some(event => event.kind === "ram"));
  const hpAfterFirstHit = victim.hp;
  match.tick(.016);
  assert.equal(victim.hp, hpAfterFirstHit, "ram cooldown should prevent per-step damage");
});

test("an off-centre ram redirects a grounded chassis while a centred ram keeps its heading", () => {
  const offset = new ArenaMatch(); const attacker = offset.addHuman("pilot-1"); isolate(offset, attacker);
  const victim = offset.cars.find(car => car.team === "red");
  victim.respawn = 0;
  Object.assign(attacker, { x: 0, z: 0, h: 0, yaw: 0, vx: 52, vz: 0, vh: 0, invulnerable: 0 });
  Object.assign(victim, { x: 3.2, z: .62, h: 0, yaw: Math.PI, vx: 0, vz: 0, vh: 0, invulnerable: 0 });
  offset.input(attacker.id, {}); offset.tick(1 / 120);
  const redirected = offset.snapshot().cars.find(view => view.id === attacker.id);
  assert.ok(Math.abs(attacker.yaw) > .02, `offset ram should redirect heading, yaw=${attacker.yaw}`);
  assert.ok(redirected.impactSerial > 0 && redirected.impactSpin > 0, "authoritative snapshot should expose the physical impact");

  const centred = new ArenaMatch(); const centredAttacker = centred.addHuman("pilot-1"); isolate(centred, centredAttacker);
  const centredVictim = centred.cars.find(car => car.team === "red");
  centredVictim.respawn = 0;
  Object.assign(centredAttacker, { x: 0, z: 0, h: 0, yaw: 0, vx: 52, vz: 0, vh: 0, invulnerable: 0 });
  Object.assign(centredVictim, { x: 3.2, z: 0, h: 0, yaw: Math.PI, vx: 0, vz: 0, vh: 0, invulnerable: 0 });
  centred.input(centredAttacker.id, {}); centred.tick(1 / 120);
  assert.ok(Math.abs(centredAttacker.yaw) < .001, `centred ram must not invent yaw, yaw=${centredAttacker.yaw}`);
});

test("rocket splash gives a surviving opposing car an outward physical kick", () => {
  const match = new ArenaMatch(); const attacker = match.addHuman("pilot-1"); isolate(match, attacker);
  const victim = match.cars.find(car => car.team === "red");
  Object.assign(victim, { x: 5, z: 0, h: 0, hp: 100, respawn: 0, invulnerable: 0, vx: 0, vz: 0, vh: 0 });
  match.explode({ team: attacker.team, owner: attacker.id, x: 0, z: 0, h: 0, vx: 74, vz: 0, vh: 0 }, "impacto");
  assert.ok(victim.hp < 100 && victim.respawn === 0);
  assert.ok(victim.vx > 0 && victim.vh > 0, `expected outward blast kick, got ${victim.vx}, ${victim.vh}`);
});

test("an oblique aerial blast adds bounded local angular velocity", () => {
  const match = new ArenaMatch(); const attacker = match.addHuman("pilot-1"); isolate(match, attacker);
  const victim = match.cars.find(car => car.team === "red");
  Object.assign(victim, { x: 4, z: 1, h: 3.5, yaw: 0, hp: 100, respawn: 0, invulnerable: 0, vx: 0, vz: 0, vh: 0, grounded: false, airTime: .2 });
  match.explode({ team: attacker.team, owner: attacker.id, x: 0, z: 0, h: 0, vx: 74, vz: 0, vh: 0 }, "impacto");
  const view = match.snapshot().cars.find(car => car.id === victim.id);
  const angularMagnitude = Math.hypot(victim.pitchRate, victim.yawRate, victim.rollRate);
  assert.ok(angularMagnitude > .1, `oblique blast should spin an airborne chassis, angular=${angularMagnitude}`);
  assert.ok(Math.abs(victim.pitchRate) <= 8.5 && Math.abs(victim.yawRate) <= 8.5 && Math.abs(victim.rollRate) <= 8.5);
  assert.ok(view.impactSerial > 0 && view.impactSpin > 0);
});

test("scrapyard covers block cars and intercept rockets", () => {
  const match = new ArenaMatch();
  const car = match.addHuman("pilot-1");
  isolate(match, car);
  Object.assign(car, { x: -24, z: -19, h: 0, yaw: 0, vx: 42, vz: 0, vh: 0, boost: 0 });
  match.input(car.id, {});
  for (let i = 0; i < 20; i += 1) match.tick(.05);
  assert.ok(car.x <= -21.19, `car crossed cover at x=${car.x}`);

  Object.assign(car, { x: -24, z: -19, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0, fireCooldown: 0 });
  match.fireRocket(car);
  for (let i = 0; i < 6; i += 1) match.tick(.016);
  assert.equal(match.rockets.length, 0);
  assert.ok(match.events.some(event => event.text === "COHETE CONTRA COBERTURA"));
});

test("cover volumes support a landing and let a full chassis fly above", () => {
  const landing = new ArenaMatch(); const landingCar = landing.addHuman("landing"); isolate(landing, landingCar);
  Object.assign(landingCar, { x: -14, z: -19, h: 7, yaw: 0, vx: 0, vz: 0, vh: 0, boost: 0 });
  landing.input(landingCar.id, {});
  for (let i = 0; i < 80; i += 1) landing.tick(1 / 120);
  const landed = landing.snapshot().cars.find(view => view.id === landingCar.id);
  assert.ok(landingCar.h >= 4.95 && landingCar.h <= 5.05, `expected a cover-top landing, got h=${landingCar.h}`);
  assert.equal(landingCar.jumps, 2);
  assert.equal(landed.surfaceType, "cover");

  const overflight = new ArenaMatch(); const flyingCar = overflight.addHuman("flyer"); isolate(overflight, flyingCar);
  Object.assign(flyingCar, { x: -25, z: -19, h: 7, yaw: 0, vx: 35, vz: 0, vh: 0, boost: 0 });
  overflight.input(flyingCar.id, {});
  for (let i = 0; i < 24; i += 1) overflight.tick(1 / 120);
  const flying = overflight.snapshot().cars.find(view => view.id === flyingCar.id);
  assert.ok(flyingCar.x > -19.5, `a high chassis should cross the cover, x=${flyingCar.x}`);
  assert.ok(flyingCar.vx > 30, `cover should not rebound a high chassis, vx=${flyingCar.vx}`);
  assert.ok(flyingCar.h > 5.5);
  assert.equal(flying.surfaceType, "air");
});

test("raised ramps also intercept low rockets", () => {
  const match = new ArenaMatch(); const car = match.addHuman("pilot-1"); isolate(match, car);
  Object.assign(car, { x: -42, z: -8, h: 0, yaw: 0, vx: 0, vz: 0, vh: 0, fireCooldown: 0 });
  match.fireRocket(car);
  for (let i = 0; i < 14; i += 1) match.tick(.016);
  assert.equal(match.rockets.length, 0);
  assert.ok(match.events.some(event => event.text === "COHETE CONTRA RAMPA"));
});

test("a direct rocket hit damages an opposing car and gives a point on elimination", () => {
  const match = new ArenaMatch();
  const attacker = match.cars.find(car => car.team === "blue");
  const victim = match.cars.find(car => car.team === "red");
  Object.assign(attacker, { x: 0, z: 0, h: 0, yaw: 0, vx: 0, vz: 0, boost: 0, fireCooldown: 0, input: { throttle: 0, steer: 0, jump: false, boost: false, roll: 0, fire: false } });
  Object.assign(victim, { x: 6, z: 0, h: 0, hp: 45, invulnerable: 0, vx: 0, vz: 0 });
  match.fireRocket(attacker);
  for (let i = 0; i < 12; i += 1) match.tick(.016);
  assert.ok(victim.respawn > 0);
  assert.equal(match.score.blue, 1);
});

test("respawning restores a car with temporary protection", () => {
  const match = new ArenaMatch();
  const victim = match.cars[0];
  match.eliminate(victim, "missing");
  for (let i = 0; i < 160; i += 1) match.tick(.016);
  assert.equal(victim.respawn, 0); assert.equal(victim.hp, 100); assert.ok(victim.invulnerable > 0);
  assert.equal(match.snapshot().cars[0].actionSerials.respawn, 1);
});
