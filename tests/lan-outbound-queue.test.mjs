import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { sendWebSocketMessage } from "../src/lan-outbound-queue.js";

class FakeSocket extends EventEmitter {
  constructor(writeResults = []) {
    super();
    this.destroyed = false;
    this.frames = [];
    this.writeResults = writeResults;
  }

  write(frame) {
    this.frames.push(frame);
    return this.writeResults.shift() ?? true;
  }

  destroy() {
    this.destroyed = true;
  }
}

test("slow WebSocket queues messages until the socket drains", () => {
  const socket = new FakeSocket([false, true]);
  assert.equal(sendWebSocketMessage(socket, { type: "state", tick: 1 }, { maxQueuedBytes: 1024 }), true);
  assert.equal(socket.lanSendState.blocked, true);

  assert.equal(sendWebSocketMessage(socket, { type: "state", tick: 2 }, { maxQueuedBytes: 1024 }), true);
  assert.equal(socket.lanSendState.queue.length, 1);
  assert.ok(socket.lanSendState.queuedBytes > 0);

  socket.emit("drain");
  assert.equal(socket.frames.length, 2);
  assert.equal(socket.lanSendState.blocked, false);
  assert.equal(socket.lanSendState.queue.length, 0);
  assert.equal(socket.lanSendState.queuedBytes, 0);
});

test("slow WebSocket is closed when its bounded queue overflows", () => {
  const socket = new FakeSocket([false]);
  sendWebSocketMessage(socket, { type: "state", tick: 1 }, { maxQueuedBytes: 1 });
  assert.equal(sendWebSocketMessage(socket, { type: "state", tick: 2 }, { maxQueuedBytes: 1 }), false);
  assert.equal(socket.destroyed, true);
});
