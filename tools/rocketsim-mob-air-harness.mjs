import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createMobAir01BrowserPlayback, stepMobAir01BrowserPlayback } from "../src/mob-air-01-browser-playback.js";
import { connectLocalWebSocket } from "./local-websocket-client.mjs";

/**
 * Autonomous R20 mobility campaign. It owns an isolated server by default,
 * drives the normal WebSocket input contract, and reports only authoritative
 * snapshots. It deliberately does not synthesize browser keyboard events.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const direction = process.env.MOB_AIR_HARNESS_DIRECTION || process.argv.find(value => value.startsWith("--direction="))?.split("=")[1] || "diagonal";
const port = Number(process.env.MOB_AIR_HARNESS_PORT || process.argv.find(value => value.startsWith("--port="))?.split("=")[1] || 5350);
const existing = process.argv.includes("--existing");
const timeoutMs = Number(process.env.MOB_AIR_HARNESS_TIMEOUT_MS || 15_000);
const executable = process.env.ROCKETSIM_BRIDGE_EXE || resolve(root, ".rocketsim-bridge-build-r20", "rocketsim_bridge-r20.exe");

if (!["front", "side", "diagonal"].includes(direction)) throw new Error(`Dirección no soportada: ${direction}`);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`Puerto inválido: ${port}`);
if (!Number.isFinite(timeoutMs) || timeoutMs < 2_000) throw new Error("MOB_AIR_HARNESS_TIMEOUT_MS debe ser >= 2000");
if (!existing && !existsSync(executable)) throw new Error(`No existe el bridge R20: ${executable}`);

let child = null;
let childOutput = "";
let closed = false;
const startedAt = Date.now();
const debugHarness = process.env.DEBUG_MOB_AIR_HARNESS === "1";
const debugLog = (...values) => { if (debugHarness) console.error("[MOB-AIR-HARNESS]", ...values); };

function appendOutput(chunk) {
  childOutput = `${childOutput}${String(chunk)}`.slice(-8_000);
}

async function waitForHttp() {
  const deadline = Date.now() + Math.min(timeoutMs, 12_000);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`El servidor aislado no abrió HTTP: ${lastError?.message || "timeout"}`);
}

function stopChild() {
  if (!child || child.killed) return;
  try { child.kill("SIGTERM"); } catch { /* Windows may already have reaped it. */ }
}

function send(ws, value) { ws.send(JSON.stringify(value)); }

async function runCampaign() {
  if (!existing) {
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        MOVEMENT_BACKEND: "rocketsim",
        ROCKETSIM_MODE: "practice",
        ROCKETSIM_ARENA: "arsenal-expanded-cornered-practice",
        ROCKETSIM_REQUEST_TIMEOUT_MS: process.env.ROCKETSIM_REQUEST_TIMEOUT_MS || "700",
        ROCKETSIM_BRIDGE_EXE: executable,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.once("exit", (code, signal) => { if (!closed && code !== 0) appendOutput(`\nchild-exit code=${code} signal=${signal}`); });
  }

  if (!existing) await waitForHttp();
  debugLog("HTTP listo", port);
  const ws = await connectLocalWebSocket({ port, timeoutMs: Math.min(timeoutMs, 6_000) });
  let welcome = null;
  let currentInput = {};
  let sequence = 0;
  let acknowledged = 0;
  let snapshots = 0;
  let lastStateAt = 0;
  let lastStateTime = null;
  let campaignReport = null;
  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolveResultFn, rejectResultFn) => {
    resolveResult = resolveResultFn;
    rejectResult = rejectResultFn;
  });
  const timeout = setTimeout(() => rejectResult(new Error("La campaña MOB-AIR agotó su tiempo.")), timeoutMs);

  const finish = report => {
    if (campaignReport) return;
    campaignReport = report;
    clearTimeout(timeout);
    resolveResult(report);
  };

  ws.on("error", error => { debugLog("WebSocket error", error); rejectResult(new Error(`WebSocket del harness falló: ${error?.message || "sin detalle"}`)); });
  ws.on("close", event => { debugLog("WebSocket cerrado", event); if (!campaignReport) rejectResult(new Error("WebSocket cerrado antes de completar la campaña.")); });
  ws.on("message", data => {
    try {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message.type === "welcome") {
        debugLog("welcome", message.id, message.owner);
        welcome = message;
        return;
      }
      if (message.type === "error") {
        debugLog("mensaje de error", message.text);
        rejectResult(new Error(message.text || "El servidor rechazó la campaña."));
        return;
      }
      if (message.type !== "state" || !welcome) return;
      snapshots += 1;
      debugLog("state", snapshots, message.inputAcknowledged);
      acknowledged = Math.max(acknowledged, Number(message.inputAcknowledged) || 0);
      const state = message.state || {};
      const car = state.cars?.find(candidate => candidate.id === welcome.id) || null;
      const playerCount = Number(state.settings?.humans);
      const now = (Date.now() - startedAt) / 1000;
      lastStateAt = now;
      lastStateTime = state.time ?? null;
      const step = stepMobAir01BrowserPlayback(playback, { now, car, snapshotTime: state.time, playerCount });
      currentInput = step.input || {};
      if (step.restartRequested && !restartSent) {
        restartSent = true;
        send(ws, { type: "restart" });
      }
      if (step.done) finish({ report: step.report, snapshots, acknowledged, playerCount, stateTime: lastStateTime, lastStateAt });
    } catch (error) {
      debugLog("fallo al procesar mensaje", error?.stack || error);
      rejectResult(error);
    }
  });

  const playback = createMobAir01BrowserPlayback({ dodgeDirection: direction });
  let restartSent = false;
  debugLog("WebSocket abierto");
  const hello = { type: "hello", protocolVersion: 1, roomId: "local", sessionId: `mob-air-harness-${port}-${Date.now()}`, name: "MOB-AIR-HARNESS" };
  debugLog("enviando hello", hello);
  send(ws, hello);
  debugLog("hello enviado");
  const inputTimer = setInterval(() => {
    if (!ws.open || !welcome || campaignReport) return;
    send(ws, { type: "input", sequence: ++sequence, input: currentInput });
  }, 1000 / 60);
  const report = await resultPromise.finally(() => {
    clearInterval(inputTimer);
    try { ws.close(); } catch { /* already closed */ }
  });
  return { ...report, port, direction, isolatedServer: !existing, bridge: basename(executable), childOutput };
}

try {
  const report = await runCampaign();
  console.log(JSON.stringify({ schemaVersion: 1, story: "MOB-AIR-R20-HARNESS", status: "ok", ...report }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ schemaVersion: 1, story: "MOB-AIR-R20-HARNESS", status: "failed", detail: error.message, port, direction, isolatedServer: !existing, childOutput }, null, 2));
  process.exitCode = 1;
} finally {
  closed = true;
  stopChild();
}
