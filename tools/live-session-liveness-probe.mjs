import assert from "node:assert/strict";
import process from "node:process";
import { inspectLocalHttpEndpoint } from "./live-probe-http-preflight.mjs";

const port = Number(process.env.LIVE_LIVENESS_PROBE_PORT || process.argv[2] || 5300);
const observeMs = Number(process.env.LIVE_LIVENESS_PROBE_OBSERVE_MS || 1800);
const timeoutMs = Number(process.env.LIVE_LIVENESS_PROBE_TIMEOUT_MS || observeMs + 4000);
const minimumSnapshots = Number(process.env.LIVE_LIVENESS_PROBE_MIN_SNAPSHOTS || 5);
const expectedBackend = process.env.LIVE_LIVENESS_EXPECT_BACKEND || null;
const expectedArena = process.env.LIVE_LIVENESS_EXPECT_ARENA || null;

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("LIVE_LIVENESS_PROBE_PORT debe ser un puerto válido");
}
if (!Number.isFinite(observeMs) || observeMs < 250) {
  throw new Error("LIVE_LIVENESS_PROBE_OBSERVE_MS debe ser al menos 250 ms");
}
if (!Number.isSafeInteger(minimumSnapshots) || minimumSnapshots < 2) {
  throw new Error("LIVE_LIVENESS_PROBE_MIN_SNAPSHOTS debe ser al menos 2");
}

const httpPreflight = await inspectLocalHttpEndpoint({ port, timeoutMs: Math.min(timeoutMs, 1_200) });
const socket = new WebSocket(`ws://127.0.0.1:${port}`);
let completed = false;
let welcome = null;
let firstStateAt = null;
let lastState = null;
const times = [];

function compactSettings(settings = {}) {
  return {
    movementBackend: settings.movementBackend || null,
    bridgeLabel: settings.bridgeLabel || null,
    profile: settings.profile || null,
    practiceArena: settings.practiceArena || null,
    roundState: settings.roundState || null,
  };
}

function finish(code, report) {
  if (completed) return;
  completed = true;
  clearTimeout(timeoutTimer);
  clearTimeout(observationTimer);
  console.log(JSON.stringify({ ...report, httpPreflight }, null, 2));
  try { socket.close(); } catch { /* the connection can fail before open */ }
  process.exitCode = code;
}

function report() {
  const settings = compactSettings(lastState?.settings);
  const timeAdvanced = times.some((time, index) => index > 0 && time > times[index - 1]);
  const nonDecreasingTime = times.every((time, index) => index === 0 || time >= times[index - 1]);
  const assertions = {
    welcomeReceived: Boolean(welcome?.id && welcome?.roomId === "local"),
    minimumSnapshots: times.length >= minimumSnapshots,
    nonDecreasingTime,
    timeAdvanced,
    expectedBackend: !expectedBackend || settings.movementBackend === expectedBackend,
    expectedArena: !expectedArena || settings.practiceArena === expectedArena,
    finiteLatestCarPoses: (lastState?.cars || []).every(car => [car.x, car.h, car.z, car.orientation?.w].every(Number.isFinite)),
  };
  return {
    schemaVersion: 1,
    story: "LIVE-LIVENESS-PROBE",
    port,
    observeMs,
    status: Object.values(assertions).every(Boolean) ? "ok" : "assertion-failed",
    welcome: welcome ? { team: welcome.team, owner: welcome.owner === true, roomId: welcome.roomId } : null,
    snapshotCount: times.length,
    firstAuthoritativeTime: times[0] ?? null,
    lastAuthoritativeTime: times.at(-1) ?? null,
    elapsedAuthoritativeTime: times.length > 1 ? times.at(-1) - times[0] : null,
    settings,
    assertions,
  };
}

const timeoutTimer = setTimeout(() => finish(1, {
  schemaVersion: 1,
  story: "LIVE-LIVENESS-PROBE",
  port,
  status: "timeout",
  timeoutMs,
  detail: "No terminó una observación autoritativa dentro del plazo.",
}), timeoutMs);

const observationTimer = setTimeout(() => {
  const result = report();
  try {
    for (const [label, passed] of Object.entries(result.assertions)) assert.equal(passed, true, label);
    finish(0, result);
  } catch (error) {
    result.error = error.message;
    finish(1, result);
  }
}, observeMs);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    roomId: "local",
    sessionId: `live-liveness-probe-${port}-${Date.now()}`,
    name: "LIVENESS-PROBE",
  }));
});

socket.addEventListener("message", event => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    finish(1, { schemaVersion: 1, story: "LIVE-LIVENESS-PROBE", port, status: "invalid-json" });
    return;
  }
  if (message.type === "welcome") {
    welcome = message;
    return;
  }
  if (message.type === "error") {
    finish(1, { schemaVersion: 1, story: "LIVE-LIVENESS-PROBE", port, status: "server-error", text: message.text });
    return;
  }
  if (message.type !== "state" || !welcome) return;

  const state = message.state || {};
  const time = Number(state.time);
  if (!Number.isFinite(time)) {
    finish(1, { schemaVersion: 1, story: "LIVE-LIVENESS-PROBE", port, status: "invalid-state-time" });
    return;
  }
  firstStateAt ??= Date.now();
  lastState = state;
  times.push(time);
});

socket.addEventListener("error", event => finish(1, {
  schemaVersion: 1,
  story: "LIVE-LIVENESS-PROBE",
  port,
  status: "connection-error",
  detail: httpPreflight.reachable
    ? (event?.message || "HTTP responde, pero no se pudo abrir el WebSocket.")
    : `HTTP local no responde (${httpPreflight.errorCode || "desconocido"}); el WebSocket no pudo abrirse.`,
}));

socket.addEventListener("close", event => {
  if (!completed) finish(1, {
    schemaVersion: 1,
    story: "LIVE-LIVENESS-PROBE",
    port,
    status: "closed-before-observation",
    code: event.code,
    reason: event.reason,
  });
});
