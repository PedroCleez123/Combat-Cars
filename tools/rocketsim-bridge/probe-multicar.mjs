import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { RocketSimBridge } from "../../src/rocketsim-backend.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = process.env.ROCKETSIM_BRIDGE_EXE;
const reportPath = resolve(root, "docs", "reference-captures", "rocketsim-multicar-r8-01.json");
if (!executable) throw new Error("ROCKETSIM_BRIDGE_EXE es obligatorio para la sonda R8-01");

const cars = [{ id: 1, team: "blue" }, { id: 2, team: "red" }];

async function verifyNativeRejections() {
  const process = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
  const next = () => new Promise((resolveLine, rejectLine) => {
    const timer = setTimeout(() => rejectLine(new Error("Timeout de protocolo nativo R8-01")), 1500);
    lines.once("line", line => { clearTimeout(timer); resolveLine(JSON.parse(line)); });
    process.once("error", error => { clearTimeout(timer); rejectLine(error); });
  });
  const exchange = async frame => {
    const response = next();
    process.stdin.write(`${JSON.stringify(frame)}\n`);
    return response;
  };
  try {
    const duplicateInit = await exchange({ type: "init", schemaVersion: 1, fixedStepHz: 120, arena: "arsenal-practice", cars: [{ id: 1, team: "blue" }, { id: 1, team: "red" }] });
    const ready = await exchange({ type: "init", schemaVersion: 1, fixedStepHz: 120, arena: "arsenal-practice", cars });
    const duplicateTick = await exchange({ type: "tick", tick: 1, cars: [{ id: 1, input: {} }, { id: 1, input: {} }] });
    const stopped = await exchange({ type: "shutdown" });
    return {
      duplicateInitRejected: duplicateInit.type === "error",
      readyAfterRejection: ready.type === "ready" && ready.cars?.length === 2,
      duplicateTickRejected: duplicateTick.type === "error",
      stopped: stopped.type === "stopped",
    };
  } finally {
    lines.close();
    process.stdin.end();
    if (!process.killed) process.kill();
  }
}

const bridge = new RocketSimBridge({ executable });
try {
  const ready = await bridge.start({ arena: "arsenal-practice", cars });
  let first = null;
  let final = null;
  for (let tick = 1; tick <= 180; tick += 1) {
    const frame = await bridge.tick(tick, [
      { id: 2, input: { throttle: -1, steer: .25, jump: false, boost: false, drift: false, airRoll: false, roll: 0 } },
      { id: 1, input: { throttle: 1, steer: -.25, jump: false, boost: false, drift: false, airRoll: false, roll: 0 } },
    ]);
    assert.deepEqual(frame.cars.map(car => car.id).sort((a, b) => a - b), [1, 2]);
    if (tick === 1) first = frame;
    final = frame;
  }
  const firstById = new Map(first.cars.map(car => [car.id, car]));
  const finalById = new Map(final.cars.map(car => [car.id, car]));
  const nativeValidation = await verifyNativeRejections();
  const report = {
    schemaVersion: 1,
    profile: "arsenal-practice",
    fixedStepHz: ready.fixedStepHz,
    cars: ready.cars,
    ticks: 180,
    initial: [...firstById.entries()].map(([id, car]) => ({ id, position: car.position, velocity: car.velocity })),
    final: [...finalById.entries()].map(([id, car]) => ({ id, position: car.position, velocity: car.velocity })),
    assertions: {
      readyHasTwoCars: ready.cars.length === 2,
      stableIds: ready.cars.map(car => car.id).sort((a, b) => a - b).join(",") === "1,2",
      independentThrottle: finalById.get(1).velocity.x > 0 && finalById.get(2).velocity.x < 0,
      statesRemainDistinct: finalById.get(1).position.x !== finalById.get(2).position.x,
      duplicateInitRejected: nativeValidation.duplicateInitRejected,
      nativeRecoveredAfterRejection: nativeValidation.readyAfterRejection && nativeValidation.stopped,
      duplicateTickRejected: nativeValidation.duplicateTickRejected,
    },
  };
  for (const [name, passed] of Object.entries(report.assertions)) assert.equal(passed, true, name);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await bridge.shutdown();
}
