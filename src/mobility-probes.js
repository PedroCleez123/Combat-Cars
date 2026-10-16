import { ARENA, ArenaMatch } from "./simulation.js";

const STEP = 1 / 120;

const round = value => Math.round(value * 1000) / 1000;
const magnitude = (x, y, z) => Math.hypot(x, y, z);

function forwardFromQuaternion(q) {
  const ix = q.w + q.y * 0 - q.z * 0;
  const iy = q.z;
  const iz = -q.y;
  const iw = -q.x;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

function practice(seed = 20261010) {
  const match = new ArenaMatch(seed, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("probe");
  return { match, car };
}

function advance(match, car, frames, input, observe) {
  for (let frame = 0; frame < frames; frame += 1) {
    match.input(car.id, input);
    match.tick(STEP);
    observe?.(frame, car);
  }
}

function groundProbe() {
  const { match, car } = practice();
  const start = { x: car.x, y: car.h, z: car.z };
  const initialForward = forwardFromQuaternion(car.orientation);
  let speedAtOneSecond = 0;
  advance(match, car, 240, { throttle: 1 }, frame => {
    if (frame === 119) speedAtOneSecond = magnitude(car.vx, car.vh, car.vz);
  });
  const speedAtTwoSeconds = magnitude(car.vx, car.vh, car.vz);

  const braking = practice();
  advance(braking.match, braking.car, 120, { throttle: 1 });
  let reverseAt = null;
  advance(braking.match, braking.car, 180, { throttle: -1 }, frame => {
    const forward = forwardFromQuaternion(braking.car.orientation);
    const forwardSpeed = braking.car.vx * forward.x + braking.car.vh * forward.y + braking.car.vz * forward.z;
    if (reverseAt === null && forwardSpeed <= 0) reverseAt = (frame + 1) * STEP;
  });

  const turning = practice();
  Object.assign(turning.car, { x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 } });
  advance(turning.match, turning.car, 120, { throttle: 1 });
  advance(turning.match, turning.car, 1, { throttle: 1, steer: 1 });
  const firstTurnYaw = turning.car.yaw;
  advance(turning.match, turning.car, 119, { throttle: 1, steer: 1 });

  const lateral = practice();
  Object.assign(lateral.car, { x: 0, z: 0, h: 0, vx: 18, vz: 8, vh: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 } });
  advance(lateral.match, lateral.car, 1, {});

  const powerslide = practice();
  Object.assign(powerslide.car, { x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, yawRate: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 } });
  advance(powerslide.match, powerslide.car, 120, { throttle: 1 });
  advance(powerslide.match, powerslide.car, 60, { throttle: 1, steer: 1, drift: true });
  const yawAtRelease = powerslide.car.yaw;
  const yawRateAtRelease = powerslide.car.yawRate;
  const slipAtRelease = -powerslide.car.vx * Math.sin(powerslide.car.yaw) + powerslide.car.vz * Math.cos(powerslide.car.yaw);
  advance(powerslide.match, powerslide.car, 120, { throttle: 1 });
  const slipAfterRecovery = -powerslide.car.vx * Math.sin(powerslide.car.yaw) + powerslide.car.vz * Math.cos(powerslide.car.yaw);
  return {
    distanceAtTwoSeconds: round((car.x - start.x) * initialForward.x + (car.h - start.y) * initialForward.y + (car.z - start.z) * initialForward.z),
    speedAtOneSecond: round(speedAtOneSecond),
    speedAtTwoSeconds: round(speedAtTwoSeconds),
    timeToReverse: round(reverseAt ?? 180 * STEP),
    turning: {
      firstStepYaw: round(firstTurnYaw),
      yawAfterOneSecond: round(turning.car.yaw),
      lateralDisplacementAfterOneSecond: round(turning.car.z),
      speedAfterOneSecond: round(magnitude(turning.car.vx, turning.car.vh, turning.car.vz))
    },
    lateralGrip: { initialSpeed: 8, speedAfterOneStep: round(lateral.car.vz) },
    powerslide: {
      yawAfterHalfSecond: round(yawAtRelease),
      yawRateAtRelease: round(yawRateAtRelease),
      lateralSlipAtRelease: round(slipAtRelease),
      lateralSlipAfterRecovery: round(slipAfterRecovery)
    }
  };
}

