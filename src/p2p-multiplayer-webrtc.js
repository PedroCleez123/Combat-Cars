// Host-star WebRTC adapter. It composes the reviewed pair session rather than
// changing it: each guest receives its own channel and its own signaling view.
import { P2PWebRTCSession } from "./p2p-webrtc-session.js";
import { P2P_MULTI_MAX_GUEST_SLOTS } from "./p2p-multiparty-signaling.js";

function slot(value) { return Number.isSafeInteger(value) && value >= 1 && value <= P2P_MULTI_MAX_GUEST_SLOTS; }

function signalingView(client, { role, peerSlot }) {
  return Object.freeze({
    on(type, listener) {
      return client.on(type, event => {
        if (type === "signal") {
          const expectedSource = role === "host" ? peerSlot : null;
          if (event?.sourceSlot !== expectedSource) return;
          listener({ payload: event.payload });
          return;
        }
        if (type === "peer-left") {
          if (role === "host" && (event?.role !== "guest" || event?.slot !== peerSlot)) return;
          if (role === "guest" && event?.role !== "host") return;
        }
        if (type === "peer-ready") {
          if (role === "host" && event?.slot !== peerSlot) return;
          if (role === "guest" && event?.slot !== null) return;
        }
        listener(event);
      });
    },
    sendSignal(payload) { return client.sendSignal(payload, { targetSlot: role === "host" ? peerSlot : null }); },
  });
}

/** A bounded WebRTC star: host has 1–5 pair sessions; a guest has one. */
export class P2PMultiplayerWebRTCStar {
  constructor({ role, signaling, slot: ownSlot = null, guestSlots = [], failoverGuestSlots = [], WebRTCSession = P2PWebRTCSession, onEvent = () => {}, ...options } = {}) {
    if ((role !== "host" && role !== "guest") || !signaling || typeof signaling.on !== "function" || typeof signaling.sendSignal !== "function" || typeof WebRTCSession !== "function" || typeof onEvent !== "function") throw new TypeError("La estrella WebRTC multiusuario no es válida.");
    if ((role === "host" && ownSlot !== null) || (role === "guest" && !slot(ownSlot)) || !Array.isArray(guestSlots) || guestSlots.some(value => !slot(value)) || new Set(guestSlots).size !== guestSlots.length || (role === "guest" && guestSlots.length !== 0)) throw new TypeError("Las plazas WebRTC multiusuario no son válidas.");
    if (!Array.isArray(failoverGuestSlots) || failoverGuestSlots.some(value => !slot(value)) || new Set(failoverGuestSlots).size !== failoverGuestSlots.length) throw new TypeError("Las plazas de failover WebRTC no son válidas.");
    this.role = role; this.signaling = signaling; this.ownSlot = ownSlot; this.guestSlots = role === "host" ? [...guestSlots].sort((a, b) => a - b) : []; this.failoverGuestSlots = [...failoverGuestSlots].sort((a, b) => a - b); this.WebRTCSession = WebRTCSession; this.onEvent = onEvent; this.options = options; this.sessions = new Map(); this.started = false; this.closed = false;
  }
  createSession(peerSlot, { beginOffer = false } = {}) {
    const role = this.role === "host" ? "host" : "guest";
    const session = new this.WebRTCSession({ ...this.options, role, signaling: signalingView(this.signaling, { role, peerSlot }), offerMode: role === "host" ? "deferred" : "automatic", onEvent: event => this.emit(peerSlot, event) });
    this.sessions.set(peerSlot, session); session.start();
    if (role === "host" && beginOffer) queueMicrotask(() => session.beginOffer?.());
    return session;
  }
  start() {
    if (this.started || this.closed) return this;
    this.started = true;
    const slots = this.role === "host" ? this.guestSlots : [this.ownSlot];
    for (const peerSlot of slots) this.createSession(peerSlot);
    if (this.role === "host") this.unsubscribeReady = this.signaling.on("peer-ready", event => this.handlePeerReady(event));
    this.unsubscribePromotion = this.signaling.on("host-promoted", event => { if (this.role === "guest") { if (event?.promoted) this.promoteToHost(event); else this.restartGuest(); } });
    return this;
  }
  handlePeerReady(event) {
    if (this.closed || this.role !== "host" || !slot(event?.slot)) return;
    let session = this.sessions.get(event.slot);
    if (!session) {
      if (!this.guestSlots.includes(event.slot)) this.guestSlots.push(event.slot);
      this.guestSlots.sort((left, right) => left - right);
      session = this.createSession(event.slot);
    }
    session?.beginOffer?.();
  }
  emit(peerSlot, event) {
    if (this.migrating && (event?.type === "closed" || event?.type === "peer-left" || event?.type === "error")) return;
    try { this.onEvent(Object.freeze({ ...event, slot: peerSlot, role: this.role })); } catch {}
  }
  get(peerSlot) { return this.sessions.get(peerSlot) || null; }
  send(peerSlot, data) { const session = this.get(peerSlot); if (!session) throw new Error("La plaza WebRTC no está conectada."); return session.send(data); }
  replace(peerSlot) {
    if (this.closed || this.role !== "host" || !slot(peerSlot) || !this.sessions.has(peerSlot)) return false;
    try { this.sessions.get(peerSlot)?.close?.(); } catch {}
    this.createSession(peerSlot);
    return true;
  }
  restartGuest() {
    if (this.closed || this.role !== "guest") return false;
    this.migrating = true;
    for (const session of this.sessions.values()) session.close?.();
    this.sessions.clear();
    this.migrating = false;
    this.createSession(this.ownSlot);
    this.emit(this.ownSlot, { type: "host-transition" });
    return true;
  }
  promoteToHost(event = {}) {
    if (this.closed || this.role !== "guest") return false;
    const formerSlot = this.ownSlot;
    this.migrating = true;
    for (const session of this.sessions.values()) session.close?.();
    this.sessions.clear();
    this.migrating = false;
    this.role = "host";
    const connected = Array.isArray(event.connectedSlots) ? event.connectedSlots : this.failoverGuestSlots;
    this.guestSlots = connected.filter(value => value !== formerSlot);
    this.ownSlot = null;
    this.unsubscribeReady = this.signaling.on("peer-ready", ready => this.handlePeerReady(ready));
    this.emit(formerSlot, { type: "host-promoted", formerSlot, hostEpoch: event?.hostEpoch ?? null, connectedSlots: [...this.guestSlots, formerSlot].sort((left, right) => left - right) });
    // Let the application rebuild its lobby authority before negotiation
    // starts.  This keeps the first guest hello from racing a not-yet-created
    // successor host channel; any frame that still arrives early is buffered
    // by the room entry point as a second line of defence.
    for (const peerSlot of this.guestSlots) this.createSession(peerSlot, { beginOffer: true });
    return true;
  }
  close() { if (this.closed) return; this.closed = true; try { this.unsubscribeReady?.(); this.unsubscribePromotion?.(); } catch {} for (const session of this.sessions.values()) session.close?.(); this.sessions.clear(); }
}
