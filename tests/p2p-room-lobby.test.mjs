import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  P2P_ICE_CONNECTION_STATES,
  P2P_ICE_SERVERS,
  P2P_SIGNAL_ORIGIN,
  normalizeSignalOrigin,
} from "../src/p2p-room-config.js";
import { consumeP2PInviteFragment, normalizeP2PRoomCode, P2PSignalingClient } from "../src/p2p-signaling-client.js";
import { initializeP2PRoomLobby, P2P_ROOM_LIFECYCLE_LABELS } from "../src/p2p-room-lobby.js";

const root = new URL("../", import.meta.url);

class FakeElement {
  constructor() { this.listeners = new Map(); this.hidden = false; this.disabled = false; this.checked = false; this.value = ""; this.textContent = ""; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async fire(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
  focus() {}
  select() {}
}

class FakeClient {
  constructor({ origin }) { this.origin = origin; this.listeners = new Map(); this.connectCalls = []; this.closeCalls = 0; }
  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
  async createRoom() { return { roomId: "r".repeat(16), hostSecret: "h".repeat(43), guestSecret: "g".repeat(43), expiresAt: Date.now() + 60_000 }; }
  async joinRoomByCode() { return { roomCode: "ABCD1234", roomId: "r".repeat(16), guestSecret: "g".repeat(43), expiresAt: Date.now() + 60_000 }; }
  connect(room) { this.connectCalls.push(room); }
  close() {
    this.closeCalls += 1;
    if (this.closeCalls === 1) this.emit("closed", { reason: "local" });
  }
}

class FakeSession {
  static instances = [];
  constructor(options) { this.options = options; this.startCalls = 0; this.beginOfferCalls = 0; this.closeCalls = 0; FakeSession.instances.push(this); }
  start() { this.startCalls += 1; this.options.onEvent({ type: "negotiating" }); return this; }
  beginOffer() { this.beginOfferCalls += 1; return this; }
  close() {
    this.closeCalls += 1;
    this.options.onEvent({ type: "closed" });
  }
  emit(type, fields = {}) { this.options.onEvent({ type, ...fields }); }
}

class FakeCausalRoomSession {
  static instances = [];
  constructor(options) {
    this.options = options;
    this.startCalls = 0;
    this.beginOfferCalls = 0;
    this.closeCalls = 0;
    FakeCausalRoomSession.instances.push(this);
  }
  start() { this.startCalls += 1; this.options.onEvent({ type: "negotiating" }); return this; }
  beginOffer() { this.beginOfferCalls += 1; return this; }
  close() {
    if (this.closeCalls > 0) return this;
    this.closeCalls += 1;
    this.options.onEvent({ type: "closed" });
  }
  emit(type, fields = {}) { this.options.onEvent({ type, ...fields }); }
}

function makeLobby({ invite = null, CausalRoomSession = null, causalContextFactory = null, hostFactory = null, onCausalSnapshot = () => {}, onPeerIdentity = () => {}, onSessionEvent = () => {}, iceServers = P2P_ICE_SERVERS, presentation = false } = {}) {
  const elements = new Map(["status", "primary", "room-panel", "invite-url", "room-caption", "room-code-display", "room-code-value", "room-code", "join-room-code", "room-code-status", "invite-note", "player-name", "copy-invite", "leave"]
    .map((id) => [id, new FakeElement()]));
  const notice = new FakeElement();
  const documentRef = { getElementById: (id) => elements.get(id), querySelector: () => notice };
  const stored = new Map();
  // The public flow now requires an explicit pilot name before either action.
  // initializeP2PRoomLobby restores this preference during construction.
  stored.set("arsenal.p2p.player-name", "Test Pilot");
  if (invite) stored.set("arsenal.p2p.invite.v1", JSON.stringify(invite));
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  const locationRef = { hash: "", pathname: "/p2p-room-lobby.html", search: "", href: "https://game.example/p2p-room-lobby.html" };
  const historyRef = { replaceState() {} };
  FakeSession.instances = [];
  FakeCausalRoomSession.instances = [];
  const controller = initializeP2PRoomLobby({
    documentRef,
    locationRef,
    historyRef,
    storage,
    localStorageRef: storage,
    origin: "https://signal.example",
    Client: FakeClient,
    WebRTCSession: FakeSession,
    CausalRoomSession,
    causalContextFactory,
    hostFactory,
    onCausalSnapshot,
    onPeerIdentity,
    onSessionEvent,
    iceServers,
    presentation,
  });
  return { elements, notice, controller, client: controller.client };
}

test("lobby is offline by default and accepts only an explicit HTTPS origin", () => {
  assert.equal(P2P_SIGNAL_ORIGIN, "https://combat-cars-signal.combat-cars-pedro.workers.dev");
  assert.equal(normalizeSignalOrigin(null), null);
  assert.equal(normalizeSignalOrigin("https://signal.example"), "https://signal.example");
  for (const value of ["http://signal.example", "https://signal.example/", "https://signal.example/path", "https://signal.example?q=x", "https://signal.example#x", "https://user:pw@signal.example"]) {
    assert.equal(normalizeSignalOrigin(value), null, value);
  }
});

test("the reviewed public ICE configuration is static, credential-free, and bounded to browser states", () => {
  assert.deepEqual(P2P_ICE_SERVERS, [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ]);
  assert.equal(Object.isFrozen(P2P_ICE_SERVERS), true);
  assert.equal(P2P_ICE_SERVERS.every(server => Object.isFrozen(server)), true);
  assert.equal(JSON.stringify(P2P_ICE_SERVERS).includes("credential"), false);
  assert.deepEqual(P2P_ICE_CONNECTION_STATES, ["new", "checking", "connected", "completed", "failed", "disconnected", "closed"]);
});

test("short room codes use a bounded Crockford alphabet and never expose signaling secrets", () => {
  assert.equal(normalizeP2PRoomCode("abcd-1234"), "ABCD1234");
  assert.equal(normalizeP2PRoomCode("ABCD 1234"), "ABCD1234");
  for (const value of ["", "ABC", "ABCD-123!", "ABCDEFGI", "abcdefghijklm"]) {
    assert.equal(normalizeP2PRoomCode(value), null, value);
  }
});

test("the optional Worker room-code exchange validates expiry and keeps the secret out of the code", async () => {
  const now = 1_700_000_000_000;
  const fetch = async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { roomCode: "ABCD1234" });
    return { ok: true, status: 200, async json() { return { roomCode: "ABCD1234", roomId: "r".repeat(16), guestSecret: "g".repeat(43), expiresAt: now + 60_000 }; } };
  };
  const client = new P2PSignalingClient({ origin: "https://signal.example", fetch, now: () => now });
  const invite = await client.joinRoomByCode("abcd-1234");
  assert.deepEqual(invite, { roomCode: "ABCD1234", roomId: "r".repeat(16), guestSecret: "g".repeat(43), expiresAt: now + 60_000 });
  assert.equal(Object.keys(invite).includes("hostSecret"), false);
  const expired = new P2PSignalingClient({
    origin: "https://signal.example",
    fetch: async () => ({ ok: true, status: 200, async json() { return { roomCode: "ABCD1234", roomId: "r".repeat(16), guestSecret: "g".repeat(43), expiresAt: now - 1 }; } }),
    now: () => now,
  });
  await assert.rejects(() => expired.joinRoomByCode("ABCD1234"), /no válida o caducada/i);
});

