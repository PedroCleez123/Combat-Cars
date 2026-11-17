// ONLINE-RENDER-04: presentation-only boundary for authoritative snapshots.

function validBuffer(buffer) {
  return buffer && typeof buffer.push === "function"
    && typeof buffer.sample === "function" && typeof buffer.close === "function";
}

/** Wrap an already validated render buffer without importing transport/input. */
export function createAuthoritativeStateSource({ buffer } = {}) {
  if (!validBuffer(buffer)) throw new TypeError("AuthoritativeStateSource needs a render buffer.");
  let closed = false;
  const listeners = new Set();
  const source = {
    push(snapshot) {
      if (closed) return null;
      buffer.push(snapshot);
      const state = buffer.sample();
      for (const listener of listeners) {
        try { listener(state); } catch { /* Presentation observers are isolated. */ }
      }
      return state;
    },
    sample() { return closed ? null : buffer.sample(); },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("AuthoritativeStateSource listener must be a function.");
      if (closed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      buffer.close();
    },
    get closed() { return closed; },
  };
  return Object.freeze(source);
}
