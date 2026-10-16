import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const port = Number(process.env.ROCKETSIM_GAME01_TEST_PORT || 5283);
const arena = "arsenal-expanded-curved-practice";
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-configurable-combat-game-01.json");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para GAME-01");

function startServer() {
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, MOVEMENT_BACKEND: "rocketsim", ROCKETSIM_MODE: "combat", ROCKETSIM_ARENA: arena, ROCKETSIM_BRIDGE_EXE: executable, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  serverProcess.stdout.on("data", chunk => output.push(chunk.toString()));
  serverProcess.stderr.on("data", chunk => output.push(chunk.toString()));
  return { process: serverProcess, output };
}

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  await new Promise(resolveStop => {
    const force = setTimeout(() => { serverProcess.kill(); resolveStop(); }, 1800);
    serverProcess.once("exit", () => { clearTimeout(force); resolveStop(); });
    serverProcess.kill("SIGTERM");
  });
}

async function waitFor(check, label, timeout = 7000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = check();
    if (result) return result;
    await wait(12);
  }
  throw new Error("Timeout: " + label);
}

function carById(frame, id) {
  return frame?.cars?.find(car => car.id === id) || null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.h - b.h, a.z - b.z);
}

async function openClient(name) {
  const socket = new WebSocket("ws://127.0.0.1:" + port);
  const frames = [];
  const errors = [];
  let welcome = null;
  let acknowledged = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.type === "welcome") welcome = message;
    if (message.type === "error") errors.push(message.text || "error without text");
    if (message.type === "state") {
      acknowledged = Math.max(acknowledged, message.inputAcknowledged || 0);
      frames.push(message.state);
    }
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", () => rejectOpen(new Error("WebSocket no abrió para " + name)), { once: true });
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: ("probe-" + name), name }));
  let sequence = 0;
  return {
    name, socket,
    get welcome() { return welcome; }, get frames() { return frames; }, get errors() { return errors; }, get acknowledged() { return acknowledged; },
    send(input) { const sent = ++sequence; socket.send(JSON.stringify({ type: "input", sequence: sent, input })); return sent; },
    configure(settings) { socket.send(JSON.stringify({ type: "configure", settings })); },
  };
}

async function join(client) {
  await waitFor(() => client.welcome, "welcome " + client.name);
  return client;
}

async function run() {
  const server = startServer();
  const clients = [];
  try {
    await waitFor(() => server.output.join("").includes("http://localhost:" + port), "servidor GAME-01");
    const blue = await join(await openClient("GAME-01-BLUE"));
    clients.push(blue);
    await waitFor(() => blue.frames.at(-1)?.settings?.humans === 1, "primer piloto");
    blue.configure({ vehicleLimit: 3, botCount: 0 });
    const configured = await waitFor(() => {
      const frame = blue.frames.at(-1);
      return frame?.settings?.vehicleLimit === 3 ? frame : null;
    }, "capacidad configurada");
    const red = await join(await openClient("GAME-01-RED"));
    await waitFor(() => {
      const frame = blue.frames.at(-1);
      return frame?.settings?.humans === 2 && frame.cars?.length === 2 ? frame : null;
    }, "roster de dos pilotos");
    const blueTwo = await join(await openClient("GAME-01-BLUE-2"));
    clients.push(red, blueTwo);
    const roster = await waitFor(() => {
      const frame = blue.frames.at(-1);
      return frame?.settings?.humans === 3 && frame.cars?.length === 3 ? frame : null;
    }, "roster de tres pilotos");
    const rejected = await openClient("GAME-01-REJECTED");
    clients.push(rejected);
    await waitFor(() => rejected.errors.length > 0, "rechazo de cuarta plaza");
    blue.configure({ vehicleLimit: 2, botCount: 0 });
    await waitFor(() => blue.errors.some(text => text.includes("inferior a los pilotos conectados")), "rechazo de reducción activa");
    const beforeDrive = carById(blue.frames.at(-1), blue.welcome.id);
    const inputSequence = blue.send({ ...neutral(), throttle: 1, boost: true, steer: .4 });
    await waitFor(() => blue.acknowledged >= inputSequence, "ACK tras configuración");
    await wait(520);
    const releaseSequence = blue.send(neutral());
    await waitFor(() => blue.acknowledged >= releaseSequence, "ACK de liberación");
    await wait(100);
    const final = blue.frames.at(-1);
    const afterDrive = carById(final, blue.welcome.id);
    const expectedConfigurationErrors = clients.slice(0, 3).flatMap(client => client.errors).filter(text => text.includes("inferior a los pilotos conectados"));
    const unexpectedErrors = clients.slice(0, 3).flatMap(client => client.errors).filter(text => !text.includes("inferior a los pilotos conectados"));
    const deltas = blue.frames.slice(1).map((frame, index) => Number((frame.time - blue.frames[index].time).toFixed(2))).filter(delta => delta > 0);
    const report = {
      schemaVersion: 1,
      story: "GAME-01",
      generatedAt: new Date().toISOString(),
      profile: final.settings.profile,
      arena: final.settings.practiceArena,
      configured: { vehicleLimit: configured.settings.vehicleLimit, bots: configured.settings.bots, combat: configured.rules.combat },
      pilots: clients.slice(0, 3).map(client => ({ name: client.name, id: client.welcome.id, team: client.welcome.team, acknowledged: client.acknowledged })),
      rejected: { errors: rejected.errors },
      movement: { inputSequence, releaseSequence, travel: distance(beforeDrive, afterDrive) },
      cadence: { values: [...new Set(deltas)], count: deltas.length },
      expectedConfigurationErrors,
      unexpectedErrors,
      assertions: {
        combatSessionConfigured: final.settings.movementBackend === "rocketsim" && final.rules.combat === true && final.settings.vehicleLimit === 3 && final.settings.bots === 0,
        threePilotsAssigned: roster.cars.length === 3 && [blue.welcome.team, red.welcome.team, blueTwo.welcome.team].join(",") === "blue,red,blue",
        fourthPilotRejected: rejected.welcome === null && rejected.errors.some(text => text.includes("capacidad")),
        activeRosterCannotShrink: blue.errors.some(text => text.includes("inferior a los pilotos conectados")) && final.settings.vehicleLimit === 3,
        inputAcknowledgedAndMoved: blue.acknowledged >= releaseSequence && distance(beforeDrive, afterDrive) > 3,
        nativeSnapshotCadence: deltas.length > 4 && deltas.every(delta => delta === .01 || delta === .02),
        acceptedPilotsHadNoUnexpectedErrors: unexpectedErrors.length === 0,
      },
    };
    report.failedAssertions = Object.entries(report.assertions).filter(([, passed]) => !passed).map(([name]) => name);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const client of clients) if (client.socket.readyState < WebSocket.CLOSING) client.socket.close();
    await stopServer(server.process);
  }
}

run().catch(error => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
