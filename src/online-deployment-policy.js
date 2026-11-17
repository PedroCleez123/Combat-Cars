/**
 * Pure deployment preflight for the optional hosted network mode.
 *
 * LAN remains the default and does not need any of the online settings.  The
 * online mode is intentionally fail-closed until a real adapter is wired in.
 * Keeping this module free of imports and side effects makes it safe to test
 * without constructing the simulation or opening a socket.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const LIMITS = Object.freeze({
  rooms: { min: 1, max: 1000 },
  connections: { min: 1, max: 10000 },
  frameBytes: { min: 256, max: 1024 * 1024 },
});

const valueOf = (env, ...names) => {
  for (const name of names) {
    if (env?.[name] !== undefined && env[name] !== null) return String(env[name]).trim();
  }
  return "";
};

function parseBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function parsePositiveInteger(value, label, bounds) {
  if (!/^\d+$/.test(value)) return { ok: false, reason: `${label} debe ser un entero positivo.` };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return { ok: false, reason: `${label} debe estar entre ${bounds.min} y ${bounds.max}.` };
  }
  return { ok: true, value: parsed };
}

function parseOrigins(raw) {
  const origins = String(raw || "").split(",").map(origin => origin.trim()).filter(Boolean);
  if (!origins.length) return { ok: false, reason: "ARSENAL_ONLINE_ALLOWED_ORIGINS requiere al menos un origen." };
  const canonical = [];
  const invalid = origins.find(origin => {
    try {
      const url = new URL(origin);
      if (![
        "http:",
        "https:",
      ].includes(url.protocol) || !url.host || url.pathname !== "/" || origin.includes("?") || origin.includes("#") || origin.includes("@") || url.username || url.password) return true;
      canonical.push(url.origin);
      return false;
    } catch {
      return true;
    }
  });
  // Keep diagnostics free of raw origin text: a rejected URL may contain
  // userinfo, which must never be echoed into process logs.
  if (invalid) return { ok: false, reason: "Origen no válido en allowlist." };
  return { ok: true, value: [...new Set(canonical)] };
}

/**
 * Evaluate the deployment contract without touching the filesystem, process,
 * simulation, bridge or listener. `adapterAvailable` is injectable for future
 * hosted adapters; it defaults to false because this repository has none.
 */
export function evaluateOnlineDeploymentPolicy(env = process.env, { adapterAvailable = false } = {}) {
  const mode = valueOf(env, "ARSENAL_NETWORK_MODE").toLowerCase() || "lan";
  if (mode === "lan") return { ok: true, mode, code: "lan", config: null, diagnostics: [] };
  if (mode !== "online") {
    return { ok: false, mode, code: "invalid-network-mode", config: null, diagnostics: [`ARSENAL_NETWORK_MODE no soportado: ${mode}.`] };
  }

  const diagnostics = [];
  const tlsRaw = valueOf(env, "ARSENAL_ONLINE_TLS_TERMINATED");
  if (parseBoolean(tlsRaw) !== true) diagnostics.push("online requiere ARSENAL_ONLINE_TLS_TERMINATED=true.");

  const adapter = valueOf(env, "ARSENAL_ONLINE_ADAPTER").toLowerCase();
  if (adapter !== "hosted") diagnostics.push("online requiere ARSENAL_ONLINE_ADAPTER=hosted.");
  const auth = valueOf(env, "ARSENAL_ONLINE_AUTH").toLowerCase();
  if (auth !== "jwt-hs256") diagnostics.push("online requiere ARSENAL_ONLINE_AUTH=jwt-hs256.");
  const jwtSecret = valueOf(env, "ARSENAL_ONLINE_JWT_SECRET");
  if (jwtSecret.length < 32) diagnostics.push("online requiere un secreto JWT de al menos 32 caracteres.");
  const jwtIssuer = valueOf(env, "ARSENAL_ONLINE_JWT_ISSUER");
  const jwtAudience = valueOf(env, "ARSENAL_ONLINE_JWT_AUDIENCE");
  if (!jwtIssuer || !jwtAudience) diagnostics.push("online requiere issuer y audience JWT exactos.");

  const origins = parseOrigins(valueOf(env, "ARSENAL_ONLINE_ALLOWED_ORIGINS", "ONLINE_ALLOWED_ORIGINS"));
  if (!origins.ok) diagnostics.push(origins.reason);

  const roomLimit = parsePositiveInteger(valueOf(env, "ARSENAL_ONLINE_MAX_ROOMS", "ARSENAL_ONLINE_ROOM_LIMIT"), "ARSENAL_ONLINE_MAX_ROOMS", LIMITS.rooms);
  const connectionLimit = parsePositiveInteger(valueOf(env, "ARSENAL_ONLINE_MAX_CONNECTIONS", "ARSENAL_ONLINE_CONNECTION_LIMIT"), "ARSENAL_ONLINE_MAX_CONNECTIONS", LIMITS.connections);
  const frameLimit = parsePositiveInteger(valueOf(env, "ARSENAL_ONLINE_MAX_FRAME_BYTES", "ARSENAL_ONLINE_FRAME_LIMIT"), "ARSENAL_ONLINE_MAX_FRAME_BYTES", LIMITS.frameBytes);
  if (!roomLimit.ok) diagnostics.push(roomLimit.reason);
  if (!connectionLimit.ok) diagnostics.push(connectionLimit.reason);
  if (!frameLimit.ok) diagnostics.push(frameLimit.reason);
  if (roomLimit.ok && roomLimit.value !== 1) diagnostics.push("ARSENAL_ONLINE_MAX_ROOMS debe ser 1 para el adaptador de sala única.");

  if (diagnostics.length) {
    return { ok: false, mode, code: "invalid-online-config", config: null, diagnostics };
  }

  const config = Object.freeze({
    tlsTerminated: true,
    adapter: "hosted",
    auth: "jwt-hs256",
    jwtIssuer,
    jwtAudience,
    allowedOrigins: origins.value,
    maxRooms: roomLimit.value,
    maxConnections: connectionLimit.value,
    maxFrameBytes: frameLimit.value,
  });
  if (!adapterAvailable) {
    return {
      ok: false,
      mode,
      code: "unsupported/no-adapter",
      config,
      diagnostics: ["online está configurado, pero este proceso no tiene adaptador online."],
    };
  }
  return { ok: true, mode, code: "online", config, diagnostics: [] };
}

/** Throw a diagnostic error suitable for a process preflight. */
export function assertOnlineDeploymentPolicy(env = process.env, options = {}) {
  const result = evaluateOnlineDeploymentPolicy(env, options);
  if (result.ok) return result;
  const error = new Error(`[ONLINE POLICY] ${result.code}: ${result.diagnostics.join(" ")}`);
  error.code = `ARSENAL_${result.code.replace(/[^A-Z0-9]+/gi, "_").toUpperCase()}`;
  error.policy = result;
  throw error;
}

export const ONLINE_POLICY_LIMITS = LIMITS;
