import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
if (!executable || !existsSync(executable)) throw new Error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-curved-practice-r7-04.json");
const fixedStepHz = 120;

const snapshotOf = (tick, car) => ({
  tick,
  position: car.position,
  velocity: car.velocity,
  orientation: car.orientation,
  grounded: car.grounded,
  wheelCount: car.wheelCount,
  worldContact: car.worldContact,
  wheelContact: car.wheelContact,
});

async function captureTrace() {
  const bridge = new RocketSimBridge({ executable });
  const checkpoints = [];
  let firstInclinedSupport = null;
  let firstSteepSupport = null;
  let contactGapsBeforeSteep = 0;
  let hadSupportSinceStart = true;
  const transitionSamples = [];
  let previousTransitionNormal = null;
  let maxNormalStepDegrees = 0;
  try {
    await bridge.start({ arena: "arsenal-curved-practice", cars: [{ id: 1, team: "blue" }] });
    for (let tick = 1; tick <= 480; tick += 1) {
      const frame = await bridge.tick(tick, [{ id: 1, input: {
        throttle: 1,
        steer: 0,
        jump: false,
        boost: tick >= 24 && tick <= 210,
        drift: false,
        airRoll: false,
        roll: 0,
      } }]);
      const car = frame.cars[0];
      const sample = snapshotOf(tick, car);
      const normal = car.wheelContact.normal;
      const supported = car.wheelContact.hasContact && car.wheelCount > 0;
      if (!firstSteepSupport && !supported && hadSupportSinceStart) contactGapsBeforeSteep += 1;
      if (!supported) hadSupportSinceStart = false;
      if (supported && !firstInclinedSupport && normal.y < .96 && normal.y > .2 && normal.x < -.05) {
        firstInclinedSupport = sample;
      }
      if (supported && !firstSteepSupport && normal.y < .55 && normal.x < -.4) {
        firstSteepSupport = sample;
      }
      if (supported && normal.y < .999 && normal.x < -.01) {
        if (previousTransitionNormal) {
          const dot = Math.max(-1, Math.min(1,
            normal.x * previousTransitionNormal.x + normal.y * previousTransitionNormal.y + normal.z * previousTransitionNormal.z,
          ));
          maxNormalStepDegrees = Math.max(maxNormalStepDegrees, Math.acos(dot) * 180 / Math.PI);
        }
        previousTransitionNormal = normal;
        if (!transitionSamples.length || tick - transitionSamples.at(-1).tick >= 4) transitionSamples.push(sample);
      }
      if (tick % 60 === 0) checkpoints.push(sample);
    }
  } finally {
    await bridge.shutdown();
  }
  assert.ok(firstInclinedSupport, "la traza debe entrar en la zona curva con una normal de apoyo inclinada");
  assert.ok(firstSteepSupport, "la traza debe alcanzar la parte empinada de la curva");
  assert.equal(contactGapsBeforeSteep, 0, "la transición suelo-curva no debe perder el apoyo antes de la parte empinada");
  assert.ok(maxNormalStepDegrees <= 8, "la normal de apoyo no debe dar un salto angular brusco entre ticks de la curva");
  return {
    fixedStepHz,
    ticks: 480,
    checkpoints,
    firstInclinedSupport,
    firstSteepSupport,
    contactGapsBeforeSteep,
    transitionSamples,
    maxNormalStepDegrees,
  };
}

const first = await captureTrace();
const second = await captureTrace();
assert.deepEqual(second, first, "dos trazas nativas de la curva deben ser deterministas");
const summary = JSON.stringify(first);
const report = {
  schemaVersion: 1,
  profile: "arsenal-curved-practice",
  geometry: {
    kind: "original-quarter-pipe",
    radiusUU: 256,
    segments: 32,
    note: "Geometría propia de entrenamiento; no es una malla ni una medición de la arena Soccar.",
  },
  sha256: createHash("sha256").update(summary).digest("hex"),
  trace: first,
};
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
