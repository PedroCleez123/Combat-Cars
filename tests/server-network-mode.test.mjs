import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(repoRoot, "server.mjs");

function runServer(environment) {
  return spawnSync(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
}

test("online without the deployment contract exits before opening a listener", () => {
  const result = runServer({
    ARSENAL_NETWORK_MODE: "online",
    PORT: "0",
    MOVEMENT_BACKEND: "js",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /\[ONLINE POLICY\]/);
  assert.doesNotMatch(output, /Car Soccer: Arsenal · backend=/);
  assert.doesNotMatch(output, /unsupported\/no-adapter/);
});

test("an invalid hosted online contract exits before match construction or listener startup", () => {
  const result = runServer({
    ARSENAL_NETWORK_MODE: "online",
    ARSENAL_ONLINE_TLS_TERMINATED: "true",
    ARSENAL_ONLINE_ADAPTER: "hosted",
    ARSENAL_ONLINE_AUTH: "jwt-hs256",
    ARSENAL_ONLINE_JWT_SECRET: "0123456789abcdef0123456789abcdef",
    ARSENAL_ONLINE_JWT_ISSUER: "https://identity.example.test",
    ARSENAL_ONLINE_JWT_AUDIENCE: "car-soccer-arsenal",
    ARSENAL_ONLINE_ALLOWED_ORIGINS: "https://play.example.test",
    ARSENAL_ONLINE_MAX_ROOMS: "2",
    ARSENAL_ONLINE_MAX_CONNECTIONS: "100",
    ARSENAL_ONLINE_MAX_FRAME_BYTES: "8192",
    PORT: "0",
    MOVEMENT_BACKEND: "rocketsim",
    // If policy ran after match construction this would report a bridge path
    // error. The sentinel keeps this test independent of a native build and
    // proves the process exits on policy before bridge startup/listen.
    ROCKETSIM_BRIDGE_EXE: "C:\\sentinel\\missing-rocketsim-bridge.exe",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /ARSENAL_ONLINE_MAX_ROOMS debe ser 1/);
  assert.doesNotMatch(output, /requiere ROCKETSIM_BRIDGE_EXE válido/);
  assert.doesNotMatch(output, /Car Soccer: Arsenal · backend=/);
});
