import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { createRocketSimWasmBridge } from "../../src/rocketsim-wasm-backend.js";

const arena = "combat-alpha";
const defaultBridge = new URL("../../.rocketsim-bridge-build-r20/rocketsim_bridge-r20.exe", import.meta.url);
const bridgeExecutable = process.env.ROCKETSIM_BRIDGE_EXE || decodeURIComponent(defaultBridge.pathname.replace(/^\//, ""));
const cars = [
  { id: 1, team: "blue" }, { id: 2, team: "red" }, { id: 3, team: "blue" },
  { id: 4, team: "red" }, { id: 5, team: "blue" }, { id: 6, team: "red" },
];
const frames = Math.max(1, Math.min(600, Number(process.env.WASM_PARITY_FRAMES || 240)));
const tolerance = Number(process.env.WASM_PARITY_TOLERANCE || 0.001);
const tolerances = {
  position: Number(process.env.WASM_PARITY_POSITION_TOLERANCE || 0.05),
  velocity: Number(process.env.WASM_PARITY_VELOCITY_TOLERANCE || 0.1),
  orientation: Number(process.env.WASM_PARITY_ORIENTATION_TOLERANCE || 0.001),
  boost: Number(process.env.WASM_PARITY_BOOST_TOLERANCE || 0.001),
  padCooldown: Number(process.env.WASM_PARITY_PAD_TOLERANCE || 0.001),
};
const traceThreshold = Number(process.env.WASM_PARITY_TRACE_THRESHOLD || Infinity);

function inputFor(tick, index) {
  const phase = tick <= 60 ? 0 : tick <= 120 ? 1 : tick <= 180 ? 2 : 3;
  const direction = index % 2 === 0 ? 1 : -1;
  return {
    throttle: phase === 0 ? 0 : phase === 3 ? .25 * direction : direction,
    steer: phase < 2 ? .08 * (index - 2.5) : -.12 * direction,
    jump: phase === 1 && tick % 45 === 0,
    boost: phase > 0,
    drift: phase === 2 && tick % 30 < 10,
    airRoll: phase === 3 && tick % 40 < 20,
    roll: phase === 3 ? .2 * direction : 0,
  };
}

function finiteDifference(a, b) {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.z - b.z),
  );
}

function quaternionDifference(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z), Math.abs(a.w - b.w));
}

function frameInputs(tick) {
  return cars.map(car => ({ id: car.id, input: inputFor(tick, car.id - 1) }));
}

function compareFrame(nativeFrame, wasmFrame, report) {
  if (nativeFrame.tick !== wasmFrame.tick || nativeFrame.cars.length !== wasmFrame.cars.length) {
    report.mismatches += 1;
    report.firstMismatch ||= { kind: "shape", nativeTick: nativeFrame.tick, wasmTick: wasmFrame.tick };
    return;
  }
  for (let index = 0; index < nativeFrame.cars.length; index += 1) {
    const nativeCar = nativeFrame.cars[index];
    const wasmCar = wasmFrame.cars[index];
    const positionError = finiteDifference(nativeCar.position, wasmCar.position);
    const velocityError = finiteDifference(nativeCar.velocity, wasmCar.velocity);
    const orientationError = quaternionDifference(nativeCar.orientation, wasmCar.orientation);
    const boostError = Math.abs(nativeCar.boost - wasmCar.boost);
    report.maxPositionError = Math.max(report.maxPositionError, positionError);
    report.maxVelocityError = Math.max(report.maxVelocityError, velocityError);
    report.maxOrientationError = Math.max(report.maxOrientationError, orientationError);
    report.maxBoostError = Math.max(report.maxBoostError, boostError);
    if (!report.firstTrace && (positionError > traceThreshold || velocityError > traceThreshold || orientationError > traceThreshold)) {
      report.firstTrace = {
        kind: "car",
        tick: nativeFrame.tick,
        id: nativeCar.id,
        errors: { positionError, velocityError, orientationError },
        native: { position: nativeCar.position, velocity: nativeCar.velocity, orientation: nativeCar.orientation },
        wasm: { position: wasmCar.position, velocity: wasmCar.velocity, orientation: wasmCar.orientation },
      };
    }
    if (positionError > tolerances.position || velocityError > tolerances.velocity || orientationError > tolerances.orientation || boostError > tolerances.boost) {
      report.mismatches += 1;
      report.firstMismatch ||= { kind: "car", tick: nativeFrame.tick, id: nativeCar.id, positionError, velocityError, orientationError, boostError };
    }
  }
  const nativePads = nativeFrame.pads || [];
  const wasmPads = wasmFrame.pads || [];
  if (nativePads.length !== wasmPads.length) {
    report.mismatches += 1;
    report.firstMismatch ||= { kind: "pads-shape", tick: nativeFrame.tick, nativePads: nativePads.length, wasmPads: wasmPads.length };
    return;
  }
  nativePads.forEach((nativePad, index) => {
    const wasmPad = wasmPads[index];
    const cooldownError = Math.abs(nativePad.cooldown - wasmPad.cooldown);
    report.maxPadCooldownError = Math.max(report.maxPadCooldownError, cooldownError);
    if (nativePad.active !== wasmPad.active || cooldownError > tolerances.padCooldown) {
      report.mismatches += 1;
      report.firstMismatch ||= { kind: "pad", tick: nativeFrame.tick, id: nativePad.id, active: [nativePad.active, wasmPad.active], cooldownError };
    }
  });
}

const native = new RocketSimBridge({ executable: bridgeExecutable, requestTimeoutMs: 1000 });
const wasm = createRocketSimWasmBridge();
const report = {
  schemaVersion: 1,
  story: "WASM-MIGRATION-02",
  arena,
  cars: cars.length,
  frames,
  tolerance,
  tolerances,
  ok: false,
  mismatches: 0,
  maxPositionError: 0,
  maxVelocityError: 0,
  maxOrientationError: 0,
  maxBoostError: 0,
  maxPadCooldownError: 0,
  firstMismatch: null,
  firstTrace: null,
};
try {
  await native.start({ arena, cars });
  await wasm.start({ arena, cars });
  for (let tick = 1; tick <= frames; tick += 1) {
    const inputs = frameInputs(tick);
    const [nativeFrame, wasmFrame] = await Promise.all([
      native.tick(tick, inputs),
      wasm.tick(tick, inputs),
    ]);
    compareFrame(nativeFrame, wasmFrame, report);
  }
  report.ok = report.mismatches === 0;
} finally {
  await Promise.allSettled([native.shutdown(), wasm.shutdown()]);
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

