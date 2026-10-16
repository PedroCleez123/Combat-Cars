import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.ROCKETSIM_COMBAT_TEST_PORT || 5216);
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const arena = process.env.ROCKETSIM_COMBAT_TEST_ARENA || "combat-lineup";
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-combat-websocket-r8-02.json");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la sonda R8-02");
if (arena !== "combat-lineup") {
  throw new Error("R8-02 requiere ROCKETSIM_COMBAT_TEST_ARENA=combat-lineup: valida impactos directos con los spawns enfrentados");
}

function startServer() {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      MOVEMENT_BACKEND: "rocketsim",
      ROCKETSIM_MODE: "combat",
      ROCKETSIM_ARENA: arena,
      ROCKETSIM_BRIDGE_EXE: executable,
      PORT: String(port),
    },
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

async function waitFor(check, label, timeout = 5000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = check();
    if (result) return result;
    await wait(10);
  }
  throw new Error(`Timeout: ${label}`);
}

async function connectPilot(name) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const stateFrames = [];
  const errors = [];
  let welcome = null;
  let acknowledged = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.type === "welcome") welcome = message;
    if (message.type === "error") errors.push(message.text || "error without text");
    if (message.type === "state") {
      acknowledged = Math.max(acknowledged, message.inputAcknowledged || 0);
      stateFrames.push(message.state);
    }
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: ("probe-" + name), name }));
  await waitFor(() => welcome, `welcome ${name}`);
  let sequence = 0;
  return {
    socket,
    get welcome() { return welcome; },
    get frames() { return stateFrames; },
    get errors() { return errors; },
    get acknowledged() { return acknowledged; },
    send(input) {
      const sent = ++sequence;
      socket.send(JSON.stringify({ type: "input", sequence: sent, input }));
      return sent;
    },
  };
}

async function run() {
  const { server, output } = startServer();
  let blue;
  let red;
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), "servidor RocketSim combate");
    blue = await connectPilot("R8-02-BLUE");
    red = await connectPilot("R8-02-RED");
    const matchState = await waitFor(() => {
      const frame = red.frames.at(-1);
      return frame?.settings?.humans === 2 && frame.cars?.length === 2 ? frame : null;
    }, "roster nativo de dos pilotos", 7000);

    const carById = (frame, id) => frame?.cars?.find(car => car.id === id) || null;
    const blueId = blue.welcome.id;
    const sendAndAcknowledge = async (pilot, input, label) => {
      const sequence = pilot.send(input);
      await waitFor(() => pilot.acknowledged >= sequence, `ACK ${label}`, 3000);
      return sequence;
    };
    const fireStart = await sendAndAcknowledge(red, { ...neutral(), fire: true }, "primer disparo");
    const fireRelease = await sendAndAcknowledge(red, neutral(), "liberación primer disparo");
    await waitFor(() => carById(red.frames.at(-1), blueId)?.hp === 35, "primer impacto", 3000);

    const fireDuringCooldown = await sendAndAcknowledge(red, { ...neutral(), fire: true }, "disparo durante cooldown");
    const cooldownRelease = await sendAndAcknowledge(red, neutral(), "liberación durante cooldown");
    await wait(120);
    const healthAfterCooldown = carById(red.frames.at(-1), blueId)?.hp;

    await wait(800);
    const fireElimination = await sendAndAcknowledge(red, { ...neutral(), fire: true }, "disparo de eliminación");
    const finalSequence = await sendAndAcknowledge(red, neutral(), "liberación de eliminación");
    const eliminated = await waitFor(() => {
      const victim = carById(red.frames.at(-1), blueId);
      return victim?.hp === 0 && victim.respawn > 0 && victim.deaths === 1 ? victim : null;
    }, "eliminación", 3000);
    const inactive = await waitFor(() => {
      const victim = carById(red.frames.at(-1), blueId);
      return victim?.h < -100 ? victim : null;
    }, "desactivación nativa", 1000);
    const respawned = await waitFor(() => {
      const victim = carById(red.frames.at(-1), blueId);
      return victim?.hp === 100 && victim.respawn === 0 && victim.actionSerials?.respawn > 0 && victim.h > -1 ? victim : null;
    }, "respawn nativo", 5000);

    const frames = red.frames;
    const allEvents = frames.flatMap(frame => frame.events || []);
    const uniqueFireEvents = [...new Map(allEvents
      .filter(item => item.kind === "fire")
      .map(item => [`${item.at}:${item.text}`, item]))
      .values()];
    const deltas = frames.slice(1)
      .map((frame, index) => Number((frame.time - frames[index].time).toFixed(2)))
      .filter(delta => delta > 0);
    const final = frames.at(-1);
    const report = {
      schemaVersion: 1,
      profile: arena,
      backend: final.settings.movementBackend,
      mode: final.settings.profile,
      port,
      generatedAt: new Date().toISOString(),
      pilots: [blue.welcome, red.welcome],
      inputs: { fireStart, fireRelease, fireDuringCooldown, cooldownRelease, fireElimination, finalSequence, acknowledged: red.acknowledged },
      snapshotTimeDeltas: {
        count: deltas.length,
        min: Math.min(...deltas),
        max: Math.max(...deltas),
        values: [...new Set(deltas)],
      },
      observed: {
        cars: final.cars.map(car => ({ id: car.id, team: car.team, hp: car.hp, x: car.x, h: car.h, z: car.z, orientation: car.orientation })),
        rockets: final.rockets.length,
        fireEvents: uniqueFireEvents,
        healthAfterCooldown,
        eliminated: { hp: eliminated.hp, respawn: eliminated.respawn, deaths: eliminated.deaths },
        inactive: { h: inactive.h },
        respawned: { hp: respawned.hp, respawn: respawned.respawn, deaths: respawned.deaths, actionSerials: respawned.actionSerials },
        errors: [...blue.errors, ...red.errors],
      },
      assertions: {
        rocketSimCombatProfile: final.settings.movementBackend === "rocketsim" && final.rules.combat === true,
        opposingTeams: blue.welcome.team === "blue" && red.welcome.team === "red",
        nativeRosterVisible: final.settings.humans === 2 && final.cars.length === 2,
        bothCarsHaveNativePose: final.cars.every(car => [car.x, car.h, car.z, car.orientation?.w].every(Number.isFinite)),
        inputsAcknowledged: red.acknowledged >= finalSequence,
        cooldownRejectsSecondFireEdge: healthAfterCooldown === 35,
        twoAcceptedFireEdges: uniqueFireEvents.length === 2,
        eliminationObserved: eliminated.hp === 0 && eliminated.deaths === 1,
        nativeDeactivationObserved: inactive.h < -100,
        nativeRespawnObserved: respawned.hp === 100 && respawned.respawn === 0 && respawned.actionSerials.respawn > 0,
        snapshotCadenceIsNativePairing: deltas.length > 2 && deltas.every(delta => delta === .01 || delta === .02),
        runtimeHadNoErrors: blue.errors.length === 0 && red.errors.length === 0,
      },
    };
    for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    blue?.socket.close();
    red?.socket.close();
    await stopServer(server);
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
