import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
if (!executable || !existsSync(executable)) throw new Error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");

const bridge = new RocketSimBridge({ executable });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-practice-contacts-r7-03.json");
const checkpoints = [];
let firstWallContact = null;
let firstWallFollowUp = null;

const sampleOf = (tick, car) => ({
  tick,
  position: car.position,
  velocity: car.velocity,
  grounded: car.grounded,
  wheelCount: car.wheelCount,
  contact: car.worldContact,
});

try {
  await bridge.start({ arena: "arsenal-practice", cars: [{ id: 1, team: "blue" }] });
  for (let tick = 1; tick <= 360; tick += 1) {
    const frame = await bridge.tick(tick, [{ id: 1, input: {
      throttle: 1, steer: 0, jump: false, boost: tick > 20, drift: false, airRoll: false, roll: 0,
    } }]);
    const car = frame.cars[0];
    const sample = sampleOf(tick, car);
    if (tick % 60 === 0) checkpoints.push(sample);
    if (!firstWallContact && car.worldContact.hasContact && Math.abs(car.worldContact.normal.x) > .9) {
      firstWallContact = sample;
    } else if (firstWallContact && !firstWallFollowUp && tick > firstWallContact.tick && car.worldContact.hasContact) {
      firstWallFollowUp = sample;
    }
  }
  assert.ok(firstWallContact, "la práctica RocketSim debe publicar el impacto de carrocería contra una pared");
  assert.ok(firstWallContact.tick > 20, "la pared debe aparecer después de la aceleración inicial");
  assert.ok(firstWallFollowUp, "el contacto de pared debe persistir al menos un tick para medir la respuesta");
  const report = {
    schemaVersion: 1,
    profile: "arsenal-practice",
    fixedStepHz: 120,
    ticks: 360,
    checkpoints,
    firstWallContact,
    firstWallFollowUp,
    limitation: "La práctica usa seis planos sintéticos; esta captura valida el contacto nativo, no una transición curva de arena Soccar.",
  };
  await mkdir(dirname(capturePath), { recursive: true });
  await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await bridge.shutdown();
}
