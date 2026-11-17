const { app, BrowserWindow, dialog } = require("electron");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { createServer, request } = require("node:http");
const { existsSync, createWriteStream } = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 5300);
const STARTUP_TIMEOUT_MS = 12_000;
const SHUTDOWN_TIMEOUT_MS = 2_500;
const isPackaged = app.isPackaged;
const projectRoot = isPackaged ? app.getAppPath() : path.join(__dirname, "..");
const serverCwd = isPackaged ? process.resourcesPath : projectRoot;
const serverPath = path.join(projectRoot, "server.mjs");
const bridgePath = isPackaged
  ? path.join(process.resourcesPath, "bridge", "rocketsim_bridge-r20.exe")
  : path.join(projectRoot, ".rocketsim-bridge-build-r20", "rocketsim_bridge-r20.exe");
const launchToken = randomBytes(32).toString("hex");

let gameServer = null;
let gameWindow = null;
let quitting = false;

// The desktop launcher starts a LAN-only server and a native bridge. Keep
// hosted deployment values out of both child processes while preserving the
// Windows/runtime variables needed to start Node and native DLLs.
const childEnvironmentAllowlist = new Set([
  "path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp",
  "userprofile", "homedrive", "homepath", "home", "appdata", "localappdata",
  "programdata", "os", "processor_architecture", "processor_architew6432",
  "number_of_processors", "ld_library_path", "dyld_library_path",
  "dyld_fallback_library_path", "lang", "lc_all", "tz",
]);

function createChildEnvironment(overrides) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (childEnvironmentAllowlist.has(name.toLowerCase())) env[name] = value;
  }
  return { ...env, ...overrides };
}

function gameUrl() {
  return `http://127.0.0.1:${PORT}/?arena=combat-alpha`;
}

function fail(message) {
  dialog.showErrorBox("Combat Cars no se pudo iniciar", message);
}

function assertLaunchConfiguration() {
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535.");
  }
  if (!existsSync(serverPath)) throw new Error(`No se encuentra el servidor del juego: ${serverPath}`);
  if (!existsSync(bridgePath)) throw new Error(`No se encuentra el bridge RocketSim R20: ${bridgePath}`);
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", error => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`El puerto ${port} ya está en uso. Cierra la instancia manual del juego antes de abrir la aplicación.`));
        return;
      }
      reject(error);
    });
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

function appendChildLogs(child) {
  const logPath = path.join(app.getPath("userData"), "server.log");
  const log = createWriteStream(logPath, { flags: "a" });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once("exit", () => log.end());
  return logPath;
}

function startServer() {
  const childEnvironment = createChildEnvironment({
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(PORT),
    MOVEMENT_BACKEND: "rocketsim",
    ROCKETSIM_MODE: "combat",
    ROCKETSIM_ARENA: "combat-alpha",
    ROCKETSIM_REQUEST_TIMEOUT_MS: process.env.ROCKETSIM_REQUEST_TIMEOUT_MS || "500",
    ROCKETSIM_BRIDGE_EXE: bridgePath,
    ARSENAL_DESKTOP_SHUTDOWN_TOKEN: launchToken,
  });
  gameServer = spawn(process.execPath, [serverPath], {
    cwd: serverCwd,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const logPath = appendChildLogs(gameServer);
  gameServer.once("error", error => {
    fail(`No se pudo crear el servidor local.\n\n${error.message}\n\nRegistro: ${logPath}`);
  });
  return logPath;
}

function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const probe = request(gameUrl(), { method: "GET", timeout: 1_000 }, response => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry(new Error(`El servidor devolvió HTTP ${response.statusCode}.`));
      });
      probe.once("error", retry);
      probe.once("timeout", () => probe.destroy(new Error("El servidor tardó demasiado en responder.")));
      probe.end();
    };
    const retry = error => {
      if (Date.now() >= deadline) return reject(error);
      setTimeout(attempt, 150);
    };
    attempt();
  });
}

function closeServer() {
  if (!gameServer || gameServer.exitCode !== null || gameServer.killed) return Promise.resolve();
  return new Promise(resolve => {
    const forced = setTimeout(() => {
      if (gameServer && gameServer.exitCode === null) gameServer.kill();
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref?.();
    gameServer.once("exit", () => {
      clearTimeout(forced);
      resolve();
    });
    const shutdown = request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/__arsenal/desktop-shutdown",
      method: "POST",
      headers: { "x-arsenal-desktop-token": launchToken },
      timeout: 1_000,
    }, response => response.resume());
    shutdown.once("error", () => {
      if (gameServer && gameServer.exitCode === null) gameServer.kill();
    });
    shutdown.once("timeout", () => shutdown.destroy());
    shutdown.end();
  });
}

function openGameWindow() {
  gameWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a111c",
    title: "Combat Cars",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  gameWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  gameWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith(`http://127.0.0.1:${PORT}/`)) event.preventDefault();
  });
  gameWindow.once("ready-to-show", () => gameWindow?.show());
  gameWindow.loadURL(gameUrl());
}

async function boot() {
  try {
    assertLaunchConfiguration();
    await assertPortAvailable(PORT);
    const logPath = startServer();
    await waitForServer();
    openGameWindow();
  } catch (error) {
    await closeServer();
    fail(`${error.message || error}\n\nEl registro del servidor se guarda en la carpeta de datos de la aplicación.`);
    app.quit();
  }
}

function requestQuit() {
  if (quitting) return;
  quitting = true;
  void closeServer().finally(() => app.quit());
}

app.whenReady().then(boot);
app.on("window-all-closed", requestQuit);
app.on("before-quit", event => {
  if (!quitting) {
    event.preventDefault();
    requestQuit();
  }
});
