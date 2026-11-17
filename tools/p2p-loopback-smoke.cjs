/*
 * P2P-WEBRTC-02 exercises the browser-native WebRTC loopback in Electron.
 * It starts a disposable localhost-only static host, clicks the opt-in page,
 * records the DOM transcript, then tears down only the processes it created.
 */
const { app, BrowserWindow } = require("electron");
const { randomBytes } = require("node:crypto");
const { mkdir, writeFile } = require("node:fs/promises");
const { request } = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const serverPath = path.join(projectRoot, "server.mjs");
const hostMode = process.argv.includes("--host");
const sessionMode = process.argv.includes("--session");
const pagePath = sessionMode ? "/p2p-session-loopback.html" : hostMode ? "/p2p-host-loopback.html" : "/p2p-loopback.html";
const story = sessionMode ? "P2P-SESSION-04" : hostMode ? "P2P-HOST-01" : "P2P-WEBRTC-02";
const configuredPort = process.env.P2P_SMOKE_PORT === undefined ? null : Number(process.env.P2P_SMOKE_PORT);
const startupTimeoutMs = Number(process.env.P2P_SMOKE_STARTUP_TIMEOUT_MS || 15000);
const clientTimeoutMs = Number(process.env.P2P_SMOKE_TIMEOUT_MS || 15000);
const startedAt = Date.now();
const forbiddenPorts = new Set([5298, 5300]);

let port = null;
let server = null;
let window = null;
let serverSpawnFailed = false;
let serverListenAnnounced = false;
let serverStartupOutput = "";
let httpErrorCode = null;
let httpStatus = null;
let pageSnapshot = { status: "", events: [] };
let artifactDirectory = null;
let browserErrors = [];
let reportEmitted = false;
let quitPreventedBeforeReport = false;

// Electron can otherwise quit when it has no BrowserWindow while the local
// server is still starting. Keep the smoke alive until its final report exists.
app.on("before-quit", event => {
  if (!reportEmitted) {
    quitPreventedBeforeReport = true;
    event.preventDefault();
  }
});

function fail(reason) {
  const error = new Error(reason);
  error.safeReason = reason;
  throw error;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, reason) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(reason), { safeReason: reason })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function validateConfiguration() {
  if (hostMode && sessionMode) fail("Los modos --host y --session son excluyentes.");
  if (configuredPort !== null
    && (!Number.isSafeInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65535 || forbiddenPorts.has(configuredPort))) {
    fail("P2P_SMOKE_PORT debe ser un puerto configurable válido distinto de 5298 y 5300.");
  }
  for (const [name, value] of [["P2P_SMOKE_STARTUP_TIMEOUT_MS", startupTimeoutMs], ["P2P_SMOKE_TIMEOUT_MS", clientTimeoutMs]]) {
    if (!Number.isSafeInteger(value) || value < 1000 || value > 60000) {
      fail(`${name} debe estar entre 1000 y 60000 ms.`);
    }
  }
}

async function chooseLoopbackPort() {
  if (configuredPort !== null) return configuredPort;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const probe = net.createServer();
    const availablePort = await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => resolve(probe.address().port));
    });
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    if (!forbiddenPorts.has(availablePort)) return availablePort;
  }
  fail("No se pudo reservar un puerto loopback permitido.");
}

