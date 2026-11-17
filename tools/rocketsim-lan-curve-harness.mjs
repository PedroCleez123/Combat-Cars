import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOBILITY_LAN_CURVE_ARENA,
  MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS,
  MOBILITY_LAN_CURVE_SCENARIOS,
  mobilityLanCurveInputAtSnapshot,
} from "../src/mobility-lan-curve-contract.js";
import { lanStateToCurveSample } from "../src/mobility-lan-curve-capture.js";
import { connectLocalWebSocket } from "./local-websocket-client.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const executable = process.env.ROCKETSIM_BRIDGE_EXE || resolve(root, ".rocketsim-bridge-build-r20", "rocketsim_bridge-r20.exe");
function optionValue(name) {
  const inline = process.argv.find(value => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const port = Number(process.env.ROCKETSIM_LAN_CURVE_PORT || optionValue("--port") || 5351);
const scenarioId = process.env.ROCKETSIM_LAN_CURVE_SCENARIO || optionValue("--scenario") || "dodge-side";
const output = resolve(process.env.ROCKETSIM_LAN_CURVE_OUTPUT || optionValue("--output") || "docs/reference-captures/rocketsim-lan-dodge-curves.json");
const timeoutMs = Number(process.env.ROCKETSIM_LAN_CURVE_TIMEOUT_MS || 20_000);
const scenario = MOBILITY_LAN_CURVE_SCENARIOS.find(candidate => candidate.id === scenarioId);
if (!scenario) throw new Error(`Escenario LAN no soportado: ${scenarioId}`);
if (!existsSync(executable)) throw new Error(`No existe el bridge R20: ${executable}`);

let child = null;
let childOutput = "";
let closed = false;
function appendOutput(chunk) { childOutput = `${childOutput}${String(chunk)}`.slice(-8_000); }
function stopChild() {
  if (!child || child.killed) return;
  try { child.kill("SIGTERM"); } catch { /* Windows may already have reaped it. */ }
}
async function waitForHttp() {
  const deadline = Date.now() + Math.min(timeoutMs, 12_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch { /* listener is still starting */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`El servidor LAN de curvas no abrió HTTP en ${port}`);
}

async function run() {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      MOVEMENT_BACKEND: "rocketsim",
      ROCKETSIM_MODE: "practice",
      ROCKETSIM_ARENA: MOBILITY_LAN_CURVE_ARENA,
      ROCKETSIM_REQUEST_TIMEOUT_MS: process.env.ROCKETSIM_REQUEST_TIMEOUT_MS || "700",
      ROCKETSIM_BRIDGE_EXE: executable,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  await waitForHttp();

  const ws = await connectLocalWebSocket({ port, timeoutMs: 6_000 });
  let welcome = null;
  let sequence = 0;
  let pendingSequence = null;
  let restartSent = false;
  let baselineRespawn = null;
  let snapshotIndex = 0;
  const samples = [];
  const markers = [];
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolvePromise, rejectPromise) => { resolveResult = resolvePromise; rejectResult = rejectPromise; });
  const timeout = setTimeout(() => rejectResult(new Error("La captura LAN de curvas agotó su tiempo.")), timeoutMs);
  const finish = result => { clearTimeout(timeout); resolveResult(result); };
  const send = value => ws.send(JSON.stringify(value));
  const sendNextInput = () => {
    const input = mobilityLanCurveInputAtSnapshot(scenario, snapshotIndex);
    sequence += 1;
    pendingSequence = sequence;
    send({ type: "input", sequence, input });
  };

  ws.on("error", error => rejectResult(new Error(`WebSocket LAN de curvas falló: ${error?.message || "sin detalle"}`)));
  ws.on("close", () => { if (samples.length < MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS) rejectResult(new Error("WebSocket LAN cerrado antes de terminar la captura.")); });
  ws.on("message", data => {
    try {
      const message = JSON.parse(String(data));
      if (message.type === "welcome") {
        welcome = message;
        return;
      }
      if (message.type === "error") throw new Error(message.text || "El servidor LAN rechazó la captura.");
      if (message.type !== "state" || !welcome) return;
      const car = message.state?.cars?.find(candidate => candidate.id === welcome.id);
      if (!car) return;
      if (Number(message.state?.settings?.humans) !== 1) throw new Error("La captura LAN requiere un único piloto.");
      if (!restartSent) {
        baselineRespawn = Number(car.actionSerials?.respawn) || 0;
        restartSent = true;
        send({ type: "restart" });
        return;
      }
      if (baselineRespawn !== null && (Number(car.actionSerials?.respawn) || 0) <= baselineRespawn) return;
      if (pendingSequence === null) {
        sendNextInput();
        return;
      }
      if ((Number(message.inputAcknowledged) || 0) < pendingSequence) return;
      const input = mobilityLanCurveInputAtSnapshot(scenario, snapshotIndex);
      const sample = lanStateToCurveSample({ frame: snapshotIndex + 1, time: message.state.time, input, car });
      samples.push(sample);
      const serials = sample.state.actionSerials;
      const marker = `${serials.jump}:${serials.doubleJump}:${serials.dodge}`;
      if ((serials.jump || serials.doubleJump || serials.dodge) && markers.at(-1)?.value !== marker) markers.push({ frame: sample.frame, value: marker });
      snapshotIndex += 1;
      pendingSequence = null;
      if (snapshotIndex >= MOBILITY_LAN_CURVE_DURATION_SNAPSHOTS) finish({ markers, samples });
      else sendNextInput();
    } catch (error) {
      rejectResult(error);
    }
  });
  send({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: `lan-curve-${port}-${Date.now()}`, name: "LAN-CURVE-HARNESS" });
  const capture = await resultPromise.finally(() => { try { ws.close(); } catch { /* already closed */ } });
  const document = {
    schemaVersion: 1,
    profile: MOBILITY_LAN_CURVE_ARENA,
    source: "RocketSim R20 LAN WebSocket integration",
    fixedStepHz: 60,
    sampling: "one authoritative state after the acknowledged 60 Hz input packet",
    scenarioManifest: { version: 1, arena: MOBILITY_LAN_CURVE_ARENA, snapshotHz: 60, nativeFixedStepHz: 120, nativeTicksPerSnapshot: 2, durationSnapshots: 72, scenarios: [scenario] },
    traces: { [scenario.traceKey]: { name: scenario.id, fixedStepHz: 60, durationSeconds: 1.2, markers: capture.markers, samples: capture.samples } },
  };
  const result = { ...document, sha256: createHash("sha256").update(JSON.stringify(document)).digest("hex") };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { output, scenario: scenario.id, samples: capture.samples.length, sha256: result.sha256, bridge: basename(executable), childOutput };
}

try {
  console.log(JSON.stringify({ schemaVersion: 1, story: "MOB-AIR-03-LAN-CURVE-HARNESS", status: "ok", ...(await run()) }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ schemaVersion: 1, story: "MOB-AIR-03-LAN-CURVE-HARNESS", status: "failed", detail: error.message, childOutput }, null, 2));
  process.exitCode = 1;
} finally {
  closed = true;
  stopChild();
}
