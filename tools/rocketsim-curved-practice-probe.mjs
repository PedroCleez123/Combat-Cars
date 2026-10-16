import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.ROCKETSIM_CURVED_PRACTICE_TEST_PORT || 5205);
const profile = "arsenal-curved-practice";
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-practice-curved-r7-05b.json");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la sonda R7-05b");

function startServer() {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, MOVEMENT_BACKEND: "rocketsim", ROCKETSIM_ARENA: profile, ROCKETSIM_BRIDGE_EXE: executable, PORT: String(port) },
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

async function waitFor(check, label, timeout = 6000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = check();
    if (result) return result;
    await wait(10);
  }
  throw new Error(`Timeout: ${label}`);
}

function supportNormal(car) {
  const normal = car.surfaceNormal || { x: 0, y: 0, z: 0 };
  return { x: Number(normal.x) || 0, y: Number(normal.y) || 0, z: Number(normal.z) || 0 };
}

function snapshot(sample) {
  const car = sample.car;
  return {
    time: sample.time,
    x: car.x,
    h: car.h,
    z: car.z,
    speed: car.speed,
    grounded: car.grounded,
    surfaceType: car.surfaceType,
    surfaceNormal: supportNormal(car),
    wheelCount: car.contacts?.[0]?.wheelCount ?? 0,
    pitch: car.pitch,
    roll: car.roll,
  };
}

async function run() {
  const { server, output } = startServer();
  let socket;
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), "servidor RocketSim curvo");
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    let id = null;
    let latest = null;
    let sequence = 0;
    let acknowledged = 0;
    const samples = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") id = message.id;
      if (message.type !== "state") return;
      latest = message.state;
      acknowledged = Math.max(acknowledged, message.inputAcknowledged || 0);
      const car = latest.cars?.find(candidate => candidate.id === id);
      if (car) samples.push({ time: latest.time, car: structuredClone(car) });
    });
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "probe-R7-05B-PROBE", name: "R7-05B-PROBE" }));
    await waitFor(() => latest?.cars?.some(car => car.id === id), "coche curvo autoritativo");

    const send = input => {
      const sent = ++sequence;
      socket.send(JSON.stringify({ type: "input", sequence: sent, input }));
      return sent;
    };
    const startIndex = samples.length;
    const driveSequence = send({ ...neutral(), throttle: 1, boost: true });
    await waitFor(() => acknowledged >= driveSequence, `ACK ${driveSequence}`);
    const firstInclined = await waitFor(() => samples.slice(startIndex).find(sample => {
      const normal = supportNormal(sample.car);
      return sample.car.grounded && normal.x < -.25 && normal.y < .97;
    }), "apoyo inclinado");
    const firstSteep = await waitFor(() => samples.slice(startIndex).find(sample => {
      const normal = supportNormal(sample.car);
      return sample.car.grounded && normal.x < -.8 && normal.y < .6;
    }), "apoyo pronunciado");
    const firstWallRide = await waitFor(() => samples.slice(startIndex).find(sample => sample.car.wallRide && sample.car.surfaceType === "wall"), "apoyo de pared");
    const stopSequence = send(neutral());
    await waitFor(() => acknowledged >= stopSequence, `ACK ${stopSequence}`);
    await wait(160);

    const captured = samples.slice(startIndex);
    const firstInclinedIndex = captured.indexOf(firstInclined);
    const firstSteepIndex = captured.indexOf(firstSteep);
    const transition = captured.slice(firstInclinedIndex, firstSteepIndex + 1);
    const contactGaps = transition.filter(sample => !sample.car.grounded || (sample.car.contacts?.[0]?.wheelCount ?? 0) <= 0).length;
    const deltas = captured.slice(1).map((sample, index) => Number((sample.time - captured[index].time).toFixed(2))).filter(delta => delta > 0);
    const report = {
      schemaVersion: 1,
      profile,
      backend: latest.settings.movementBackend,
      port,
      snapshots: captured.length,
      inputSequences: sequence,
      acknowledged,
      snapshotTimeDeltas: {
        unique: [...new Set(deltas)],
        min: Math.min(...deltas),
        max: Math.max(...deltas),
        mean: deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length,
        expectedSeconds: 2 / 120,
      },
      transition: {
        firstInclined: snapshot(firstInclined),
        firstSteep: snapshot(firstSteep),
        firstWallRide: snapshot(firstWallRide),
        samples: transition.length,
        contactGaps,
      },
      assertions: {
        backendIsRocketSim: latest.settings.movementBackend === "rocketsim",
        profileIsCurved: latest.settings.practiceArena === profile,
        singlePilot: latest.settings.humans === 1 && latest.cars.length === 1,
        twoTicksPerSnapshot: deltas.every(delta => delta === .01 || delta === .02) && Math.abs((deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length) - 2 / 120) < .002,
        inclinedSupportObserved: firstInclined.car.grounded && supportNormal(firstInclined.car).x < -.25,
        steepSupportObserved: firstSteep.car.grounded && supportNormal(firstSteep.car).x < -.8,
        wallRideObserved: firstWallRide.car.wallRide && firstWallRide.car.surfaceType === "wall",
        noSupportGapBeforeWall: contactGaps === 0,
      },
    };
    for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    socket?.close();
    await stopServer(server);
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
