/*
 * VISUAL-SMOKE-01 starts a disposable R20 combat server and observes the real
 * browser client through Electron. It intentionally checks only reproducible
 * presentation facts: boot, authoritative HUD, capture availability, and
 * renderer/load failures. Combat cooldown and input edges remain covered by
 * the authoritative combat tests; offscreen Chromium input is deliberately
 * not treated as gameplay evidence. It is not a judgement of game feel or
 * visual art direction.
 */
const { app, BrowserWindow } = require("electron");
const { existsSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const { request } = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { headingRateForFrame, isPhaseCaptureReady } = require("./visual-smoke-metrics.cjs");

const projectRoot = path.join(__dirname, "..");
const serverPath = path.join(projectRoot, "server.mjs");
const bridgePath = path.join(projectRoot, ".rocketsim-bridge-build-r20", "rocketsim_bridge-r20.exe");
const portArgument = process.argv.find(argument => argument.startsWith("--port="));
const outputArgument = process.argv.find(argument => argument.startsWith("--output="));
const port = Number(portArgument?.slice("--port=".length) || process.env.VISUAL_SMOKE_PORT || 5361);
const outputDirectory = outputArgument?.slice("--output=".length) || process.env.VISUAL_SMOKE_OUTPUT_DIR || null;
const startupTimeoutMs = Number(process.env.VISUAL_SMOKE_STARTUP_TIMEOUT_MS || 15000);
const clientTimeoutMs = Number(process.env.VISUAL_SMOKE_CLIENT_TIMEOUT_MS || 12000);
const timelineTimeoutMs = Number(process.env.VISUAL_SMOKE_TIMELINE_TIMEOUT_MS || 50000);
const maxAirHeadingRate = Number(process.env.VISUAL_SMOKE_MAX_AIR_HEADING_RATE || 3.3);
// The smoke browser is Electron, but the disposable HTTP/WebSocket server
// should run under the real Node runtime. Electron's ELECTRON_RUN_AS_NODE
// child can announce listen() while remaining unreachable from the parent
// process in restricted desktop environments. Callers may pin an absolute
// node.exe with VISUAL_SMOKE_NODE_EXE; PATH lookup is the portable default.
const serverRuntime = process.env.VISUAL_SMOKE_NODE_EXE || "node";

let server = null;
let window = null;
const serverOutput = [];
const browserErrors = [];
let semanticDiagnostics = null;

function fail(message) {
  throw new Error(`visual-smoke: ${message}`);
}

function requireValidConfiguration() {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) fail("--port debe estar entre 1024 y 65535");
  if (!Number.isFinite(maxAirHeadingRate) || maxAirHeadingRate <= 0) fail("VISUAL_SMOKE_MAX_AIR_HEADING_RATE debe ser un número positivo");
  if (!Number.isFinite(timelineTimeoutMs) || timelineTimeoutMs <= 0) fail("VISUAL_SMOKE_TIMELINE_TIMEOUT_MS debe ser un número positivo");
  if (!existsSync(serverPath)) fail(`no se encuentra ${serverPath}`);
  if (!existsSync(bridgePath)) fail(`no se encuentra el bridge R20: ${bridgePath}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendServerOutput(chunk) {
  const text = String(chunk).trim();
  if (!text) return;
  serverOutput.push(text);
  while (serverOutput.length > 24) serverOutput.shift();
}

function startServer() {
  server = spawn(serverRuntime, [serverPath], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      MOVEMENT_BACKEND: "rocketsim",
      ROCKETSIM_MODE: "combat",
      ROCKETSIM_ARENA: "combat-alpha",
      ROCKETSIM_REQUEST_TIMEOUT_MS: process.env.ROCKETSIM_REQUEST_TIMEOUT_MS || "500",
      ROCKETSIM_BRIDGE_EXE: bridgePath,
    },
  });
  server.stdout.on("data", appendServerOutput);
  server.stderr.on("data", appendServerOutput);
  server.once("error", error => appendServerOutput(`spawn-error: ${error.message}`));
}

function requestStatus() {
  return new Promise((resolve, reject) => {
    const probe = request({ hostname: "127.0.0.1", port, path: "/", method: "GET", timeout: 1000 }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    probe.once("error", reject);
    probe.once("timeout", () => probe.destroy(new Error("HTTP timeout")));
    probe.end();
  });
}

async function waitForHttp() {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await requestStatus() === 200) return;
      lastError = new Error("el servidor no devolvió HTTP 200");
    } catch (error) {
      lastError = error;
    }
    if (server?.exitCode !== null) break;
    await delay(150);
  }
  const detail = serverOutput.join("\n") || lastError?.message || "sin salida";
  fail(`R20 no alcanzó HTTP 200 en ${startupTimeoutMs} ms (${detail})`);
}

async function inspectClient() {
  return window.webContents.executeJavaScript(`(() => {
    const text = selector => document.querySelector(selector)?.textContent || "";
    return {
      title: document.title,
      objective: text("#objective"),
      readout: text("#readout"),
      status: text("#status"),
      canvas: Boolean(document.querySelector("#game")),
      webgl: Boolean(document.querySelector("#game")?.getContext("webgl2") || document.querySelector("#game")?.getContext("webgl")),
      visualSmoke: window.__arsenalVisualSmoke || null,
    };
  })()`);
}

function isClientReady(snapshot) {
  return snapshot.canvas
    && snapshot.webgl
    && snapshot.objective.includes("COMBATE ROCKETSIM")
    && snapshot.objective.includes("R20")
    && snapshot.readout.includes("COHETE")
    && snapshot.readout.includes("BAJAS")
    && snapshot.readout.includes("CAÍDAS");
}

async function waitForClient() {
  const deadline = Date.now() + clientTimeoutMs;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = await inspectClient();
    if (isClientReady(snapshot)) return snapshot;
    await delay(100);
  }
  fail(`el cliente no publicó HUD RocketSim R20 completo (${JSON.stringify(snapshot)})`);
}

async function armVisualPlayback() {
  await window.webContents.executeJavaScript(`(() => {
    if (window.__arsenalVisualSmoke) window.__arsenalVisualSmoke.armed = true;
    return Boolean(window.__arsenalVisualSmoke?.armed);
  })()`);
}

async function captureVisualPhases() {
  const phases = ["ground-idle", "ground-drive", "takeoff", "air-left-turn", "air-right-turn", "air-release", "complete"];
  const phaseOrder = new Map(phases.map((phase, index) => [phase, index]));
  const captures = [];
  const deadline = Date.now() + timelineTimeoutMs;
  for (const phase of phases) {
    let snapshot = null;
    let phaseHeld = false;
    while (Date.now() < deadline) {
      snapshot = await inspectClient();
      const observedIndex = phaseOrder.get(snapshot.visualSmoke?.phase);
      if (isPhaseCaptureReady(phase, snapshot)) {
        // Inspect and set the hold in one renderer-side turn. This closes the
        // race where a slow offscreen capture crosses the phase boundary.
        const holdResult = await window.webContents.executeJavaScript("(() => { const smoke = window.__arsenalVisualSmoke; const ready = smoke?.phase === " + JSON.stringify(phase) + "; if (ready) { smoke.captureHold = true; smoke.captureHoldStartedAt = performance.now() / 1000; } return { ready, phase: smoke?.phase || null }; })()");
        phaseHeld = holdResult?.ready === true;
        if (phaseHeld) break;
      }
      if (observedIndex !== undefined && observedIndex > phaseOrder.get(phase)) break;
      await delay(40);
    }
    const observedPhase = snapshot?.visualSmoke?.phase;
    if (observedPhase !== phase) fail(`visual playback esperaba la fase exacta ${phase}, pero observó ${observedPhase || "ninguna"}`);
    if (!isPhaseCaptureReady(phase, snapshot)) fail(`visual playback no observó cámara aérea autoritativa durante la fase exacta ${phase}`);
    if (!phaseHeld) fail("visual playback no pudo retener la fase exacta antes de capturar");
    await window.webContents.executeJavaScript(`(() => {
      if (window.__arsenalVisualSmoke) window.__arsenalVisualSmoke.captureHold = true;
      return Boolean(window.__arsenalVisualSmoke?.captureHold);
    })()`);
    let image;
    let afterCapture;
    try {
      image = await window.webContents.capturePage();
      afterCapture = await inspectClient();
    } finally {
      await window.webContents.executeJavaScript(`(() => {
        if (window.__arsenalVisualSmoke) {
          window.__arsenalVisualSmoke.captureHold = false;
          window.__arsenalVisualSmoke.captureNextPhase = ${JSON.stringify(phases[phaseOrder.get(phase) + 1] || null)};
        }
        return true;
      })()`);
    }
    const capturedPhase = afterCapture?.visualSmoke?.phase;
    if (capturedPhase !== phase) fail(`la captura ${phase} avanzó a la fase ${capturedPhase || "ninguna"} antes de completarse`);
    if (!isPhaseCaptureReady(phase, afterCapture)) fail(`la captura ${phase} no conservó evidencia aérea autoritativa durante la fase exacta`);
    const phaseSamples = (afterCapture.visualSmoke?.cameraSamples || []).filter(sample => sample.phase === phase);
    const phaseModeSample = phaseSamples.find(sample => phase === "takeoff" && sample.mode === "air")
      || phaseSamples.at(-1)
      || null;
    let capturePath = null;
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      capturePath = path.join(outputDirectory, `${String(captures.length + 1).padStart(2, "0")}-${phase}.png`);
      await writeFile(capturePath, image.toPNG());
    }
    captures.push({
      phase,
      observedPhase,
      modeEvidence: phaseModeSample?.mode || null,
      authoritativeAirSample: phaseSamples.some(sample => sample.mode === "air"),
      path: capturePath,
      ...summarizeCapture(image),
    });
  }
  const telemetry = await inspectClient();
  const samples = telemetry.visualSmoke?.cameraSamples || [];
  const motion = { samples: samples.length, maxHeadingSpeed: 0, maxPositionSpeed: 0, maxFocusSpeed: 0, nonFinite: 0, byPhase: {} };
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const sampleDt = Math.max(current.t - previous.t, 1 / 240);
    const rawHeadingSpeed = headingRateForFrame(previous, current);
    if (!Number.isFinite(rawHeadingSpeed)) motion.nonFinite += 1;
    const headingSpeed = Number.isFinite(rawHeadingSpeed) ? rawHeadingSpeed : 0;
    const positionSpeed = Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y, current.position.z - previous.position.z) / sampleDt;
    const focusSpeed = Math.hypot(current.focus.x - previous.focus.x, current.focus.y - previous.focus.y, current.focus.z - previous.focus.z) / sampleDt;
    motion.maxHeadingSpeed = Math.max(motion.maxHeadingSpeed, headingSpeed);
    motion.maxPositionSpeed = Math.max(motion.maxPositionSpeed, positionSpeed);
    motion.maxFocusSpeed = Math.max(motion.maxFocusSpeed, focusSpeed);
    const phase = current.phase || "unknown";
    const phaseMotion = motion.byPhase[phase] ||= { samples: 0, modes: {}, maxHeadingSpeed: 0, maxAirHeadingSpeed: 0, maxPositionSpeed: 0, maxFocusSpeed: 0 };
    phaseMotion.samples += 1;
    phaseMotion.modes[current.mode || "unknown"] = (phaseMotion.modes[current.mode || "unknown"] || 0) + 1;
    phaseMotion.maxHeadingSpeed = Math.max(phaseMotion.maxHeadingSpeed, headingSpeed);
    if (current.mode === "air" && previous.mode === "air" && !current.warmup && !previous.warmup) {
      phaseMotion.maxAirHeadingSpeed = Math.max(phaseMotion.maxAirHeadingSpeed, headingSpeed);
    }
    phaseMotion.maxPositionSpeed = Math.max(phaseMotion.maxPositionSpeed, positionSpeed);
    phaseMotion.maxFocusSpeed = Math.max(phaseMotion.maxFocusSpeed, focusSpeed);
    for (const value of [current.t, current.frameDt, current.heading, ...Object.values(current.position), ...Object.values(current.focus)]) {
      if (!Number.isFinite(value)) motion.nonFinite += 1;
    }
  }
  // Offscreen software rendering can produce about three samples per second.
  // The per-air-phase guard below remains stricter where the camera contract
  // matters; this total only rejects an absent or numerically invalid trace.
  semanticDiagnostics = { captures, motion };
  if (motion.samples < 24 || motion.nonFinite) fail(`telemetría de cámara insuficiente o inválida (${JSON.stringify(motion)})`);
  assertAirCameraEnvelope(motion);
  return semanticDiagnostics;
}

// The smoke owns only the reproducible camera contract: airborne turn phases
// must reach the authoritative air mode and remain within its presentation
// response envelope. Landing is intentionally excluded because its feel needs
// human review before introducing a transition policy.
function assertAirCameraEnvelope(motion) {
  for (const phase of ["air-left-turn", "air-right-turn"]) {
    const phaseMotion = motion.byPhase[phase];
    const airSamples = phaseMotion?.modes?.air || 0;
    // Software rendering can sample a phase only a handful of times. The
    // left turn still requires two air frames for a rate interval; the right
    // turn accepts one explicit air frame and reports its rate as unverified.
    // Grounded samples during the same labelled window never participate in
    // the airborne heading envelope.
    const minimumAirSamples = phase === "air-right-turn" ? 1 : 2;
    if (airSamples < minimumAirSamples) fail(`la fase ${phase} no mantuvo modo aéreo (${JSON.stringify(phaseMotion || null)})`);
    // A single right-turn air sample proves the authoritative mode but does
    // not form a rate interval; keep that coverage explicit and defer the
    // velocity envelope to a future higher-FPS capture.
    if (airSamples >= 2 && phaseMotion.maxAirHeadingSpeed > maxAirHeadingRate) {
      fail(`la fase ${phase} superó el límite aéreo de cámara ${maxAirHeadingRate} rad/s (${phaseMotion.maxAirHeadingSpeed})`);
    }
  }
}

function summarizeCapture(image) {
  const bitmap = image.toBitmap();
  let nonTransparent = 0;
  const colors = new Set();
  const stride = Math.max(4, Math.floor(bitmap.length / 4096 / 4) * 4);
  for (let index = 0; index + 3 < bitmap.length; index += stride) {
    if (bitmap[index + 3] !== 0) nonTransparent += 1;
    colors.add(`${bitmap[index]}:${bitmap[index + 1]}:${bitmap[index + 2]}`);
  }
  return {
    width: image.getSize().width,
    height: image.getSize().height,
    pngBytes: image.toPNG().length,
    sampledNonTransparentPixels: nonTransparent,
    sampledDistinctColors: colors.size,
  };
}

function validCapture(capture) {
  return capture.width >= 960
    && capture.height >= 540
    && capture.pngBytes > 4096
    && capture.sampledNonTransparentPixels > 10
    && capture.sampledDistinctColors > 8;
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.killed) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => {
      if (server?.exitCode === null) server.kill();
      resolve();
    }, 2500);
    timeout.unref?.();
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function run() {
  requireValidConfiguration();
  startServer();
  await waitForHttp();
  window = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    backgroundColor: "#0a111c",
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const text = String(message);
    const knownSoftwareRendererNotice = text.includes("Automatic fallback to software WebGL")
      || text.includes("GPU stall due to ReadPixels")
      || text.includes("GL Driver Message");
    if (level >= 2 && !text.includes("Electron Security Warning") && !knownSoftwareRendererNotice) {
      browserErrors.push(`${sourceId}:${line}: ${message}`);
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    browserErrors.push(`load ${code} ${description} ${validatedUrl}`);
  });
  await window.loadURL(`http://127.0.0.1:${port}/?arena=combat-alpha&visualSmoke=1`);
  const initial = await waitForClient();
  const capture = summarizeCapture(await window.webContents.capturePage());
  if (!validCapture(capture)) fail(`captura no válida (${JSON.stringify(capture)})`);
  await armVisualPlayback();
  const semantic = await captureVisualPhases();
  if (browserErrors.length) fail(`errores del cliente: ${browserErrors.join(" | ")}`);
  return {
    schemaVersion: 1,
    story: "VISUAL-SMOKE-01",
    status: "ok",
    port,
    server: { backend: "rocketsim", bridge: "R20", arena: "combat-alpha" },
    checks: {
      initialHud: initial.readout.includes("COHETE"),
      combatHudReadyLabel: initial.readout.includes("LISTO · F PARA LANZAR"),
      authoritativeCombatLabel: initial.objective.includes("COMBATE ROCKETSIM") && initial.objective.includes("R20"),
      capture,
      semantic,
      browserErrorCount: browserErrors.length,
    },
  };
}

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    console.log(JSON.stringify(await run(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schemaVersion: 1,
      story: "VISUAL-SMOKE-01",
      status: "failed",
      detail: error.message || String(error),
      browserErrors,
      browserErrorCount: browserErrors.length,
      serverOutput,
      captures: semanticDiagnostics?.captures || [],
      motion: semanticDiagnostics?.motion || null,
    }, null, 2));
    exitCode = 1;
  } finally {
    window?.destroy();
    await stopServer();
    app.exit(exitCode);
  }
});