function jumpProbe() {
  const { match, car } = practice();
  let maxHeight = 0, landedAt = null;
  advance(match, car, 1, { jump: true });
  advance(match, car, 23, { jump: true });
  advance(match, car, 360, {}, frame => {
    maxHeight = Math.max(maxHeight, car.h);
    // Suspension can hold the root a few millimetres above the legacy zero
    // reference, so landing is an authoritative support transition rather
    // than an exact position comparison.
    if (landedAt === null && frame > 4 && car.grounded && car.jumps === 2) landedAt = (frame + 1) * STEP;
  });
  return { apex: round(maxHeight), airtime: round(landedAt ?? 360 * STEP), landingState: car.jumpState };
}

function jumpActionProbe() {
  const dodge = practice();
  advance(dodge.match, dodge.car, 1, { jump: true });
  const first = dodge.match.snapshot().cars[0];
  advance(dodge.match, dodge.car, 5, {});
  advance(dodge.match, dodge.car, 1, { jump: true, throttle: 1, steer: 1 });
  const committed = dodge.match.snapshot().cars[0];
  const direction = { forward: dodge.car.dodgeForward, side: dodge.car.dodgeSide };
  advance(dodge.match, dodge.car, 30, {});
  const afterDodge = dodge.match.snapshot().cars[0];
  advance(dodge.match, dodge.car, 360, {});
  const landed = dodge.match.snapshot().cars[0];

  const vertical = practice();
  advance(vertical.match, vertical.car, 1, { jump: true });
  advance(vertical.match, vertical.car, 10, {});
  advance(vertical.match, vertical.car, 1, { jump: true });
  const doubleJump = vertical.match.snapshot().cars[0];

  // FIS-14I measures the transition that is easiest to make feel artificial:
  // a diagonal dodge with both yaw and directional air roll reaches the floor
  // while its chassis still has attitude and lateral momentum.  This is a
  // baseline for tuning the transition, not a target copied from a reference.
  const rollDodgeLanding = practice();
  advance(rollDodgeLanding.match, rollDodgeLanding.car, 1, { jump: true });
  advance(rollDodgeLanding.match, rollDodgeLanding.car, 5, {});
  advance(rollDodgeLanding.match, rollDodgeLanding.car, 1, { jump: true, throttle: 1, steer: 1, roll: 1 });
  const rollDodgeStart = { x: rollDodgeLanding.car.x, z: rollDodgeLanding.car.z };
  const rollDodgeDirection = {
    forward: rollDodgeLanding.car.dodgeForward,
    side: rollDodgeLanding.car.dodgeSide
  };
  let firstSupport = null;
  let impact = null;
  advance(rollDodgeLanding.match, rollDodgeLanding.car, 480, {}, frame => {
    if (impact === null && rollDodgeLanding.car.lastLanding) impact = { ...rollDodgeLanding.car.lastLanding };
    if (firstSupport === null && rollDodgeLanding.car.grounded && rollDodgeLanding.car.jumps === 2) {
      firstSupport = {
        frame: frame + 1,
        seconds: (frame + 1) * STEP,
        pitch: rollDodgeLanding.car.pitch,
        roll: rollDodgeLanding.car.roll,
        horizontalSpeed: Math.hypot(rollDodgeLanding.car.vx, rollDodgeLanding.car.vz),
        travel: Math.hypot(rollDodgeLanding.car.x - rollDodgeStart.x, rollDodgeLanding.car.z - rollDodgeStart.z),
        floorContact: contactSummary(rollDodgeLanding.car, "floor")
      };
    }
  });

  return {
    directionalDodge: {
      firstState: first.jumpState,
      firstWindow: first.jumpWindowRemaining,
      committedState: committed.jumpState,
      direction: { forward: round(direction.forward), side: round(direction.side) },
      stateAfterCommit: afterDodge.jumpState,
      landingState: landed.jumpState,
      jumpsAfterLanding: landed.jumps
    },
    verticalDoubleJump: {
      state: doubleJump.jumpState,
      jumpHoldRemaining: doubleJump.jumpHoldRemaining,
      jumps: doubleJump.jumps
    },
    yawRollDodgeLanding: {
      direction: { forward: round(rollDodgeDirection.forward), side: round(rollDodgeDirection.side) },
      firstSupport: firstSupport && {
        frame: firstSupport.frame,
        seconds: round(firstSupport.seconds),
        pitch: round(firstSupport.pitch), roll: round(firstSupport.roll),
        horizontalSpeed: round(firstSupport.horizontalSpeed), travel: round(firstSupport.travel),
        floorContact: firstSupport.floorContact
      },
      impact: impact && {
        pitch: round(impact.pitch), roll: round(impact.roll),
        pitchRate: round(impact.pitchRate), rollRate: round(impact.rollRate),
        normalSpeed: round(impact.normalSpeed)
      },
      final: {
        grounded: rollDodgeLanding.car.grounded,
        jumps: rollDodgeLanding.car.jumps,
        pitch: round(rollDodgeLanding.car.pitch),
        roll: round(rollDodgeLanding.car.roll)
      }
    }
  };
}