test("malformed and repeated invite fragments are rejected and remove stale session state", () => {
  const values = new Map([["arsenal.p2p.invite.v1", "stale-secret"]]);
  const storage = { setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  for (const hash of ["#p2p=", "#p2p=abc&x=y", "#p2p=abc#p2p=def", "#other=abc"]) {
    const result = consumeP2PInviteFragment({ hash, storage, now: () => 1 });
    if (hash.startsWith("#p2p=")) assert.equal(result.invite, null);
  }
  assert.equal(values.has("arsenal.p2p.invite.v1"), false);
});

test("legacy room URL preserves a private invite while redirecting into the isolated playable arena", async () => {
  const html = await readFile(new URL("p2p-room-lobby.html", root), "utf8");
  const moduleSource = await readFile(new URL("src/p2p-room-lobby.js", root), "utf8");
  assert.match(html, /<html lang="es">/);
  assert.match(html, /p2p-causal-beta/);
  assert.match(html, /arena\.hash = window\.location\.hash/);
  assert.match(html, /window\.location\.replace\(arena\.href\)/);
  assert.match(html, /RocketSim WASM y WebRTC P2P/);
  assert.match(moduleSource, /P2PSignalingClient/);
  assert.match(moduleSource, /createP2PInviteUrl/);
  assert.match(moduleSource, /textContent/);
  assert.doesNotMatch(moduleSource, /confirmPrivacy|requestPrivacyAcknowledgement|globalThis\.confirm/i);
  assert.doesNotMatch(moduleSource, /innerHTML|["'](?:\.\/|\/)?client\.js|RTCPeerConnection|P2PHostMatch/i);
  assert.doesNotMatch(html, /src="\/?src\/client\.js|from\s+["'][^"']*client\.js/i);
});

test("one create click creates and connects without a privacy acknowledgement", async () => {
  const { elements, client } = makeLobby();
  assert.equal(elements.get("primary").disabled, false);
  await elements.get("primary").fire("click");
  assert.equal(client.connectCalls[0]?.role, "host");
});

test("one room-code join click connects without a privacy acknowledgement", async () => {
  const { elements, client } = makeLobby();
  elements.get("room-code").value = "ABCD1234";
  await elements.get("join-room-code").fire("click");
  assert.equal(client.connectCalls[0]?.role, "guest");
});

test("host and guest tabs keep independent lobby state while joining the same room", async () => {
  const host = makeLobby();
  const guest = makeLobby();
  await host.elements.get("primary").fire("click");
  guest.elements.get("room-code").value = "ABCD1234";
  await guest.elements.get("join-room-code").fire("click");
  assert.equal(host.client.connectCalls[0]?.role, "host");
  assert.equal(guest.client.connectCalls[0]?.role, "guest");
  assert.notEqual(host.client.connectCalls[0]?.role, guest.client.connectCalls[0]?.role);
  host.controller.destroy();
  guest.controller.destroy();
});

test("lobby accepts a short room code through the same private-match menu", async () => {
  const { elements, client, controller } = makeLobby();
  elements.get("room-code").value = "abcd-1234";
  await elements.get("join-room-code").fire("click");
  assert.equal(client.connectCalls[0]?.role, "guest");
  assert.equal(client.connectCalls[0]?.roomId, "r".repeat(16));
  assert.equal(elements.get("room-code-status").textContent, "");
  controller.destroy();
});

test("room creation failure exposes the same explicit retry action", async () => {
  const { elements, client, controller } = makeLobby();
  client.createRoom = async () => { throw new Error("service unavailable"); };
  await elements.get("primary").fire("click");
  assert.equal(elements.get("primary").textContent, "Reintentar conexión");
  assert.equal(elements.get("primary").disabled, false);
  assert.match(elements.get("status").textContent, /crear la sala|Reintentar/i);
  assert.doesNotMatch(elements.get("status").textContent, /secret|candidate|sdp|192\.0\.2\.1|10\.0\.0\.1/i);
  controller.destroy();
});

test("both roles prepare on ready; host offers only after peer-ready and reports ready without starting a match", async () => {
  const { elements, notice, client, controller } = makeLobby();
  await elements.get("primary").fire("click");
  assert.equal(client.connectCalls[0]?.role, "host", elements.get("status").textContent);
  assert.equal(FakeSession.instances.length, 0, "session waits for signaling ready");

  client.emit("ready", { role: "host" });
  assert.equal(FakeSession.instances.length, 1);
  assert.equal(FakeSession.instances[0].startCalls, 1);
  assert.equal(FakeSession.instances[0].options.offerMode, "deferred");
  assert.deepEqual(FakeSession.instances[0].options.iceServers, P2P_ICE_SERVERS);
  assert.equal(FakeSession.instances[0].beginOfferCalls, 0, "prepared host must not offer before peer-ready");

  client.emit("peer-ready", { role: "guest" });
  client.emit("peer-ready", { role: "guest" });
  assert.equal(FakeSession.instances.length, 1);
  assert.equal(FakeSession.instances[0].options.role, "host");
  assert.equal(FakeSession.instances[0].startCalls, 1);
  assert.equal(FakeSession.instances[0].beginOfferCalls, 1, "duplicate peer-ready does not duplicate offer start");
  FakeSession.instances[0].emit("channel-open");
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.channelReady);
  assert.match(notice.textContent, /Esta versión todavía no inicia una partida/i);
  assert.doesNotMatch(elements.get("status").textContent, /h{43}|g{43}/);
  controller.destroy();
  assert.equal(FakeSession.instances[0].closeCalls, 1);
});

test("guest prepares on ready with its signal listener before peer-ready and failure needs manual retry", async () => {
  const { elements, client, controller } = makeLobby({ invite: { roomId: "r".repeat(16), guestSecret: "g".repeat(43), expiresAt: Date.now() + 60_000 } });
  elements.get("primary").fire("click");
  assert.equal(client.connectCalls[0]?.role, "guest", elements.get("status").textContent);
  client.emit("peer-ready", { role: "guest" });
  assert.equal(FakeSession.instances.length, 0, "ignore an event naming the local role");
  client.emit("ready", { role: "guest" });
  assert.equal(FakeSession.instances.length, 1);
  assert.equal(FakeSession.instances[0].startCalls, 1);
  assert.equal(FakeSession.instances[0].beginOfferCalls, 0);
  client.emit("peer-ready", { role: "host" });
  assert.equal(FakeSession.instances.length, 1);
  const session = FakeSession.instances[0];
  session.emit("error", { error: { code: "setup-failed", message: "No se pudo iniciar la sesión WebRTC." } });
  session.close();
  assert.equal(controller.session, null);
  assert.equal(session.closeCalls, 1);
  client.emit("ready", { role: "guest" });
  client.emit("peer-ready", { role: "host" });
  assert.equal(FakeSession.instances.length, 1);
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.error);
  assert.equal(elements.get("primary").textContent, "Reintentar conexión");
  assert.equal(elements.get("primary").disabled, false);
  assert.match(elements.get("status").textContent, /red|firewall|NAT|WebRTC|Reintentar/i);
  assert.doesNotMatch(elements.get("status").textContent, /secret|candidate|sdp|192\.0\.2\.1|10\.0\.0\.1/i);
  assert.equal(client.connectCalls.length, 1, "no retry happens from an error callback");
  await elements.get("primary").fire("click");
  assert.equal(client.connectCalls.length, 2, "a retry requires an explicit user action");
  controller.destroy();
});

