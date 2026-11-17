import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyOnlineAccessToken } from "../src/online-jwt-auth.js";

const secret = "0123456789abcdef0123456789abcdef";
const options = { secret, issuer: "https://identity.example.test", audience: "car-soccer-arsenal", nowSeconds: 1_000 };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(header = { alg: "HS256", typ: "JWT" }, payload = {}) {
  const signingInput = `${encode(header)}.${encode({ iss: options.issuer, aud: options.audience, sub: "pilot_7", exp: 1_100, ...payload })}`;
  return `${signingInput}.${createHmac("sha256", secret).update(signingInput).digest("base64url")}`;
}

test("HS256 online access tokens verify a safe subject and optional display name", () => {
  const result = verifyOnlineAccessToken(token(undefined, { name: "María <pilot>" }), options);
  assert.deepEqual(result, { ok: true, subject: "pilot_7", displayName: "María pilot", expiresAt: 1_100, role: "pilot" });
});

test("online JWT exposes only normalized expiry and the signed host role", () => {
  assert.equal(verifyOnlineAccessToken(token(undefined, { role: "host" }), options).role, "host");
  assert.equal(verifyOnlineAccessToken(token(undefined, { role: "administrator" }), options).role, "pilot");
  assert.equal(verifyOnlineAccessToken(token(undefined, { role: { unexpected: true } }), options).role, "pilot");
});

test("online JWT rejection is strict and never echoes token or secret material", () => {
  const secretToken = token();
  const cases = [
    token({ alg: "none" }),
    `${secretToken.slice(0, -1)}x`,
    token(undefined, { exp: 1_000 }),
    token(undefined, { iss: "other" }),
    token(undefined, { aud: "other" }),
    token(undefined, { sub: "../../unsafe" }),
    "not.a.jwt",
  ];
  for (const candidate of cases) {
    const result = verifyOnlineAccessToken(candidate, options);
    assert.deepEqual(result, { ok: false, code: "invalid-token" });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(result), /not\.a\.jwt/);
  }
});
