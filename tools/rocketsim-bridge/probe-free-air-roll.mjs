import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;

async function run(label, activeInput) {
  const bridge = new RocketSimBridge({ executable });
  const samples = [];
  try {
    await bridge.start();
    for (let tick = 1; tick <= 96; tick += 1) {
      const input = tick <= 24 ? { jump: true }
        : tick >= 49 && tick <= 84 ? activeInput
          : {};
      const frame = await bridge.tick(tick, [{ id: 1, input }]);
      if (tick >= 49) {
        const car = frame.cars[0];
        samples.push({
          tick,
          grounded: car.grounded,
          orientation: car.orientation,
          localAngularVelocity: car.localAngularVelocity,
        });
      }
    }
  } finally {
    await bridge.shutdown();
  }
  if (samples.some(sample => sample.grounded)) throw new Error(`${label} no se ejecutó completamente en el aire`);
  return samples;
}

if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
  process.exitCode = 2;
} else {
  // composeVehicleInput already sets roll=steer for free air roll. The native
  // sidecar must therefore suppress yaw, producing the same flight as a pure
  // directional roll without a steer input.
  const free = await run("free-air-roll", { airRoll: true, steer: 1, roll: 1 });
  const direct = await run("directional-roll", { airRoll: false, steer: 0, roll: 1 });
  const freeHash = createHash("sha256").update(JSON.stringify(free)).digest("hex");
  const directHash = createHash("sha256").update(JSON.stringify(direct)).digest("hex");
  const equivalent = freeHash === directHash;
  console.log(JSON.stringify({ samples: free.length, freeHash, directHash, equivalent }, null, 2));
  if (!equivalent) process.exitCode = 1;
}