test("explicit retry closes stale signaling and reconnects the same unexpired host room", async () => {
  const { elements, client, controller } = makeLobby();
  await elements.get("primary").fire("click");
  const firstRoom = { ...client.connectCalls[0] };
  client.emit("ready", { role: "host" });
  client.emit("peer-ready", { role: "guest" });
  const firstSession = FakeSession.instances[0];
  firstSession.emit("error", { error: { code: "peer-connection-failed", message: "synthetic failure" } });

  assert.equal(elements.get("primary").textContent, "Reintentar conexión");
  await elements.get("primary").fire("click");
  assert.equal(client.closeCalls, 1, "retry must release the active signaling socket before reconnecting");
  assert.equal(client.connectCalls.length, 2);
  assert.deepEqual(client.connectCalls[1], firstRoom, "the host keeps its issued invite instead of creating a different room");
  assert.equal(firstSession.closeCalls, 1, "retry retires the exhausted WebRTC boundary once");
  assert.equal(elements.get("status").textContent, "Reintentando la conexión privada…");

  client.emit("ready", { role: "host" });
  client.emit("peer-ready", { role: "guest" });
  assert.equal(FakeSession.instances.length, 2, "the reconnect starts a fresh WebRTC boundary only after signaling is ready");
  assert.equal(FakeSession.instances[1].beginOfferCalls, 1);
  controller.destroy();
});