function safeInheritedEnvironment() {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function createServerEnvironment() {
  return {
    ...safeInheritedEnvironment(),
    PORT: String(port),
    MOVEMENT_BACKEND: "js",
    // The server binds 127.0.0.1 in this mode. These disposable local values
    // satisfy its preflight; no user secret or access token is read or issued.
    ARSENAL_NETWORK_MODE: "online",
    ARSENAL_ONLINE_TLS_TERMINATED: "true",
    ARSENAL_ONLINE_ADAPTER: "hosted",
    ARSENAL_ONLINE_AUTH: "jwt-hs256",
    ARSENAL_ONLINE_JWT_SECRET: randomBytes(32).toString("hex"),
    ARSENAL_ONLINE_JWT_ISSUER: "p2p-loopback-smoke-local",
    ARSENAL_ONLINE_JWT_AUDIENCE: "p2p-loopback-smoke-local",
    ARSENAL_ONLINE_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    ARSENAL_ONLINE_MAX_ROOMS: "1",
    ARSENAL_ONLINE_MAX_CONNECTIONS: "1",
    ARSENAL_ONLINE_MAX_FRAME_BYTES: "2048",
  };
}

async function createArtifactDirectory() {
  const configuredRoot = process.env.P2P_SMOKE_OUTPUT_DIR;
  const outputRoot = configuredRoot
    ? path.resolve(projectRoot, configuredRoot)
    : path.join(projectRoot, "artifacts");
  await mkdir(outputRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const prefix = sessionMode ? "p2p-session-loopback" : hostMode ? "p2p-host-loopback" : "p2p-loopback";
    const uniqueName = `${prefix}-${timestamp}-${process.pid}-${randomBytes(4).toString("hex")}`;
    const candidate = path.join(outputRoot, uniqueName);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  fail("No se pudo crear un directorio único para el artefacto.");
}

function startServer() {
  const runtime = process.env.P2P_SMOKE_NODE_EXE || "node";
  server = spawn(runtime, [serverPath], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
    env: createServerEnvironment(),
  });
  server.stdout.on("data", chunk => {
    serverStartupOutput = (serverStartupOutput + String(chunk)).slice(-512);
    if (serverStartupOutput.includes("backend=js") && serverStartupOutput.includes(`http://localhost:${port}`)) {
      serverListenAnnounced = true;
    }
  });
  server.once("error", () => { serverSpawnFailed = true; });
}

function requestPageStatus() {
  return new Promise((resolve, reject) => {
    const probe = request({
      hostname: "127.0.0.1",
      port,
      path: pagePath,
      method: "GET",
      timeout: 1000,
    }, response => {
      httpStatus = response.statusCode ?? null;
      httpErrorCode = null;
      response.resume();
      resolve(httpStatus);
    });
    probe.once("error", error => {
      httpErrorCode = typeof error.code === "string" ? error.code : "HTTP_ERROR";
      reject(error);
    });
    probe.once("timeout", () => {
      httpErrorCode = "HTTP_TIMEOUT";
      probe.destroy(new Error("HTTP timeout"));
    });
    probe.end();
  });
}

async function waitForHttp() {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (serverSpawnFailed || server?.exitCode !== null) fail("El servidor local desechable no pudo arrancar.");
    try {
      if (await requestPageStatus() === 200) {
        // Check that a configured-port collision did not serve this response.
        await delay(100);
        if (serverSpawnFailed || server?.exitCode !== null) fail("El servidor local desechable no pudo arrancar.");
        return;
      }
    } catch {
      // Keep polling until the bounded startup deadline.
    }
    await delay(100);
  }
  fail(`El servidor local no devolvió HTTP 200 para ${pagePath} dentro del tiempo límite.`);
}

function attachBrowserDiagnostics(browserWindow) {
  browserWindow.webContents.on("console-message", (_event, levelOrDetails, message) => {
    const details = levelOrDetails && typeof levelOrDetails === "object" ? levelOrDetails : null;
    const level = details ? details.level : levelOrDetails;
    const text = String(details ? details.message : message || "").slice(0, 500);
    const isError = typeof level === "string" ? level.toLowerCase() === "error" : Number(level) >= 2;
    if (isError && !text.includes("Electron Security Warning") && browserErrors.length < 20) browserErrors.push(text);
  });
}

function readPageSnapshot() {
  return withTimeout(window.webContents.executeJavaScript(`(() => ({
    status: document.querySelector("#status")?.textContent?.trim() || "",
    events: Array.from(document.querySelectorAll("#events li"), item => item.textContent.trim()).slice(0, 40),
  }))()`), 2000, "El renderer no respondió al diagnóstico dentro del tiempo límite.");
}

async function clickAndWaitForSuccess() {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector("#run");
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) fail("No se pudo pulsar el botón de prueba mediante Electron.");

  const deadline = Date.now() + clientTimeoutMs;
  while (Date.now() < deadline) {
    pageSnapshot = await readPageSnapshot();
    const status = pageSnapshot.status;
    if (status.includes("Completado:") && status.includes("Peers cerrados.")) return;
    if (status.includes("No completado:") && status.includes("Peers cerrados.")) {
      fail("La página completó el diagnóstico WebRTC local con resultado fallido.");
    }
    await delay(100);
  }
  fail("La página no alcanzó el estado de éxito dentro del tiempo límite.");
}

function createSmokeWindow() {
  window = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  attachBrowserDiagnostics(window);
}

async function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return true;
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", finish);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", finish);
      resolve(child.exitCode !== null);
    }, timeoutMs);
    child.once("exit", finish);
  });
}

async function stopServer() {
  if (!server || server.exitCode !== null) return true;
  try { server.kill("SIGTERM"); } catch { /* The child may already have exited. */ }
  if (await waitForChildExit(server, 1500)) return true;
  try { server.kill("SIGKILL"); } catch { /* Only this smoke's child is targeted. */ }
  return waitForChildExit(server, 1000);
}

