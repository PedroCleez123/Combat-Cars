// P2P-WASM-42: isolated v5-to-renderer adapter. It consumes a decoded,
// authoritative presentation envelope and returns the same renderer state
// shape as the causal v1 adapter. It never advances RocketSim, predicts a
// pose, sends input, or feeds presentation data back into combat.
import { SNAPSHOT_INTERPOLATION_DELAY, SnapshotInterpolator } from "../../src/snapshot-interpolation.js";
import { createOnlineFullPresentationStateFromEnvelope } from "../../src/online-full-presentation-state.js";
import { normalizeP2PWasmCausalCombatPresentationEnvelope } from "./p2p-wasm-causal-combat-presentation-protocol.mjs";

const nowSeconds = () => (typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000);

function copiedVector(vector) {
  return vector ? { x: vector.x, y: vector.y, z: vector.z } : null;
}

function contactFor(telemetry) {
  if (telemetry.wheelContact.hasContact) return telemetry.wheelContact;
  if (telemetry.worldContact.hasContact) return telemetry.worldContact;
  return null;
}

function surfaceFor(telemetry) {
  const contact = contactFor(telemetry);
  if (!contact) return telemetry.grounded ? { kind: "ground", contact: null } : { kind: "air", contact: null };
  const normalY = contact.normal.y;
  if (normalY < -.65) return { kind: "ceiling", contact };
  if (Math.abs(normalY) < .35) return { kind: "wall", contact };
  return { kind: "ground", contact };
}

function normalizeContext(value, expected, label) {
  if (expected !== null && expected !== value) throw new TypeError(`El sobre v5 no coincide con ${label} del buffer.`);
  return expected ?? value;
}

function createStateFromNormalized(envelope, { roomId, sessionId }) {
  // Keep the public path on the same immutable full-state adapter as the
  // direct host path. The v5 envelope is still the transport boundary; this
  // function only projects its decoded authoritative fields for presentation.
  const base = createOnlineFullPresentationStateFromEnvelope(envelope, { roomId, sessionId });
  const cars = base.cars.map((car, index) => {
    const telemetry = envelope.presentation[index];
    const surface = surfaceFor(telemetry);
    const contact = surface.contact;
    const normalVelocity = contact
      ? car.velocity.x * contact.normal.x + car.velocity.y * contact.normal.y + car.velocity.z * contact.normal.z
      : null;
    return {
      ...car,
      // Full attitude and every field below originate in WASM v5. No local
      // gameplay value is inferred to fill a missing remote field.
      orientation: { ...telemetry.orientation },
      boost: telemetry.boost,
      jumps: telemetry.jumps,
      grounded: telemetry.grounded,
      jumpState: telemetry.jumpState,
      actionSerials: { ...telemetry.actionSerials },
      boosting: telemetry.boosting,
      powerslide: telemetry.powerslide,
      supersonic: telemetry.supersonic,
      angularVelocity: { ...telemetry.angularVelocity },
      wheelCount: telemetry.wheelCount,
      wheelContact: { hasContact: telemetry.wheelContact.hasContact, normal: copiedVector(telemetry.wheelContact.normal) },
      worldContact: { hasContact: telemetry.worldContact.hasContact, normal: copiedVector(telemetry.worldContact.normal) },
      surfaceType: surface.kind,
      wallRide: surface.kind === "wall",
      ceilingContact: surface.kind === "ceiling",
      surfaceNormal: copiedVector(contact?.normal),
      contacts: contact ? [{
        kind: surface.kind,
        normal: copiedVector(contact.normal),
        point: { x: car.x, y: car.h, z: car.z },
        wheelCount: telemetry.wheelCount,
        normalVelocity,
        separation: 0,
      }] : [],
    };
  });
  return {
    ...base,
    settings: { ...base.settings, p2pPresentationProtocol: envelope.protocolVersion },
    cars,
  };
}

/** Build presentation state from a strict, decoded v5 envelope. */
export function createP2PWasmPresentationRenderState(value, { roomId = null, sessionId = null } = {}) {
  const envelope = normalizeP2PWasmCausalCombatPresentationEnvelope(value);
  if (!envelope) throw new TypeError("El sobre causal v5 no cumple el contrato de presentación.");
  const boundRoomId = normalizeContext(envelope.roomId, roomId, "roomId");
  const boundSessionId = normalizeContext(envelope.sessionId, sessionId, "sessionId");
  return createStateFromNormalized(envelope, { roomId: boundRoomId, sessionId: boundSessionId });
}

/**
 * Presentation-only v5 buffer. The v1 adapter remains intact while this
 * isolated gate proves full attitude and surface fields through a browser.
 */
export class P2PWasmPresentationRenderBuffer {
  constructor({ roomId = null, sessionId = null, delay = SNAPSHOT_INTERPOLATION_DELAY, now = nowSeconds } = {}) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(roomId || "") || !/^[A-Za-z0-9_-]{1,64}$/u.test(sessionId || "")
      || typeof now !== "function" || !Number.isFinite(delay) || delay < 0 || delay > 1) {
      throw new TypeError("La configuración del buffer causal v5 no es válida.");
    }
    this.roomId = roomId;
    this.sessionId = sessionId;
    this.now = now;
    this.interpolator = new SnapshotInterpolator(delay);
    this.lastTick = 0;
    this.lastSequence = 0;
    this.closed = false;
  }

  push(envelope, receivedAt = this.now()) {
    if (this.closed) return null;
    if (!Number.isFinite(receivedAt) || receivedAt < 0) throw new TypeError("receivedAt causal v5 no es válido.");
    const normalized = normalizeP2PWasmCausalCombatPresentationEnvelope(envelope);
    if (!normalized) throw new TypeError("El sobre causal v5 no cumple el contrato de presentación.");
    if (normalized.sequence <= this.lastSequence) throw new RangeError("El buffer causal v5 recibió una secuencia repetida o atrasada.");
    const state = createStateFromNormalized(normalized, { roomId: this.roomId, sessionId: this.sessionId });
    const tick = Math.round(state.time * 60);
    if (tick <= this.lastTick) throw new RangeError("El buffer causal v5 recibió un tick repetido o atrasado.");
    this.lastTick = tick;
    this.lastSequence = normalized.sequence;
    this.interpolator.push(state, receivedAt);
    return state;
  }

  sample(at = this.now()) {
    if (!Number.isFinite(at) || at < 0) throw new TypeError("El instante de muestra causal v5 no es válido.");
    return this.closed ? null : this.interpolator.sample(at);
  }

  reset() {
    this.interpolator.reset();
    this.lastTick = 0;
    this.lastSequence = 0;
    return this;
  }

  close() {
    if (this.closed) return this;
    this.closed = true;
    this.interpolator.reset();
    this.lastTick = 0;
    this.lastSequence = 0;
    return this;
  }
}
