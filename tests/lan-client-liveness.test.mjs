import assert from "node:assert/strict";
import test from "node:test";
import { createStateLiveness, recordAuthoritativeState, shouldReconnectForStateStall } from "../src/lan-client-liveness.js";

test("client liveness waits for the configured authoritative-state window", () => {
  const liveness = createStateLiveness({ now: 10, timeoutMs: 8 });
  assert.equal(shouldReconnectForStateStall(liveness, 17.999), false);
  assert.equal(shouldReconnectForStateStall(liveness, 18), true);
});

test("client liveness requests only one reconnect for a frozen state stream", () => {
  const liveness = createStateLiveness({ now: 0, timeoutMs: 2 });
  assert.equal(shouldReconnectForStateStall(liveness, 2), true);
  assert.equal(shouldReconnectForStateStall(liveness, 5), false);
});

test("a new authoritative state resets the pending reconnect decision", () => {
  const liveness = createStateLiveness({ now: 0, timeoutMs: 2 });
  assert.equal(shouldReconnectForStateStall(liveness, 2), true);
  recordAuthoritativeState(liveness, 2.2);
  assert.equal(shouldReconnectForStateStall(liveness, 4.1), false);
  assert.equal(shouldReconnectForStateStall(liveness, 4.2), true);
});

test("client liveness rejects invalid clocks and timeouts", () => {
  assert.throws(() => createStateLiveness({ now: -1 }), /non-negative/);
  assert.throws(() => createStateLiveness({ timeoutMs: 0 }), /positive/);
});
