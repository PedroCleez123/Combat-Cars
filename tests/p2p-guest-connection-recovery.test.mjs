import assert from "node:assert/strict";
import test from "node:test";

import {
  P2P_GUEST_RECONNECT_DELAYS_MS,
  P2P_HOST_PROMOTION_GRACE_MS,
  createP2PHostSlotRecovery,
  createP2PGuestConnectionRecovery,
} from "../src/p2p-guest-connection-recovery.js";

function timers() {
  let next = 0;
  const pending = new Map();
  return {
    setTimeoutFn(callback, delay) { const id = ++next; pending.set(id, { callback, delay }); return id; },
    clearTimeoutFn(id) { pending.delete(id); },
    runOne() { const [id, timer] = pending.entries().next().value || []; if (id !== undefined) { pending.delete(id); timer.callback(); return timer.delay; } return null; },
    count() { return pending.size; },
  };
}

test("guest recovery bounds retries and resets only after a direct channel opens", () => {
  const clock = timers(); const retries = []; const exhausted = [];
  const recovery = createP2PGuestConnectionRecovery({ ...clock, onRetry: event => retries.push(event), onExhausted: event => exhausted.push(event) });
  assert.equal(recovery.scheduleRetry({ reason: "signal-error" }), true);
  assert.equal(recovery.scheduleRetry({ reason: "duplicate" }), false);
  assert.equal(clock.runOne(), P2P_GUEST_RECONNECT_DELAYS_MS[0]);
  assert.deepEqual(retries, [{ attempt: 1, delayMs: P2P_GUEST_RECONNECT_DELAYS_MS[0], reason: "signal-error" }]);
  assert.equal(recovery.scheduleRetry(), true); clock.runOne();
  assert.equal(recovery.scheduleRetry(), true); clock.runOne();
  assert.equal(recovery.scheduleRetry(), false);
  assert.deepEqual(exhausted, [{ attempts: P2P_GUEST_RECONNECT_DELAYS_MS.length, reason: "transport" }]);
  recovery.connected();
  assert.equal(recovery.scheduleRetry(), true);
  assert.equal(recovery.snapshot().attempts, 1);
});

test("guest recovery waits for host promotion before retrying and cancels it when elected", () => {
  const clock = timers(); const awaiting = []; const retries = [];
  const recovery = createP2PGuestConnectionRecovery({ ...clock, onAwaitingPromotion: event => awaiting.push(event), onRetry: event => retries.push(event) });
  assert.equal(recovery.awaitHostPromotion(), true);
  assert.deepEqual(awaiting, [{ reason: "peer-left", delayMs: P2P_HOST_PROMOTION_GRACE_MS }]);
  recovery.promotionObserved();
  assert.equal(clock.count(), 0);
  assert.equal(retries.length, 0);
  assert.equal(recovery.awaitHostPromotion({ reason: "channel-closed" }), true);
  assert.equal(clock.runOne(), P2P_HOST_PROMOTION_GRACE_MS);
  assert.equal(clock.runOne(), P2P_GUEST_RECONNECT_DELAYS_MS[0]);
  assert.equal(retries[0].reason, "promotion-timeout");
});

test("host slot recovery neutralizes and replaces a departed combat peer once", () => {
  const calls = [];
  const recovery = createP2PHostSlotRecovery({
    onNeutralize: slot => calls.push(["neutralize", slot]),
    onReplace: slot => calls.push(["replace", slot]),
  });

  assert.equal(recovery.begin(2), true);
  assert.equal(recovery.begin(2), false);
  assert.deepEqual(calls, [["neutralize", 2], ["replace", 2]]);
  assert.equal(recovery.isPending(2), true);
  assert.equal(recovery.reconnected(2), true);
  assert.equal(recovery.reconnected(2), false);
  assert.equal(recovery.begin(2), true);
  assert.deepEqual(calls, [["neutralize", 2], ["replace", 2], ["neutralize", 2], ["replace", 2]]);
  assert.equal(recovery.begin(0), false);
  assert.equal(recovery.begin(6), false);
});
