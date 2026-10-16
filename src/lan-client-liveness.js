import { LAN_STATE_STALL_TIMEOUT_MS } from "./lan-session-protocol.js";

function validTime(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a finite non-negative time`);
  return value;
}

/**
 * Tracks authoritative state frames, not transport heartbeats. A heartbeat can
 * prove that a socket still exists while its simulation loop is no longer
 * producing states, so it must not refresh this clock.
 */
export function createStateLiveness({ now = 0, timeoutMs = LAN_STATE_STALL_TIMEOUT_MS } = {}) {
  const startedAt = validTime(now, "liveness start time");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("liveness timeout must be positive");
  return { lastStateAt: startedAt, timeoutMs, reconnectRequested: false };
}

export function recordAuthoritativeState(liveness, now) {
  if (!liveness || typeof liveness !== "object") throw new TypeError("liveness state is required");
  liveness.lastStateAt = validTime(now, "authoritative state time");
  liveness.reconnectRequested = false;
  return liveness;
}

export function shouldReconnectForStateStall(liveness, now) {
  if (!liveness || typeof liveness !== "object") throw new TypeError("liveness state is required");
  const at = validTime(now, "liveness check time");
  if (liveness.reconnectRequested || at - liveness.lastStateAt < liveness.timeoutMs) return false;
  liveness.reconnectRequested = true;
  return true;
}
