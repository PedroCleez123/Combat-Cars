#!/usr/bin/env node

/*
 * Public two-window endurance smoke for the production P2P beta.
 *
 * It uses the deployed Pages + Worker route, but reports only bounded player
 * state. Room codes, WebRTC candidates, SDP and addresses remain inside the
 * two temporary Electron windows and are never printed.
 */
const { app, BrowserWindow } = require("electron");

const url = process.env.P2P_CAUSAL_BETA_URL || "https://combat-cars.pages.dev/p2p-causal-beta.html";
const timeoutMs = Number(process.env.P2P_CAUSAL_BETA_TIMEOUT_MS || 60_000);
const enduranceMs = Number(process.env.P2P_CAUSAL_BETA_ENDURANCE_MS || 15_000);
const startedAt = Date.now();
const windows = [];
const consoleErrors = [];

if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
  throw new TypeError("P2P_CAUSAL_BETA_TIMEOUT_MS debe estar entre 5000 y 120000.");
}
if (!Number.isSafeInteger(enduranceMs) || enduranceMs < 1_000 || enduranceMs > 60_000) {
  throw new TypeError("P2P_CAUSAL_BETA_ENDURANCE_MS debe estar entre 1000 y 60000.");
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function safeError(error) {
  const raw = String(error?.message || error || "fallo desconocido");
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url-redacted]")
    .replace(/#p2p=[^\s"'<>]+/gi, "#p2p=[redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[ip-redacted]")
    .replace(/\b(?:candidate|candidates|srflx|relay|typ\s+host)\b[^\n]{0,180}/gi, "[ice-redacted]")
    .slice(0, 220);
}

function createWindow(partition, label) {
  const window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 720,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.on("console-message", (_event, level, message) => {
    // Electron emits its own CSP warning for remote pages. It is not a page
    // runtime error and must not mask the P2P result; only Chromium error
    // messages are part of this smoke's failure contract.
    if (level >= 3 && !String(message).startsWith("Electron Security Warning")) {
      consoleErrors.push({ label, message: safeError(message) });
    }
  });
  windows.push(window);
  return window;
}

async function evaluate(window, source) {
  if (window.isDestroyed()) throw new Error("La ventana de prueba se cerró.");
  return window.webContents.executeJavaScript(source, true);
}

async function observe(window) {
  return evaluate(window, `(() => {
    const text = id => document.getElementById(id)?.textContent?.trim() || "";
    const visible = id => { const element = document.getElementById(id); return Boolean(element && !element.hidden); };
    const snapshot = text("causal-snapshot");
    const tick = snapshot.match(/(?:^|\\n)tick\\s+(-?\\d+)/i)?.[1] || null;
    return {
      title: document.title,
      status: text("status"),
      causalState: text("causal-state"),
      hudVisible: visible("causal-hud"),
      role: text("causal-hud-role"),
      rivalVisible: visible("causal-hud-rival"),
      connection: text("causal-hud-connection"),
      tick: tick === null ? null : Number(tick),
      canvas: (() => { const c = document.getElementById("causal-scene"); return c ? { width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight } : null; })(),
    };
  })()`);
}

async function waitFor(window, predicate, label) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await observe(window);
    if (predicate(latest)) return latest;
    await sleep(100);
  }
  throw new Error(`${label}: ${JSON.stringify(latest)}`);
}

function active(observation) {
  return observation.hudVisible
    && /^TÚ · (HOST|PILOTO)$/i.test(observation.role)
    && /partida activa/i.test(observation.status)
    && /online/i.test(observation.connection)
    && observation.canvas?.width > 0
    && observation.canvas?.height > 0
    && observation.canvas?.clientWidth > 0
    && observation.canvas?.clientHeight > 0;
}

