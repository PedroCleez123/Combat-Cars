import assert from "node:assert/strict";
import process from "node:process";

const port = Number(process.env.LIVE_SESSION_PROBE_PORT || process.argv[2] || 5300);
const timeoutMs = Number(process.env.LIVE_SESSION_PROBE_TIMEOUT_MS || 5000);
const expectedBackend = process.env.LIVE_SESSION_EXPECT_BACKEND || null;
const expectedArena = process.env.LIVE_SESSION_EXPECT_ARENA || null;

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("LIVE_SESSION_PROBE_PORT debe ser un puerto válido");
}

const socket = new WebSocket(`ws://127.0.0.1:${port}`);
let completed = false;
let welcome = null;

function compactSettings(settings = {}) {
  return {
    movementBackend: settings.movementBackend || null,
    bridgeLabel: settings.bridgeLabel || null,
    profile: settings.profile || null,
    practiceArena: settings.practiceArena || null,
    humans: settings.humans ?? null,
    vehicleLimit: settings.vehicleLimit ?? null,
    bots: settings.bots ?? null,
    roundState: settings.roundState || null,
  };
}

function finish(code, report) {
  if (completed) return;
  completed = true;
  clearTimeout(timer);
  console.log(JSON.stringify(report, null, 2));
  try { socket.close(); } catch { /* the connection can fail before open */ }
  process.exitCode = code;
}

const timer = setTimeout(() => finish(1, {
  schemaVersion: 1,
  story: "LIVE-SESSION-PROBE",
  port,
  status: "timeout",
  timeoutMs,
  detail: "No se recibieron welcome y snapshot autoritativo.",
}), timeoutMs);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    roomId: "local",
    sessionId: `live-session-probe-${port}-${Date.now()}`,
    name: "PROBE",
  }));
});

socket.addEventListener("message", event => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    finish(1, { schemaVersion: 1, story: "LIVE-SESSION-PROBE", port, status: "invalid-json" });
    return;
  }
  if (message.type === "welcome") {
    welcome = message;
    return;
  }
  if (message.type === "error") {
    finish(1, { schemaVersion: 1, story: "LIVE-SESSION-PROBE", port, status: "server-error", text: message.text });
    return;
  }
  if (message.type !== "state" || !welcome) return;

  const state = message.state || {};
  const settings = compactSettings(state.settings);
  const assertions = {
    welcomeReceived: Boolean(welcome.id && welcome.roomId === "local"),
    authoritativeStateReceived: Number.isFinite(Number(state.time)),
    expectedBackend: !expectedBackend || settings.movementBackend === expectedBackend,
    expectedArena: !expectedArena || settings.practiceArena === expectedArena,
    finiteCarPoses: (state.cars || []).every(car => [car.x, car.h, car.z, car.orientation?.w].every(Number.isFinite)),
  };
  const report = {
    schemaVersion: 1,
    story: "LIVE-SESSION-PROBE",
    port,
    status: Object.values(assertions).every(Boolean) ? "ok" : "assertion-failed",
    welcome: { team: welcome.team, owner: welcome.owner === true, roomId: welcome.roomId },
    settings,
    rules: state.rules || null,
    cars: (state.cars || []).map(car => ({ id: car.id, team: car.team, h: car.h, grounded: car.grounded, surfaceType: car.surfaceType })),
    assertions,
  };
  try {
    for (const [label, passed] of Object.entries(assertions)) assert.equal(passed, true, label);
    finish(0, report);
  } catch (error) {
    report.error = error.message;
    finish(1, report);
  }
});

socket.addEventListener("error", event => finish(1, {
  schemaVersion: 1,
  story: "LIVE-SESSION-PROBE",
  port,
  status: "connection-error",
  detail: event?.message || "No se pudo abrir el WebSocket.",
}));

socket.addEventListener("close", event => {
  if (!completed) finish(1, {
    schemaVersion: 1,
    story: "LIVE-SESSION-PROBE",
    port,
    status: "closed-before-state",
    code: event.code,
    reason: event.reason,
  });
});
