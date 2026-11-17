// ONLINE-AUDIO-19: presentation-only audio bridge for the causal WASM route.
// It consumes already-authoritative render state; it neither predicts events
// nor feeds timing, input, or audio state back into the host simulation.
import { createAudioMixer } from "../../src/audio-mixer.js";

const ROLE_TO_CAR = Object.freeze({ host: "p2p-host", pilot: "p2p-pilot" });
const ACTION_SERIAL_KINDS = Object.freeze(["jump", "doubleJump", "dodge", "respawn"]);

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function eventKey(event) {
  if (!event || typeof event !== "object") return null;
  const kind = typeof event.kind === "string" ? event.kind : "";
  const text = typeof event.text === "string" ? event.text : "";
  const at = finite(event.at, -1);
  return kind && at >= 0 ? `${kind}\u0000${at}\u0000${text}` : null;
}

function actionSerial(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function cueForAction(kind) {
  if (kind === "doubleJump") return "double-jump";
  return kind === "jump" || kind === "dodge" ? kind : null;
}

/**
 * Project one validated causal state into the existing local audio mixer.
 * Browsers still require a trusted user gesture through `unlock`; before that
 * this object only records event identities to prevent a backlog burst.
 */
export function createP2PWasmCausalAudioPresenter({ mixer = createAudioMixer(), role = null } = {}) {
  let currentRole = role;
  const seenEvents = new Set();
  let previousSpeed = null;
  let previousTime = null;
  // Keep the most recent authoritative frame so a user gesture that unlocks
  // Web Audio can immediately re-apply the current motor/nitro state. Without
  // this replay, a browser that resumes audio between two snapshots can remain
  // silent until the next simulation update, and a stopped stream can never
  // start the already-visible engine state.
  let latestState = null;
  let latestRole = currentRole;
  let latestCarId = null;
  const actionSerialsByCar = new Map();
  let lastRoundSerial = null;
  let previousBraking = false;
  let previousDrifting = false;
  let disposed = false;

  function ownCar(state, nextRole = currentRole, carId = null) {
    // Pair sessions retain their compact role mapping. A multiparty lobby and
    // match use slot identities (`p2p-guest-1` … `p2p-guest-5`), so callers
    // must be able to select the actual local car rather than silently
    // falling back to a non-existent `p2p-pilot`.
    const ownId = typeof carId === "string" && carId.length > 0
      ? carId
      : ROLE_TO_CAR[nextRole] || null;
    return state?.cars?.find?.(car => car?.id === ownId) || null;
  }

  function presentActionSerials(state) {
    const roundSerial = Number.isSafeInteger(state?.settings?.roundSerial) ? state.settings.roundSerial : null;
    const roundChanged = lastRoundSerial !== null && roundSerial !== null && lastRoundSerial !== roundSerial;
    if (roundSerial !== null) lastRoundSerial = roundSerial;
    for (const car of state.cars) {
      if (!car || typeof car.id !== "string" || !car.actionSerials || typeof car.actionSerials !== "object") continue;
      const previous = actionSerialsByCar.get(car.id);
      if (!previous) {
        const baseline = {};
        for (const kind of ACTION_SERIAL_KINDS) {
          const value = actionSerial(car.actionSerials[kind]);
          if (value !== null) baseline[kind] = value;
        }
        actionSerialsByCar.set(car.id, baseline);
        continue;
      }
      for (const kind of ACTION_SERIAL_KINDS) {
        const next = actionSerial(car.actionSerials[kind]);
        if (next === null) continue;
        const before = actionSerial(previous[kind]);
        // The round transition resets jump/double-jump/dodge counters in the
        // authoritative match. Only the separately increasing respawn serial
        // may produce a cue at that boundary.
        if (roundChanged && kind !== "respawn") {
          previous[kind] = next;
          continue;
        }
        if (before !== null && next > before) {
          const cue = cueForAction(kind);
          if (cue) mixer.playCue?.(cue);
        }
        previous[kind] = next;
      }
    }
  }

  function present(state, { role: nextRole = currentRole, carId = null } = {}) {
    if (disposed || !state || !Array.isArray(state.cars)) return false;
    currentRole = nextRole;
    latestRole = nextRole;
    latestCarId = typeof carId === "string" && carId.length > 0 ? carId : null;
    latestState = state;
    const car = ownCar(state, nextRole, latestCarId);
    const alive = car?.alive === true;
    const speed = Math.max(0, finite(car?.speed, Math.hypot(finite(car?.vx), finite(car?.vz), finite(car?.vh))));
    const boost = Math.max(0, Math.min(100, finite(car?.boost)));
    const time = finite(state.time, null);
    const dt = previousTime !== null && time !== null ? Math.max(1 / 120, Math.min(.12, time - previousTime)) : null;
    const acceleration = dt !== null && previousSpeed !== null ? (speed - previousSpeed) / dt : 0;
    previousSpeed = speed;
    previousTime = time;
    const motorActive = alive && (Math.abs(finite(car?.forwardSpeed, speed)) > .5 || car?.boosting === true);
    // Mirror the local client: RocketSim's `boosting` flag is the authoritative
    // audio edge. Do not add a second boost-value gate here, because a frame at
    // the depletion edge can still be marked boosting while the scalar has
    // already reached zero.
    const nitroActive = alive && car?.boosting === true;
    const powerslide = Math.max(0, Math.min(1, finite(car?.powerslide)));
    // Match the local presentation cues using only the authoritative frame.
    // Held reverse input is intentionally unavailable online, so braking is
    // emitted from the observable deceleration branch only.
    const braking = alive && Math.abs(finite(car?.forwardSpeed, speed)) > 2
      && !nitroActive && acceleration < -18;
    const drifting = alive && powerslide > .35 && speed > 2;
    if (braking && !previousBraking) mixer.playCue?.("brake", { intensity: Math.min(1, Math.abs(acceleration) / 60) });
    if (drifting && !previousDrifting) mixer.playCue?.("drift", { intensity: powerslide });
    mixer.setMotorState?.({ active: motorActive, intensity: Math.min(1, speed / 56), speed, acceleration });
    mixer.setNitroState?.({ active: nitroActive, intensity: boost / 100, speed, acceleration });
    mixer.setDriftState?.({ active: drifting, intensity: powerslide, speed, acceleration });
    previousBraking = braking;
    previousDrifting = drifting;
    presentActionSerials(state);
    for (const event of state.events || []) {
      const key = eventKey(event);
      if (!key || seenEvents.has(key)) continue;
      seenEvents.add(key);
      // The mixer makes the gesture/mute decision. This bridge must not infer
      // an impact from HP deltas or body pose: only a host event is audible.
      mixer.playFeedback?.(event);
    }
    // Bound local presentation memory even if a malformed display source were
    // to append events indefinitely. The causal wire already caps it at eight.
    while (seenEvents.size > 32) seenEvents.delete(seenEvents.values().next().value);
    return true;
  }

  async function unlock() {
    if (disposed) return false;
    const unlocked = await mixer.unlock?.();
    if (unlocked) {
      await mixer.preloadCombat?.();
      // The current snapshot may have arrived before the trusted gesture.
      // Re-project it after preload so the first audible frame does not depend
      // on a coincidental future snapshot or a still-running simulation.
      if (latestState) present(latestState, { role: latestRole, carId: latestCarId });
    }
    return Boolean(unlocked);
  }

  function setVolume(value) {
    if (disposed || typeof mixer.setVolume !== "function") return null;
    return mixer.setVolume(value);
  }

  function setMuted(value) {
    if (disposed || typeof mixer.setMuted !== "function") return null;
    return mixer.setMuted(value);
  }

  function getAudioState() {
    return mixer.getState?.() || null;
  }

  function clear() {
    mixer.clear?.();
    seenEvents.clear();
    actionSerialsByCar.clear();
    lastRoundSerial = null;
    previousSpeed = null;
    previousTime = null;
    previousBraking = false;
    previousDrifting = false;
    latestState = null;
    latestRole = currentRole;
    latestCarId = null;
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    clear();
    await mixer.dispose?.();
  }

  return Object.freeze({
    present, unlock, setVolume, setMuted, getAudioState, clear, dispose,
    getState: () => Object.freeze({ role: currentRole, seenEventCount: seenEvents.size, mixer: getAudioState() }),
  });
}
