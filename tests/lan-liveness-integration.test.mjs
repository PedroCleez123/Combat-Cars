import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { connectLocalWebSocket } from "../tools/local-websocket-client.mjs";
import { createStateLiveness, recordAuthoritativeState, shouldReconnectForStateStall } from "../src/lan-client-liveness.js";

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function serverFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length >= 126) throw new RangeError("El frame de integración debe ser corto");
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

async function listenServer(server) {
  try {
    await new Promise((resolve, reject) => {
      const onError = error => { server.off("listening", resolve); reject(error); };
      server.once("error", onError);
      server.once("listening", () => { server.off("error", onError); resolve(); });
      server.listen(0, "127.0.0.1");
    });
  } catch (error) {
    if (error?.code === "EACCES") return false;
    throw error;
  }
  return true;
}

test("LIVENESS-01 detecta stream detenido, ignora heartbeat y recupera un estado", async t => {
  const server = createServer();
  const sockets = new Set();
  let connections = 0;
  let heartbeatCount = 0;
  const timers = new Set();
  server.on("upgrade", request => {
    const socket = request.socket;
    const key = request.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    const connection = ++connections;
    const schedule = (callback, milliseconds) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, milliseconds);
      timers.add(timer);
    };
    schedule(() => {
      socket.write(serverFrame({ type: "welcome", id: `pilot-${connection}`, roomId: "local" }));
      socket.write(serverFrame({ type: "state", state: { time: connection, cars: [] } }));
      if (connection === 1) {
        socket.write(serverFrame({ type: "state", state: { time: connection + 0.05, cars: [] } }));
        const heartbeatTimer = setInterval(() => {
          if (socket.destroyed) { clearInterval(heartbeatTimer); return; }
          heartbeatCount += 1;
          socket.write(serverFrame({ type: "heartbeat" }));
        }, 12);
        socket.once("close", () => clearInterval(heartbeatTimer));
      }
    }, 10);
    socket.once("close", () => sockets.delete(socket));
    socket.once("error", () => sockets.delete(socket));
  });

  const listening = await listenServer(server);
  if (!listening) {
    t.skip("El sandbox bloquea el listener loopback de la integración.");
    return;
  }
  const port = server.address().port;
  let first = null;
  let second = null;
  try {
    try {
      first = await connectLocalWebSocket({ port });
    } catch (error) {
      if (error?.code === "EACCES") {
        t.skip("El sandbox permite escuchar, pero bloquea la conexión loopback de la integración.");
        return;
      }
      throw error;
    }
    const liveness = createStateLiveness({ now: performance.now(), timeoutMs: 70 });
    let stateCount = 0;
    first.on("message", raw => {
      const message = JSON.parse(raw);
      if (message.type === "state") {
        stateCount += 1;
        recordAuthoritativeState(liveness, performance.now());
      }
    });
    first.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "liveness-integration", name: "LIVENESS" }));
    await wait(100);
    assert.ok(stateCount >= 2, "el transporte debe entregar estados iniciales");
    assert.ok(heartbeatCount >= 1, "el servidor de prueba debe enviar heartbeats");
    await wait(85);
    assert.equal(shouldReconnectForStateStall(liveness, performance.now()), true);
    assert.equal(shouldReconnectForStateStall(liveness, performance.now() + 500), false);
    first.close();

    second = await connectLocalWebSocket({ port });
    const recovered = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No llegó un estado tras reconectar.")), 500);
      second.on("message", raw => {
        const message = JSON.parse(raw);
        if (message.type !== "state") return;
        clearTimeout(timer);
        recordAuthoritativeState(liveness, performance.now());
        resolve();
      });
      second.on("error", reject);
    });
    second.send(JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId: "liveness-integration", name: "LIVENESS" }));
    await recovered;
    assert.equal(shouldReconnectForStateStall(liveness, performance.now()), false);
    assert.equal(connections, 2);
  } finally {
    first?.close();
    second?.close();
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
