import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYTEST_PRIORITY,
  classifyPlaytestPriority,
  createR19WebPlaytestBatch,
  formatPlaytestBatchPlan,
} from "../src/playtest-batch-plan.js";

test("only player-facing regressions request an immediate in-game test", () => {
  const grouped = classifyPlaytestPriority({});
  assert.equal(grouped.priority, PLAYTEST_PRIORITY.P1);
  assert.equal(grouped.execution, "group-with-next-batch");

  const immediate = classifyPlaytestPriority({ cannotControlVehicle: true });
  assert.equal(immediate.priority, PLAYTEST_PRIORITY.P0);
  assert.equal(immediate.execution, "immediate");
  assert.match(immediate.reasons[0], /no puede controlar/);
});

test("the R19 batch groups visual and aerial checks but isolates destructive liveness", () => {
  const batch = createR19WebPlaytestBatch({ combatPort: 5300, practicePort: 5298 });
  assert.equal(batch.id, "PLAYTEST-BATCH-01");
  assert.equal(batch.priority, PLAYTEST_PRIORITY.P1);
  assert.equal(batch.items[0].url, "http://localhost:5300/?arena=combat-alpha");
  assert.match(batch.items.find(item => item.id === "hitbox-visual").url, /hitbox01=1/);
  assert.match(batch.items.find(item => item.id === "mob-air-side").url, /dodge=side/);
  assert.equal(batch.items.at(-1).id, "liveness-controlled-stall");
  assert.equal(batch.items.at(-1).priority, PLAYTEST_PRIORITY.P2);
  assert.equal(batch.items.at(-1).url, null);
});

test("the batch plan rejects unsafe endpoint configuration and stays human-readable", () => {
  assert.throws(() => createR19WebPlaytestBatch({ combatPort: 0 }), /combatPort/);
  assert.throws(() => createR19WebPlaytestBatch({ host: "http://localhost" }), /host/);
  const printed = formatPlaytestBatchPlan(createR19WebPlaytestBatch());
  assert.match(printed, /PLAYTEST-BATCH-01/);
  assert.match(printed, /mob-air-diagonal/);
  assert.match(printed, /localhost:5298/);
});
