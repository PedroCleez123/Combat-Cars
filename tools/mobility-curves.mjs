import { mobilityCurveScenarioManifest, runMobilityCurveSuite } from "../src/mobility-curve-probes.js";

if (process.argv.includes("--manifest")) {
  console.log(JSON.stringify(mobilityCurveScenarioManifest(), null, 2));
} else {
  console.log(JSON.stringify(runMobilityCurveSuite(), null, 2));
}