test("causal opt-in starts only after ready, keeps deferred host offer, and never creates WebRTCSession", async () => {
  const contexts = [];
  const snapshots = [];
  const { elements, notice, client, controller } = makeLobby({
    CausalRoomSession: FakeCausalRoomSession,
    presentation: true,
    causalContextFactory: (input) => { contexts.push(input); return { roomId: input.roomId, sessionId: input.sessionId }; },
    hostFactory: () => ({ receivePilotCommand() { return { accepted: true }; }, close() {} }),
    onCausalSnapshot: (snapshot, metadata) => snapshots.push({ snapshot, metadata }),
  });
  assert.match(notice.textContent, /Partida online privada 1v1/i);
  await elements.get("primary").fire("click");
  client.emit("ready", { role: "host" });
  assert.equal(FakeSession.instances.length, 0, "causal mode must not instantiate the direct WebRTC session");
  assert.equal(FakeCausalRoomSession.instances.length, 1);
  const session = FakeCausalRoomSession.instances[0];
  assert.equal(session.options.role, "host");
  assert.equal(session.startCalls, 1);
  assert.deepEqual(session.options.iceServers, P2P_ICE_SERVERS);
  assert.equal(session.options.primePilotOnWelcome, true,
    "presentation rooms must bootstrap their first two-car frame before browser controls exist");
  assert.equal(session.beginOfferCalls, 0, "host offer must remain deferred until peer-ready");
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].roomId, "r".repeat(16));
  assert.equal(contexts[0].sessionId, `p2p-room-${"r".repeat(16)}`);

  client.emit("peer-ready", { role: "guest" });
  client.emit("peer-ready", { role: "guest" });
  assert.equal(session.beginOfferCalls, 1);
  assert.equal(typeof session.options.onSnapshot, "function");
  session.options.onSnapshot({ tick: 1 }, { role: "host" });
  assert.deepEqual(snapshots, [{ snapshot: { tick: 1 }, metadata: { role: "host" } }]);
  session.emit("causal-ready");
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.channelReady);
  session.emit("causal-message");
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.active);
  session.emit("error", { error: { message: "Fallo causal" } });
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.error);
  controller.destroy();
  controller.destroy();
  assert.equal(session.closeCalls, 1, "destroy must close the causal session at most once");
});

