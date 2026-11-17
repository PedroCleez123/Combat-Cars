// P2P-WASM-38: keep the authoritative host simulation on a fixed-rate clock.
// Network input only updates the latest pilot intent; it never owns the
// simulation cadence. The clock intentionally advances one fixed tick per
// scheduler wake and drops missed wakes instead of attempting an unbounded
// catch-up burst in a throttled browser tab.

export const P2P_WASM_HOST_CLOCK_DEFAULT_INTERVAL_MS = 1000 / 60;
export const P2P_WASM_HOST_CLOCK_MAX_STEPS_PER_WAKE = 1;

function promiseLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function safeResult(accepted, reason, extra = {}) {
  return Object.freeze({ accepted, reason, ...extra });
}

function errorMessage(error, fallback) {
  return typeof error?.message === "string" && error.message.length > 0
    ? error.message
    : fallback;
}

function validScheduler(scheduler) {
  return scheduler
    && typeof scheduler.setInterval === "function"
    && typeof scheduler.clearInterval === "function";
}

/**
 * Fixed-rate host clock for the causal WASM room.
 *
 * `host.advance(1)` is the only simulation step. `onSnapshot` is a
 * presentation/transport callback; returning false means the room could not
 * publish and the clock must stop. The class is browser-safe and scheduler
 * injectable so deterministic tests never need wall-clock sleeps.
 */
