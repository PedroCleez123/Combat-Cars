// Bounded recovery policy for the public guest lobby. It deliberately owns
// timing only: the room entry point remains responsible for credentials,
// WebRTC resources and authoritative lobby state.
export const P2P_HOST_PROMOTION_GRACE_MS = 1_500;
export const P2P_GUEST_RECONNECT_DELAYS_MS = Object.freeze([500, 1_500, 3_000]);

/**
 * Keeps a host-side combat slot recovery idempotent. A WebRTC session can
 * report both peer-left and closed (and sometimes error) for one departure;
 * only the first notification may neutralize and replace the slot.
 */
export function createP2PHostSlotRecovery({ onNeutralize = () => {}, onReplace = () => {} } = {}) {
  if (typeof onNeutralize !== "function" || typeof onReplace !== "function") {
    throw new TypeError("La recuperación de slots del host P2P no es válida.");
  }
  const pending = new Set();
  const validSlot = slot => Number.isSafeInteger(slot) && slot >= 1 && slot <= 5;
  return Object.freeze({
    begin(slot) {
      if (!validSlot(slot) || pending.has(slot)) return false;
      pending.add(slot);
      onNeutralize(slot);
      onReplace(slot);
      return true;
    },
    reconnected(slot) {
      if (!validSlot(slot)) return false;
      return pending.delete(slot);
    },
    isPending(slot) { return validSlot(slot) && pending.has(slot); },
    clear() { pending.clear(); },
    snapshot() { return Object.freeze({ pendingSlots: [...pending].sort((a, b) => a - b) }); },
  });
}

function validTimerApi(setTimeoutFn, clearTimeoutFn) {
  return typeof setTimeoutFn === "function" && typeof clearTimeoutFn === "function";
}

/**
 * Serializes guest retries and leaves a short window for a Durable Object
 * host-promotion notice. A departing host must be allowed to promote the
 * remaining guest before that guest tears down its signaling socket.
 */
export function createP2PGuestConnectionRecovery({
  setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
  onRetry = () => {},
  onAwaitingPromotion = () => {},
  onExhausted = () => {},
} = {}) {
  if (!validTimerApi(setTimeoutFn, clearTimeoutFn) || typeof onRetry !== "function"
    || typeof onAwaitingPromotion !== "function" || typeof onExhausted !== "function") {
    throw new TypeError("La recuperación del invitado P2P no es válida.");
  }

  let attempts = 0;
  let retryTimer = null;
  let promotionTimer = null;
  let disposed = false;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeoutFn(retryTimer);
    retryTimer = null;
  };
  const clearPromotion = () => {
    if (promotionTimer !== null) clearTimeoutFn(promotionTimer);
    promotionTimer = null;
  };
  const scheduleRetry = ({ reason = "transport" } = {}) => {
    if (disposed || retryTimer !== null || promotionTimer !== null) return false;
    if (attempts >= P2P_GUEST_RECONNECT_DELAYS_MS.length) {
      onExhausted({ attempts, reason });
      return false;
    }
    attempts += 1;
    const delayMs = P2P_GUEST_RECONNECT_DELAYS_MS[attempts - 1];
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      if (!disposed) onRetry({ attempt: attempts, delayMs, reason });
    }, delayMs);
    return true;
  };

  return Object.freeze({
    scheduleRetry,
    awaitHostPromotion({ reason = "peer-left" } = {}) {
      if (disposed || promotionTimer !== null) return false;
      clearRetry();
      onAwaitingPromotion({ reason, delayMs: P2P_HOST_PROMOTION_GRACE_MS });
      promotionTimer = setTimeoutFn(() => {
        promotionTimer = null;
        scheduleRetry({ reason: "promotion-timeout" });
      }, P2P_HOST_PROMOTION_GRACE_MS);
      return true;
    },
    connected() {
      clearRetry();
      clearPromotion();
      attempts = 0;
    },
    promotionObserved() {
      clearRetry();
      clearPromotion();
      attempts = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearRetry();
      clearPromotion();
    },
    snapshot() {
      return Object.freeze({ attempts, retryPending: retryTimer !== null, promotionPending: promotionTimer !== null, disposed });
    },
  });
}
