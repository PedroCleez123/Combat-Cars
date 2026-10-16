import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.ROCKETSIM_WALL_ACTIONS_TEST_PORT || 5207);
const profile = "arsenal-curved-practice";
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-wall-actions-r7-05c.json");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0 });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la sonda R7-05c");

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

function wheelCount(car) {
  return car.contacts?.[0]?.wheelCount ?? 0;
}

function wallSupport(car) {
  return Boolean(car?.grounded && car.wallRide && car.surfaceType === "wall" && wheelCount(car) > 0);
}

function compact(car) {
  return {
    time: car.time,
    x: car.x,
    h: car.h,
    z: car.z,
    speed: car.speed,
    grounded: car.grounded,
    wallRide: car.wallRide,
    surfaceType: car.surfaceType,
    wheelCount: wheelCount(car),
    jumpState: car.jumpState,
    jumps: car.jumps,
    actionSerials: { ...car.actionSerials },
    boost: car.boost,
    angularVelocity: { ...car.angularVelocity },
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
      acknowledged = Math.max(acknowledged, message.inputAcknowledged || 0);
      latest = message.state;
      const car = latest?.cars?.find(candidate => candidate.id === id);
      if (car) samples.push({ receivedAt: performance.now(), time: latest.time, car: structuredClone(car) });
    });
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "probe-R7-05C-WALL-ACTIONS", name: "R7-05C-WALL-ACTIONS" }));
    await waitFor(() => latest?.cars?.some(car => car.id === id), "coche autoritativo");

    const send = input => {
      const sent = ++sequence;
      socket.send(JSON.stringify({ type: "input", sequence: sent, input }));
      return sent;
    };
    const carNow = () => latest?.cars?.find(candidate => candidate.id === id) || null;
    const waitState = (predicate, label, timeout = 6000) => waitFor(() => {
      const car = carNow();
      return car && predicate(car) ? structuredClone(car) : null;
    }, label, timeout);
    const pulse = async (input, milliseconds = 130) => {
      const sent = send(input);
      await wait(milliseconds);
      send(neutral());
      await waitFor(() => acknowledged >= sent, `ACK ${sent}`);
      return sent;
    };
    const restart = async () => {
      socket.send(JSON.stringify({ type: "restart" }));
      await waitState(car => car.grounded && car.jumps === 2 && car.actionSerials.jump === 0 && car.actionSerials.doubleJump === 0 && car.actionSerials.dodge === 0, "reinicio de fase");
      await wait(70);
      send(neutral());
    };
    const reachWall = async () => {
      const startIndex = samples.length;
      const driveSequence = send({ ...neutral(), throttle: 1, boost: true });
      await waitFor(() => acknowledged >= driveSequence, `ACK ${driveSequence}`);
      const source = await waitState(wallSupport, "apoyo de pared para acción");
      return { source, startIndex };
    };
    const phase = async (name, action) => {
      await restart();
      const { source, startIndex } = await reachWall();
      const result = await action(source);
      await wait(180);
      const captured = samples.slice(startIndex);
      assert.ok(captured.length >= 5, `${name}: deben existir snapshots suficientes`);
      return { name, source: compact(source), result, samples: captured, final: compact(captured.at(-1).car) };
    };

    const wallJump = await phase("wall-jump", async source => {
      const before = source.actionSerials.jump;
      await pulse({ ...neutral(), jump: true });
      const jumped = await waitState(car => car.actionSerials.jump > before, "salto desde pared");
      return { source, jumped: compact(jumped), leftSupport: !wallSupport(jumped) };
    });

    const wallDodge = await phase("wall-directed-dodge", async source => {
      const before = { ...source.actionSerials };
      await pulse({ ...neutral(), jump: true });
      const firstJump = await waitState(car => car.actionSerials.jump > before.jump, "primer salto antes del dodge");
      await wait(130);
      await pulse({ ...neutral(), jump: true, throttle: 1, steer: 1 });
      const dodged = await waitState(car => car.actionSerials.dodge > before.dodge, "dodge dirigido desde pared");
      return { source, firstJump: compact(firstJump), dodged: compact(dodged), leftSupport: !wallSupport(dodged) };
    });

    const wallAirRollBoost = await phase("wall-air-roll-boost", async source => {
      const beforeBoost = source.boost;
      await pulse({ ...neutral(), jump: true });
      const jumped = await waitState(car => car.actionSerials.jump > source.actionSerials.jump, "salto antes del air roll");
      send({ ...neutral(), throttle: -1, steer: 1, airRoll: true, roll: 1, boost: true });
      await wait(360);
      const moved = carNow();
      send(neutral());
      assert.ok(moved, "air roll: debe existir snapshot");
      return {
        source,
        jumped: compact(jumped),
        flight: compact(moved),
        angularMotion: Math.max(Math.abs(moved.angularVelocity.pitch), Math.abs(moved.angularVelocity.yaw), Math.abs(moved.angularVelocity.roll)),
        boostSpent: beforeBoost - moved.boost,
      };
    });

    const wallRecovery = await phase("wall-jump-recovery", async source => {
      await pulse({ ...neutral(), jump: true });
      const jumped = await waitState(car => car.actionSerials.jump > source.actionSerials.jump, "salto antes de recuperación");
      send(neutral());
      const supported = await waitState(car => car.grounded && wheelCount(car) > 0, "recuperación a apoyo", 5000);
      return { source, jumped: compact(jumped), supported: compact(supported), recovered: !wallSupport(jumped) && supported.grounded };
    });

    const phases = [wallJump, wallDodge, wallAirRollBoost, wallRecovery];
    const deltas = phases.flatMap(phaseResult => phaseResult.samples.slice(1).map((sample, index) => Number((sample.time - phaseResult.samples[index].time).toFixed(2)))).filter(delta => delta > 0);
    const uniqueDeltas = [...new Set(deltas)];
    const meanDelta = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
    const report = {
      schemaVersion: 1,
      profile,
      backend: latest.settings.movementBackend,
      port,
      generatedAt: new Date().toISOString(),
      snapshots: phases.reduce((sum, phaseResult) => sum + phaseResult.samples.length, 0),
      inputSequences: sequence,
      acknowledged,
      snapshotTimeDeltas: { unique: uniqueDeltas, min: Math.min(...deltas), max: Math.max(...deltas), mean: meanDelta, expectedSeconds: 2 / 120 },
      phases: phases.map(({ name, source, result, final, samples: phaseSamples }) => ({ name, source, result, final, sampleCount: phaseSamples.length })),
      assertions: {
        backendIsRocketSim: latest.settings.movementBackend === "rocketsim",
        profileIsCurved: latest.settings.practiceArena === profile,
        singlePilot: latest.settings.humans === 1 && latest.cars.length === 1,
        twoTicksPerSnapshot: uniqueDeltas.every(delta => delta === 0.01 || delta === 0.02) && Math.abs(meanDelta - (2 / 120)) < .002,
        everyPhaseStartedOnWall: phases.every(phaseResult => phaseResult.source.wallRide && phaseResult.source.surfaceType === "wall" && phaseResult.source.wheelCount > 0),
        wallJumpObserved: wallJump.result.jumped.actionSerials.jump > wallJump.source.actionSerials.jump && wallJump.result.leftSupport,
        wallDirectedDodgeObserved: wallDodge.result.dodged.actionSerials.dodge > wallDodge.source.actionSerials.dodge && wallDodge.result.leftSupport,
        wallAirRollProducedAngularMotion: wallAirRollBoost.result.angularMotion > .01,
        wallAirRollSpentBoost: wallAirRollBoost.result.boostSpent > .01,
        wallJumpRecoveredToSupport: wallRecovery.result.recovered,
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
