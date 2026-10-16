import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const port = Number(process.env.ROCKETSIM_COMBAT_SIX_TEST_PORT || 5332);
const arena = process.env.ROCKETSIM_COMBAT_SIX_ARENA || "arsenal-expanded-curved-practice";
const reportPath = process.env.ROCKETSIM_COMBAT_SIX_REPORT || resolve(root, "docs", "reference-captures", "rocketsim-combat-six-pilot-game-02.json");
const story = process.env.ROCKETSIM_COMBAT_SIX_STORY || "GAME-02";
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para GAME-02");

function startServer() {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, MOVEMENT_BACKEND: "rocketsim", ROCKETSIM_MODE: "combat", ROCKETSIM_ARENA: arena, ROCKETSIM_BRIDGE_EXE: executable, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  server.stdout.on("data", chunk => output.push(chunk.toString()));
  server.stderr.on("data", chunk => output.push(chunk.toString()));
  return { server, output };
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  await new Promise(resolveStop => {
    const force = setTimeout(() => { server.kill(); resolveStop(); }, 1800);
    server.once("exit", () => { clearTimeout(force); resolveStop(); });
    server.kill("SIGTERM");
  });
}

async function waitFor(check, label, timeout = 8000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = check();
    if (result) return result;
    await wait(12);
  }
  throw new Error(`Timeout: ${label}`);
}

function finitePose(car) {
  return Boolean(car) && [car.x, car.h, car.z, car.speed, car.orientation?.x, car.orientation?.y, car.orientation?.z, car.orientation?.w].every(Number.isFinite);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.h - b.h, a.z - b.z);
}

async function connectPilot(name) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
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
    socket.addEventListener("error", () => rejectOpen(new Error(`WebSocket no abrió para ${name}`)), { once: true });
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: ("probe-" + name), name }));
  await waitFor(() => welcome, `welcome ${name}`);
  let sequence = 0;
  return {
    name,
    socket,
    get welcome() { return welcome; },
    get frames() { return frames; },
    get errors() { return errors; },
    get acknowledged() { return acknowledged; },
    send(input) {
      const sent = ++sequence;
      socket.send(JSON.stringify({ type: "input", sequence: sent, input }));
      return sent;
    },
  };
}

async function acknowledge(pilot, input, label) {
  const sequence = pilot.send(input);
  await waitFor(() => pilot.acknowledged >= sequence, `ACK ${label}`);
  return sequence;
}

