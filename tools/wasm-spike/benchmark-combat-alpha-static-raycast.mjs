import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runP2PWasmCombatAlphaRaycastBenchmark } from "./combat-alpha-static-raycast-contract.mjs";

const WASM_MODULE_URL = new URL("./build/rocketsim_wasm.mjs", import.meta.url);

export async function runCombatAlphaStaticRaycastBenchmark() {
  const { default: createRocketSimWasm } = await import(WASM_MODULE_URL.href);
  const module = await createRocketSimWasm();
  return runP2PWasmCombatAlphaRaycastBenchmark({ module, now: () => performance.now() });
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direct) {
  try {
    const report = await runCombatAlphaStaticRaycastBenchmark();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.accepted ? 0 : 1;
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
