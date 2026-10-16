import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import {
  bridgeArenaForInitialCondition,
  bridgeFrameToCurveSample,
  createBridgeActionTracker,
  normalizeCurveInput,
} from "../../src/rocketsim-curve-capture.js";
import { MOBILITY_CURVE_SCENARIOS, mobilityCurveScenarioManifest } from "../../src/mobility-curve-probes.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const output = resolve(process.argv[2] || "docs/reference-captures/rocketsim-bridge-r6-02-all.json");

async function captureScenario(scenario) {
  const bridge = new RocketSimBridge({ executable });
  const samples = [];
  const markers = [];
  const actionTracker = createBridgeActionTracker();
  let frame = 0;
  try {
    const arena = bridgeArenaForInitialCondition(scenario.initialCondition);
    const ready = await bridge.start({ arena, cars: [{ id: 1, team: "blue" }] });
    if (ready.arena !== arena) throw new Error(`${scenario.id} inició ${ready.arena} en vez de ${arena}`);
    for (const phase of scenario.phases) {
      const input = normalizeCurveInput(phase.input || {});
      for (let index = 0; index < phase.frames; index += 1) {
        frame += 1;
        const state = await bridge.tick(frame, [{ id: 1, input }]);
        if (state.tick !== frame) throw new Error(`${scenario.id} devolvió tick ${state.tick} en vez de ${frame}`);
        const car = state.cars[0];
        if (scenario.initialCondition !== "grounded" && car.grounded) {
          throw new Error(`${scenario.id} tocó suelo en el tick ${frame}`);
        }
        const sample = bridgeFrameToCurveSample({ frame, input, car, actionTracker });
        samples.push(sample);
        const serials = sample.state.actionSerials;
        const value = `${serials.jump}:${serials.doubleJump}:${serials.dodge}`;
        if ((serials.jump || serials.doubleJump || serials.dodge) && markers.at(-1)?.value !== value) markers.push({ frame, value });
      }
    }
  } finally {
    await bridge.shutdown();
  }
  if (frame !== 144) throw new Error(`${scenario.id} generó ${frame} ticks, se esperaban 144`);
  return [scenario.traceKey, {
    name: scenario.id,
    fixedStepHz: 120,
    durationSeconds: frame / 120,
    markers,
    samples,
  }];
}

if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
  process.exitCode = 2;
} else {
  const traces = Object.fromEntries(await Promise.all(MOBILITY_CURVE_SCENARIOS.map(captureScenario)));
  const capture = {
    schemaVersion: 1,
    profile: "mixed-development-profiles",
    source: "RocketSim bridge R6-02",
    fixedStepHz: 120,
    sampling: "one sample after every authoritative fixed step",
    scenarioManifest: mobilityCurveScenarioManifest(),
    traces,
  };
  const sha256 = createHash("sha256").update(JSON.stringify(capture)).digest("hex");
  const result = { ...capture, sha256 };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, scenarios: Object.keys(traces), sha256 }, null, 2));
}
