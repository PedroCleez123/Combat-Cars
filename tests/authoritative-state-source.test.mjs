import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoritativeStateSource } from "../src/authoritative-state-source.js";

function buffer() {
  let closed = false;
  let value = null;
  return {
    push(next) { if (closed) throw new Error("closed"); value = next; },
    sample() { return closed ? null : value; },
    close() { closed = true; value = null; },
  };
}

test("authoritative state source publishes only buffered presentation state", () => {
  const source = createAuthoritativeStateSource({ buffer: buffer() });
  const seen = [];
  const unsubscribe = source.subscribe(state => seen.push(state));
  const first = { tick: 1 };
  assert.equal(source.push(first), first);
  assert.deepEqual(seen, [first]);
  assert.equal(source.sample(), first);
  unsubscribe();
  source.close();
  assert.equal(source.closed, true);
  assert.equal(source.sample(), null);
  assert.equal(source.push({ tick: 2 }), null);
});

test("authoritative state source isolates observer failures and cleanup", () => {
  const source = createAuthoritativeStateSource({ buffer: buffer() });
  let second = 0;
  source.subscribe(() => { throw new Error("observer"); });
  source.subscribe(() => { second += 1; });
  assert.doesNotThrow(() => source.push({ tick: 1 }));
  assert.equal(second, 1);
  assert.throws(() => source.subscribe(null), /listener/);
  assert.throws(() => createAuthoritativeStateSource(), /render buffer/);
  source.close();
  source.close();
});
