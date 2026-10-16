import { ArenaMatch } from "./simulation.js";

const FIXED_STEP_HZ = 120;
const STEP = 1 / FIXED_STEP_HZ;
const DEFAULT_FRAMES = 300;
// Keep the probe aligned with the authoritative gameplay support gate. A
// tilted landing can be supported by a pair of tires before each spring
// reaches the flat-rest .10 compression used by the old capture.
const WHEEL_SUPPORT_COMPRESSION = .01;

const round = value => Math.round(Number(value || 0) * 10000) / 10000;

function practice(seed = 20261011) {
  const match = new ArenaMatch(seed, { arena: "calibration", vehicleLimit: 1, botCount: 0 });
  const car = match.addHuman("m4-contact-probe");
  return { match, car };
}

function setDropCondition(car, { height = 8, pitch = 0, roll = 0 } = {}) {
  const halfPitch = pitch / 2;
  const halfRoll = roll / 2;
  const orientation = roll !== 0
    ? { x: Math.sin(halfRoll), y: 0, z: 0, w: Math.cos(halfRoll) }
    : { x: 0, y: 0, z: Math.sin(halfPitch), w: Math.cos(halfPitch) };
  Object.assign(car, {
    x: 0, z: 0, h: height, vx: 0, vz: 0, vh: 0,
    yaw: 0, pitch, roll, pitchRate: 0, yawRate: 0, rollRate: 0,
    orientation
  });
}

function stateSample(view, frame, input) {
  const floor = view.contacts.find(contact => contact.kind === "floor") || null;
  const floorWheels = view.wheels.filter(wheel => wheel.kind === "floor");
  const loadedWheels = floorWheels.filter(wheel => wheel.compression >= WHEEL_SUPPORT_COMPRESSION
    && wheel.normalVelocity <= .05);
  const bodyContact = Boolean(floor);
  const wheelSupport = loadedWheels.length >= 2;
  const normal = floor?.normal || { x: 0, y: 0, z: 0 };
  const normalSpeed = view.velocity.x * normal.x + view.velocity.y * normal.y + view.velocity.z * normal.z;
  const tangentSpeed = Math.hypot(
    view.velocity.x - normal.x * normalSpeed,
    view.velocity.y - normal.y * normalSpeed,
    view.velocity.z - normal.z * normalSpeed
  );
  return {
    frame,
    time: round(frame / FIXED_STEP_HZ),
    input: { ...input },
    state: {
      position: { x: view.x, y: view.h, z: view.z },
      velocity: { ...view.velocity },
      angularVelocity: { ...view.angularVelocity },
      orientation: { ...view.orientation },
      grounded: view.grounded,
      jumpState: view.jumpState,
      jumps: view.jumps,
      dodgeRemaining: view.dodgeRemaining,
      actionSerials: { ...view.actionSerials },
      contacts: view.contacts.map(contact => ({ ...contact })),
      wheels: view.wheels.map(wheel => ({ ...wheel })),
      bodyContact,
      wheelSupport,
      loadedWheelCount: loadedWheels.length,
      normalSpeed: round(normalSpeed),
      tangentSpeed: round(tangentSpeed),
      lastLanding: view.lastLanding ? { ...view.lastLanding } : null
    }
  };
}

function summarize(samples) {
  const bodyContact = samples.find(sample => sample.state.bodyContact);
  const wheelSupport = samples.find(sample => sample.state.wheelSupport);
  const grounded = samples.find(sample => sample.state.grounded);
  const landing = samples.find(sample => sample.state.lastLanding);
  const floorSeparations = samples.flatMap(sample => sample.state.contacts
    .filter(contact => contact.kind === "floor")
    .map(contact => contact.separation));
  const maxPenetration = floorSeparations.length
    ? Math.min(...floorSeparations)
    : null;
  const maxTangentSpeedAtContact = bodyContact
    ? Math.max(...samples.slice(bodyContact.frame - 1).map(sample => sample.state.tangentSpeed))
    : null;
  const final = samples.at(-1)?.state;
  return {
    firstBodyContactFrame: bodyContact?.frame ?? null,
    firstWheelSupportFrame: wheelSupport?.frame ?? null,
    firstGroundedFrame: grounded?.frame ?? null,
    bodyToWheelSupportFrames: bodyContact && wheelSupport
      ? wheelSupport.frame - bodyContact.frame : null,
    landingFrame: landing?.frame ?? null,
    minimumFloorSeparation: maxPenetration === null ? null : round(maxPenetration),
    maximumTangentSpeedAfterBodyContact: maxTangentSpeedAtContact === null
      ? null : round(maxTangentSpeedAtContact),
    final: final ? compactFinal(final) : null
  };
}

