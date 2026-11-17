import test from "node:test";
import assert from "node:assert/strict";
import { assertOnlineDeploymentPolicy, evaluateOnlineDeploymentPolicy } from "../src/online-deployment-policy.js";

const validOnline = {
  ARSENAL_NETWORK_MODE: "online",
  ARSENAL_ONLINE_TLS_TERMINATED: "true",
  ARSENAL_ONLINE_ADAPTER: "hosted",
  ARSENAL_ONLINE_AUTH: "jwt-hs256",
  ARSENAL_ONLINE_JWT_SECRET: "0123456789abcdef0123456789abcdef",
  ARSENAL_ONLINE_JWT_ISSUER: "https://identity.example.test",
  ARSENAL_ONLINE_JWT_AUDIENCE: "car-soccer-arsenal",
  ARSENAL_ONLINE_ALLOWED_ORIGINS: "https://play.example.test,https://admin.example.test",
  ARSENAL_ONLINE_MAX_ROOMS: "1",
  ARSENAL_ONLINE_MAX_CONNECTIONS: "120",
  ARSENAL_ONLINE_MAX_FRAME_BYTES: "8192",
};

test("LAN remains the default and does not require hosted settings", () => {
  const result = evaluateOnlineDeploymentPolicy({});
  assert.equal(result.ok, true);
  assert.equal(result.code, "lan");
});

test("online mode fails closed when TLS, auth, origins or limits are missing", () => {
  const result = evaluateOnlineDeploymentPolicy({ ARSENAL_NETWORK_MODE: "online" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid-online-config");
  assert.ok(result.diagnostics.some(message => message.includes("TLS")));
  assert.ok(result.diagnostics.some(message => message.includes("AUTH=jwt-hs256")));
  assert.ok(result.diagnostics.some(message => message.includes("allowlist") || message.includes("origen")));
  assert.ok(result.diagnostics.some(message => message.includes("MAX_ROOMS")));
});

test("valid online settings select the hosted single-room adapter", () => {
  const result = evaluateOnlineDeploymentPolicy(validOnline);
  assert.equal(result.ok, false, "a caller still needs to declare that its adapter is wired");
  assert.equal(result.code, "unsupported/no-adapter");
  assert.equal(result.config.maxFrameBytes, 8192);
  assert.deepEqual(result.config.allowedOrigins, ["https://play.example.test", "https://admin.example.test"]);
});

test("online origins are serialized to canonical origins before matching", () => {
  const result = evaluateOnlineDeploymentPolicy({
    ...validOnline,
    ARSENAL_ONLINE_ALLOWED_ORIGINS: "https://play.example.test/, https://play.example.test:443, http://localhost:80/",
  });
  assert.equal(result.code, "unsupported/no-adapter");
  assert.deepEqual(result.config.allowedOrigins, ["https://play.example.test", "http://localhost"]);
});

test("online origins reject userinfo without echoing credentials", () => {
  const result = evaluateOnlineDeploymentPolicy({
    ...validOnline,
    ARSENAL_ONLINE_ALLOWED_ORIGINS: "https://secret:password@play.example.test/",
  });
  assert.equal(result.code, "invalid-online-config");
  assert.match(result.diagnostics.join(" "), /Origen no válido/);
  assert.doesNotMatch(result.diagnostics.join(" "), /password/);
  assert.equal(evaluateOnlineDeploymentPolicy({
    ...validOnline,
    ARSENAL_ONLINE_ALLOWED_ORIGINS: "https://@play.example.test/",
  }).code, "invalid-online-config");
});

test("online origins continue rejecting paths, queries and fragments", () => {
  for (const origin of [
    "https://play.example.test/game",
    "https://play.example.test/?",
    "https://play.example.test/#",
  ]) {
    const result = evaluateOnlineDeploymentPolicy({ ...validOnline, ARSENAL_ONLINE_ALLOWED_ORIGINS: origin });
    assert.equal(result.code, "invalid-online-config", origin);
  }
});

test("the pure policy accepts a future adapter without changing its contract", () => {
  const result = assertOnlineDeploymentPolicy(validOnline, { adapterAvailable: true });
  assert.equal(result.ok, true);
  assert.equal(result.code, "online");
  assert.equal(result.config.maxRooms, 1);
  assert.equal(result.config.adapter, "hosted");
  assert.equal(result.config.auth, "jwt-hs256");
});

test("online requires the exact hosted JWT adapter contract and a one-room limit", () => {
  const result = evaluateOnlineDeploymentPolicy({
    ...validOnline,
    ARSENAL_ONLINE_ADAPTER: "proxy",
    ARSENAL_ONLINE_AUTH: "oidc",
    ARSENAL_ONLINE_JWT_SECRET: "short",
    ARSENAL_ONLINE_MAX_ROOMS: "2",
  }, { adapterAvailable: true });
  assert.equal(result.code, "invalid-online-config");
  assert.match(result.diagnostics.join(" "), /ADAPTER=hosted/);
  assert.match(result.diagnostics.join(" "), /AUTH=jwt-hs256/);
  assert.match(result.diagnostics.join(" "), /al menos 32/);
  assert.match(result.diagnostics.join(" "), /debe ser 1/);
  assert.doesNotMatch(result.diagnostics.join(" "), /short/);
});

test("invalid origin and out-of-range limits are diagnosed", () => {
  const result = evaluateOnlineDeploymentPolicy({
    ...validOnline,
    ARSENAL_ONLINE_ALLOWED_ORIGINS: "file:///tmp",
    ARSENAL_ONLINE_MAX_CONNECTIONS: "0",
    ARSENAL_ONLINE_MAX_FRAME_BYTES: "999999999",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid-online-config");
  assert.ok(result.diagnostics.some(message => message.includes("Origen no válido")));
  assert.ok(result.diagnostics.some(message => message.includes("MAX_CONNECTIONS")));
  assert.ok(result.diagnostics.some(message => message.includes("MAX_FRAME_BYTES")));
});
