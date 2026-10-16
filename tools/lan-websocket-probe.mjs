import process from "node:process";

const port = Number(process.env.LAN_PROBE_PORT || process.argv[2] || 5300);
const timeoutMs = Number(process.env.LAN_PROBE_TIMEOUT_MS || 5000);
const sessionId = `manual-websocket-probe-${Date.now()}`;
const socket = new WebSocket(`ws://127.0.0.1:${port}`);
let completed = false;

function finish(code, report) {
  if (completed) return;
  completed = true;
  console.log(JSON.stringify(report, null, 2));
  try { socket.close(); } catch { /* socket may not have opened */ }
  process.exitCode = code;
}

const timer = setTimeout(() => finish(1, {
  schemaVersion: 1,
  status: "timeout",
  port,
  timeoutMs,
  detail: "No se recibió welcome del servidor WebSocket.",
}), timeoutMs);

socket.addEventListener("open", () => {
  console.log(`OPEN ws://127.0.0.1:${port}`);
  socket.send(JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    roomId: "local",
    sessionId,
    name: "DEBUG",
  }));
});

socket.addEventListener("message", event => {
  let message;
  try {
    message = JSON.parse(String(event.data));
  } catch {
    clearTimeout(timer);
    finish(1, { schemaVersion: 1, status: "invalid-json", port, data: String(event.data) });
    return;
  }
  if (message.type === "welcome") {
    clearTimeout(timer);
    finish(0, {
      schemaVersion: 1,
      status: "ok",
      port,
      welcome: {
        id: message.id,
        team: message.team,
        owner: message.owner === true,
        protocolVersion: message.protocolVersion,
        roomId: message.roomId,
      },
    });
  } else if (message.type === "error") {
    clearTimeout(timer);
    finish(1, { schemaVersion: 1, status: "server-error", port, text: message.text });
  }
});

socket.addEventListener("error", event => {
  clearTimeout(timer);
  finish(1, {
    schemaVersion: 1,
    status: "connection-error",
    port,
    detail: event?.message || "No se pudo abrir el WebSocket.",
  });
});

socket.addEventListener("close", event => {
  if (!completed) {
    clearTimeout(timer);
    finish(1, { schemaVersion: 1, status: "closed-before-welcome", port, code: event.code, reason: event.reason });
  }
});