function airProbe() {
  const { match, car } = practice();
  Object.assign(car, { x: 0, z: 0, h: 10, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  advance(match, car, 54, { throttle: 1, steer: 1, airRoll: false, roll: 1 });
  const forward = forwardFromQuaternion(car.orientation);
  return {
    forwardYAfter045Seconds: round(forward.y),
    pitchRate: round(car.pitchRate),
    yawRate: round(car.yawRate),
    rollRate: round(car.rollRate)
  };
}

function airAxisProbe() {
  const prepare = () => {
    const result = practice();
    Object.assign(result.car, {
      x: 0, z: 0, h: 12, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0,
      orientation: { x: 0, y: 0, z: 0, w: 1 }
    });
    return result;
  };
  const sampleAxis = input => {
    const { match, car } = prepare();
    advance(match, car, 36, input);
    const forward = forwardFromQuaternion(car.orientation);
    const up = rotateUp(car.orientation);
    const driven = { pitch: car.pitchRate, yaw: car.yawRate, roll: car.rollRate };
    advance(match, car, 48, {});
    return {
      forward: { y: round(forward.y), z: round(forward.z) },
      up: { z: round(up.z) },
      drivenRates: { pitch: round(driven.pitch), yaw: round(driven.yaw), roll: round(driven.roll) },
      releasedRates: { pitch: round(car.pitchRate), yaw: round(car.yawRate), roll: round(car.rollRate) }
    };
  };
  const climb = prepare();
  advance(climb.match, climb.car, 36, { throttle: -1 });
  const climbVelocity = climb.car.vh;
  advance(climb.match, climb.car, 24, { boost: true });

  const dive = prepare();
  advance(dive.match, dive.car, 36, { throttle: 1 });
  const diveVelocity = dive.car.vh;
  advance(dive.match, dive.car, 24, { boost: true });

  return {
    pitchDown: sampleAxis({ throttle: 1 }),
    pitchUp: sampleAxis({ throttle: -1 }),
    yawRight: sampleAxis({ steer: 1 }),
    rollRight: sampleAxis({ airRoll: true, roll: 1 }),
    boostVector: {
      noseUpVerticalDelta: round(climb.car.vh - climbVelocity),
      noseDownVerticalDelta: round(dive.car.vh - diveVelocity)
    }
  };
}

function airManeuverProbe() {
  const phases = [
    { label: "pitchDown", frames: 24, input: { throttle: 1 } },
    { label: "pitchReverse", frames: 36, input: { throttle: -1 } },
    { label: "rightYawRoll", frames: 12, input: { steer: 1, airRoll: false, roll: 1 } },
    { label: "leftYawRoll", frames: 24, input: { steer: -1, airRoll: false, roll: -1 } },
    { label: "release", frames: 18, input: {} },
    { label: "noseUp", frames: 54, input: { throttle: -1 } },
    { label: "boost", frames: 12, input: { boost: true } }
  ];
  const view = (car, elapsed, label) => {
    const forward = forwardFromQuaternion(car.orientation);
    const up = rotateUp(car.orientation);
    return {
      label, time: round(elapsed), grounded: car.grounded,
      forward: { y: round(forward.y), z: round(forward.z) },
      up: { z: round(up.z) },
      angularVelocity: { pitch: round(car.pitchRate), yaw: round(car.yawRate), roll: round(car.rollRate) },
      velocity: { x: round(car.vx), y: round(car.vh), z: round(car.vz) },
      speed: round(magnitude(car.vx, car.vh, car.vz))
    };
  };
  const run = grouped => {
    const { match, car } = practice();
    Object.assign(car, {
      // The full maneuver lasts 1.5 seconds. Start safely below the ceiling
      // so the captured flight path never turns into a contact test.
      x: 0, z: 0, h: 22, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0,
      orientation: { x: 0, y: 0, z: 0, w: 1 }
    });
    let elapsed = 0;
    return phases.map(phase => {
      match.input(car.id, phase.input);
      if (grouped) {
        // ArenaMatch intentionally caps a network packet at 50 ms. Deliver
        // this 20 Hz version in legal packets, then compare it with 120 Hz.
        for (let packets = phase.frames / 6; packets > 0; packets -= 1) match.tick(6 * STEP);
      } else advance(match, car, phase.frames, phase.input);
      elapsed += phase.frames * STEP;
      return view(car, elapsed, phase.label);
    });
  };
  const fixed = run(false);
  const grouped = run(true);
  return { trace: fixed, cadenceMatches: JSON.stringify(fixed) === JSON.stringify(grouped) };
}

function rotateUp(q) {
  const ix = -q.z;
  const iy = q.w;
  const iz = q.x;
  const iw = -q.y;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  };
}

function boostProbe() {
  const { match, car } = practice();
  Object.assign(car, { x: 0, z: 0, h: 10, vx: 0, vz: 0, vh: 0, yaw: 0, pitch: 0, roll: 0, boost: 12, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  advance(match, car, 120, { boost: true });
  return { speedAfterOneSecond: round(magnitude(car.vx, car.vh, car.vz)), boostValueAfterOneSecond: round(car.boost) };
}

function dodgeProbe(label, input) {
  const { match, car } = practice();
  advance(match, car, 1, { jump: true });
  advance(match, car, 10, {});
  const before = { x: car.x, h: car.h, z: car.z, vx: car.vx, vh: car.vh, vz: car.vz };
  advance(match, car, 1, { jump: true, ...input });
  const initial = { x: car.vx - before.vx, y: car.vh - before.vh, z: car.vz - before.vz };
  advance(match, car, 20, {});
  return [label, {
    impulse: { x: round(initial.x), y: round(initial.y), z: round(initial.z) },
    displacement: { x: round(car.x - before.x), y: round(car.h - before.h), z: round(car.z - before.z) }
  }];
}

function contactSummary(car, kind) {
  const contact = car.contacts.find(item => item.kind === kind);
  if (!contact) return null;
  return {
    kind: contact.kind,
    normal: contact.normal,
    point: { x: round(contact.point.x), y: round(contact.point.y), z: round(contact.point.z) },
    wheelCount: contact.wheelCount,
    normalVelocity: round(contact.normalVelocity),
    separation: round(contact.separation)
  };
}

function contactProbe() {
  const rest = practice();
  advance(rest.match, rest.car, 1200, {});

  const wallScenarios = [
    { label: "east", axis: "x", tangentAxis: "z", position: 60, normalSpeed: 20, tangentSpeed: 8 },
    { label: "west", axis: "x", tangentAxis: "z", position: -60, normalSpeed: -20, tangentSpeed: 8 },
    { label: "south", axis: "z", tangentAxis: "x", position: 44.8, normalSpeed: 20, tangentSpeed: 8 },
    { label: "north", axis: "z", tangentAxis: "x", position: -44.8, normalSpeed: -20, tangentSpeed: 8 }
  ];
  const walls = wallScenarios.map(scenario => {
    const { match, car } = practice();
    const normalVelocityKey = scenario.axis === "x" ? "vx" : "vz";
    const tangentVelocityKey = scenario.tangentAxis === "x" ? "vx" : "vz";
    Object.assign(car, { h: 5, [scenario.axis]: scenario.position });
    Object.assign(car, { [normalVelocityKey]: scenario.normalSpeed, [tangentVelocityKey]: scenario.tangentSpeed });
    advance(match, car, 2, {});
    return [scenario.label, {
      contact: contactSummary(car, "wall"),
      normalSpeedAfterImpact: round(car[normalVelocityKey]),
      tangentSpeedAfterImpact: round(car[tangentVelocityKey])
    }];
  });

  const ceiling = practice();
  Object.assign(ceiling.car, { h: 23.5, vx: 9, vz: 0, vh: 32 });
  advance(ceiling.match, ceiling.car, 1, {});
  return {
    floorAfterTenSeconds: {
      height: round(rest.car.h),
      verticalSpeed: round(rest.car.vh),
      contact: contactSummary(rest.car, "floor")
    },
    walls: Object.fromEntries(walls),
    ceiling: {
      height: round(ceiling.car.h),
      verticalSpeed: round(ceiling.car.vh),
      contact: contactSummary(ceiling.car, "ceiling")
    }
  };
}

function suspensionProbe() {
  const drop = practice();
  Object.assign(drop.car, { h: 8, vh: 0 });
  const settleHeights = [];
  advance(drop.match, drop.car, 600, {}, frame => {
    if (frame >= 540) settleHeights.push(drop.car.h);
  });

  const attitudeLandings = Object.fromEntries([
    { label: "pitch", axis: "z", angle: .28, key: "pitch" },
    { label: "roll", axis: "x", angle: -.24, key: "roll" }
  ].map(scenario => {
    const { match, car } = practice();
    const half = scenario.angle / 2;
    const orientation = scenario.axis === "x"
      ? { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) }
      : { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
    Object.assign(car, { h: 7, vh: 0, orientation, [scenario.key]: scenario.angle });
    let minimumFloorSeparation = Infinity;
    let firstSupportFrame = null;
    let angleAtFirstSupport = null;
    let impact = null;
    advance(match, car, 600, {}, () => {
      const floor = car.contacts.find(item => item.kind === "floor");
      if (floor) minimumFloorSeparation = Math.min(minimumFloorSeparation, floor.separation);
      if (impact === null && car.lastLanding) impact = { ...car.lastLanding };
      if (firstSupportFrame === null && car.grounded) {
        firstSupportFrame = match.tickCount;
        angleAtFirstSupport = car[scenario.key];
      }
    });
    return [scenario.label, {
      finalAngle: round(car[scenario.key]),
      firstSupportFrame,
      firstSupportSeconds: firstSupportFrame === null ? null : round(firstSupportFrame * STEP),
      angleAtFirstSupport: angleAtFirstSupport === null ? null : round(angleAtFirstSupport),
      impact: impact && {
        pitch: round(impact.pitch), roll: round(impact.roll),
        pitchRate: round(impact.pitchRate), rollRate: round(impact.rollRate),
        normalSpeed: round(impact.normalSpeed)
      },
      minimumFloorSeparation: round(minimumFloorSeparation),
      grounded: car.grounded,
      floorContact: contactSummary(car, "floor")
    }];
  }));

  const jumps = practice();
  advance(jumps.match, jumps.car, 1, { jump: true });
  const afterFirstJump = jumps.car.jumps;
  advance(jumps.match, jumps.car, 5, {});
  advance(jumps.match, jumps.car, 1, { jump: true });
  const afterSecondJump = jumps.car.jumps;
  advance(jumps.match, jumps.car, 360, {});

  const corner = practice();
  Object.assign(corner.car, {
    x: ARENA.halfWidth - 2.4, z: 0, h: 2,
    vx: 16, vz: 0, vh: -2
  });
  advance(corner.match, corner.car, 240, {});
  const cornerState = corner.match.snapshot().cars[0];

  return {
    flatDrop: {
      landed: drop.car.grounded,
      height: round(drop.car.h),
      verticalSpeed: round(drop.car.vh),
      settleHeightRange: round(Math.max(...settleHeights) - Math.min(...settleHeights)),
      floorContact: contactSummary(drop.car, "floor")
    },
    attitudeLandings,
    jumpRecovery: {
      afterFirstJump,
      afterSecondJump,
      afterLanding: jumps.car.jumps,
      grounded: jumps.car.grounded,
      floorContact: contactSummary(jumps.car, "floor")
    },
    floorWallCorner: {
      x: round(corner.car.x),
      grounded: cornerState.grounded,
      floorContact: contactSummary(corner.car, "floor"),
      wallContact: contactSummary(corner.car, "wall")
    }
  };
}

const clampUnit = value => Math.max(-1, Math.min(1, value));

function prepareFlatPractice() {
  const result = practice();
  Object.assign(result.car, {
    x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0,
    yaw: 0, pitch: 0, roll: 0, pitchRate: 0, yawRate: 0, rollRate: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 }
  });
  return result;
}

function prepareAirPractice() {
  const result = prepareFlatPractice();
  // These manoeuvres are deliberately short, but begin high enough that a
  // contact cannot make an angular response look faster or slower.
  Object.assign(result.car, { h: 20, grounded: false, airTime: .01 });
  return result;
}

function firstFrame(frames, advanceFrame, condition) {
  for (let frame = 0; frame < frames; frame += 1) {
    advanceFrame(frame);
    if (condition()) return frame + 1;
  }
  return null;
}

function airAxisEnvelope(label, input, rateKey, vector) {
  const { match, car } = prepareAirPractice();
  const initial = vector(car.orientation);
  const quarterTurnFrame = firstFrame(180, () => {
    match.input(car.id, input);
    match.tick(STEP);
  }, () => {
    const current = vector(car.orientation);
    const dot = initial.x * current.x + initial.y * current.y + initial.z * current.z;
    return Math.acos(clampUnit(dot)) >= Math.PI / 2;
  });
  const rateAtQuarterTurn = car[rateKey];
  const releaseFrame = firstFrame(180, () => {
    match.input(car.id, {});
    match.tick(STEP);
  }, () => Math.abs(car[rateKey]) <= .05);

  const reverse = prepareAirPractice();
  advance(reverse.match, reverse.car, 36, input);
  const drivenRate = reverse.car[rateKey];
  const reversalFrame = firstFrame(180, () => {
    // Boolean actions are not part of these manoeuvres. Keeping this explicit
    // protects the envelope from accidentally turning a future action into a
    // truthy negative value.
    reverse.match.input(reverse.car.id, Object.fromEntries(Object.entries(input)
      .map(([key, value]) => [key, typeof value === "number" ? -value : value])));
    reverse.match.tick(STEP);
  }, () => Math.sign(reverse.car[rateKey]) !== Math.sign(drivenRate));

  return {
    label,
    quarterTurnSeconds: round((quarterTurnFrame ?? 180) * STEP),
    quarterTurnReached: quarterTurnFrame !== null,
    rateAtQuarterTurn: round(rateAtQuarterTurn),
    releaseToNeutralSeconds: round((releaseFrame ?? 180) * STEP),
    releaseSettled: releaseFrame !== null,
    reverseToNeutralSeconds: round((reversalFrame ?? 180) * STEP),
    reverseReached: reversalFrame !== null
  };
}

function groundEnvelope() {
  const straight = prepareFlatPractice();
  const supersonicFrame = firstFrame(300, () => {
    straight.match.input(straight.car.id, { throttle: 1, boost: true });
    straight.match.tick(STEP);
  }, () => Math.hypot(straight.car.vx, straight.car.vh, straight.car.vz) >= 53);

  const quarterTurn = input => {
    const trial = prepareFlatPractice();
    advance(trial.match, trial.car, 120, { throttle: 1 });
    const startYaw = trial.car.yaw;
    const entrySpeed = Math.hypot(trial.car.vx, trial.car.vz);
    let previous = { x: trial.car.x, z: trial.car.z };
    let arcLength = 0;
    const frame = firstFrame(180, () => {
      trial.match.input(trial.car.id, input);
      trial.match.tick(STEP);
      arcLength += Math.hypot(trial.car.x - previous.x, trial.car.z - previous.z);
      previous = { x: trial.car.x, z: trial.car.z };
    }, () => Math.abs(trial.car.yaw - startYaw) >= Math.PI / 2);
    const sweptRadians = Math.abs(trial.car.yaw - startYaw);
    const exitSpeed = Math.hypot(trial.car.vx, trial.car.vz);
    const right = { x: -Math.sin(trial.car.yaw), z: Math.cos(trial.car.yaw) };
    const lateralSpeed = trial.car.vx * right.x + trial.car.vz * right.z;
    const recoveryFrame = input.drift ? firstFrame(180, () => {
      trial.match.input(trial.car.id, { throttle: 1 });
      trial.match.tick(STEP);
    }, () => {
      const recoveryRight = { x: -Math.sin(trial.car.yaw), z: Math.cos(trial.car.yaw) };
      const recoverySlip = trial.car.vx * recoveryRight.x + trial.car.vz * recoveryRight.z;
      return Math.abs(recoverySlip) <= .25 && Math.abs(trial.car.yawRate) <= .1;
    }) : null;
    return {
      seconds: round((frame ?? 180) * STEP),
      reached: frame !== null,
      effectiveRadius: round(arcLength / Math.max(sweptRadians, .0001)),
      entrySpeed: round(entrySpeed),
      exitSpeed: round(exitSpeed),
      speedRetention: round(exitSpeed / Math.max(entrySpeed, .0001)),
      lateralSpeedAtQuarterTurn: round(lateralSpeed),
      recoverySeconds: recoveryFrame === null ? null : round(recoveryFrame * STEP),
      recovered: recoveryFrame !== null
    };
  };
  const gripTurn = quarterTurn({ throttle: 1, steer: 1 });
  const powerslideTurn = quarterTurn({ throttle: 1, steer: 1, drift: true });
  const speedBandTurn = (entrySpeed, drift, boost) => {
    const trial = prepareFlatPractice();
    // Start away from every boundary so the highest speed + boost trace is a
    // steering measurement rather than a wall-contact measurement.
    Object.assign(trial.car, { x: -24, z: 0, vx: entrySpeed, vz: 0, vh: 0 });
    const startYaw = trial.car.yaw;
    let previous = { x: trial.car.x, z: trial.car.z };
    let arcLength = 0;
    let peakSpeed = entrySpeed;
    const frame = firstFrame(180, () => {
      trial.match.input(trial.car.id, { throttle: 1, steer: 1, drift, boost });
      trial.match.tick(STEP);
      arcLength += Math.hypot(trial.car.x - previous.x, trial.car.z - previous.z);
      previous = { x: trial.car.x, z: trial.car.z };
      peakSpeed = Math.max(peakSpeed, Math.hypot(trial.car.vx, trial.car.vz));
    }, () => Math.abs(trial.car.yaw - startYaw) >= Math.PI / 4);
    const sweptRadians = Math.abs(trial.car.yaw - startYaw);
    const exitSpeed = Math.hypot(trial.car.vx, trial.car.vz);
    const right = { x: -Math.sin(trial.car.yaw), z: Math.cos(trial.car.yaw) };
    const lateralSpeed = trial.car.vx * right.x + trial.car.vz * right.z;
    return {
      reached: frame !== null,
      seconds: round((frame ?? 180) * STEP),
      effectiveRadius: round(arcLength / Math.max(sweptRadians, .0001)),
      entrySpeed: round(entrySpeed),
      exitSpeed: round(exitSpeed),
      peakSpeed: round(peakSpeed),
      speedRetention: round(exitSpeed / Math.max(entrySpeed, .0001)),
      lateralSpeedAtEighthTurn: round(lateralSpeed)
    };
  };
  const speedBands = Object.fromEntries([12, 28, 42].map(entrySpeed => [
    String(entrySpeed), {
      grip: speedBandTurn(entrySpeed, false, false),
      powerslide: speedBandTurn(entrySpeed, true, false),
      gripBoost: speedBandTurn(entrySpeed, false, true),
      powerslideBoost: speedBandTurn(entrySpeed, true, true)
    }
  ]));

  return {
    boostToSupersonicSeconds: round((supersonicFrame ?? 300) * STEP),
    boostReachedSupersonic: supersonicFrame !== null,
    gripQuarterTurn: gripTurn,
    powerslideQuarterTurn: powerslideTurn,
    speedBands
  };
}

function actionEnvelope() {
  const jump = prepareFlatPractice();
  let apex = jump.car.h;
  advance(jump.match, jump.car, 1, { jump: true });
  advance(jump.match, jump.car, 23, { jump: true });
  const landingFrame = firstFrame(360, () => {
    jump.match.input(jump.car.id, {});
    jump.match.tick(STEP);
    apex = Math.max(apex, jump.car.h);
  }, () => jump.car.grounded && jump.car.jumps === 2);

  const dodge = prepareFlatPractice();
  advance(dodge.match, dodge.car, 1, { jump: true });
  advance(dodge.match, dodge.car, 5, {});
  const start = { x: dodge.car.x, z: dodge.car.z };
  advance(dodge.match, dodge.car, 1, { jump: true, throttle: 1 });
  advance(dodge.match, dodge.car, 20, {});

  // FIS-18 compares the two second-action families under the same takeoff.
  // A vertical double jump supplies lift; a directional dodge commits a
  // horizontal impulse and leaves existing vertical velocity untouched apart
  // from the short reference damping window.
  const measureSecondAction = (input) => {
    const action = prepareFlatPractice();
    advance(action.match, action.car, 1, { jump: true });
    advance(action.match, action.car, 10, {});
    const beforeVerticalVelocity = action.car.vh;
    advance(action.match, action.car, 1, { jump: true, ...input });
    const initialVerticalVelocityDelta = action.car.vh - beforeVerticalVelocity;
    let apex = action.car.h;
    advance(action.match, action.car, 20, {}, () => { apex = Math.max(apex, action.car.h); });
    return {
      initialVerticalVelocityDelta: round(initialVerticalVelocityDelta),
      apexAt0175Seconds: round(apex),
      committedDodge: action.car.dodgeSerial === 1,
      committedDoubleJump: action.car.doubleJumpSerial === 1
    };
  };
  const verticalDouble = measureSecondAction({});
  const forwardDodge = measureSecondAction({ throttle: 1 });
  const sideDodge = measureSecondAction({ steer: 1 });
  return {
    heldJumpApex: round(apex),
    heldJumpAirtimeSeconds: round((landingFrame ?? 360) * STEP),
    landedWithTwoJumps: landingFrame !== null,
    forwardDodgeDistanceAt0175Seconds: round(Math.hypot(dodge.car.x - start.x, dodge.car.z - start.z)),
    dodgeCommitted: dodge.car.dodgeSerial === 1,
    secondJump: {
      verticalDouble,
      forwardDodge,
      sideDodge,
      directedLiftBelowVertical: forwardDodge.initialVerticalVelocityDelta < verticalDouble.initialVerticalVelocityDelta,
      levelDirectionsMatch: Math.abs(forwardDodge.initialVerticalVelocityDelta - sideDodge.initialVerticalVelocityDelta) < .03
    }
  };
}

// CAL-04 is a kinematic envelope, not a claim that these values duplicate a
// reference game. It makes the next tuning decision observable: each family
// has a rise, release, reversal or travel measurement under the same 120 Hz
// authoritative simulation used by play.
export function runMobilityEnvelope() {
  return {
    fixedStepHz: 120,
    profile: "calibration",
    ground: groundEnvelope(),
    actions: actionEnvelope(),
    air: {
      pitch: airAxisEnvelope("pitch", { throttle: 1 }, "pitchRate", forwardFromQuaternion),
      yaw: airAxisEnvelope("yaw", { steer: 1 }, "yawRate", forwardFromQuaternion),
      roll: airAxisEnvelope("roll", { roll: 1 }, "rollRate", rotateUp)
    }
  };
}

// A deterministic baseline rather than a target-value assertion. These
// probes expose the effect of each later physics change in a clean arena.
export function runMobilityProbes() {
  const dodges = Object.fromEntries([
    dodgeProbe("forward", { throttle: 1 }), dodgeProbe("back", { throttle: -1 }),
    dodgeProbe("left", { steer: -1 }), dodgeProbe("right", { steer: 1 }),
    dodgeProbe("forwardLeft", { throttle: 1, steer: -1 }), dodgeProbe("forwardRight", { throttle: 1, steer: 1 }),
    dodgeProbe("backLeft", { throttle: -1, steer: -1 }), dodgeProbe("backRight", { throttle: -1, steer: 1 })
  ]);
  return {
    fixedStepHz: 120, profile: "calibration", ground: groundProbe(), jump: jumpProbe(), jumpActions: jumpActionProbe(), air: airProbe(), airAxes: airAxisProbe(), airManeuver: airManeuverProbe(), boost: boostProbe(),
    contacts: contactProbe(), suspension: suspensionProbe(), dodges
  };
}

