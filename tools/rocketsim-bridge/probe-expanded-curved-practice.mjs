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
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-expanded-curved-practice-arena-01.json");
const cars = [1, 2, 3, 4].map(id => ({ id, team: id % 2 ? "blue" : "red" }));
const neutral = { throttle: 1, steer: 0, jump: false, boost: true, drift: false, airRoll: false, roll: 0 };

async function capture() {
  const bridge = new RocketSimBridge({ executable });
  const perCar = new Map(cars.map(car => [car.id, { firstInclined: null, firstSteep: null, supportedTicks: 0, gapsBeforeSteep: 0, previous: null, maxNormalStepDegrees: 0 }]));
  try {
    await bridge.start({ arena: "arsenal-expanded-curved-practice", cars });
    // This profile has straight joins at its top corners. The cornered
    // profile owns the full wall-to-ceiling route; keep this legacy probe
    // focused on its four lower floor-to-wall arcs.
    for (let tick = 1; tick <= 360; tick += 1) {
      const frame = await bridge.tick(tick, cars.map(car => ({ ...car, input: neutral })));
      for (const car of frame.cars) {
        const trace = perCar.get(car.id);
        const normal = car.wheelContact.normal;
        const supported = car.wheelContact.hasContact && car.wheelCount > 0;
        if (supported) trace.supportedTicks += 1;
        if (supported && normal.y < .96 && normal.y > .2 && trace.firstInclined === null) trace.firstInclined = { tick, normal };
        if (supported && normal.y < .55 && trace.firstSteep === null) trace.firstSteep = { tick, normal };
        if (trace.firstInclined && trace.firstSteep === null && !supported) trace.gapsBeforeSteep += 1;
        if (supported && normal.y < .999 && trace.previous) {
          const dot = Math.max(-1, Math.min(1, normal.x * trace.previous.x + normal.y * trace.previous.y + normal.z * trace.previous.z));
          trace.maxNormalStepDegrees = Math.max(trace.maxNormalStepDegrees, Math.acos(dot) * 180 / Math.PI);
        }
        if (supported && normal.y < .999) trace.previous = normal;
      }
    }
  } finally {
    await bridge.shutdown();
  }
  const result = Object.fromEntries([...perCar.entries()].map(([id, value]) => [id, value]));
  for (const [id, trace] of Object.entries(result)) {
    assert.ok(trace.firstInclined, `coche ${id} debe entrar en una curva con apoyo inclinado`);
    assert.ok(trace.firstSteep, `coche ${id} debe alcanzar la pared curva`);
    assert.equal(trace.gapsBeforeSteep, 0, `coche ${id} no debe perder apoyo antes de la pared`);
    assert.ok(trace.maxNormalStepDegrees <= 8, `coche ${id} no debe dar saltos de normal > 8 grados`);
  }
  return { fixedStepHz: 120, ticks: 360, cars: result };
}

const first = await capture();
const second = await capture();
assert.deepEqual(second, first, "la traza ampliada debe ser determinista");
const report = {
  schemaVersion: 1,
  profile: "arsenal-expanded-curved-practice",
  geometry: { width: 144, depth: 108, height: 30, radius: 8, segments: 32, scale: 56 / 2300, kind: "original-four-floor-wall-quarter-pipes" },
  sha256: createHash("sha256").update(JSON.stringify(first)).digest("hex"),
  trace: first,
};
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
