import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";

const debug = process.env.DEBUG_LOCAL_WS === "1";

function clientFrame(text, opcode = 1) {
  const payload = Buffer.from(String(text));
  if (payload.length > 0xffff) throw new RangeError("El frame de prueba excede 65535 bytes");
  const mask = randomBytes(4);
  const header = payload.length < 126
    ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
    : Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

function parseServerFrames(buffer, emit) {
  let pending = buffer;
  while (pending.length >= 2) {
    const first = pending[0];
    const second = pending[1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (pending.length < 4) break;
      length = pending.readUInt16BE(2);
      offset = 4;
    }
    if (length === 127) throw new Error("El servidor emitió un frame WebSocket demasiado grande");
    if (pending.length < offset + length) break;
    const payload = pending.subarray(offset, offset + length);
    pending = pending.subarray(offset + length);
    if (opcode === 1) emit("message", payload.toString("utf8"));
    else if (opcode === 8) emit("server-close", payload);
    else if (opcode === 9) emit("ping", payload);
  }
  return pending;
}

/**
 * Small localhost-only WebSocket client for test harnesses. It is intentionally
 * limited to the application's text frames, avoiding browser focus, Gamepad
 * API and the global undici WebSocket lifecycle in host automation.
 */
export async function connectLocalWebSocket({ host = "127.0.0.1", port, timeoutMs = 5_000, origin = null } = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Puerto WebSocket inválido");
  const socket = createConnection({ host, port });
  const client = new EventEmitter();
  // Keep connection failures observable without allowing an unhandled EventEmitter
  // error to terminate a probe before its caller can attach diagnostics.
  client.on("error", () => {});
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  let settled = false;
  let timeout;

  const fail = error => {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      client.emit("error", error);
    }
  };
  const ready = new Promise((resolveReady, rejectReady) => {
    timeout = setTimeout(() => {
      const error = new Error(`Timeout abriendo WebSocket en ${host}:${port}`);
      fail(error);
      rejectReady(error);
      socket.destroy();
    }, timeoutMs);
    socket.once("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write([
        "GET / HTTP/1.1",
        `Host: ${host}:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...(typeof origin === "string" ? [`Origin: ${origin}`] : []),
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", chunk => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        if (!upgraded) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd < 0) return;
          const header = buffer.subarray(0, headerEnd).toString("ascii");
          if (!/^HTTP\/1\.1 101\b/m.test(header)) throw new Error(`Upgrade WebSocket rechazado: ${header.split("\r\n")[0] || "respuesta vacía"}`);
          upgraded = true;
          buffer = buffer.subarray(headerEnd + 4);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolveReady(client);
          }
          // Give the caller a microtask to subscribe before processing a state
          // frame coalesced with the upgrade response.
          queueMicrotask(() => {
            try { buffer = parseServerFrames(buffer, client.emit.bind(client)); } catch (error) { client.emit("error", error); socket.destroy(); }
          });
          return;
        }
        buffer = parseServerFrames(buffer, client.emit.bind(client));
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          rejectReady(error);
        }
        client.emit("error", error);
        socket.destroy();
      }
    });
    socket.once("error", error => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        rejectReady(error);
      }
      client.emit("error", error);
    });
    socket.once("close", hadError => {
      clearTimeout(timeout);
      client.open = false;
      client.emit("close", { hadError });
    });
  });

  client.open = true;
  client.send = value => {
    if (!client.open || socket.destroyed) throw new Error("WebSocket de prueba no está abierto");
    const frame = clientFrame(value);
    if (debug) console.error("[LOCAL-WS] send", frame.length, frame.subarray(0, Math.min(12, frame.length)).toString("hex"), String(value).slice(0, 80));
    socket.write(frame);
  };
  client.close = () => {
    if (!client.open || socket.destroyed) return;
    try { socket.write(clientFrame("", 8)); } finally { socket.end(); }
  };
  client.on("ping", payload => { if (client.open && !socket.destroyed) socket.write(clientFrame(payload, 10)); });
  return ready;
}
