import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { createBridgeActionTracker, bridgeFrameToCurveSample, normalizeCurveInput } from "../../src/rocketsim-curve-capture.js";
import { MOBILITY_CURVE_SCENARIOS, mobilityCurveScenarioManifest } from "../../src/mobility-curve-probes.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const output = resolve(process.argv[2] || "docs/reference-captures/rocketsim-bridge-r6-01-ground.json");
const groundScenarios = MOBILITY_CURVE_SCENARIOS.filter(scenario => scenario.initialCondition === "grounded");

if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
  process.exitCode = 2;
} else {
  const traces = {};
  for (const scenario of groundScenarios) {
    const bridge = new RocketSimBridge({ executable });
    const samples = [];
    const markers = [];
    const actionTracker = createBridgeActionTracker();
    let frame = 0;
    try {
      await bridge.start({ arena: "clean-six-planes", cars: [{ id: 1, team: "blue" }] });
      for (const phase of scenario.phases) {
        const input = normalizeCurveInput(phase.input || {});
        for (let index = 0; index < phase.frames; index += 1) {
          frame += 1;
          const state = await bridge.tick(frame, [{ id: 1, input }]);
          if (state.tick !== frame) throw new Error(`${scenario.id} devolvió tick ${state.tick} en vez de ${frame}`);
          const sample = bridgeFrameToCurveSample({ frame, input, car: state.cars[0], actionTracker });
          samples.push(sample);
          const serials = sample.state.actionSerials;
          const value = `${serials.jump}:${serials.doubleJump}:${serials.dodge}`;
          if ((serials.jump || serials.doubleJump || serials.dodge) && markers.at(-1)?.value !== value) markers.push({ frame, value });
        }
      }
    } finally {
      await bridge.shutdown();
    }
    traces[scenario.traceKey] = {
      name: scenario.id,
      fixedStepHz: 120,
      durationSeconds: frame / 120,
      markers,
      samples,
    };
  }
  const manifest = mobilityCurveScenarioManifest();
  const capture = {
    schemaVersion: 1,
    profile: "clean-six-planes",
    source: "RocketSim bridge R6-01",
    fixedStepHz: 120,
    sampling: "one sample after every authoritative fixed step",
    scenarioManifest: { ...manifest, scenarios: manifest.scenarios.filter(scenario => scenario.initialCondition === "grounded") },
    traces,
  };
  const sha256 = createHash("sha256").update(JSON.stringify(capture)).digest("hex");
  const result = { ...capture, sha256 };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, scenarios: groundScenarios.map(scenario => scenario.id), sha256 }, null, 2));
}
