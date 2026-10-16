import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-combat-bridge-r8-02.json");
if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la sonda R8-02");

const cars = [{ id: 1, team: "blue" }, { id: 2, team: "red" }];
const neutralInput = id => ({
  id,
  input: { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 },
});

const bridge = new RocketSimBridge({ executable, requestTimeoutMs: 1000 });
try {
  const ready = await bridge.start({ arena: "clean-six-planes", cars });
  const initial = await bridge.tick(1, [neutralInput(1), neutralInput(2)]);
  const inactive = await bridge.setCombatActive(2, false);
  const respawned = await bridge.respawn(2);
  const continued = await bridge.tick(2, [neutralInput(1), neutralInput(2)]);
  const inactiveCar = inactive.cars.find(car => car.id === 2);
  const respawnedCar = respawned.cars.find(car => car.id === 2);
  const report = {
    schemaVersion: 1,
    profile: "clean-six-planes",
    fixedStepHz: ready.fixedStepHz,
    assertions: {
      readyHasTwoCars: ready.cars.length === 2,
      initialHasTwoCars: initial.cars.length === 2,
      inactiveCarLeavesArena: inactiveCar.position.y < -9999,
      respawnReturnsNativeSpawn: respawnedCar.position.y > 0,
      tickContinuesAfterRespawn: continued.tick === 2 && continued.cars.length === 2,
    },
    samples: {
      initial: initial.cars.map(car => ({ id: car.id, position: car.position })),
      inactive: { id: inactiveCar.id, position: inactiveCar.position },
      respawned: { id: respawnedCar.id, position: respawnedCar.position },
      continuedTick: continued.tick,
    },
  };
  for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await bridge.shutdown();
}
