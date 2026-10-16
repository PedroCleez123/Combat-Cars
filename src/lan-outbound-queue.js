function createSendState(socket) {
  return socket.lanSendState || (socket.lanSendState = {
    blocked: false,
    drainBound: false,
    queue: [],
    queuedBytes: 0,
  });
}

function waitForDrain(socket, state) {
  if (state.drainBound || socket.destroyed) return;
  state.drainBound = true;
  socket.once("drain", () => flushWebSocketQueue(socket, state));
}

export function createServerTextFrame(data) {
  const body = Buffer.from(JSON.stringify(data));
  let header;
  if (body.length < 126) header = Buffer.from([0x81, body.length]);
  else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    return null;
  }
  return Buffer.concat([header, body]);
}

export function flushWebSocketQueue(socket, state = socket?.lanSendState) {
  if (!socket || !state || socket.destroyed) return;
  state.drainBound = false;
  state.blocked = false;
  while (!socket.destroyed && state.queue.length) {
    const frame = state.queue.shift();
    state.queuedBytes -= frame.length;
    if (!socket.write(frame)) {
      state.blocked = true;
      waitForDrain(socket, state);
      return;
    }
  }
}

export function sendWebSocketMessage(socket, data, { maxQueuedBytes } = {}) {
  if (!socket || socket.destroyed) return false;
  const frame = createServerTextFrame(data);
  if (!frame) return false;
  const state = createSendState(socket);
  if (state.blocked || state.queue.length) {
    if (!Number.isFinite(maxQueuedBytes) || state.queuedBytes + frame.length > maxQueuedBytes) {
      socket.destroy();
      return false;
    }
    state.queue.push(frame);
    state.queuedBytes += frame.length;
    return true;
  }
  if (!socket.write(frame)) {
    state.blocked = true;
    waitForDrain(socket, state);
  }
  return true;
}
