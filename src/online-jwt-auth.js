import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePilotName } from "./lan-session-protocol.js";

const SAFE_SUBJECT = /^[A-Za-z0-9_-]{1,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function failure(code) {
  return { ok: false, code };
}

function decodeJson(segment) {
  if (!BASE64URL.test(segment)) return null;
  try {
    const text = Buffer.from(segment, "base64url").toString("utf8");
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Verify the deliberately small hosted-access JWT contract. This verifier is
 * intentionally not a general JWT implementation: it accepts only compact
 * HS256 tokens and returns no token material or claim data on failure.
 */
export function verifyOnlineAccessToken(token, { secret, issuer, audience, nowSeconds = Date.now() / 1000 } = {}) {
  if (typeof token !== "string" || typeof secret !== "string" || !issuer || !audience) return failure("invalid-token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !part)) return failure("invalid-token");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  if (!header || !payload || header.alg !== "HS256" || !BASE64URL.test(encodedSignature)) return failure("invalid-token");

  const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  let received;
  try { received = Buffer.from(encodedSignature, "base64url"); } catch { return failure("invalid-token"); }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return failure("invalid-token");

  if (payload.iss !== issuer || payload.aud !== audience) return failure("invalid-token");
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= nowSeconds) return failure("invalid-token");
  if (typeof payload.sub !== "string" || !SAFE_SUBJECT.test(payload.sub)) return failure("invalid-token");
  if (payload.name !== undefined && typeof payload.name !== "string") return failure("invalid-token");

  return {
    ok: true,
    subject: payload.sub,
    displayName: payload.name === undefined ? null : normalizePilotName(payload.name),
    // Only retain the normalized authorization facts needed after the hello;
    // never retain the compact token or the complete decoded payload.
    expiresAt: payload.exp,
    role: payload.role === "host" ? "host" : "pilot",
  };
}

export const ONLINE_SAFE_SUBJECT = SAFE_SUBJECT;