function compactFinal(state) {
  return {
    grounded: state.grounded,
    jumps: state.jumps,
    jumpState: state.jumpState,
    position: { ...state.position },
    velocity: { ...state.velocity },
    angularVelocity: { ...state.angularVelocity },
    orientation: { ...state.orientation },
    loadedWheelCount: state.loadedWheelCount,
    lastLanding: state.lastLanding
  };
}

function runFixedScenario(id, setup, phases, frames = DEFAULT_FRAMES) {
  const { match, car } = practice();
  setup(car);
  const samples = [];
  let frame = 0;
  for (const phase of phases) {
    for (let index = 0; index < phase.frames && frame < frames; index += 1) {
      match.input(car.id, phase.input);
      match.tick(STEP);
      frame += 1;
      samples.push(stateSample(match.snapshot().cars[0], frame, phase.input));
    }
  }
  while (frame < frames) {
    const input = {};
    match.input(car.id, input);
    match.tick(STEP);
    frame += 1;
    samples.push(stateSample(match.snapshot().cars[0], frame, input));
  }
  return { id, fixedStepHz: FIXED_STEP_HZ, durationSeconds: round(frames / FIXED_STEP_HZ), samples, summary: summarize(samples) };
}

function runGroupedScenario(id, setup, phases, frames = DEFAULT_FRAMES) {
  const { match, car } = practice();
  setup(car);
  let frame = 0;
  for (const phase of phases) {
    let remaining = phase.frames;
    while (remaining > 0 && frame < frames) {
      // ArenaMatch.tick() internally consumes the same 120 Hz fixed steps.
      // Keep action phases as packet boundaries; only held inputs are grouped.
      const chunk = Math.min(remaining, frames - frame, 6);
      match.input(car.id, phase.input);
      match.tick(chunk * STEP);
      frame += chunk;
      remaining -= chunk;
    }
  }
  while (frame < frames) {
    const chunk = Math.min(frames - frame, 6);
    const input = {};
    match.input(car.id, input);
    match.tick(chunk * STEP);
    frame += chunk;
  }
  return compactFinal(stateSample(match.snapshot().cars[0], frame, {}).state);
}

const SCENARIOS = Object.freeze([
  {
    id: "flat-drop",
    setup: car => setDropCondition(car, { height: 8 }),
    phases: [{ frames: DEFAULT_FRAMES, input: {} }]
  },
  {
    id: "pitch-drop",
    setup: car => setDropCondition(car, { height: 7, pitch: .28 }),
    phases: [{ frames: DEFAULT_FRAMES, input: {} }]
  },
  {
    id: "roll-drop",
    setup: car => setDropCondition(car, { height: 7, roll: -.24 }),
    phases: [{ frames: DEFAULT_FRAMES, input: {} }]
  },
  {
    id: "dodge-forward-landing",
    setup: car => setDropCondition(car, { height: 0 }),
    phases: [
      { frames: 1, input: { jump: true } },
      { frames: 10, input: {} },
      { frames: 1, input: { jump: true, throttle: 1 } },
      { frames: DEFAULT_FRAMES - 12, input: {} }
    ]
  },
  {
    id: "dodge-side-landing",
    setup: car => setDropCondition(car, { height: 0 }),
    phases: [
      { frames: 1, input: { jump: true } },
      { frames: 10, input: {} },
      { frames: 1, input: { jump: true, steer: 1 } },
      { frames: DEFAULT_FRAMES - 12, input: {} }
    ]
  },
  {
    id: "dodge-diagonal-roll-landing",
    setup: car => setDropCondition(car, { height: 0 }),
    phases: [
      { frames: 1, input: { jump: true } },
      { frames: 10, input: {} },
      { frames: 1, input: { jump: true, throttle: 1, steer: 1, roll: 1 } },
      { frames: DEFAULT_FRAMES - 12, input: {} }
    ]
  }
]);

export function runContactTransitionProbes() {
  const traces = Object.fromEntries(SCENARIOS.map(scenario => [scenario.id,
    runFixedScenario(scenario.id, scenario.setup, scenario.phases)]));
  const groupedFinals = Object.fromEntries(SCENARIOS.map(scenario => [scenario.id,
    runGroupedScenario(scenario.id, scenario.setup, scenario.phases)]));
  return {
    schemaVersion: 1,
    source: "Arsenal M4-01 contact transition probe",
    fixedStepHz: FIXED_STEP_HZ,
    profile: "calibration",
    sampling: "snapshot after every authoritative fixed step",
    inputCadence: {
      fixed: "one packet per 120 Hz fixed step",
      grouped: "one packet for up to six fixed steps; action phases remain packet boundaries"
    },
    scenarioManifest: {
      version: 1,
      scenarios: SCENARIOS.map(scenario => ({
        id: scenario.id,
        frames: DEFAULT_FRAMES,
        phases: scenario.phases.map(phase => ({ frames: phase.frames, input: { ...phase.input } }))
      }))
    },
    traces,
    groupedFinals
  };
}

