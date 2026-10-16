import { ArenaMatch } from "./simulation.js";

// The simulation is authoritative at 120 Hz. These probes deliberately keep
// the input schedule explicit so a future reference capture can be replayed
// against the same action edges without relying on human timing.
const FIXED_STEP_HZ = 120;
const STEP = 1 / FIXED_STEP_HZ;
const SEED = 20261011;

const round = value => {
  const rounded = Math.round(Number(value || 0) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const inputShape = input => ({
  throttle: round(input.throttle),
  steer: round(input.steer),
  jump: Boolean(input.jump),
  boost: Boolean(input.boost),
  drift: Boolean(input.drift),
  airRoll: Boolean(input.airRoll),
  roll: round(input.roll)
});

function practice() {
  const match = new ArenaMatch(SEED, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("curve-probe");
  Object.assign(car, {
    x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0,
    yaw: 0, pitch: 0, roll: 0, pitchRate: 0, yawRate: 0, rollRate: 0,
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    grounded: true, airTime: 0
  });
  return { match, car };
}

function airbornePractice() {
  const result = practice();
  Object.assign(result.car, { h: 20, grounded: false, airTime: STEP });
  return result;
}

// Start after a completed first jump, far enough above the arena for a full
// second-action trace. This separates flip dynamics from an incidental floor
// hit while retaining the same action window and input edge as a real jump.
function secondActionAirPractice() {
  const result = airbornePractice();
  Object.assign(result.car, {
    h: 20, vh: 0, grounded: false, airTime: .1,
    jumpState: "airborne", jumps: 1, secondJumpWindow: 1.15,
    jumpHold: 0, jumpElapsed: .2, lastJump: false
  });
  return result;
}

function stateSample(car, frame, input) {
  return {
    frame,
    time: round(frame * STEP),
    input: inputShape(input),
    state: {
      position: { x: round(car.x), y: round(car.h), z: round(car.z) },
      velocity: { x: round(car.vx), y: round(car.vh), z: round(car.vz) },
      angularVelocity: { pitch: round(car.pitchRate), yaw: round(car.yawRate), roll: round(car.rollRate) },
      // The JavaScript simulator stores these rates directly in chassis-local
      // controller axes. RocketSim's oracle converts its Bullet world vector
      // to the same representation before curves are compared.
      localAngularVelocity: { pitch: round(car.pitchRate), yaw: round(car.yawRate), roll: round(car.rollRate) },
      orientation: {
        x: round(car.orientation.x), y: round(car.orientation.y),
        z: round(car.orientation.z), w: round(car.orientation.w)
      },
      grounded: Boolean(car.grounded),
      jumpState: car.jumpState,
      jumps: car.jumps,
      secondJumpWindow: round(car.secondJumpWindow),
      dodgeTime: round(car.dodgeTime),
      dodgeDirection: { forward: round(car.dodgeForward), side: round(car.dodgeSide) },
      actionSerials: {
        jump: car.jumpSerial,
        doubleJump: car.doubleJumpSerial,
        dodge: car.dodgeSerial,
        respawn: car.respawnSerial
      }
    }
  };
}

function runSchedule(name, phases, initialCondition = "grounded") {
  const setup = initialCondition === "second-action-airborne"
    ? secondActionAirPractice
    : initialCondition === "airborne" ? airbornePractice : practice;
  const { match, car } = setup();
  const samples = [];
  let frame = 0;
  const markers = [];
  for (const phase of phases) {
    const input = inputShape(phase.input || {});
    for (let i = 0; i < phase.frames; i += 1) {
      match.input(car.id, input);
      match.tick(STEP);
      frame += 1;
      const sample = stateSample(car, frame, input);
      samples.push(sample);
      const serials = sample.state.actionSerials;
      if (serials.jump || serials.doubleJump || serials.dodge) {
        const marker = `${serials.jump}:${serials.doubleJump}:${serials.dodge}`;
        if (markers.at(-1)?.value !== marker) markers.push({ frame, value: marker });
      }
    }
  }
  return {
    name,
    fixedStepHz: FIXED_STEP_HZ,
    durationSeconds: round(frame * STEP),
    markers,
    samples
  };
}

const neutral = (frames, id) => ({ frames, input: {}, id });
const hold = (frames, input, id) => ({ frames, input, id });

const FIRST_JUMP = [
  hold(1, { jump: true }), hold(23, { jump: true }), neutral(120)
];

const SECOND_ACTION_PREFIX = [
  hold(1, { jump: true }), neutral(10)
];

const GROUND_CONTROL = [
  hold(48, { throttle: 1 }, "accelerate"),
  hold(24, { throttle: 1, steer: 1 }, "grip-turn"),
  hold(24, { throttle: 1, steer: 1, drift: true }, "powerslide-turn"),
  neutral(48, "release")
];

const secondAction = input => [
  ...SECOND_ACTION_PREFIX,
  hold(1, { jump: true, ...input }),
  neutral(132)
];

const airSecondAction = input => [
  neutral(11),
  hold(1, { jump: true, ...input }),
  neutral(132)
];

// This is the common input contract for the local simulator and any external
// reference runner. Every phase is expressed in authoritative 120 Hz frames,
// so no scenario depends on a human holding a key for an approximate time.
export const MOBILITY_CURVE_SCENARIOS = Object.freeze([
  {
    id: "ground-control",
    traceKey: "groundControl",
    purpose: "Aceleración, giro con agarre y powerslide en suelo.",
    initialCondition: "grounded",
    phases: GROUND_CONTROL
  },
  {
    id: "first-jump",
    traceKey: "firstJump",
    purpose: "Salto sostenido y liberación.",
    initialCondition: "grounded",
    phases: FIRST_JUMP
  },
  {
    id: "double-jump",
    traceKey: "doubleJump",
    purpose: "Segundo salto vertical sin dirección.",
    initialCondition: "grounded",
    phases: secondAction({})
  },
  {
    id: "dodge-forward",
    traceKey: "dodgeForward",
    purpose: "Dodge frontal con dirección comprometida.",
    initialCondition: "grounded",
    phases: secondAction({ throttle: 1 })
  },
  {
    id: "dodge-side",
    traceKey: "dodgeSide",
    purpose: "Dodge lateral con dirección comprometida.",
    initialCondition: "grounded",
    phases: secondAction({ steer: 1 })
  },
  {
    id: "dodge-diagonal-roll",
    traceKey: "dodgeDiagonalRoll",
    purpose: "Dodge diagonal con throttle, giro y alabeo direccional.",
    initialCondition: "grounded",
    phases: secondAction({ throttle: 1, steer: 1, roll: 1 })
  },
  {
    id: "air-axes",
    traceKey: "airAxes",
    purpose: "Pitch, yaw y roll combinados, liberación e inversión.",
    initialCondition: "airborne",
    phases: [
      hold(36, { throttle: 1, steer: 1, roll: 1 }),
      neutral(36),
      hold(36, { throttle: -1, steer: -1, roll: -1 }),
      neutral(36)
    ]
  },
  {
    id: "free-air-roll",
    traceKey: "freeAirRoll",
    purpose: "Free air roll separando el modificador de la guiñada.",
    initialCondition: "airborne",
    phases: [
      // This is the vehicle-input boundary, after composeVehicleInput has
      // mapped Shift + steer to the roll axis. Keeping the composed value in
      // the manifest lets the JavaScript simulator and native sidecar replay
      // the exact same controller action without depending on keyboard code.
      hold(36, { airRoll: true, steer: 1, roll: 1 }), neutral(36),
      hold(36, { airRoll: true, steer: -1, roll: -1 }), neutral(36)
    ]
  }
  ,{
    id: "air-pitch",
    traceKey: "airPitch",
    purpose: "Pitch aislado, liberación e inversión.",
    initialCondition: "airborne",
    phases: [hold(36, { throttle: 1 }), neutral(36), hold(36, { throttle: -1 }), neutral(36)]
  },
  {
    id: "air-yaw",
    traceKey: "airYaw",
    purpose: "Guiñada aislada, liberación e inversión.",
    initialCondition: "airborne",
    phases: [hold(36, { steer: 1 }), neutral(36), hold(36, { steer: -1 }), neutral(36)]
  },
  {
    id: "air-roll",
    traceKey: "airRoll",
    purpose: "Alabeo aislado, liberación e inversión.",
    initialCondition: "airborne",
    phases: [hold(36, { roll: 1 }), neutral(36), hold(36, { roll: -1 }), neutral(36)]
  },
  {
    id: "air-double-jump",
    traceKey: "airDoubleJump",
    purpose: "Segundo salto vertical desde una condición aérea limpia.",
    initialCondition: "second-action-airborne",
    phases: airSecondAction({})
  },
  {
    id: "air-dodge-forward",
    traceKey: "airDodgeForward",
    purpose: "Dodge frontal sin contacto incidental con el suelo.",
    initialCondition: "second-action-airborne",
    phases: airSecondAction({ throttle: 1 })
  },
  {
    id: "air-dodge-side",
    traceKey: "airDodgeSide",
    purpose: "Dodge lateral sin contacto incidental con el suelo.",
    initialCondition: "second-action-airborne",
    phases: airSecondAction({ steer: 1 })
  },
  {
    id: "air-dodge-diagonal-roll",
    traceKey: "airDodgeDiagonalRoll",
    purpose: "Dodge diagonal con air roll desde una condición aérea limpia.",
    initialCondition: "second-action-airborne",
    phases: airSecondAction({ throttle: 1, steer: 1, roll: 1 })
  }
]);

export function mobilityCurveScenarioManifest() {
  return {
    version: 1,
    fixedStepHz: FIXED_STEP_HZ,
    durationFrames: 144,
    scenarios: MOBILITY_CURVE_SCENARIOS.map(scenario => ({
      id: scenario.id,
      traceKey: scenario.traceKey,
      purpose: scenario.purpose,
      initialCondition: scenario.initialCondition,
      phases: scenario.phases.map((phase, index) => ({
        id: phase.id || `phase-${index + 1}`,
        frames: phase.frames,
        input: inputShape(phase.input || {})
      }))
    }))
  };
}

export function runMobilityCurveSuite() {
  const traces = Object.fromEntries(MOBILITY_CURVE_SCENARIOS.map(scenario => [
    scenario.traceKey,
    runSchedule(scenario.id, scenario.phases, scenario.initialCondition)
  ]));
  return {
    schemaVersion: 1,
    profile: "calibration",
    source: "CarSoccerArsenal",
    seed: SEED,
    fixedStepHz: FIXED_STEP_HZ,
    sampling: "one sample after every authoritative fixed step",
    scenarioManifest: mobilityCurveScenarioManifest(),
    traces
  };
}