async function enableDiagnostics(window) {
  await evaluate(window, `(() => {
    const toggle = document.getElementById("diagnostics-toggle");
    if (!toggle) throw new Error("Falta el interruptor de diagnóstico.");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

async function main() {
  await app.whenReady();
  const host = createWindow("persist:combat-cars-public-smoke-host", "host");
  const guest = createWindow("persist:combat-cars-public-smoke-guest", "guest");
  await Promise.all([host.loadURL(url), guest.loadURL(url)]);

  // Creating and joining are direct menu actions. The privacy disclosure is
  // informational only; the smoke must exercise the same one-click path as a
  // player and must not synthesize a removed consent checkbox.
  // Exercise the same compact menu path a player uses. The old `primary` /
  // `join-room-code` hooks belonged to the removed confirmation UI and can
  // silently leave both windows in local practice.
  await evaluate(host, `document.getElementById("unified-create")?.click()`);
  const roomCode = await (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const code = await evaluate(host, `document.getElementById("room-code-value")?.value || ""`);
      if (/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code)) return code;
      await sleep(100);
    }
    throw new Error("el host no recibió una clave corta");
  })();

  await evaluate(guest, `(() => {
    const input = document.getElementById("room-code");
    if (!input) throw new Error("Falta el campo de clave.");
    input.value = ${JSON.stringify(roomCode)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("unified-join")?.click();
  })()`);

  // The production HUD intentionally hides the per-car cards, including the
  // rival card. A single smoke run still proves that both windows loaded the
  // active online presentation and advanced their authoritative ticks; rival
  // visibility is a human two-browser check, not a DOM contract.
  const [hostActive, guestActive] = await Promise.all([
    waitFor(host, active, "el host no alcanzó la partida activa"),
    waitFor(guest, active, "el invitado no alcanzó la partida activa"),
  ]);
  await Promise.all([enableDiagnostics(host), enableDiagnostics(guest)]);
  const [hostTickStart, guestTickStart] = await Promise.all([
    waitFor(host, state => Number.isSafeInteger(state.tick) && state.tick > 0, "el host no publicó tick diagnóstico"),
    waitFor(guest, state => Number.isSafeInteger(state.tick) && state.tick > 0, "el invitado no recibió tick diagnóstico"),
  ]);

  await sleep(enduranceMs);
  const [hostFinal, guestFinal] = await Promise.all([observe(host), observe(guest)]);
  if (!active(hostFinal) || !active(guestFinal)
    || !(hostFinal.tick > hostTickStart.tick) || !(guestFinal.tick > guestTickStart.tick)) {
    throw new Error(`la partida no se mantuvo activa: host=${hostFinal.tick}/${hostTickStart.tick} ${hostFinal.status} ${hostFinal.connection} ${hostFinal.causalState}; guest=${guestFinal.tick}/${guestTickStart.tick} ${guestFinal.status} ${guestFinal.connection} ${guestFinal.causalState}`);
  }
  if (consoleErrors.length) throw new Error(`errores de consola: ${JSON.stringify(consoleErrors)}`);

  console.log(JSON.stringify({
    status: "passed",
    story: "P2P-PUBLIC-ENDURANCE-01",
    url: new URL(url).origin,
    durationMs: Date.now() - startedAt,
    enduranceMs,
    host: { role: hostFinal.role, firstTick: hostTickStart.tick, finalTick: hostFinal.tick },
    guest: { role: guestFinal.role, firstTick: guestTickStart.tick, finalTick: guestFinal.tick },
    consoleErrors: 0,
  }));
}

main().catch(error => {
  console.error(JSON.stringify({
    status: "failed",
    story: "P2P-PUBLIC-ENDURANCE-01",
    url: (() => { try { return new URL(url).origin; } catch { return "[invalid-url]"; } })(),
    durationMs: Date.now() - startedAt,
    error: safeError(error),
  }));
  process.exitCode = 1;
}).finally(() => {
  for (const window of windows) {
    try { if (!window.isDestroyed()) window.destroy(); } catch { /* Continue closing all test windows. */ }
  }
  app.quit();
});
