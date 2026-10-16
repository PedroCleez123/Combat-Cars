import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeVehicleInput } from "../src/control-mapping.js";
import { readGamepadActions } from "../src/gamepad-input.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.CALIBRATION_TEST_PORT || 5199);
const reportPath = resolve(root, "docs", "automated-cal-03-last-run.json");
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
const emptyButtons = () => Array.from({ length: 13 }, () => ({ pressed: false, value: 0 }));

function controllerInput({ steer = 0, accelerate = 0, brake = 0, buttons = [] } = {}) {
  const standardButtons = emptyButtons();
  for (const index of buttons) standardButtons[index] = { pressed: true, value: 1 };
  standardButtons[6] = { pressed: brake >= .5, value: brake };
  standardButtons[7] = { pressed: accelerate >= .5, value: accelerate };
  const { actions } = readGamepadActions([{
    connected: true, mapping: "standard", axes: [steer, 0], buttons: standardButtons
  }]);
  return composeVehicleInput(actions);
}

function startServer() {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  server.stdout.on("data", chunk => output.push(chunk.toString()));
  server.stderr.on("data", chunk => output.push(chunk.toString()));
  return { server, output };
}

async function waitFor(check, label, timeout = 4000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = check();
    if (value) return value;
    await wait(10);
  }
  throw new Error(`Timeout: ${label}`);
}

