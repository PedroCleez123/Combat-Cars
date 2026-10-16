import assert from "node:assert/strict";
import test from "node:test";
import { acceptInputSequence, consumeInputAcknowledgement, recordInputTransmission } from "../src/input-ack.js";

test("input acknowledgement accepts only a newer valid sequence", () => {
  assert.equal(acceptInputSequence(4, 5), 5);
  assert.equal(acceptInputSequence(4, 4), 4);
  assert.equal(acceptInputSequence(4, 1), 4);
  assert.equal(acceptInputSequence(4, -1), 4);
  assert.equal(acceptInputSequence(4, Number.NaN), 4);
});

test("input acknowledgement measures a received sequence once and retires confirmed inputs", () => {
  const pending = new Map();
  recordInputTransmission(pending, 1, 10);
  recordInputTransmission(pending, 2, 10.02);
  recordInputTransmission(pending, 3, 10.04);
  const first = consumeInputAcknowledgement(pending, 0, 2, 10.05);
  assert.equal(first.acknowledged, 2);
  assert.ok(Math.abs(first.roundTripMs - 30) < 1e-9);
  assert.deepEqual([...pending.keys()], [3]);
  const repeated = consumeInputAcknowledgement(pending, 2, 2, 10.08);
  assert.deepEqual(repeated, { acknowledged: 2, roundTripMs: null });
});

test("input acknowledgement bounds retained timing samples", () => {
  const pending = new Map();
  for (let sequence = 1; sequence <= 182; sequence += 1) recordInputTransmission(pending, sequence, sequence / 60);
  assert.equal(pending.has(1), false);
  assert.equal(pending.has(182), true);
});
