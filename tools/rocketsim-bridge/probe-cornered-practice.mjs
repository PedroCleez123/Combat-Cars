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
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-cornered-practice-arena-02.json");
const cars = [1, 2, 3, 4].map(id => ({ id, team: id % 2 ? "blue" : "red" }));
const neutral = { throttle: 1, steer: 0, jump: false, boost: true, drift: false, airRoll: false, roll: 0 };
const arsenalHeight = positionY => (positionY - 17) * 56 / 2300;

async function capture() {
  const bridge = new RocketSimBridge({ executable });
  const traces = new Map(cars.map(car => [car.id, { supportedTicks: 0, firstInclined: null, firstSteep: null, firstVerticalCorner: null, maxHeight: 0, gapsBeforeSteep: 0, maxNormalStepDegrees: 0, maxStep: null, minNormalY: 1, maxNormalY: -1, previous: null, previousTick: 0 }]));
  try {
    await bridge.start({ arena: "arsenal-expanded-cornered-practice", cars });
    for (let tick = 1; tick <= 720; tick += 1) {
      const frame = await bridge.tick(tick, cars.map(car => ({ ...car, input: neutral })));
      for (const car of frame.cars) {
        const trace = traces.get(car.id);
        const normal = car.wheelContact.normal;
        const height = arsenalHeight(car.position.y);
        trace.maxHeight = Math.max(trace.maxHeight, height);
        const supported = car.wheelContact.hasContact && car.wheelCount > 0;
        if (supported) {
          trace.supportedTicks += 1;
          trace.minNormalY = Math.min(trace.minNormalY, normal.y);
          trace.maxNormalY = Math.max(trace.maxNormalY, normal.y);
          if (normal.y < .96 && normal.y > .2 && trace.firstInclined === null) trace.firstInclined = { tick, normal };
          if (normal.y < .55 && trace.firstSteep === null) trace.firstSteep = { tick, normal };
          if (height > 8.5 && Math.abs(normal.x) > .1 && Math.abs(normal.z) > .1 && Math.abs(normal.y) < .1 && trace.firstVerticalCorner === null) trace.firstVerticalCorner = { tick, height, normal };
          if (trace.previous) {
            const dot = Math.max(-1, Math.min(1, normal.x * trace.previous.x + normal.y * trace.previous.y + normal.z * trace.previous.z));
            const degrees = Math.acos(dot) * 180 / Math.PI;
            if (degrees > trace.maxNormalStepDegrees) trace.maxStep = { tick, degrees, from: trace.previous, to: normal, fromTick: trace.previousTick };
            trace.maxNormalStepDegrees = Math.max(trace.maxNormalStepDegrees, degrees);
          }
          trace.previous = normal;
          trace.previousTick = tick;
        } else {
          if (trace.firstInclined && !trace.firstSteep) trace.gapsBeforeSteep += 1;
          trace.previous = null;
        }
      }
    }
  } finally { await bridge.shutdown(); }
  const result = Object.fromEntries([...traces.entries()].map(([id, trace]) => [id, trace]));
  for (const [id, trace] of Object.entries(result)) {
    assert.ok(trace.firstInclined, `coche ${id} debe entrar en el parche de esquina`);
    assert.ok(trace.firstSteep, `coche ${id} debe alcanzar la pared desde la esquina`);
    assert.ok(trace.firstVerticalCorner, `coche ${id} debe apoyar en la esquina vertical por encima del parche de suelo`);
    assert.equal(trace.gapsBeforeSteep, 0, `coche ${id} no debe perder apoyo en la esquina`);
    // The upper wall->ceiling arc is deliberately part of this profile. A
    // negative y component is therefore expected once the car rides the roof;
    // the old lower-corner probe incorrectly treated it as a regression.
    assert.ok(trace.minNormalY <= -.1, `coche ${id} debe recorrer una curva de techo con normal descendente`);
    assert.ok(trace.maxNormalStepDegrees <= 8, `coche ${id} no debe dar saltos de normal > 8 grados`);
  }
  return { fixedStepHz: 120, ticks: 720, cars: result };
}

const first = await capture();
const second = await capture();
assert.deepEqual(second, first, "la traza de esquinas debe ser determinista");
const report = { schemaVersion: 1, profile: "arsenal-expanded-cornered-practice", geometry: { width: 144, depth: 108, height: 30, radius: 8, pipeSegments: 32, cornerSegments: 16, kind: "floor-wall-ceiling-curves-plus-lower-upper-spherical-and-vertical-corner-patches" }, sha256: createHash("sha256").update(JSON.stringify(first)).digest("hex"), trace: first };
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
