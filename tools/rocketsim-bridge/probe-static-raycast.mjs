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
const capturePath = resolve(root, "docs", "reference-captures", "rocketsim-static-raycast-combat-geo-01.json");
const native = (x, y, z) => ({ x, y, z });

async function capture() {
  const bridge = new RocketSimBridge({ executable });
  try {
    const ready = await bridge.start({ arena: "arsenal-expanded-block-practice", cars: [{ id: 1, team: "blue" }] });
    assert.equal(ready.features?.staticRaycast, true, "el bridge debe declarar staticRaycast");
    const frame = await bridge.raycast([
      // JSONL uses RocketSim-scale y-up coordinates. The block centre is
      // 2 Arsenal units above the floor: 2 * 2300 / 56 RocketSim units.
      { id: 1, from: native(-1800, 82.142857, 0), to: native(1800, 82.142857, 0) },
      { id: 2, from: native(-1800, 82.142857, 900), to: native(1800, 82.142857, 900) },
    ]);
    assert.equal(frame.tick, 0);
    const frontal = frame.hits.find(hit => hit.id === 1);
    const lateral = frame.hits.find(hit => hit.id === 2);
    assert.ok(frontal?.hit, "el segmento frontal debe encontrar el bloque");
    assert.ok(frontal.fraction > 0 && frontal.fraction < 1, "el impacto debe estar dentro del segmento");
    assert.ok(Math.abs(frontal.normal.x) > .9 && Math.abs(frontal.normal.y) < .1 && Math.abs(frontal.normal.z) < .1, "la normal debe ser frontal");
    assert.equal(lateral?.hit, false, "el segmento lateral debe pasar junto al bloque");
    return { readyFeatures: ready.features, tick: frame.tick, hits: frame.hits };
  } finally {
    await bridge.shutdown();
  }
}

const first = await capture();
const second = await capture();
assert.deepEqual(second, first, "la consulta nativa debe ser determinista");
const report = { schemaVersion: 1, story: "COMBAT-GEO-01", profile: "arsenal-expanded-block-practice", sha256: createHash("sha256").update(JSON.stringify(first)).digest("hex"), ...first };
await mkdir(dirname(capturePath), { recursive: true });
await writeFile(capturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
