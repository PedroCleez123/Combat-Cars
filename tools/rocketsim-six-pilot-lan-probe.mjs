import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const port = Number(process.env.ROCKETSIM_R9_TEST_PORT || 5280);
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-six-pilot-lan-r9-01.json");
const arena = "arsenal-expanded-curved-practice";
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la campaña R9-01");

function carById(frame, id) {
  return frame?.cars?.find(car => car.id === id) || null;
}

function finitePose(car) {
  return Boolean(car) && [car.x, car.h, car.z, car.speed, car.orientation?.x, car.orientation?.y, car.orientation?.z, car.orientation?.w].every(Number.isFinite);
}

function compact(car) {
  return {
    id: car.id, team: car.team, x: car.x, h: car.h, z: car.z, speed: car.speed,
    velocity: car.velocity, steer: car.steer, boost: car.boost, orientation: car.orientation,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.h - b.h, a.z - b.z);
}

function startServer() {
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      MOVEMENT_BACKEND: "rocketsim",
      ROCKETSIM_MODE: "practice",
      ROCKETSIM_ARENA: arena,
      ROCKETSIM_BRIDGE_EXE: executable,
      PORT: String(port),
    },
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

async function waitFor(check, label, timeout = 8000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = check();
    if (result) return result;
    await wait(12);
  }
  throw new Error("Timeout: " + label);
}

async function connectPilot(name) {
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
  await waitFor(() => welcome, "welcome " + name);
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
  await waitFor(() => pilot.acknowledged >= sequence, "ACK " + label);
  return sequence;
}

function snapshotCadence(frames) {
  const deltas = frames.slice(1)
    .map((frame, index) => Number((frame.time - frames[index].time).toFixed(2)))
    .filter(delta => delta > 0);
  return { values: [...new Set(deltas)], count: deltas.length, valid: deltas.length > 4 && deltas.every(delta => delta === .01 || delta === .02) };
}

async function run() {
  const server = startServer();
  const pilots = [];
  try {
    await waitFor(() => server.output.join("").includes("http://localhost:" + port), "servidor R9-01");
    for (let index = 0; index < 6; index += 1) {
      const pilot = await connectPilot("R9-01-PILOT-" + (index + 1));
      pilots.push(pilot);
      await waitFor(() => {
        const frame = pilot.frames.at(-1);
        return frame?.settings?.humans === index + 1 && frame.cars?.length === index + 1 ? frame : null;
      }, "roster de " + (index + 1) + " pilotos");
    }

    const observer = pilots[0];
    const stable = await waitFor(() => {
      const frame = observer.frames.at(-1);
      return frame?.settings?.humans === 6 && frame.cars?.length === 6 ? frame : null;
    }, "roster estable de seis pilotos");
    const initialById = new Map(stable.cars.map(car => [car.id, compact(car)]));
    const steerValues = [-1, -.6, -.2, .2, .6, 1];
    const sequences = [];
    for (const [index, pilot] of pilots.entries()) {
      sequences.push(await acknowledge(pilot, { ...neutral(), throttle: 1, boost: true, steer: steerValues[index] }, "input piloto " + (index + 1)));
    }
    await wait(1000);
    const inputFrame = observer.frames.at(-1);
    const inputById = new Map(inputFrame.cars.map(car => [car.id, compact(car)]));
    for (const [index, pilot] of pilots.entries()) {
      sequences.push(await acknowledge(pilot, neutral(), "liberación piloto " + (index + 1)));
    }
    await wait(220);
    const driven = observer.frames.at(-1);
    const drivenById = new Map(driven.cars.map(car => [car.id, compact(car)]));
    const movement = pilots.map(pilot => {
      const id = pilot.welcome.id;
      return { id, travel: distance(initialById.get(id), drivenById.get(id)) };
    });

    const removedPilot = pilots.at(-1);
    const removedId = removedPilot.welcome.id;
    removedPilot.socket.close();
    const afterLeave = await waitFor(() => {
      const frame = observer.frames.at(-1);
      return frame?.settings?.humans === 5 && frame.cars?.length === 5 && !carById(frame, removedId) ? frame : null;
    }, "reconstrucción tras desconexión", 10000);
    const remaining = pilots.slice(0, -1);
    const recoverySequence = await acknowledge(remaining[0], { ...neutral(), throttle: 1, steer: .4 }, "input tras desconexión");
    await wait(180);
    const recovered = observer.frames.at(-1);
    const cadence = snapshotCadence(observer.frames);
    const errors = pilots.flatMap(pilot => pilot.errors);
    const expectedTeams = ["blue", "red", "blue", "red", "blue", "red"];
    const report = {
      schemaVersion: 1,
      story: "R9-01",
      generatedAt: new Date().toISOString(),
      profile: arena,
      backend: driven.settings.movementBackend,
      pilots: pilots.map((pilot, index) => ({ name: pilot.name, id: pilot.welcome.id, team: pilot.welcome.team, acknowledged: pilot.acknowledged, expectedTeam: expectedTeams[index] })),
      initial: [...initialById.values()],
      duringIndependentInputs: [...inputById.values()],
      afterIndependentInputs: [...drivenById.values()],
      movement,
      disconnect: {
        removedId,
        remainingIds: afterLeave.cars.map(car => car.id),
        humans: afterLeave.settings.humans,
        recoverySequence,
        recoveredCars: recovered.cars.map(compact),
      },
      cadence: { values: cadence.values, count: cadence.count },
      errors,
      assertions: {
        rocketsimExpandedPractice: driven.settings.movementBackend === "rocketsim" && driven.settings.practiceArena === arena && driven.rules.combat === false,
        sixStableIds: stable.cars.map(car => car.id).sort().join(",") === pilots.map(pilot => pilot.welcome.id).sort().join(","),
        balancedTeams: pilots.every((pilot, index) => pilot.welcome.team === expectedTeams[index]),
        allFiniteNativePoses: stable.cars.every(finitePose) && driven.cars.every(finitePose) && afterLeave.cars.every(finitePose) && recovered.cars.every(finitePose),
        perPilotInputAcknowledged: pilots.every((pilot, index) => pilot.acknowledged >= sequences[index] && pilot.acknowledged >= sequences[index + 6]),
        inputsRemainMappedToOwnCars: pilots.every((pilot, index) => inputById.get(pilot.welcome.id)?.steer === steerValues[index]),
        allPilotsMoved: movement.every(item => item.travel > 3),
        nativeSnapshotCadence: cadence.valid,
        disconnectRebuiltRoster: afterLeave.settings.humans === 5 && afterLeave.cars.length === 5 && !carById(afterLeave, removedId),
        postDisconnectInputAcknowledged: remaining[0].acknowledged >= recoverySequence && recovered.cars.length === 5 && carById(recovered, removedId) === null,
        runtimeHadNoErrors: errors.length === 0,
      },
    };
    report.failedAssertions = Object.entries(report.assertions).filter(([, passed]) => !passed).map(([name]) => name);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const pilot of pilots) if (pilot.socket.readyState < WebSocket.CLOSING) pilot.socket.close();
    await stopServer(server.process);
  }
}

run().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

