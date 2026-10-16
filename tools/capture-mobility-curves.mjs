import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runMobilityCurveSuite } from "../src/mobility-curve-probes.js";

const output = resolve(process.argv[2] || "docs/reference-captures/arsenal-current.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(runMobilityCurveSuite(), null, 2)}\n`, "utf8");
console.log(`Captura escrita en ${output}`);