export class P2PWasmHostClock {
  constructor({
    host,
    scheduler = typeof globalThis !== "undefined" ? globalThis : null,
    tickIntervalMs = P2P_WASM_HOST_CLOCK_DEFAULT_INTERVAL_MS,
    snapshotEveryTicks = 1,
    onSnapshot = () => {},
    onError = () => {},
  } = {}) {
    if (!host || typeof host.advance !== "function") {
      throw new TypeError("P2P WASM host clock requires a host with advance().");
    }
    if (!validScheduler(scheduler)) {
      throw new TypeError("P2P WASM host clock requires setInterval/clearInterval.");
    }
    if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0 || tickIntervalMs > 60_000) {
      throw new TypeError("P2P WASM host clock interval must be within (0, 60000].");
    }
    if (!Number.isSafeInteger(snapshotEveryTicks) || snapshotEveryTicks < 1 || snapshotEveryTicks > 60) {
      throw new TypeError("P2P WASM host clock snapshotEveryTicks must be between 1 and 60.");
    }
    if (typeof onSnapshot !== "function" || typeof onError !== "function") {
      throw new TypeError("P2P WASM host clock observers are invalid.");
    }
    this.host = host;
    this.scheduler = scheduler;
    this.tickIntervalMs = tickIntervalMs;
    this.snapshotEveryTicks = snapshotEveryTicks;
    this.onSnapshot = onSnapshot;
    this.onError = onError;
    this.timerId = null;
    this.running = false;
    this.closed = false;
    this.tickCount = 0;
    this.publishedSnapshots = 0;
    this.lastHostTick = 0;
    this.error = null;
    this.inFlight = false;
  }

  start() {
    if (this.closed) return safeResult(false, "El reloj causal del host ya está cerrado.");
    if (this.running) return safeResult(true, "El reloj causal del host ya estaba activo.", { running: true });
    this.running = true;

    // Prime the match immediately after the first ordered pilot command. This
    // keeps the handshake responsive without letting that command own future
    // simulation ticks.
    const first = this.step();
    if (promiseLike(first)) {
      // RocketSim WASM advances asynchronously. Keep the public start() call
      // synchronous for the existing room/session contract, but only arm the
      // interval after the priming tick has completed. This also prevents a
      // throttled browser from overlapping two native/WASM advances.
      first.then(result => {
        if (this.closed || !this.running) return result;
        if (!result?.accepted) {
          this.stop();
          this.reportError(result?.reason || "Falló el tick causal inicial.", result?.error);
          return result;
        }
        this.schedule();
        return result;
      }).catch(error => {
        if (this.closed || !this.running) return;
        this.stop();
        this.reportError(errorMessage(error, "Falló el tick causal inicial."), error);
      });
      return safeResult(true, "Reloj causal del host iniciado; tick inicial en curso.", { running: true, pending: true });
    }
    if (!first.accepted) {
      this.stop();
      this.reportError(first.reason, first.error);
      return first;
    }
    const scheduled = this.schedule();
    if (!scheduled.accepted) return scheduled;
    return safeResult(true, "Reloj causal del host iniciado.", { running: true, snapshot: first.snapshot });
  }

  schedule() {
    if (this.closed || !this.running || this.timerId !== null) return safeResult(true, "Reloj causal del host ya está programado.", { running: this.running });
    try {
      this.timerId = this.scheduler.setInterval(() => this.wake(), this.tickIntervalMs);
      return safeResult(true, "Reloj causal del host programado.", { running: true });
    } catch (error) {
      this.stop();
      const failure = safeResult(false, errorMessage(error, "No se pudo iniciar el reloj causal del host."), { error });
      this.reportError(failure.reason, error);
      return failure;
    }
  }

  wake() {
    if (!this.running || this.closed) return safeResult(false, "El reloj causal del host no está activo.");
    const outcome = this.step();
    if (promiseLike(outcome)) {
      return outcome.then(result => {
        // A second interval callback while WASM is still advancing is a
        // bounded skip, not a host failure. The next scheduled wake continues
        // from the same authoritative tick.
        if (!result.accepted && !result.skipped) {
          this.stop();
          this.reportError(result.reason, result.error);
        }
        return result;
      }).catch(error => {
        this.stop();
        this.reportError(errorMessage(error, "Falló el tick causal del host."), error);
        return safeResult(false, errorMessage(error, "Falló el tick causal del host."), { error });
      });
    }
    if (!outcome.accepted && !outcome.skipped) {
      this.stop();
      this.reportError(outcome.reason, outcome.error);
    }
    return outcome;
  }

  step() {
    if (this.closed) return safeResult(false, "El reloj causal del host ya está cerrado.");
    if (this.inFlight) return safeResult(false, "El tick causal anterior aún está en curso.", { skipped: true });
    this.inFlight = true;
    const finish = candidate => {
      if (this.closed) return safeResult(false, "El reloj causal del host ya está cerrado.");
      const snapshot = candidate && typeof candidate === "object" && "snapshot" in candidate
        ? candidate.snapshot
        : candidate;
      if (!snapshot || typeof snapshot !== "object") {
        throw new Error("El host causal no devolvió un snapshot al avanzar.");
      }
      if (!Number.isSafeInteger(snapshot.tick) || snapshot.tick < 1 || snapshot.tick <= this.lastHostTick) {
        throw new Error("El host causal devolvió un tick no estrictamente creciente.");
      }
      this.lastHostTick = snapshot.tick;
      this.tickCount += 1;
      if (this.tickCount % this.snapshotEveryTicks === 0) {
        const published = this.onSnapshot(snapshot);
        if (published === false) throw new Error("La sala causal rechazó la publicación del snapshot.");
        this.publishedSnapshots += 1;
      }
      return safeResult(true, "Tick causal avanzado.", { snapshot });
    };
    const fail = error => safeResult(false, errorMessage(error, "Falló el tick causal del host."), { error });
    let asyncAdvance = false;
    try {
      const candidate = this.host.advance(1);
      if (promiseLike(candidate)) {
        asyncAdvance = true;
        const pending = Promise.resolve(candidate)
          .then(value => {
            try { return finish(value); } catch (error) { return fail(error); }
          })
          .finally(() => { this.inFlight = false; });
        return pending;
      }
      try { return finish(candidate); } catch (error) { return fail(error); }
    } catch (error) {
      return fail(error);
    } finally {
      if (!asyncAdvance) this.inFlight = false;
    }
  }

  stop() {
    if (this.timerId !== null) {
      try { this.scheduler.clearInterval(this.timerId); } catch { /* Cleanup remains best effort. */ }
      this.timerId = null;
    }
    this.running = false;
    return this;
  }

  close() {
    if (this.closed) return this;
    this.stop();
    this.closed = true;
    return this;
  }

  reportError(message, error) {
    this.error = Object.freeze({ code: "host-clock-failed", message, ...(error ? { error } : {}) });
    try { this.onError(this.error); } catch { /* Error observers cannot revive the clock. */ }
  }

  diagnostics() {
    return Object.freeze({
      running: this.running,
      closed: this.closed,
      tickCount: this.tickCount,
      publishedSnapshots: this.publishedSnapshots,
      lastHostTick: this.lastHostTick,
      snapshotEveryTicks: this.snapshotEveryTicks,
      tickIntervalMs: this.tickIntervalMs,
      maxStepsPerWake: P2P_WASM_HOST_CLOCK_MAX_STEPS_PER_WAKE,
      error: this.error,
    });
  }
}

