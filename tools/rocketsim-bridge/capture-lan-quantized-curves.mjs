import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";
import { bridgeFrameToCurveSample, createBridgeActionTracker } from "../../src/rocketsim-curve-capture.js";
import {
  MOBILITY_LAN_CURVE_ARENA,
  MOBILITY_LAN_CURVE_NATIVE_TICKS_PER_SNAPSHOT,
  MOBILITY_LAN_CURVE_SCENARIOS,
  assertMobilityLanCurveScenario,
  mobilityLanCurveInputAtSnapshot,
  mobilityLanCurveManifest,
} from "../../src/mobility-lan-curve-contract.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const output = resolve(process.argv[2] || "docs/reference-captures/rocketsim-lan-quantized-curves.json");

async function captureScenario(scenario) {
  assertMobilityLanCurveScenario(scenario);
  const bridge = new RocketSimBridge({ executable });
  const actionTracker = createBridgeActionTracker();
  const samples = [];
  const markers = [];
  let nativeTick = 0;
  try {
    const ready = await bridge.start({ arena: MOBILITY_LAN_CURVE_ARENA, cars: [{ id: 1, team: "blue" }] });
    if (ready.arena !== MOBILITY_LAN_CURVE_ARENA) throw new Error(`${scenario.id} inició ${ready.arena} en vez de ${MOBILITY_LAN_CURVE_ARENA}`);
    for (let snapshotIndex = 0; snapshotIndex < 72; snapshotIndex += 1) {
      const input = mobilityLanCurveInputAtSnapshot(scenario, snapshotIndex);
      let car = null;
      for (let step = 0; step < MOBILITY_LAN_CURVE_NATIVE_TICKS_PER_SNAPSHOT; step += 1) {
        nativeTick += 1;
        const state = await bridge.tick(nativeTick, [{ id: 1, input }]);
        if (state.tick !== nativeTick) throw new Error(`${scenario.id} devolvió tick ${state.tick} en vez de ${nativeTick}`);
        car = state.cars[0];
      }
      const sample = bridgeFrameToCurveSample({ frame: snapshotIndex + 1, input, car, actionTracker });
      sample.time = (snapshotIndex + 1) / 60;
      samples.push(sample);
      const serials = sample.state.actionSerials;
      const value = `${serials.jump}:${serials.doubleJump}:${serials.dodge}`;
      if ((serials.jump || serials.doubleJump || serials.dodge) && markers.at(-1)?.value !== value) markers.push({ frame: sample.frame, value });
    }
  } finally {
    await bridge.shutdown();
  }
  return [scenario.traceKey, { name: scenario.id, fixedStepHz: 60, durationSeconds: 1.2, markers, samples }];
}

if (!executable || !existsSync(executable)) {
  console.error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
  process.exitCode = 2;
} else {
  const traces = Object.fromEntries(await Promise.all(MOBILITY_LAN_CURVE_SCENARIOS.map(captureScenario)));
  const capture = {
    schemaVersion: 1,
    profile: MOBILITY_LAN_CURVE_ARENA,
    source: "RocketSim bridge native LAN-quantized",
    fixedStepHz: 60,
    sampling: "one sample after two authoritative 120 Hz ticks",
    scenarioManifest: mobilityLanCurveManifest(),
    traces,
  };
  const result = { ...capture, sha256: createHash("sha256").update(JSON.stringify(capture)).digest("hex") };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, scenarios: Object.keys(traces), sha256: result.sha256 }, null, 2));
}
