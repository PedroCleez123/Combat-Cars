import { readFile } from "node:fs/promises";
import { compareCurveTraces } from "../src/mobility-curve-comparison.js";

const [referencePath, candidatePath, scenario = "dodge-forward"] = process.argv.slice(2);
if (!referencePath || !candidatePath) {
  console.error("Uso: node tools/compare-mobility-curves.mjs <referencia.json> <candidato.json> [escenario]");
  process.exitCode = 1;
} else {
  const reference = JSON.parse(await readFile(referencePath, "utf8"));
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  console.log(JSON.stringify(compareCurveTraces(reference, candidate, scenario), null, 2));
}

