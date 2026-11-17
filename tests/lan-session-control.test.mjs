import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSessionOwner,
  isSessionOwner,
  LAN_HELLO_TIMEOUT_MS,
  resetPeerInputWindow,
  releaseSessionOwner,
} from "../src/lan-session-control.js";

test("LAN session assigns the first authenticated peer as owner", () => {
  assert.equal(assignSessionOwner(null, "peer-a"), "peer-a");
  assert.equal(assignSessionOwner("peer-a", "peer-b"), "peer-a");
  assert.equal(isSessionOwner("peer-a", "peer-a"), true);
  assert.equal(isSessionOwner("peer-a", "peer-b"), false);
});

test("LAN session releases ownership only when the owner leaves permanently", () => {
  assert.equal(releaseSessionOwner("peer-a", "peer-b"), "peer-a");
  assert.equal(releaseSessionOwner("peer-a", "peer-a"), null);
  assert.equal(LAN_HELLO_TIMEOUT_MS, 5000);
});

test("LAN reconnect resets the input high-water mark for a fresh client counter", () => {
  const peer = { lastInputSequence: 3471, inputWindowStarted: 1, inputCount: 99 };
  assert.equal(resetPeerInputWindow(peer, 5000), peer);
  assert.deepEqual(peer, { lastInputSequence: 0, inputWindowStarted: 5000, inputCount: 0 });
});
