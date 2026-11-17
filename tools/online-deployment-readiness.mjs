import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateOnlineDeploymentPolicy } from "../src/online-deployment-policy.js";

function readPublicOrigin(env) {
  const value = env?.ARSENAL_PUBLIC_ORIGIN;
  return typeof value === "string" ? value.trim() : "";
}

function isCanonicalHttpsOrigin(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && url.pathname === "/"
      && !url.search
      && !url.hash
      && value === url.origin;
  } catch {
    return false;
  }
}

function safeMode(mode) {
  return mode === "lan" || mode === "online" ? mode : "unknown";
}

/**
 * Check the hosted online configuration without starting the game or reading
 * any deployment secrets into the result. `env` is injectable for unit tests.
 */
export function evaluateOnlineDeploymentReadiness(env = process.env) {
  const policy = evaluateOnlineDeploymentPolicy(env, { adapterAvailable: true });
  const mode = safeMode(policy.mode);

  if (mode === "lan") {
    return {
      status: "not-ready",
      mode,
      code: "online-mode-required",
      checks: [{
        code: "online-mode-required",
        status: "fail",
        diagnostic: "ARSENAL_NETWORK_MODE=online es necesario para validar un despliegue online; LAN sigue siendo el modo predeterminado.",
      }],
      diagnostics: ["El entorno está en modo LAN; no se requieren ajustes públicos para jugar en LAN."],
    };
  }

  if (mode !== "online") {
    return {
      status: "not-ready",
      mode,
      code: "unsupported-network-mode",
      checks: [{
        code: "unsupported-network-mode",
        status: "fail",
        diagnostic: "ARSENAL_NETWORK_MODE debe ser lan u online.",
      }],
      diagnostics: ["ARSENAL_NETWORK_MODE debe ser lan u online."],
    };
  }

  const checks = [];
  const diagnostics = [];
  if (policy.ok) {
    checks.push({
      code: "online-deployment-policy",
      status: "pass",
      diagnostic: "La configuración cumple la política online del servidor.",
    });
  } else {
    const policyCode = policy.code === "invalid-online-config" ? policy.code : "policy-failed";
    for (const diagnostic of policy.diagnostics) {
      checks.push({
        code: policyCode,
        status: "fail",
        diagnostic,
      });
      diagnostics.push(diagnostic);
    }
  }

  const publicOrigin = readPublicOrigin(env);
  const canonicalOrigin = isCanonicalHttpsOrigin(publicOrigin);
  checks.push({
    code: "public-origin-canonical-https",
    status: canonicalOrigin ? "pass" : "fail",
    diagnostic: canonicalOrigin
      ? "ARSENAL_PUBLIC_ORIGIN es un origen HTTPS canónico."
      : "ARSENAL_PUBLIC_ORIGIN debe ser un origen HTTPS canónico, sin ruta, barra final, credenciales, query ni fragmento.",
  });
  if (!canonicalOrigin) diagnostics.push("ARSENAL_PUBLIC_ORIGIN debe ser un origen HTTPS canónico.");

  const isAllowlisted = canonicalOrigin
    && policy.config?.allowedOrigins?.includes(publicOrigin) === true;
  checks.push({
    code: "public-origin-allowlisted",
    status: isAllowlisted ? "pass" : "fail",
    diagnostic: isAllowlisted
      ? "ARSENAL_PUBLIC_ORIGIN coincide exactamente con un origen permitido."
      : "ARSENAL_PUBLIC_ORIGIN debe coincidir exactamente con una entrada de ARSENAL_ONLINE_ALLOWED_ORIGINS.",
  });
  if (!isAllowlisted) diagnostics.push("ARSENAL_PUBLIC_ORIGIN debe coincidir exactamente con una entrada de ARSENAL_ONLINE_ALLOWED_ORIGINS.");

  const ready = policy.ok && canonicalOrigin && isAllowlisted;
  return {
    status: ready ? "ready" : "not-ready",
    mode,
    code: ready ? "online-readiness-ready" : "online-readiness-check-failed",
    checks,
    diagnostics,
  };
}

/** Serialize only the deliberately redacted public result shape. */
export function serializeOnlineDeploymentReadiness(env = process.env) {
  return `${JSON.stringify(evaluateOnlineDeploymentReadiness(env), null, 2)}\n`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const result = evaluateOnlineDeploymentReadiness(process.env);
  process.stdout.write(serializeOnlineDeploymentReadiness(process.env));
  process.exitCode = result.status === "ready" ? 0 : 1;
}
