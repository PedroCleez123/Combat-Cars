import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RocketSimBridge } from "../src/rocketsim-backend.js";
import { RocketSimPracticeMatch } from "../src/rocketsim-practice-match.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
if (!executable || !existsSync(executable)) throw new Error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-ramp-combat-occlusion-arena-06.json");
const neutral = { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false };

async function capture() {
  const match = new RocketSimPracticeMatch({
    arena: "arsenal-expanded-ramp-practice", combat: true,
    bridgeFactory: () => new RocketSimBridge({ executable }),
  });
  const events = [];
  try {
    await match.start();
    const blue = match.addHuman("blue", "BLUE");
    const red = match.addHuman("red", "RED");
    assert.equal(blue.team, "blue");
    assert.equal(red.team, "red");
    await match.tick(); // completes the queued two-car native roster rebuild
    match.input("red", { ...neutral, fire: true });
    let snapshot = await match.tick();
    events.push(...snapshot.events);
    match.input("red", neutral);
    for (let index = 0; index < 180; index += 1) {
      snapshot = await match.tick();
      events.push(...snapshot.events);
      if (events.some(item => item.kind === "miss" && item.text === "COHETE INTERCEPTADO")) break;
    }
    const blueCar = snapshot.cars.find(car => car.id === "blue");
    const redCar = snapshot.cars.find(car => car.id === "red");
    const intercepted = events.find(item => item.kind === "miss" && item.text === "COHETE INTERCEPTADO") || null;
    assert.ok(intercepted, "el cohete de combate debe ser interceptado por la rampa");
    assert.equal(blueCar.hp, 100, "la rampa debe proteger al rival tras ella");
    assert.equal(redCar.hp, 100, "el tirador no debe sufrir daño en la oclusión");
    return {
      time: snapshot.time, settings: snapshot.settings,
      cars: [blueCar, redCar].map(car => ({ id: car.id, team: car.team, hp: car.hp, x: car.x, h: car.h, z: car.z })),
      intercepted, eventKinds: events.map(item => item.kind),
    };
  } finally { await match.shutdown(); }
}

const first = await capture();
const second = await capture();
assert.deepEqual(second, first, "la oclusión de combate de la rampa debe ser determinista");
const report = { schemaVersion: 1, story: "ARENA-06", profile: "arsenal-expanded-ramp-practice", sha256: createHash("sha256").update(JSON.stringify(first)).digest("hex"), ...first };
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
