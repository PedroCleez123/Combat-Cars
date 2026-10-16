import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-two-pilot-mob-03.json");
const basePort = Number(process.env.ROCKETSIM_MOB03_TEST_PORT || 5270);
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const neutral = () => ({ throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false });

if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la campaña MOB-03");

function finitePose(car) {
  return Boolean(car) && [car.x, car.h, car.z, car.speed, car.orientation?.x, car.orientation?.y, car.orientation?.z, car.orientation?.w].every(Number.isFinite);
}

function compact(car) {
  return {
    id: car.id, team: car.team, x: car.x, h: car.h, z: car.z, speed: car.speed,
    velocity: car.velocity, hp: car.hp, respawn: car.respawn, deaths: car.deaths,
    actionSerials: car.actionSerials, orientation: car.orientation,
  };
}

function carById(frame, id) {
  return frame?.cars?.find(car => car.id === id) || null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.h - b.h, a.z - b.z);
}

function startServer({ port, arena }) {
  const serverProcess = spawn(process.execPath, ["server.mjs"], {
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
  serverProcess.stdout.on("data", chunk => output.push(chunk.toString()));
  serverProcess.stderr.on("data", chunk => output.push(chunk.toString()));
  return { process: serverProcess, output };
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
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

async function connectPilot(port, name) {
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
    send(input) {
      const sent = ++sequence;
      socket.send(JSON.stringify({ type: "input", sequence: sent, input }));
      return sent;
    },
  };
}

async function withArena({ port, arena }, work) {
  const { process, output } = startServer({ port, arena });
  let blue;
  let red;
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), `servidor ${arena}`);
    blue = await connectPilot(port, `MOB-03-BLUE-${arena}`);
    red = await connectPilot(port, `MOB-03-RED-${arena}`);
    const initial = await waitFor(() => {
      const frame = red.frames.at(-1);
      return frame?.settings?.humans === 2 && frame.cars?.length === 2 ? frame : null;
    }, `roster de dos pilotos ${arena}`);
    return await work({ blue, red, initial });
  } finally {
    blue?.socket.close();
    red?.socket.close();
    await stopServer(process);
  }
}

async function acknowledge(pilot, input, label) {
  const sequence = pilot.send(input);
  await waitFor(() => pilot.acknowledged >= sequence, `ACK ${label}`);
  return sequence;
}

async function movementPhase() {
  return withArena({ port: basePort, arena: "arsenal-expanded-curved-practice" }, async ({ blue, red, initial }) => {
    const blueId = blue.welcome.id;
    const redId = red.welcome.id;
    const initialBlue = carById(initial, blueId);
    const initialRed = carById(initial, redId);
    assert.ok(finitePose(initialBlue) && finitePose(initialRed), "poses iniciales finitas");

    const blueInput = { ...neutral(), throttle: 1, boost: true };
    const redInput = { ...neutral(), throttle: 1, boost: true };
    const blueSequence = await acknowledge(blue, blueInput, "movimiento azul");
    const redSequence = await acknowledge(red, redInput, "movimiento rojo");
    await wait(1400);
    const blueRelease = await acknowledge(blue, neutral(), "liberación azul");
    const redRelease = await acknowledge(red, neutral(), "liberación rojo");
    await wait(260);

    const frames = red.frames;
    const final = frames.at(-1);
    const finalBlue = carById(final, blueId);
    const finalRed = carById(final, redId);
    const paired = frames.map(frame => [carById(frame, blueId), carById(frame, redId)]).filter(([a, b]) => a && b);
    const separations = paired.map(([a, b]) => distance(a, b));
    const deltas = frames.slice(1).map((frame, index) => Number((frame.time - frames[index].time).toFixed(2))).filter(delta => delta > 0);
    const blueTravel = distance(initialBlue, finalBlue);
    const redTravel = distance(initialRed, finalRed);
    return {
      arena: final.settings.practiceArena,
      pilots: [blue.welcome, red.welcome],
      inputs: { blueSequence, redSequence, blueRelease, redRelease, blueAcknowledged: blue.acknowledged, redAcknowledged: red.acknowledged },
      initial: { blue: compact(initialBlue), red: compact(initialRed) },
      final: { blue: compact(finalBlue), red: compact(finalRed) },
      movement: { blueTravel, redTravel, minSeparation: Math.min(...separations), finalSeparation: separations.at(-1) },
      cadence: { values: [...new Set(deltas)], count: deltas.length },
      errors: [...blue.errors, ...red.errors],
      assertions: {
        expandedArena: final.settings.practiceArena === "arsenal-expanded-curved-practice",
        opposingTeams: blue.welcome.team === "blue" && red.welcome.team === "red",
        stableRoster: paired.length > 10 && paired.every(([a, b]) => a.id === blueId && b.id === redId && a.team === "blue" && b.team === "red"),
        independentAcks: blue.acknowledged >= blueRelease && red.acknowledged >= redRelease,
        finiteNativePoses: paired.every(([a, b]) => finitePose(a) && finitePose(b)),
        bothPilotsMoved: blueTravel > 3 && redTravel > 3,
        nativeSnapshotCadence: deltas.length > 4 && deltas.every(delta => delta === .01 || delta === .02),
        runtimeHadNoErrors: blue.errors.length === 0 && red.errors.length === 0,
      },
    };
  });
}

