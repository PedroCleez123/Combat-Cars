import assert from "node:assert/strict";
import test from "node:test";

import {
  P2PWasmHostClock,
  P2P_WASM_HOST_CLOCK_MAX_STEPS_PER_WAKE,
} from "../tools/wasm-spike/p2p-wasm-host-clock.mjs";

function manualScheduler() {
  let nextId = 0;
  const timers = new Map();
  return {
    setInterval(callback, interval) {
      const id = ++nextId;
      timers.set(id, { callback, interval });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    fireAll() {
      for (const { callback } of [...timers.values()]) callback();
    },
    get size() { return timers.size; },
    get interval() { return [...timers.values()][0]?.interval; },
  };
}

function fakeHost() {
  return {
    ticks: 0,
    advance() { this.ticks += 1; return { tick: this.ticks }; },
  };
}

test("P2P-WASM-38 starts with one tick, then advances exactly one fixed tick per wake", () => {
  const scheduler = manualScheduler();
  const host = fakeHost();
  const snapshots = [];
  const clock = new P2PWasmHostClock({
    host,
    scheduler,
    onSnapshot: snapshot => snapshots.push(snapshot.tick),
  });

  const started = clock.start();
  assert.equal(started.accepted, true);
  assert.equal(host.ticks, 1, "the first accepted input is primed immediately");
  assert.deepEqual(snapshots, [1]);
  assert.equal(scheduler.size, 1);
  assert.equal(scheduler.interval, 1000 / 60);

  scheduler.fireAll();
  scheduler.fireAll();
  assert.equal(host.ticks, 3, "two scheduler wakes produce two, not an unbounded catch-up burst, ticks");
  assert.deepEqual(snapshots, [1, 2, 3]);
  assert.equal(clock.diagnostics().maxStepsPerWake, P2P_WASM_HOST_CLOCK_MAX_STEPS_PER_WAKE);
  assert.equal(clock.diagnostics().lastHostTick, 3);

  clock.close();
  assert.equal(scheduler.size, 0);
  scheduler.fireAll();
  assert.equal(host.ticks, 3, "closing the room stops the simulation clock");
});

test("P2P-WASM-38 reports a host failure and stops scheduling", () => {
  const scheduler = manualScheduler();
  const errors = [];
  const host = {
    ticks: 0,
    advance() {
      this.ticks += 1;
      if (this.ticks === 2) throw new Error("synthetic host failure");
      return { tick: this.ticks };
    },
  };
  const clock = new P2PWasmHostClock({
    host,
    scheduler,
    onError: error => errors.push(error),
  });
  assert.equal(clock.start().accepted, true);
  assert.equal(scheduler.size, 1);
  const wake = clock.wake();
  assert.equal(wake.accepted, false);
  assert.equal(scheduler.size, 0);
  assert.equal(clock.running, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "host-clock-failed");
  assert.match(errors[0].message, /synthetic host failure/);
});

test("P2P-WASM-39 rejects a host snapshot that does not advance its authoritative tick", () => {
  const scheduler = manualScheduler();
  const clock = new P2PWasmHostClock({
    host: { advance() { return { tick: 1 }; } },
    scheduler,
  });
  assert.equal(clock.start().accepted, true);
  const wake = clock.wake();
  assert.equal(wake.accepted, false);
  assert.match(wake.reason, /tick no estrictamente creciente/);
  assert.equal(scheduler.size, 0);
});

test("P2P-WASM-38 validates an explicit fixed-rate scheduler contract", () => {
  assert.throws(() => new P2PWasmHostClock({ host: fakeHost(), scheduler: {} }), /setInterval\/clearInterval/);
  assert.throws(() => new P2PWasmHostClock({ host: {}, scheduler: manualScheduler() }), /advance/);
});

