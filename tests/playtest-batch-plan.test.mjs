import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYTEST_PRIORITY,
  classifyPlaytestPriority,
  createCombatExperiencePlaytestBatch,
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

test("the final R20 batch groups presentation checks without reviving retired practice modes", () => {
  const batch = createCombatExperiencePlaytestBatch({ combatPort: 5300 });
  assert.equal(batch.id, "COMBAT-EXPERIENCE-02");
  assert.equal(batch.priority, PLAYTEST_PRIORITY.P1);
  assert.equal(batch.items[0].url, "http://localhost:5300/?arena=combat-alpha");
  assert.equal(batch.items.find(item => item.id === "first-kill-loading-and-performance").url, "http://localhost:5300/?arena=combat-alpha");
  assert.equal(batch.items.find(item => item.id === "arena-readability-and-pickups").url, "http://localhost:5300/?arena=combat-alpha");
  assert.equal(batch.items.some(item => item.id.startsWith("mob-air-")), false);
  assert.equal(batch.items.some(item => item.url?.includes("5298")), false);
  assert.equal(batch.items.at(-1).id, "audio-and-session-finish");
  assert.equal(batch.items.at(-1).priority, PLAYTEST_PRIORITY.P1);
});

test("the batch plan rejects unsafe endpoint configuration and stays human-readable", () => {
  assert.throws(() => createCombatExperiencePlaytestBatch({ combatPort: 0 }), /combatPort/);
  assert.throws(() => createCombatExperiencePlaytestBatch({ host: "http://localhost" }), /host/);
  const printed = formatPlaytestBatchPlan(createCombatExperiencePlaytestBatch());
  assert.match(printed, /COMBAT-EXPERIENCE-02/);
  assert.match(printed, /first-kill-loading-and-performance/);
  assert.doesNotMatch(printed, /mob-air-diagonal/);
  assert.doesNotMatch(printed, /localhost:5298/);
});