test("signaling loss after the direct channel opens does not evict the live room", async () => {
  const { elements, client, controller } = makeLobby({
    CausalRoomSession: FakeCausalRoomSession,
    presentation: true,
  });
  await elements.get("primary").fire("click");
  client.emit("ready", { role: "host" });
  client.emit("peer-ready", { role: "guest" });
  const session = FakeCausalRoomSession.instances[0];
  session.emit("channel-open");
  session.emit("causal-ready", { role: "host" });
  session.emit("causal-message");
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.active);

  // The Worker relay can be interrupted after SDP/ICE rendezvous. The direct
  // channel remains the source of truth, so these signaling events are ignored.
  client.emit("error");
  client.emit("closed", { reason: "closed" });
  client.emit("peer-left", { role: "guest" });
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.active);
  assert.equal(session.closeCalls, 0);

  // Once active, departure is authored by the direct DataChannel session.
  session.emit("peer-left", { role: "guest" });
  session.emit("closed");
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.waitingReplacement);

  // A real DataChannel departure still follows the normal replacement path.
  session.emit("peer-left", { role: "guest" });
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.waitingReplacement);
  controller.destroy();
});

test("lobby forwards only the allowlisted ICE state and never candidate or address fields", async () => {
  const observed = [];
  const { elements, client, controller } = makeLobby({ onSessionEvent: event => observed.push(event) });
  await elements.get("primary").fire("click");
  client.emit("ready", { role: "host" });
  const session = FakeSession.instances[0];
  session.emit("ice-state", { state: "checking", candidate: "candidate:private", ip: "192.0.2.1" });
  session.emit("ice-state", { state: "not-a-state", candidate: "candidate:private" });
  assert.deepEqual(observed, [{ type: "lifecycle", state: "waitingOpponent" }, { type: "negotiating" }, { type: "ice-state", state: "checking" }]);
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.waitingOpponent);
  assert.doesNotMatch(JSON.stringify(observed), /candidate|192\.0\.2\.1/);
  controller.destroy();
});