async function combatPhase() {
  return withArena({ port: basePort + 1, arena: "combat-lineup" }, async ({ blue, red, initial }) => {
    const blueId = blue.welcome.id;
    const redId = red.welcome.id;
    // `combat-lineup` is a clean native arena with an intentional rear spawn.
    // Use it only to record a native vehicle contact, then restart before the
    // deterministic rocket sequence. No pose is written by Node in either leg.
    const contactStartIndex = red.frames.length;
    const contactStart = { blue: carById(initial, blueId), red: carById(initial, redId) };
    const contactDrive = await acknowledge(red, { ...neutral(), throttle: 1, boost: true }, "aproximación de contacto");
    await wait(560);
    const contactRelease = await acknowledge(red, neutral(), "liberación de contacto");
    await wait(180);
    const contactFrames = red.frames.slice(contactStartIndex)
      .map(frame => [carById(frame, blueId), carById(frame, redId)])
      .filter(([blueCar, redCar]) => blueCar && redCar);
    const contactSeparations = contactFrames.map(([blueCar, redCar]) => distance(blueCar, redCar));
    const contactEnd = contactFrames.at(-1);
    red.socket.send(JSON.stringify({ type: "restart" }));
    const reset = await waitFor(() => {
      const frame = red.frames.at(-1);
      const blueCar = carById(frame, blueId);
      const redCar = carById(frame, redId);
      return blueCar?.actionSerials?.respawn > contactStart.blue.actionSerials.respawn
        && redCar?.actionSerials?.respawn > contactStart.red.actionSerials.respawn
        ? { blue: blueCar, red: redCar } : null;
    }, "reinicio tras contacto", 5000);
    const fireStart = await acknowledge(red, { ...neutral(), fire: true }, "primer disparo");
    const fireRelease = await acknowledge(red, neutral(), "liberación primer disparo");
    await waitFor(() => carById(red.frames.at(-1), blueId)?.hp === 35, "primer impacto");
    const fireCooldown = await acknowledge(red, { ...neutral(), fire: true }, "disparo durante cooldown");
    const cooldownRelease = await acknowledge(red, neutral(), "liberación durante cooldown");
    await wait(120);
    const healthAfterCooldown = carById(red.frames.at(-1), blueId)?.hp;
    // Leave more than one authoritative cooldown interval after the rejected
    // edge. The campaign exercises two server processes in sequence, so this
    // avoids treating a locally delayed snapshot as a combat-rule failure.
    await wait(1000);
    const fireElimination = await acknowledge(red, { ...neutral(), fire: true }, "disparo de eliminación");
    const finalSequence = await acknowledge(red, neutral(), "liberación de eliminación");
    const eliminated = await waitFor(() => {
      const victim = carById(red.frames.at(-1), blueId);
      return victim?.hp === 0 && victim.respawn > 0 && victim.deaths === 1 ? victim : null;
    }, "eliminación");
    const inactive = await waitFor(() => {
      const victim = carById(red.frames.at(-1), blueId);
      return victim?.h < -100 ? victim : null;
    }, "desactivación nativa");
    const respawned = await waitFor(() => {
      const victim = carById(red.frames.at(-1), blueId);
      return victim?.hp === 100 && victim.respawn === 0 && victim.actionSerials?.respawn > 0 && victim.h > -1 ? victim : null;
    }, "respawn nativo", 5000);
    const frames = red.frames;
    const final = frames.at(-1);
    const fireEvents = [...new Map(frames.flatMap(frame => frame.events || []).filter(item => item.kind === "fire").map(item => [`${item.at}:${item.text}`, item])).values()];
    const deltas = frames.slice(1).map((frame, index) => Number((frame.time - frames[index].time).toFixed(2))).filter(delta => delta > 0);
    return {
      arena: final.settings.practiceArena,
      pilots: [blue.welcome, red.welcome],
      initial: { blue: compact(carById(initial, blueId)), red: compact(carById(initial, redId)) },
      contact: {
        inputs: { contactDrive, contactRelease },
        start: { blue: compact(contactStart.blue), red: compact(contactStart.red) },
        end: { blue: compact(contactEnd[0]), red: compact(contactEnd[1]) },
        minSeparation: Math.min(...contactSeparations),
        reset: { blue: compact(reset.blue), red: compact(reset.red) },
      },
      inputs: { fireStart, fireRelease, fireCooldown, cooldownRelease, fireElimination, finalSequence, redAcknowledged: red.acknowledged },
      observed: { healthAfterCooldown, eliminated: compact(eliminated), inactive: compact(inactive), respawned: compact(respawned), fireEvents, errors: [...blue.errors, ...red.errors] },
      cadence: { values: [...new Set(deltas)], count: deltas.length },
      assertions: {
        combatLineup: final.settings.practiceArena === "combat-lineup" && final.rules.combat === true,
        nativeVehicleContactObserved: Math.min(...contactSeparations) < distance(contactStart.blue, contactStart.red) - 4,
        contactRestartedNatively: reset.blue.actionSerials.respawn > contactStart.blue.actionSerials.respawn && reset.red.actionSerials.respawn > contactStart.red.actionSerials.respawn,
        inputsAcknowledged: red.acknowledged >= finalSequence,
        cooldownRejected: healthAfterCooldown === 35,
        twoFireEdges: fireEvents.length === 2,
        eliminationObserved: eliminated.hp === 0 && eliminated.deaths === 1,
        nativeDeactivationObserved: inactive.h < -100,
        nativeRespawnObserved: respawned.hp === 100 && respawned.respawn === 0 && respawned.actionSerials.respawn > 0,
        nativeSnapshotCadence: deltas.length > 4 && deltas.every(delta => delta === .01 || delta === .02),
        runtimeHadNoErrors: blue.errors.length === 0 && red.errors.length === 0,
      },
    };
  });
}

async function run() {
  const movement = await movementPhase();
  const combat = await combatPhase();
  const assertions = { ...Object.fromEntries(Object.entries(movement.assertions).map(([name, value]) => [`movement.${name}`, value])), ...Object.fromEntries(Object.entries(combat.assertions).map(([name, value]) => [`combat.${name}`, value])) };
  const report = { schemaVersion: 1, story: "MOB-03", generatedAt: new Date().toISOString(), movement, combat, assertions };
  report.failedAssertions = Object.entries(assertions).filter(([, passed]) => !passed).map(([name]) => name);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const [name, passed] of Object.entries(assertions)) assert.equal(passed, true, name);
  console.log(JSON.stringify(report, null, 2));
}

run().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
