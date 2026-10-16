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
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-block-practice-arena-05.json");
const cars = [{ id: 1, team: "blue" }, { id: 2, team: "red" }, { id: 3, team: "blue" }];
const driven = { throttle: 1, steer: 0, jump: false, boost: true, drift: false, airRoll: false, roll: 0 };
const neutral = { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 };
const arsenal = value => value * 56 / 2300;

async function capture() {
  const bridge = new RocketSimBridge({ executable });
  const trace = { headOn: { initialX: null, maxX: -Infinity, firstBlockContact: null, final: null }, bypass: { initialX: null, maxX: -Infinity, final: null }, tickDeltas: [] };
  try {
    await bridge.start({ arena: "arsenal-expanded-block-practice", cars });
    for (let tick = 1; tick <= 420; tick += 1) {
      const frame = await bridge.tick(tick, cars.map(car => ({ ...car, input: car.id === 1 || car.id === 3 ? driven : neutral })));
      const headOn = frame.cars.find(car => car.id === 1);
      const bypass = frame.cars.find(car => car.id === 3);
      const headX = arsenal(headOn.position.x);
      const bypassX = arsenal(bypass.position.x);
      if (trace.headOn.initialX === null) trace.headOn.initialX = headX;
      if (trace.bypass.initialX === null) trace.bypass.initialX = bypassX;
      trace.headOn.maxX = Math.max(trace.headOn.maxX, headX);
      trace.bypass.maxX = Math.max(trace.bypass.maxX, bypassX);
      if (headOn.worldContact.hasContact && headOn.worldContact.normal.x < -.5 && trace.headOn.firstBlockContact === null) {
        trace.headOn.firstBlockContact = { tick, position: headOn.position, normal: headOn.worldContact.normal, velocity: headOn.velocity };
      }
      if (tick > 1) trace.tickDeltas.push(frame.tick - (tick - 1));
      if (tick === 420) { trace.headOn.final = { position: headOn.position, velocity: headOn.velocity }; trace.bypass.final = { position: bypass.position, velocity: bypass.velocity }; }
    }
  } finally { await bridge.shutdown(); }
  assert.ok(trace.headOn.initialX < -35, "el coche frontal debe comenzar antes del bloque");
  assert.ok(trace.headOn.firstBlockContact, "el coche frontal debe publicar contacto nativo con la cara del bloque");
  assert.ok(trace.headOn.maxX < -6, `el coche frontal no debe atravesar el bloque, maxX=${trace.headOn.maxX}`);
  assert.ok(trace.bypass.initialX < -35, "el coche lateral debe comenzar antes del bloque");
  assert.ok(trace.bypass.maxX > 20, `el coche lateral debe poder pasar por el lateral, maxX=${trace.bypass.maxX}`);
  assert.ok(trace.tickDeltas.every(delta => delta === 1), "los ticks del bridge deben permanecer consecutivos");
  return trace;
}

const first = await capture();
const second = await capture();
assert.deepEqual(second, first, "la traza del bloque debe ser determinista");
const report = {
  schemaVersion: 1,
  profile: "arsenal-expanded-block-practice",
  geometry: { center: { x: 0, y: 2, z: 0 }, size: { x: 14, y: 4, z: 18 }, kind: "single-static-box" },
  sha256: createHash("sha256").update(JSON.stringify(first)).digest("hex"),
  trace: first,
};
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

