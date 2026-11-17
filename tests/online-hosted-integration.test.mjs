import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import test from "node:test";
import { connectLocalWebSocket } from "../tools/local-websocket-client.mjs";

const root = new URL("..", import.meta.url);
const secret = "0123456789abcdef0123456789abcdef";
const issuer = "https://identity.example.test";
const audience = "car-soccer-arsenal";
const origin = "https://play.example.test";
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function makeToken({ subject = "pilot_1", role, expiresInSeconds = 20 } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: audience, sub: subject, exp: Math.floor(Date.now() / 1000) + expiresInSeconds, ...(role === undefined ? {} : { role }) })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${createHmac("sha256", secret).update(signingInput).digest("base64url")}`;
}

function hello(token, sessionId = "online-session") {
  return JSON.stringify({ type: "hello", protocolVersion: 1, roomId: "local", sessionId, name: "Untrusted name", ...(token ? { accessToken: token } : {}) });
}

function nextMessage(socket, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No llegó ${label}.`)), 3_000);
    const listener = raw => {
      const message = JSON.parse(raw);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

async function expectUpgradeRejection(options) {
  await assert.rejects(() => connectLocalWebSocket(options), /Upgrade WebSocket rechazado|ECONNREFUSED|EACCES/);
}

test("hosted online binds loopback, validates Origin and JWT, bounds active sockets, roles and expiry", async t => {
  const port = 5600 + (process.pid % 300);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      MOVEMENT_BACKEND: "js",
      ARENA_PROFILE: "scrapyard",
      VEHICLE_LIMIT: "2",
      ARSENAL_NETWORK_MODE: "online",
      ARSENAL_ONLINE_TLS_TERMINATED: "true",
      ARSENAL_ONLINE_ADAPTER: "hosted",
      ARSENAL_ONLINE_AUTH: "jwt-hs256",
      ARSENAL_ONLINE_JWT_SECRET: secret,
      ARSENAL_ONLINE_JWT_ISSUER: issuer,
      ARSENAL_ONLINE_JWT_AUDIENCE: audience,
      ARSENAL_ONLINE_ALLOWED_ORIGINS: origin,
      ARSENAL_ONLINE_MAX_ROOMS: "1",
      ARSENAL_ONLINE_MAX_CONNECTIONS: "1",
      ARSENAL_ONLINE_MAX_FRAME_BYTES: "8192",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  const sockets = [];
  try {
    const deadline = Date.now() + 5_000;
    while (!output.includes(`http://localhost:${port}`) && child.exitCode === null && Date.now() < deadline) await wait(20);
    if (child.exitCode !== null && /EACCES|listen/i.test(output)) {
      t.skip("El sandbox bloquea el listener loopback online de la integración.");
      return;
    }
    assert.ok(output.includes(`http://localhost:${port}`), output);

    let preflight;
    try {
      // Prove this sandbox can actually reach the loopback listener before
      // treating 403 rejections as online adapter evidence.
      preflight = await connectLocalWebSocket({ port, origin });
      sockets.push(preflight);
    } catch (error) {
      if (error?.code === "EACCES") {
        t.skip("El sandbox permite el listener, pero bloquea la conexión loopback online.");
        return;
      }
      throw error;
    }
    preflight.close();
    await wait(40);
    await expectUpgradeRejection({ port });
    await expectUpgradeRejection({ port, origin: "https://wrong.example.test" });

    const missing = await connectLocalWebSocket({ port, origin }); sockets.push(missing);
    const missingError = nextMessage(missing, message => message.type === "error", "error de token ausente");
    missing.send(hello(null));
    assert.equal((await missingError).code, "online-access-token-required");
    missing.close();

    const bad = await connectLocalWebSocket({ port, origin }); sockets.push(bad);
    const badError = nextMessage(bad, message => message.type === "error", "error de token inválido");
    bad.send(hello("not.a.jwt"));
    assert.equal((await badError).code, "online-access-token-invalid");
    bad.close();

    const first = await connectLocalWebSocket({ port, origin }); sockets.push(first);
    const firstWelcome = nextMessage(first, message => message.type === "welcome", "welcome de piloto");
    first.send(hello(makeToken({ subject: "pilot_reconnect" }), "first-session"));
    assert.equal((await firstWelcome).owner, false, "un piloto online no se convierte en host por llegar primero");
    await assert.rejects(() => connectLocalWebSocket({ port, origin }), /Upgrade WebSocket rechazado/);
    first.close();
    await wait(80);

    const reconnected = await connectLocalWebSocket({ port, origin }); sockets.push(reconnected);
    const reconnectWelcome = nextMessage(reconnected, message => message.type === "welcome", "welcome de reconexión");
    reconnected.send(hello(makeToken({ subject: "pilot_reconnect" }), "new-session"));
    assert.equal((await reconnectWelcome).owner, false, "la reserva desconectada no consume el cupo de sockets activos");
    reconnected.close();
    await wait(80);

    const host = await connectLocalWebSocket({ port, origin }); sockets.push(host);
    const hostWelcome = nextMessage(host, message => message.type === "welcome", "welcome de host");
    host.send(hello(makeToken({ subject: "host_1", role: "host", expiresInSeconds: 2 }), "host-session"));
    assert.equal((await hostWelcome).owner, true);
    await new Promise(resolve => host.once("close", resolve));

    const pilotAfterHost = await connectLocalWebSocket({ port, origin }); sockets.push(pilotAfterHost);
    const pilotAfterHostWelcome = nextMessage(pilotAfterHost, message => message.type === "welcome", "welcome de piloto tras expirar host");
    pilotAfterHost.send(hello(makeToken({ subject: "pilot_reconnect" }), "pilot-after-host"));
    assert.equal((await pilotAfterHostWelcome).owner, false, "la expiración del host no transfiere autoridad a un piloto");
    pilotAfterHost.close();
    await wait(80);

    const expired = await connectLocalWebSocket({ port, origin }); sockets.push(expired);
    const expiredError = nextMessage(expired, message => message.type === "error", "rechazo de token vencido");
    expired.send(hello(makeToken({ subject: "host_1", role: "host", expiresInSeconds: -1 }), "expired-session"));
    assert.equal((await expiredError).code, "online-access-token-invalid");
    expired.close();

    const fresh = await connectLocalWebSocket({ port, origin }); sockets.push(fresh);
    const freshWelcome = nextMessage(fresh, message => message.type === "welcome", "welcome con token nuevo");
    fresh.send(hello(makeToken({ subject: "host_1", role: "host" }), "fresh-session"));
    assert.equal((await freshWelcome).owner, true, "un host expirado sólo puede volver con un token válido nuevo");
  } finally {
    for (const socket of sockets) socket.close();
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
});