test("causal opt-in maps guest to the causal pilot role and reflects closed safely", async () => {
  const invite = { roomId: "r".repeat(16), guestSecret: "g".repeat(43), expiresAt: Date.now() + 60_000 };
  const { elements, client, controller } = makeLobby({ invite, CausalRoomSession: (options) => new FakeCausalRoomSession(options) });
  await elements.get("primary").fire("click");
  assert.equal(client.connectCalls[0]?.role, "guest", elements.get("status").textContent);
  client.emit("ready", { role: "guest" });
  assert.equal(FakeSession.instances.length, 0);
  assert.equal(FakeCausalRoomSession.instances.length, 1);
  const session = FakeCausalRoomSession.instances[0];
  assert.equal(session.options.role, "guest", "the lobby keeps its transport role; the causal adapter maps it to pilot");
  session.emit("closed", { reason: "transport-closed" });
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.error);
  controller.destroy();
  assert.equal(session.closeCalls, 0, "el lobby no debe cerrar dos veces una sesión que ya notificó closed");
});

test("ONLINE-IDENTITY-22 forwards the required guest identity and only validated peer identity", async () => {
  const invite = { roomId: "r".repeat(16), guestSecret: "g".repeat(43), expiresAt: Date.now() + 60_000 };
  const identities = [];
  const { elements, client, controller } = makeLobby({
    invite,
    CausalRoomSession: FakeCausalRoomSession,
    onPeerIdentity: identity => identities.push(identity),
  });
  await elements.get("primary").fire("click");
  client.emit("ready", { role: "guest" });
  const session = FakeCausalRoomSession.instances[0];
  assert.equal(session.options.identityName, "Test Pilot");
  session.options.onIdentity({ role: "host", name: "HOST <unsafe>" });
  assert.deepEqual(identities, [{ role: "host", name: "HOST unsafe" }]);
  controller.destroy();
});

test("a host recycles only the exhausted peer session after guest-left and accepts a replacement", async () => {
  const { elements, client, controller } = makeLobby();
  await elements.get("primary").fire("click");
  client.emit("ready", { role: "host" });
  client.emit("peer-ready", { role: "guest" });
  const first = FakeSession.instances[0];
  assert.equal(first.beginOfferCalls, 1);
  client.emit("peer-left", { role: "guest" });
  assert.equal(first.closeCalls, 1);
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.waitingReplacement);
  client.emit("peer-ready", { role: "guest" });
  assert.equal(FakeSession.instances.length, 2);
  assert.equal(FakeSession.instances[1].startCalls, 1);
  assert.equal(FakeSession.instances[1].beginOfferCalls, 1);
  controller.destroy();
});

test("ONLINE-LIFECYCLE-25 exposes one safe, allowlisted lifecycle vocabulary", async () => {
  const observed = [];
  const { elements, client, controller } = makeLobby({
    CausalRoomSession: FakeCausalRoomSession,
    onSessionEvent: event => observed.push(event),
  });
  await elements.get("primary").fire("click");
  client.emit("ready", { role: "host" });
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.waitingOpponent);
  client.emit("peer-ready", { role: "guest" });
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.negotiating);
  const session = FakeCausalRoomSession.instances[0];
  session.emit("causal-ready", { role: "host" });
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.channelReady);
  session.emit("causal-message");
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.active);
  session.emit("peer-left", { role: "guest" });
  session.emit("closed");
  assert.equal(elements.get("status").textContent, P2P_ROOM_LIFECYCLE_LABELS.waitingReplacement);
  assert.deepEqual(observed.filter(event => event.type === "lifecycle").map(event => event.state), [
    "waitingOpponent", "negotiating", "channelReady", "active", "waitingReplacement",
  ]);
  assert.doesNotMatch(JSON.stringify(observed), /https?:|secret|sdp|candidate|192\.0\.2\.1/i);
  controller.destroy();
});
