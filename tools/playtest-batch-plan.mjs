import process from "node:process";
import { createCombatExperiencePlaytestBatch, formatPlaytestBatchPlan } from "../src/playtest-batch-plan.js";

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const json = process.argv.includes("--json");
const batch = createCombatExperiencePlaytestBatch({
  host: readOption("--host", process.env.PLAYTEST_BATCH_HOST || "localhost"),
  combatPort: readOption("--combat-port", process.env.PLAYTEST_BATCH_COMBAT_PORT || 5300),
});

console.log(json ? JSON.stringify(batch, null, 2) : formatPlaytestBatchPlan(batch));