async function run() {
  const { server, output } = startServer();
  const pilots = [];
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), "servidor GAME-02");
    for (let index = 0; index < 6; index += 1) {
      const pilot = await connectPilot(`GAME-02-PILOT-${index + 1}`);
      pilots.push(pilot);
      await waitFor(() => {
        const frame = pilot.frames.at(-1);
        return frame?.settings?.humans === index + 1 && frame.cars?.length === index + 1 ? frame : null;
      }, `roster de ${index + 1} pilotos`);
    }

    const observer = pilots[0];
    const stable = await waitFor(() => {
      const frame = observer.frames.at(-1);
      return frame?.settings?.humans === 6 && frame.cars?.length === 6 ? frame : null;
    }, "roster estable de seis pilotos");
    const initial = new Map(stable.cars.map(car => [car.id, { x: car.x, h: car.h, z: car.z }]));
    const steerValues = [-1, -.6, -.2, .2, .6, 1];
    const movementSequences = [];
    for (const [index, pilot] of pilots.entries()) {
      movementSequences.push(await acknowledge(pilot, { ...neutral(), throttle: 1, boost: true, steer: steerValues[index] }, `movimiento ${index + 1}`));
    }
    await wait(420);
    const movingFrame = observer.frames.at(-1);
    const moved = pilots.map(pilot => {
      const car = movingFrame.cars.find(candidate => candidate.id === pilot.welcome.id);
      return { id: pilot.welcome.id, travel: distance(initial.get(pilot.welcome.id), car) };
    });
    const fireSequences = [];
    for (const [index, pilot] of pilots.entries()) {
      fireSequences.push(await acknowledge(pilot, { ...neutral(), fire: true }, `disparo ${index + 1}`));
      await acknowledge(pilot, neutral(), `liberación ${index + 1}`);
    }
    await wait(120);
    const allFrames = pilots.flatMap(pilot => pilot.frames);
    const final = observer.frames.at(-1);
    const fireEvents = [...new Map(allFrames.flatMap(frame => frame.events || [])
      .filter(item => item.kind === "fire")
      .map(item => [`${item.at}:${item.text}`, item])).values()];
    const maxRockets = Math.max(...observer.frames.map(frame => frame.rockets?.length || 0));
    const disconnected = pilots.at(-1);
    const disconnectedId = disconnected.welcome.id;
    disconnected.socket.close();
    const afterDisconnect = await waitFor(() => {
      const frame = observer.frames.at(-1);
      return frame?.settings?.humans === 5 && frame.cars?.length === 5 && !frame.cars.some(car => car.id === disconnectedId) ? frame : null;
    }, "reconstrucción de roster tras desconexión", 10000);
    const remainingPilot = pilots[0];
    const recoverySequence = await acknowledge(remainingPilot, { ...neutral(), throttle: 1, steer: .35 }, "movimiento tras desconexión");
    await wait(120);
    const recovered = observer.frames.at(-1);
    const deltas = observer.frames.slice(1).map((frame, index) => Number((frame.time - observer.frames[index].time).toFixed(2))).filter(delta => delta > 0);
    const teams = pilots.map(pilot => pilot.welcome.team);
    const report = {
      schemaVersion: 1,
      story,
      generatedAt: new Date().toISOString(),
      profile: arena,
      backend: final.settings.movementBackend,
      mode: final.settings.profile,
      port,
      pilots: pilots.map(pilot => ({ name: pilot.name, id: pilot.welcome.id, team: pilot.welcome.team, acknowledged: pilot.acknowledged })),
      movement: moved,
      inputs: { movementSequences, fireSequences },
      observed: {
        fireEvents, maxRockets, finalRockets: final.rockets.length, score: final.score,
        disconnect: { id: disconnectedId, humans: afterDisconnect.settings.humans, cars: afterDisconnect.cars.length, recoverySequence, recoveredCars: recovered.cars.length },
        errors: pilots.flatMap(pilot => pilot.errors),
      },
      snapshotTimeDeltas: { values: [...new Set(deltas)], min: Math.min(...deltas), max: Math.max(...deltas) },
      assertions: {
        rocketsimCombat: final.settings.movementBackend === "rocketsim" && final.rules.combat === true,
        sixPilotRoster: final.settings.humans === 6 && final.cars.length === 6,
        uniquePilotIds: new Set(pilots.map(pilot => pilot.welcome.id)).size === 6,
        alternatingTeams: teams.join(",") === "blue,red,blue,red,blue,red",
        finiteNativePoses: final.cars.every(finitePose),
        // Each car is sampled after a shared 420 ms window that starts only
        // once the sixth sequential ACK is received. Scheduler variance can
        // shift the earliest native input by one snapshot, so require clear
        // motion rather than a time-dependent travel value from a fixed start.
        everyPilotMoved: moved.every(item => item.travel > 2),
        movementInputsAcknowledged: pilots.every((pilot, index) => pilot.acknowledged >= movementSequences[index]),
        movementInputsStayMappedToOwnCars: pilots.every((pilot, index) => movingFrame.cars.find(car => car.id === pilot.welcome.id)?.steer === steerValues[index]),
        fireInputsAcknowledged: pilots.every((pilot, index) => pilot.acknowledged >= fireSequences[index]),
        sixFireEdgesObserved: fireEvents.length >= 6,
        rocketsPublished: maxRockets >= 4,
        disconnectRebuildsCombatRoster: afterDisconnect.settings.humans === 5 && afterDisconnect.cars.length === 5 && !afterDisconnect.cars.some(car => car.id === disconnectedId),
        remainingPilotContinuesAfterDisconnect: remainingPilot.acknowledged >= recoverySequence && recovered.cars.length === 5 && !recovered.cars.some(car => car.id === disconnectedId),
        nativeSnapshotCadence: deltas.length > 4 && deltas.every(delta => delta === .01 || delta === .02),
        runtimeHadNoErrors: pilots.every(pilot => pilot.errors.length === 0),
      },
    };
    report.failedAssertions = Object.entries(report.assertions).filter(([, passed]) => !passed).map(([name]) => name);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const pilot of pilots) if (pilot.socket.readyState < WebSocket.CLOSING) pilot.socket.close();
    await stopServer(server);
  }
}

run().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
