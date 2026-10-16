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
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-ramp-practice-arena-06.json");
const cars = [{ id: 1, team: "blue" }, { id: 2, team: "red" }, { id: 3, team: "blue" }];
const driven = { throttle: 1, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 };
const neutral = { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 };
const arsenal = value => value * 56 / 2300;

async function capture() {
  const bridge = new RocketSimBridge({ executable });
  const trace = {
    approach: null, firstSlopeSupport: null, firstExitAirborne: null, firstLandingAfterExit: null,
    ramp: { maxX: -Infinity, maxHeight: -Infinity, final: null },
    bypass: { initialX: null, maxX: -Infinity, final: null }, tickDeltas: [], staticRay: null,
  };
  try {
    const ready = await bridge.start({ arena: "arsenal-expanded-ramp-practice", cars });
    assert.equal(ready.features?.staticRaycast, true, "la rampa necesita la consulta estática declarada");
    // A nose-height combat ray from the red spawn to the blue spawn crosses
    // the wedge. It is a native geometry check, independent of car contacts.
    const ray = await bridge.raycast([{ id: 1, from: { x: 1600, y: 62.18, z: 0 }, to: { x: -1600, y: 62.18, z: 0 } }]);
    trace.staticRay = ray.hits.find(hit => hit.id === 1) || null;
    for (let tick = 1; tick <= 480; tick += 1) {
      const active = tick <= 230;
      const frame = await bridge.tick(tick, cars.map(car => ({ ...car, input: (car.id === 1 || car.id === 3) && active ? driven : neutral })));
      const rampCar = frame.cars.find(car => car.id === 1);
      const bypass = frame.cars.find(car => car.id === 3);
      const x = arsenal(rampCar.position.x);
      const h = arsenal(rampCar.position.y - 17);
      const bypassX = arsenal(bypass.position.x);
      const normal = rampCar.wheelContact?.normal || rampCar.worldContact?.normal;
      const supportedOnSlope = rampCar.grounded && normal?.y < .995 && normal.y > .6 && x > -11 && x < 11;
      if (trace.approach === null && x < -10) trace.approach = { tick, x, h, grounded: rampCar.grounded };
      if (supportedOnSlope && trace.firstSlopeSupport === null) trace.firstSlopeSupport = { tick, x, h, normal, velocity: rampCar.velocity };
      if (x > 10 && !rampCar.grounded && trace.firstExitAirborne === null) trace.firstExitAirborne = { tick, x, h, velocity: rampCar.velocity };
      if (x > 10 && rampCar.grounded && trace.firstExitAirborne && trace.firstLandingAfterExit === null) trace.firstLandingAfterExit = { tick, x, h, normal };
      trace.ramp.maxX = Math.max(trace.ramp.maxX, x);
      trace.ramp.maxHeight = Math.max(trace.ramp.maxHeight, h);
      if (trace.bypass.initialX === null) trace.bypass.initialX = bypassX;
      trace.bypass.maxX = Math.max(trace.bypass.maxX, bypassX);
      if (tick > 1) trace.tickDeltas.push(frame.tick - (tick - 1));
      if (tick === 480) {
        trace.ramp.final = { position: rampCar.position, velocity: rampCar.velocity, grounded: rampCar.grounded };
        trace.bypass.final = { position: bypass.position, velocity: bypass.velocity, grounded: bypass.grounded };
      }
    }
  } finally { await bridge.shutdown(); }
  assert.ok(trace.staticRay?.hit, "un segmento de cohete debe interceptar la rampa nativa");
  assert.ok(trace.staticRay.fraction > 0 && trace.staticRay.fraction < 1, "el impacto de la rampa debe quedar dentro del segmento");
  assert.ok(trace.approach?.x < -10, "el coche debe comenzar antes de la rampa");
  assert.ok(trace.firstSlopeSupport, "el coche debe publicar apoyo nativo en la cara inclinada");
  assert.ok(trace.ramp.maxHeight > 2.5, `la subida debe elevar el coche, altura=${trace.ramp.maxHeight}`);
  assert.ok(trace.ramp.maxX > 12, `el coche debe salir por la parte alta, x=${trace.ramp.maxX}`);
  assert.ok(trace.firstExitAirborne, "la salida por el borde alto debe publicar un tramo aéreo");
  assert.ok(trace.firstLandingAfterExit, "la sonda debe observar el aterrizaje después de la salida");
  assert.ok(trace.bypass.initialX < -35 && trace.bypass.maxX > 20, "el carril lateral debe evitar la rampa");
  assert.ok(trace.tickDeltas.every(delta => delta === 1), "los ticks del bridge deben permanecer consecutivos");
  return trace;
}

const first = await capture();
const second = await capture();
assert.deepEqual(second, first, "la traza de rampa debe ser determinista");
const report = {
  schemaVersion: 1, story: "ARENA-06", profile: "arsenal-expanded-ramp-practice",
  geometry: { center: { x: 0, y: 0, z: 0 }, run: 20, width: 18, height: 4.5, kind: "single-static-wedge" },
  sha256: createHash("sha256").update(JSON.stringify(first)).digest("hex"), trace: first,
};
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
