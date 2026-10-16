import assert from "node:assert/strict";
import test from "node:test";

import {
  assignSessionOwner,
  isSessionOwner,
  LAN_HELLO_TIMEOUT_MS,
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