async function run() {
  const { server, output } = startServer();
  let socket;
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), "el servidor de calibración temporal");
    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    let id = null;
    let latest = null;
    let acknowledged = 0;
    let sequence = 0;
    let samples = [];
    const report = { profile: "CAL-03-red-autoritaria", port, steps: [], generatedAt: new Date().toISOString() };
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "welcome") id = message.id;
      if (message.type === "state") {
        latest = message.state;
        acknowledged = message.inputAcknowledged || acknowledged;
        const car = latest?.cars?.find(candidate => candidate.id === id);
        if (car) samples.push(car);
      }
    });
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "probe-CAL-03-AUTOMATION", name: "CAL-03-AUTOMATION" }));
    const current = async () => waitFor(() => latest?.cars?.find(candidate => candidate.id === id), "el coche autoritativo");
    await current();

    const sendInput = async input => {
      const sent = ++sequence;
      socket.send(JSON.stringify({ type: "input", sequence: sent, input }));
      await waitFor(() => acknowledged >= sent, `ACK de entrada ${sent}`);
      return sent;
    };
    const restart = async () => {
      samples = [];
      socket.send(JSON.stringify({ type: "restart" }));
      await waitFor(() => {
        const car = latest?.cars?.find(candidate => candidate.id === id);
        // A previous snapshot can already be grounded with two jumps. Wait
        // for the restarted car, whose action serials are rebuilt at zero,
        // before the next input edge; otherwise an old double-jump sample can
        // leak into the following dodge assertion.
        return car?.grounded && car.jumps === 2
          && car.actionSerials?.jump === 0
          && car.actionSerials?.doubleJump === 0
          && car.actionSerials?.dodge === 0;
      }, "reinicio de la maniobra");
      samples = [];
      await sendInput(controllerInput());
    };
    const hold = async (input, requestedMs) => {
      const pressedSequence = await sendInput(input);
      const startedAt = performance.now();
      await wait(requestedMs);
      const heldForMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const releasedSequence = await sendInput(controllerInput());
      return { requestedMs, heldForMs, pressedSequence, releasedSequence };
    };
    const jump = () => hold(controllerInput({ buttons: [0] }), 90);
    const snapshot = () => latest.cars.find(candidate => candidate.id === id);
    const actionSeen = action => samples.some(sample => Number(sample.actionSerials?.[action] || 0) > 0);
    const summarize = (id, inputTrace, assertions) => {
      const angular = samples.map(sample => sample.angularVelocity || {});
      const entry = {
        id, inputTrace, samples: samples.length,
        peak: {
          pitch: Math.max(...angular.map(rate => Math.abs(rate.pitch || 0))),
          yaw: Math.max(...angular.map(rate => Math.abs(rate.yaw || 0))),
          roll: Math.max(...angular.map(rate => Math.abs(rate.roll || 0))),
          height: Math.max(...samples.map(sample => sample.h || 0))
        },
        final: snapshot(), assertions
      };
      report.steps.push(entry);
      return entry;
    };

    await restart();
    const pitchDownTrace = [await jump(), await hold(controllerInput({ accelerate: 1 }), 400)];
    await wait(180);
    const pitchDown = summarize("pitch-down", pitchDownTrace, { positivePitch: samples.some(sample => sample.pitch > .1) });
    assert.equal(pitchDown.assertions.positivePitch, true, "W/forward del mando debe bajar el morro");

    await restart();
    await jump();
    await hold(controllerInput({ brake: 1 }), 400);
    const noBoostTrace = await hold(controllerInput(), 250);
    const unboostedVerticalVelocity = snapshot().velocity.y;

    await restart();
    const pitchBoostTrace = [await jump(), await hold(controllerInput({ brake: 1 }), 400)];
    pitchBoostTrace.push(await hold(controllerInput({ buttons: [5] }), 250));
    const boostedVerticalVelocity = snapshot().velocity.y;
    await wait(120);
    const pitchBoost = summarize("pitch-up-boost", pitchBoostTrace, {
      negativePitch: samples.some(sample => sample.pitch < -.1),
      boostSeen: samples.some(sample => sample.boosting),
      boostAddsMoreVerticalVelocity: boostedVerticalVelocity > unboostedVerticalVelocity + .1
    });
    assert.deepEqual(pitchBoost.assertions, { negativePitch: true, boostSeen: true, boostAddsMoreVerticalVelocity: true }, "S y B deben orientar y aplicar nitro");
    pitchBoost.control = { noBoostTrace, unboostedVerticalVelocity, boostedVerticalVelocity };

    await restart();
    const yawTrace = [await jump(), await hold(controllerInput({ steer: 1 }), 400)];
    await wait(120);
    const yaw = summarize("yaw-right", yawTrace, { positiveYaw: samples.some(sample => sample.angularVelocity?.yaw > .2) });
    assert.equal(yaw.assertions.positiveYaw, true, "el stick a la derecha debe producir yaw derecho");

    await restart();
    const leftRollTrace = [await jump(), await hold(controllerInput({ buttons: [2] }), 300)];
    await wait(120);
    const leftRoll = samples.some(sample => sample.angularVelocity?.roll < -.2);
    await restart();
    const rightRollTrace = [await jump(), await hold(controllerInput({ buttons: [1] }), 300)];
    await wait(120);
    const roll = summarize("direct-roll", { left: leftRollTrace, right: rightRollTrace }, {
      leftRoll,
      rightRoll: samples.some(sample => sample.angularVelocity?.roll > .2)
    });
    assert.deepEqual(roll.assertions, { leftRoll: true, rightRoll: true }, "X/B deben dar roll direccional opuesto");

    await restart();
    const freeRollTrace = [await jump(), await hold(controllerInput({ steer: 1, buttons: [4] }), 400)];
    await wait(120);
    const freeRollSamples = samples.filter(sample => Math.abs(sample.angularVelocity?.roll || 0) > .2);
    const freeRoll = summarize("free-air-roll-release", freeRollTrace, {
      rollSeen: freeRollSamples.length > 0,
      yawSuppressed: freeRollSamples.every(sample => Math.abs(sample.angularVelocity?.yaw || 0) < .03)
    });
    assert.deepEqual(freeRoll.assertions, { rollSeen: true, yawSuppressed: true }, "LB + stick debe transferir steer a roll y suprimir yaw");

    await restart();
    const firstDoubleJump = await jump();
    await wait(120);
    const secondDoubleJump = await jump();
    const doubleJumpTrace = [firstDoubleJump, { waitMs: 120 }, secondDoubleJump];
    await wait(120);
    const verticalDoubleJump = summarize("vertical-double-jump", doubleJumpTrace, {
      doubleJumpSeen: actionSeen("doubleJump"),
      noDodgeSeen: !actionSeen("dodge"),
      secondJumpConsumed: snapshot().jumps === 0
    });
    assert.deepEqual(verticalDoubleJump.assertions, {
      doubleJumpSeen: true, noDodgeSeen: true, secondJumpConsumed: true
    }, "A sin dirección debe producir un doble salto vertical, no un dodge");

    await restart();
    const firstDodgeJump = await jump();
    await wait(120);
    const committedDodge = await hold(controllerInput({ steer: 1, accelerate: 1, buttons: [0, 1] }), 90);
    const dodgeTrace = [firstDodgeJump, { waitMs: 120 }, committedDodge];
    await wait(70);
    const dodgeSamples = samples.filter(sample => Number(sample.actionSerials?.dodge || 0) > 0);
    const dodgeDirection = dodgeSamples[0]?.dodgeDirection;
    const rollDodge = summarize("controller-yaw-roll-dodge", dodgeTrace, {
      dodgeSeen: actionSeen("dodge"),
      noDoubleJumpSeen: !actionSeen("doubleJump"),
      directionIsDiagonal: Boolean(dodgeDirection)
        && dodgeDirection.forward > 0
        && dodgeDirection.side > dodgeDirection.forward
        && Math.abs(Math.hypot(dodgeDirection.forward, dodgeDirection.side) - 1) < .01
    });
    rollDodge.control = { dodgeDirection };
    assert.deepEqual(rollDodge.assertions, {
      dodgeSeen: true, noDoubleJumpSeen: true, directionIsDiagonal: true
    }, "RT + stick derecho + B + A debe conservar un dodge diagonal con roll");

    await restart();
    const landingTrace = [await jump(), await hold(controllerInput({ brake: 1 }), 400), await hold(controllerInput({ buttons: [5] }), 300)];
    await waitFor(() => {
      const car = snapshot();
      return car?.grounded && car.jumps === 2;
    }, "aterrizaje con dos saltos recuperados", 3500);
    const landing = summarize("boost-landing", landingTrace, {
      boostSeen: samples.some(sample => sample.boosting),
      landedWithTwoJumps: snapshot().grounded && snapshot().jumps === 2,
      landingObserved: Boolean(snapshot().lastLanding)
    });
    assert.deepEqual(landing.assertions, { boostSeen: true, landedWithTwoJumps: true, landingObserved: true }, "el aterrizaje debe recuperar ambos saltos y publicar su observación");

    report.passed = true;
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    socket?.close();
    server.kill();
  }
}

run().catch(async error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