async function cleanup() {
  if (window && !window.isDestroyed()) {
    try { window.destroy(); } catch { /* Electron may already have closed it. */ }
  }
  return await stopServer();
}

function buildReport(status, reason = undefined) {
  const resultPath = artifactDirectory ? path.join(artifactDirectory, "result.json") : null;
  return {
    schemaVersion: 1,
    story,
    url: port ? `http://127.0.0.1:${port}${pagePath}` : null,
    versions: { electron: process.versions.electron || null, chromium: process.versions.chrome || null },
    status,
    pageStatus: pageSnapshot.status,
    events: pageSnapshot.events,
    consoleErrors: browserErrors,
    httpStatus,
    httpErrorCode,
    serverListenAnnounced,
    quitPreventedBeforeReport,
    durationMs: Date.now() - startedAt,
    artifactPath: resultPath ? path.relative(projectRoot, resultPath) : null,
    ...(reason ? { reason } : {}),
  };
}

async function run() {
  let failureReason = null;
  let didPass = false;
  try {
    artifactDirectory = await createArtifactDirectory();
    validateConfiguration();
    await app.whenReady();
    createSmokeWindow();
    port = await chooseLoopbackPort();
    startServer();
    await waitForHttp();
    const pageUrl = `http://127.0.0.1:${port}${pagePath}`;
    await withTimeout(window.loadURL(pageUrl), clientTimeoutMs, "La página local no terminó de cargar dentro del tiempo límite.");
    await clickAndWaitForSuccess();
    if (browserErrors.length > 0) fail("El renderer registró errores de consola durante la prueba.");
    didPass = true;
  } catch (error) {
    failureReason = error?.safeReason || "El smoke WebRTC local terminó con un error inesperado.";
  } finally {
    if (!artifactDirectory && !failureReason) failureReason = "No se pudo preparar el directorio del artefacto.";
    let childStopped = false;
    try { childStopped = await cleanup(); } catch { /* Continue to emit a safe failure report. */ }
    if (!childStopped) {
      didPass = false;
      failureReason = failureReason || "No se pudo confirmar el cierre del servidor local desechable.";
    }
    if (!didPass && serverListenAnnounced && httpStatus === null) {
      failureReason = "El proceso hijo anunció la escucha local, pero Electron no recibió respuesta HTTP por loopback.";
    }
  }

  let report;
  try {
    report = buildReport(didPass ? "pass" : "fail", didPass ? undefined : failureReason || "El smoke WebRTC local falló.");
  } catch {
    report = {
      schemaVersion: 1,
      story,
      url: port ? `http://127.0.0.1:${port}${pagePath}` : null,
      versions: { electron: process.versions.electron || null, chromium: process.versions.chrome || null },
      status: "fail",
      events: [],
      consoleErrors: [],
      httpStatus,
      quitPreventedBeforeReport,
      durationMs: Date.now() - startedAt,
      artifactPath: artifactDirectory ? path.relative(projectRoot, path.join(artifactDirectory, "result.json")) : null,
      reason: "No se pudo construir el informe del smoke WebRTC local.",
    };
  }
  await emitFinalReport(report);
}

async function emitFinalReport(report) {
  if (reportEmitted) return;
  let finalReport = report;
  if (artifactDirectory) {
    try {
      await writeFile(path.join(artifactDirectory, "result.json"), `${JSON.stringify(finalReport)}\n`, { flag: "wx" });
    } catch {
      finalReport = {
        ...finalReport,
        status: "fail",
        reason: "No se pudo guardar el artefacto JSON.",
      };
    }
  }
  reportEmitted = true;
  console.log(JSON.stringify(finalReport));
  app.exit(finalReport.status === "pass" ? 0 : 1);
}

run().catch(async () => {
  try { await cleanup(); } catch { /* Preserve the fallback result. */ }
  await emitFinalReport({
    schemaVersion: 1,
    story,
    url: port ? `http://127.0.0.1:${port}${pagePath}` : null,
    versions: { electron: process.versions.electron || null, chromium: process.versions.chrome || null },
    status: "fail",
    events: pageSnapshot.events,
    consoleErrors: browserErrors,
    httpStatus,
    quitPreventedBeforeReport,
    durationMs: Date.now() - startedAt,
    artifactPath: artifactDirectory ? path.relative(projectRoot, path.join(artifactDirectory, "result.json")) : null,
    reason: "Electron no pudo completar el smoke WebRTC local.",
  });
});
