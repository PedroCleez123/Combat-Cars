import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const port = Number(process.env.ROCKETSIM_VIS03_TEST_PORT || 5295);
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-projectile-visibility-vis03.json");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para VIS-03");

function startServer() {
  const childProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      MOVEMENT_BACKEND: "rocketsim",
      ROCKETSIM_MODE: "combat",
      ROCKETSIM_ARENA: "combat-lineup",
      ROCKETSIM_BRIDGE_EXE: executable,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  childProcess.stdout.on("data", chunk => output.push(chunk.toString()));
  childProcess.stderr.on("data", chunk => output.push(chunk.toString()));
  return { process: childProcess, output };
}

async function stopServer(process) {
  if (!process || process.exitCode !== null) return;
  await new Promise(resolveStop => {
    const force = setTimeout(() => { process.kill(); resolveStop(); }, 1800);
    process.once("exit", () => { clearTimeout(force); resolveStop(); });
    process.kill("SIGTERM");
  });
}

async function waitFor(check, label, timeout = 6000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = check();
    if (value) return value;
    await wait(10);
  }
  throw new Error(`Timeout: ${label}`);
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
    socket,
    get welcome() { return welcome; },
    get frames() { return frames; },
    get errors() { return errors; },
    get acknowledged() { return acknowledged; },
    send(input) { const sent = ++sequence; socket.send(JSON.stringify({ type: "input", sequence: sent, input })); return sent; },
  };
}

async function run() {
  const server = startServer();
  let blue;
  let red;
  try {
    await waitFor(() => server.output.join("").includes(`http://localhost:${port}`), "servidor VIS-03");
    blue = await connectPilot("VIS-03-BLUE");
    red = await connectPilot("VIS-03-RED");
    const roster = await waitFor(() => {
      const frame = red.frames.at(-1);
      return frame?.settings?.humans === 2 && frame.cars?.length === 2 ? frame : null;
    }, "roster de dos pilotos");
    const fireSequence = red.send({ ...neutral(), fire: true });
    await waitFor(() => red.acknowledged >= fireSequence, "ACK de disparo");
    const projectileFrame = await waitFor(() => red.frames.find(frame => frame.rockets?.some(rocket => rocket.team === "red")) || null, "cohete autoritativo en snapshot");
    const rocket = projectileFrame.rockets.find(item => item.team === "red");
    const shooter = projectileFrame.cars.find(car => car.id === red.welcome.id);
    const distanceFromShooter = Math.hypot(rocket.x - shooter.x, rocket.h - shooter.h, rocket.z - shooter.z);
    red.send(neutral());
    const report = {
      schemaVersion: 1,
      story: "VIS-03.1",
      generatedAt: new Date().toISOString(),
      profile: projectileFrame.settings.practiceArena,
      backend: projectileFrame.settings.movementBackend,
      roster: roster.cars.map(car => ({ id: car.id, team: car.team })),
      projectile: {
        id: rocket.id,
        team: rocket.team,
        position: { x: rocket.x, h: rocket.h, z: rocket.z },
        velocity: { x: rocket.vx, h: rocket.vh, z: rocket.vz },
        distanceFromShooter,
      },
      assertions: {
        nativeCombatProfile: projectileFrame.settings.movementBackend === "rocketsim" && projectileFrame.rules.combat === true && projectileFrame.settings.practiceArena === "combat-lineup",
        redFireAcknowledged: red.acknowledged >= fireSequence,
        twoPilotRoster: roster.cars.length === 2 && blue.welcome.team === "blue" && red.welcome.team === "red",
        projectilePublishedToClient: Boolean(rocket),
        projectileHasFinitePoseAndVelocity: [rocket.x, rocket.h, rocket.z, rocket.vx, rocket.vh, rocket.vz].every(Number.isFinite),
        projectileHasLeftShooter: distanceFromShooter > 2.5,
        runtimeHadNoErrors: blue.errors.length === 0 && red.errors.length === 0,
      },
    };
    report.failedAssertions = Object.entries(report.assertions).filter(([, passed]) => !passed).map(([name]) => name);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const serverOutput = server.output.join("").trim();
    throw new Error(`${error.message || String(error)}${serverOutput ? ` · servidor: ${serverOutput.slice(-800)}` : ""}`);
  } finally {
    blue?.socket.close();
    red?.socket.close();
    await stopServer(server.process);
  }
}

run().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
