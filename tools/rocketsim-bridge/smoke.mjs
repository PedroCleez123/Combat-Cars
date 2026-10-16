import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
  process.exitCode = 2;
} else {
  const bridge = new RocketSimBridge({ executable });
  const samples = [];
  try {
    const ready = await bridge.start();
    for (let tick = 1; tick <= 120; tick += 1) {
      const frame = await bridge.tick(tick, [{ id: 1, input: {
        throttle: 0, steer: 0, jump: tick === 12, boost: false, drift: false, roll: 0,
      } }]);
      if ([1, 12, 13, 60, 120].includes(tick)) {
        const car = frame.cars[0];
        samples.push({ tick, grounded: car.grounded, jumpState: car.jumpState, position: car.position, velocity: car.velocity, orientation: car.orientation });
      }
    }
    const summary = JSON.stringify({ ready, samples });
    const hash = createHash("sha256").update(summary).digest("hex");
    console.log(JSON.stringify({ schemaVersion: 1, fixedStepHz: 120, samples, sha256: hash }));
  } finally {
    await bridge.shutdown();
  }
}
