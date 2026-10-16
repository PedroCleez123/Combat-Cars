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
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-combat-alpha-geometry-arena-07.json");
const cars = [1, 2, 3, 4, 5, 6].map(id => ({ id, team: id % 2 ? "blue" : "red" }));
const arsenal = value => value * 56 / 2300;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

async function capture() {
  const bridge = new RocketSimBridge({ executable });
  try {
    const ready = await bridge.start({ arena: "combat-alpha", cars });
    assert.equal(ready.features?.staticRaycast, true, "combat-alpha requiere raycast estático");
    const spawn = await bridge.tick(1, cars.map(car => ({ ...car, input: { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 } })));
    const rays = await bridge.raycast([
      { id: 1, from: { x: -2400, y: 82.142857, z: -821.4286 }, to: { x: 2400, y: 82.142857, z: -821.4286 } },
      { id: 2, from: { x: 2400, y: 62.18, z: 821.4286 }, to: { x: -2400, y: 62.18, z: 821.4286 } },
      { id: 3, from: { x: -2400, y: 62.18, z: 0 }, to: { x: 2400, y: 62.18, z: 0 } },
    ]);
    const output = {
      readyFeatures: ready.features,
      spawns: spawn.cars.map(car => ({ id: car.id, team: cars.find(item => item.id === car.id)?.team, position: car.position, orientation: car.orientation })),
      hits: rays.hits,
    };
    assert.equal(output.spawns.length, 6, "deben publicarse seis coches");
    assert.equal(new Set(output.spawns.map(car => car.id)).size, 6, "los IDs de spawn deben ser únicos");
    for (const car of output.spawns) {
      assert.ok([car.position.x, car.position.y, car.position.z, car.orientation.x, car.orientation.y, car.orientation.z, car.orientation.w].every(Number.isFinite), `spawn finito ${car.id}`);
      assert.ok(Math.abs(arsenal(car.position.x)) > 40, `spawn ${car.id} debe quedarse fuera de la composición central`);
    }
    for (let left = 0; left < output.spawns.length; left += 1) for (let right = left + 1; right < output.spawns.length; right += 1) {
      assert.ok(distance(output.spawns[left].position, output.spawns[right].position) > 900, `spawns ${output.spawns[left].id}/${output.spawns[right].id} demasiado cercanos`);
    }
    const block = output.hits.find(hit => hit.id === 1);
    const ramp = output.hits.find(hit => hit.id === 2);
    const central = output.hits.find(hit => hit.id === 3);
    assert.ok(block?.hit && block.fraction > 0 && block.fraction < 1, "el carril de bloque debe tener cobertura nativa");
    assert.ok(ramp?.hit && ramp.fraction > 0 && ramp.fraction < 1, "el carril de rampa debe tener cobertura nativa");
    assert.equal(central?.hit, false, "el corredor central debe permanecer libre");
    return output;
  } finally { await bridge.shutdown(); }
}

const first = await capture();
const second = await capture();
assert.deepEqual(second, first, "la geometría combat-alpha debe ser determinista");
const report = {
  schemaVersion: 1, story: "ARENA-07", profile: "combat-alpha",
  layout: { block: { x: 0, z: -20, size: [14, 4, 18] }, ramp: { x: 0, z: 20, size: [20, 4.5, 18] }, centralLane: { zMin: -11, zMax: 11 } },
  sha256: createHash("sha256").update(JSON.stringify(first)).digest("hex"), ...first,
};
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
