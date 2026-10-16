import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.ROCKETSIM_PRACTICE_TEST_PORT || 5204);
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-practice-r7-02.json");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la sonda R7-02");

function startServer() {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, MOVEMENT_BACKEND: "rocketsim", ROCKETSIM_BRIDGE_EXE: executable, PORT: String(port) },
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
    const force = setTimeout(() => {
      server.kill();
      resolveStop();
    }, 1800);
    server.once("exit", () => {
      clearTimeout(force);
      resolveStop();
    });
    server.kill("SIGTERM");
  });
}

async function waitFor(check, label, timeout = 5000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = check();
    if (result) return result;
    await wait(10);
  }
  throw new Error(`Timeout: ${label}`);
}

async function run() {
  const { server, output } = startServer();
  let socket;
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), "servidor RocketSim");
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    let id = null;
    let latest = null;
    let sequence = 0;
    let acknowledged = 0;
    const samples = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") id = message.id;
      if (message.type === "state") {
        acknowledged = Math.max(acknowledged, message.inputAcknowledged || 0);
        latest = message.state;
        const car = latest?.cars?.find(candidate => candidate.id === id);
        if (car) samples.push({ receivedAt: performance.now(), time: latest.time, car: structuredClone(car) });
      }
    });
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "probe-R7-02-PROBE", name: "R7-02-PROBE" }));
    await waitFor(() => latest?.cars?.some(car => car.id === id), "coche autoritativo");

    const send = input => {
      const sent = ++sequence;
      socket.send(JSON.stringify({ type: "input", sequence: sent, input }));
      return sent;
    };
    const waitState = predicate => waitFor(() => {
      const car = latest?.cars?.find(candidate => candidate.id === id);
      return car && predicate(car) ? car : null;
    }, "estado de maniobra");
    const restart = async () => {
      socket.send(JSON.stringify({ type: "restart" }));
      await waitState(car => car.grounded && car.jumps === 2 && car.actionSerials.jump === 0 && car.actionSerials.doubleJump === 0 && car.actionSerials.dodge === 0);
      // The restart request is serialized with the next physics tick. Keep
      // one extra published frame so an old state cannot consume the first
      // edge of the following phase.
      await wait(70);
      send(neutral());
    };
    const pulse = async input => {
      const sent = send(input);
      await wait(150);
      send(neutral());
      await waitFor(() => acknowledged >= sent, `ACK ${sent}`);
    };
    const phase = async (name, action) => {
      await restart();
      const startIndex = samples.length;
      await action();
      await wait(220);
      const captured = samples.slice(startIndex);
      assert.ok(captured.length >= 4, `${name}: deben existir snapshots suficientes`);
      return { name, samples: captured, final: captured.at(-1).car };
    };

    const jump = await phase("first-jump", async () => {
      await pulse({ ...neutral(), jump: true });
      await waitState(car => car.actionSerials.jump > 0);
    });
    const verticalDoubleJump = await phase("vertical-double-jump", async () => {
      await pulse({ ...neutral(), jump: true });
      await wait(130);
      await pulse({ ...neutral(), jump: true });
      await waitState(car => car.actionSerials.doubleJump > 0);
    });
    const directedDodge = await phase("directed-dodge", async () => {
      await pulse({ ...neutral(), jump: true });
      await wait(130);
      await pulse({ ...neutral(), jump: true, throttle: 1, steer: 1 });
      await waitState(car => car.actionSerials.dodge > 0);
    });
    const flight = await phase("flight-axes-and-boost", async () => {
      await pulse({ ...neutral(), jump: true });
      await wait(180);
      send({ ...neutral(), throttle: -1, steer: 1, airRoll: true, roll: 1, boost: true });
      await wait(260);
      send(neutral());
    });

    const phases = [jump, verticalDoubleJump, directedDodge, flight];
    const all = phases.flatMap(phase => phase.samples);
    // Do not measure across restart boundaries: the practice clock is
    // intentionally reset to zero for each isolated manoeuvre.
    const deltas = phases.flatMap(phase => phase.samples.slice(1).map((sample, index) => Number((sample.time - phase.samples[index].time).toFixed(2)))).filter(delta => delta > 0);
    const uniqueDeltas = [...new Set(deltas)];
    const meanDelta = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
    const report = {
      schemaVersion: 1,
      profile: "arsenal-practice",
      backend: latest.settings.movementBackend,
      port,
      generatedAt: new Date().toISOString(),
      snapshots: all.length,
      inputSequences: sequence,
      acknowledged,
      snapshotTimeDeltas: { unique: uniqueDeltas, min: Math.min(...deltas), max: Math.max(...deltas), mean: meanDelta, expectedSeconds: 2 / 120 },
      phases: phases.map(({ name, samples: phaseSamples, final }) => ({
        name,
        sampleCount: phaseSamples.length,
        actionSerials: final.actionSerials,
        maxHeight: Math.max(...phaseSamples.map(sample => sample.car.h)),
        maxAngular: {
          pitch: Math.max(...phaseSamples.map(sample => Math.abs(sample.car.angularVelocity.pitch))),
          yaw: Math.max(...phaseSamples.map(sample => Math.abs(sample.car.angularVelocity.yaw))),
          roll: Math.max(...phaseSamples.map(sample => Math.abs(sample.car.angularVelocity.roll))),
        },
        final: { grounded: final.grounded, h: final.h, jumps: final.jumps, actionSerials: final.actionSerials },
      })),
      assertions: {
        backendIsRocketSim: latest.settings.movementBackend === "rocketsim",
        singlePilot: latest.settings.humans === 1 && latest.cars.length === 1,
        twoTicksPerSnapshot: uniqueDeltas.every(delta => delta === 0.01 || delta === 0.02) && Math.abs(meanDelta - (2 / 120)) < .002,
        jumpObserved: jump.final.actionSerials.jump > 0,
        verticalDoubleJumpObserved: verticalDoubleJump.final.actionSerials.doubleJump > 0,
        directedDodgeObserved: directedDodge.final.actionSerials.dodge > 0,
        flightProducedAngularMotion: flight.samples.some(sample => Math.abs(sample.car.angularVelocity.pitch) > .01 || Math.abs(sample.car.angularVelocity.yaw) > .01 || Math.abs(sample.car.angularVelocity.roll) > .01),
      },
    };
    assert.equal(report.assertions.backendIsRocketSim, true);
    assert.equal(report.assertions.singlePilot, true);
    assert.equal(report.assertions.twoTicksPerSnapshot, true);
    assert.equal(report.assertions.jumpObserved, true);
    assert.equal(report.assertions.verticalDoubleJumpObserved, true);
    assert.equal(report.assertions.directedDodgeObserved, true);
    assert.equal(report.assertions.flightProducedAngularMotion, true);
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
