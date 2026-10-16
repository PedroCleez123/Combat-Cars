import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundledDevelopmentBridge = resolve(root, ".rocketsim-bridge-build-r9", "rocketsim_bridge-r19.exe");
const executable = process.env.ROCKETSIM_BRIDGE_EXE || (existsSync(bundledDevelopmentBridge) ? bundledDevelopmentBridge : null);

if (!executable || !existsSync(executable)) {
  throw new Error("No se encontró rocketsim_bridge-r19.exe. Compila el bridge R19 o define ROCKETSIM_BRIDGE_EXE.");
}

const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, MOVEMENT_BACKEND: "rocketsim", ROCKETSIM_MODE: "practice", ROCKETSIM_ARENA: process.env.ROCKETSIM_ARENA || "arsenal-expanded-cornered-practice", ROCKETSIM_BRIDGE_EXE: executable },
  stdio: "inherit",
  windowsHide: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("exit", (code, signal) => {
  if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
