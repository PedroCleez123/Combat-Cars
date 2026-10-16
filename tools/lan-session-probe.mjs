import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.LAN_SESSION_TEST_PORT || 5345);
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const sessionId = "online01-session-probe";

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    // The probe exercises two simultaneous authenticated peers (owner + guest).
    // Keep the match otherwise minimal, but do not leave the default one-car
    // capacity in place or the guest would be rejected before ownership can be
    // tested.
    env: { ...process.env, MOVEMENT_BACKEND: "js", PORT: String(port), VEHICLE_LIMIT: "2", ARENA_PROFILE: "scrapyard" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  return { child, output };
}

async function waitFor(check, label, timeout = 5000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = check();
    if (value) return value;
    await wait(20);
  }
  throw new Error(`Timeout: ${label}`);
}

function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))));
  return { socket, messages };
}

async function openPilot({ sessionId: pilotSessionId = sessionId, name = "ONLINE-01" } = {}) {
  const pilot = connect();
  await new Promise((resolveOpen, rejectOpen) => {
    pilot.socket.addEventListener("open", resolveOpen, { once: true });
    pilot.socket.addEventListener("error", () => rejectOpen(new Error("WebSocket no abrió")), { once: true });
  });
  pilot.socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: pilotSessionId, name }));
  const welcome = await waitFor(() => pilot.messages.find(message => message.type === "welcome"), "welcome");
  await waitFor(() => pilot.messages.find(message => message.type === "state"), "state");
  return { ...pilot, welcome };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolveStop => {
    const force = setTimeout(() => { child.kill(); resolveStop(); }, 1500);
    child.once("exit", () => { clearTimeout(force); resolveStop(); });
    child.kill("SIGTERM");
  });
}

async function run() {
  const { child, output } = startServer();
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), "servidor LAN");
    const invalid = connect();
    await new Promise((resolveOpen, rejectOpen) => {
      invalid.socket.addEventListener("open", resolveOpen, { once: true });
    invalid.socket.addEventListener("error", () => rejectOpen(new Error(`WebSocket inválido no abrió: ${output.join("")}`)), { once: true });
    });
    invalid.socket.send(JSON.stringify({ type: "input", sequence: 1, input: {} }));
    const invalidError = await waitFor(() => invalid.messages.find(message => message.type === "error"), "rechazo sin hello");
    assert.match(invalidError.text, /hello/);
    invalid.socket.close();

    const owner = await openPilot({ sessionId: "online01-owner", name: "ONLINE-OWNER" });
    assert.equal(owner.welcome.owner, true, "el primer peer recibe el ownership");
    const guest = await openPilot({ sessionId: "online01-guest", name: "ONLINE-GUEST" });
    assert.equal(guest.welcome.owner, false, "el segundo peer no recibe el ownership");
    guest.socket.send(JSON.stringify({ type: "restart" }));
    const guestControlError = await waitFor(() => guest.messages.find(message => message.type === "error"), "rechazo de restart del segundo peer");
    assert.match(guestControlError.text, /host/);
    owner.socket.close();
    const ownerTransfer = await waitFor(() => guest.messages.find(message => message.type === "session-owner" && message.owner === true), "reasignación del owner", 6500);
    assert.equal(ownerTransfer.protocolVersion, 1);
    guest.socket.close();

    const first = await openPilot();
    const firstId = first.welcome.id;
    first.socket.close();
    await wait(120);
    const recovered = await openPilot();
    assert.equal(recovered.welcome.id, firstId, "la reconexión conserva ID");
    assert.equal(recovered.welcome.protocolVersion, 1);
    recovered.socket.close();
    await wait(4200);
    const fresh = await openPilot();
    assert.notEqual(fresh.welcome.id, firstId, "fuera de la ventana se crea una sesión nueva");
    const report = { schemaVersion: 1, story: "ONLINE-01", port, assertions: { rejectsInputBeforeHello: true, assignsFirstOwner: owner.welcome.owner === true, rejectsGuestControl: /host/.test(guestControlError.text), reassignsOwner: ownerTransfer.owner === true, reconnectsWithinGrace: recovered.welcome.id === firstId, expiresAfterGrace: fresh.welcome.id !== firstId } };
    console.log(JSON.stringify(report, null, 2));
    fresh.socket.close();
  } finally {
    await stopServer(child);
  }
}

run().catch(error => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
