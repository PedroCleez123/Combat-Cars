import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateOnlineDeploymentReadiness,
  serializeOnlineDeploymentReadiness,
} from "../tools/online-deployment-readiness.mjs";

const validOnline = {
  ARSENAL_NETWORK_MODE: "online",
  ARSENAL_ONLINE_TLS_TERMINATED: "true",
  ARSENAL_ONLINE_ADAPTER: "hosted",
  ARSENAL_ONLINE_AUTH: "jwt-hs256",
  ARSENAL_ONLINE_JWT_SECRET: "REPLACE_ME_WITH_A_RANDOM_SECRET_OF_32_CHARS_MIN",
  ARSENAL_ONLINE_JWT_ISSUER: "https://identity.example.test",
  ARSENAL_ONLINE_JWT_AUDIENCE: "car-soccer-arsenal",
  ARSENAL_ONLINE_ALLOWED_ORIGINS: "https://play.example.test,https://admin.example.test",
  ARSENAL_ONLINE_MAX_ROOMS: "1",
  ARSENAL_ONLINE_MAX_CONNECTIONS: "120",
  ARSENAL_ONLINE_MAX_FRAME_BYTES: "8192",
  ARSENAL_PUBLIC_ORIGIN: "https://play.example.test",
};

test("LAN returns not-ready with a clear online-mode diagnostic", () => {
  const result = evaluateOnlineDeploymentReadiness({});
  assert.equal(result.status, "not-ready");
  assert.equal(result.mode, "lan");
  assert.equal(result.code, "online-mode-required");
  assert.match(result.diagnostics.join(" "), /modo LAN/);
});

test("valid hosted policy and exactly allowlisted HTTPS origin return ready", () => {
  const result = evaluateOnlineDeploymentReadiness(validOnline);
  assert.equal(result.status, "ready");
  assert.equal(result.mode, "online");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.checks.every(check => check.status === "pass"));
});

test("public origin must be HTTPS, canonical, and exactly allowlisted", async t => {
  const cases = [
    ["HTTP is rejected", "http://play.example.test", /HTTPS canónico/],
    ["non-canonical path is rejected", "https://play.example.test/", /HTTPS canónico/],
    ["case-normalized URL is rejected", "https://PLAY.example.test", /HTTPS canónico/],
    ["non-allowlisted HTTPS origin is rejected", "https://other.example.test", /coincidir exactamente/],
  ];

  for (const [name, origin, diagnostic] of cases) {
    await t.test(name, () => {
      const result = evaluateOnlineDeploymentReadiness({
        ...validOnline,
        ARSENAL_PUBLIC_ORIGIN: origin,
      });
      assert.equal(result.status, "not-ready");
      assert.match(result.diagnostics.join(" "), diagnostic);
    });
  }
});

test("serialized JSON never contains the JWT secret or access token", () => {
  const secret = "highly-sensitive-secret-value-never-log-0123456789";
  const token = "eyJhbGciOiJIUzI1NiJ9.private.jwt-signature";
  const json = serializeOnlineDeploymentReadiness({
    ...validOnline,
    ARSENAL_ONLINE_JWT_SECRET: secret,
    ARSENAL_ACCESS_TOKEN: token,
  });

  assert.equal(JSON.parse(json).status, "ready");
  assert.ok(!json.includes(secret));
  assert.ok(!json.includes(token));
  assert.ok(!json.includes("ARSENAL_ONLINE_JWT_SECRET"));
  assert.ok(!json.includes("ARSENAL_ACCESS_TOKEN"));
});
