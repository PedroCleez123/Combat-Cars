import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { connectLocalWebSocket } from "../tools/local-websocket-client.mjs";

const root = new URL("..", import.meta.url);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("LAN accepts an extended WebSocket payload whose decoded length is exactly 127 bytes", async t => {
  const port = 5360 + (process.pid % 100);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MOVEMENT_BACKEND: "js", ARENA_PROFILE: "calibration", VEHICLE_LIMIT: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  let socket;
  try {
    const deadline = Date.now() + 5_000;
    while (!output.includes(`http://localhost:${port}`) && Date.now() < deadline) await wait(20);
    assert.ok(output.includes(`http://localhost:${port}`), output);
    try {
      socket = await connectLocalWebSocket({ port });
    } catch (error) {
      if (error?.code === "EACCES") {
        t.skip("El sandbox permite iniciar el listener, pero bloquea la conexión loopback.");
        return;
      }
      throw error;
    }
    const hello = { type: "hello", protocolVersion: 1, roomId: "local", sessionId: "frame-boundary-", name: "FRAME-BOUNDARY" };
    while (Buffer.byteLength(JSON.stringify(hello)) < 127) hello.sessionId += "x";
    assert.equal(Buffer.byteLength(JSON.stringify(hello)), 127);
    const welcome = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No se recibió welcome para el frame de 127 bytes.")), 3_000);
      socket.on("message", data => {
        const message = JSON.parse(data);
        if (message.type === "welcome") { clearTimeout(timer); resolve(message); }
      });
      socket.on("error", reject);
    });
    socket.send(JSON.stringify(hello));
    const message = await welcome;
    assert.equal(message.protocolVersion, 1);
    assert.equal(message.roomId, "local");
  } finally {
    socket?.close();
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
});
