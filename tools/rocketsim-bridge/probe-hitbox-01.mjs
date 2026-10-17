import { existsSync } from "node:fs";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });
const totalTicks = Math.max(1, Number.parseInt(process.env.HITBOX_01_TICKS || "1200", 10) || 1200);
const upY = orientation => {
  if (!orientation) return 1;
  const norm = orientation.x ** 2 + orientation.y ** 2 + orientation.z ** 2 + orientation.w ** 2;
  return norm > .000001 ? 1 - 2 * (orientation.x ** 2 + orientation.z ** 2) / norm : 1;
};
const bodyFloorContact = car => Boolean(
  car.worldContact?.hasContact
  && Number(car.worldContact.normal?.y) > .65
  && !car.wheelContact?.hasContact,
);

if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
  process.exitCode = 2;
} else {
  const bridge = new RocketSimBridge({ executable, requestTimeoutMs: Number(process.env.ROCKETSIM_REQUEST_TIMEOUT_MS || 500) });
  const samples = [];
  const inversionSamples = [];
  let inverted = false;
  let invertedGroundContact = false;
  let rotationReleasedAt = null;
  let firstGroundAfterInversion = null;
  try {
    await bridge.start({ arena: "arsenal-practice", cars: [{ id: 1, team: "blue" }] });
    for (let tick = 1; tick <= totalTicks; tick += 1) {
      const input = tick >= 3 && tick <= 20
        ? { ...neutral(), jump: true }
        // Release rotation as soon as the authoritative car is inverted. This
        // mirrors the browser campaign instead of prescribing a fixed spin
        // duration that might rotate the car upright before it reaches ground.
        : tick >= 36 && rotationReleasedAt === null
          ? { ...neutral(), airRoll: true, roll: 1, boost: true }
          : neutral();
      const frame = await bridge.tick(tick, [{ id: 1, input }]);
      const car = frame.cars[0];
      const currentUpY = upY(car.orientation);
      if (currentUpY <= -.65 && !inverted) rotationReleasedAt = tick;
      inverted ||= currentUpY <= -.65;
      invertedGroundContact ||= Boolean(bodyFloorContact(car) && currentUpY <= -.65);
      const sample = { tick, grounded: car.grounded, bodyFloorContact: bodyFloorContact(car), worldNormalY: Number(car.worldContact?.normal?.y?.toFixed?.(3)), upY: Number(currentUpY.toFixed(4)), y: Number(car.position?.y?.toFixed?.(2)), velocityY: Number(car.velocity?.y?.toFixed?.(2)) };
      if (!firstGroundAfterInversion && inverted && (car.grounded || bodyFloorContact(car))) firstGroundAfterInversion = sample;
      if (currentUpY <= -.65 || (inverted && tick <= 220)) inversionSamples.push(sample);
      if (tick % 4 === 0 || currentUpY <= -.65 || car.grounded) samples.push(sample);
    }
  } finally {
    await bridge.shutdown();
  }
  const deepest = Math.min(...samples.map(sample => sample.upY));
  const report = {
    schemaVersion: 1,
    story: "HITBOX-01",
    arena: "arsenal-practice",
    ticks: totalTicks,
    deepestUpY: deepest,
    inversionObserved: inverted,
    invertedGroundContact,
    rotationReleasedAt,
    firstGroundAfterInversion,
    inversionSamples: [...inversionSamples.slice(0, 16), ...inversionSamples.slice(-16)],
    samples: samples.slice(-24),
    visualDecision: "pending-human-observation",
  };
  console.log(JSON.stringify(report, null, 2));
}
