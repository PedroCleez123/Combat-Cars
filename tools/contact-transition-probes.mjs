import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runContactTransitionProbes } from "../src/contact-transition-probes.js";

const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve("docs/reference-captures/arsenal-m4-01-contact-transitions.json");
const result = runContactTransitionProbes();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Captura escrita en ${outputPath}`);

