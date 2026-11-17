import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createP2PWasmCausalCombatPresentationEnvelope } from "../tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs";

import {
  SAFE_TEST_COMMAND,
  normalizeCausalBetaSnapshot,
  renderCausalBetaState,
  startP2PCausalBeta,
  formatP2PCausalTargetStatus,
  formatP2PCausalMetadataStatus,
  P2P_CAUSAL_DIAGNOSTICS_INTERVAL_MS,
  P2P_CAUSAL_DIAGNOSTICS_STORAGE_KEY,
  P2P_CAUSAL_AUDIO_VOLUME_STORAGE_KEY,
  P2P_CAUSAL_AUDIO_MUTED_STORAGE_KEY,
  P2P_CAUSAL_METADATA_STALE_MS,
} from "../src/p2p-causal-beta.js";
import { P2P_ROOM_LIFECYCLE_LABELS } from "../src/p2p-room-lobby.js";
import { renderP2PCausalBetaHud } from "../src/p2p-causal-beta-hud.js";
import { decodeP2PPlayerIdentityEnvelope, normalizeP2PPlayerName } from "../src/p2p-player-identity.js";

const root = new URL("../", import.meta.url);

test("online WASM page is explicit about its private 1v1 scope and isolated from LAN boot", async () => {
  const html = await readFile(new URL("p2p-causal-beta.html", root), "utf8");
  const source = await readFile(new URL("src/p2p-causal-beta.js", root), "utf8");
  const lobbySource = await readFile(new URL("src/p2p-room-lobby.js", root), "utf8");
  assert.match(html, /data-p2p-room-lobby-auto-start="false"/);
  assert.match(html, /data-p2p-causal-beta-auto-start="false"/);
  assert.match(html, /data-platform="desktop"/);
  assert.match(html, /data-supported-input="keyboard-mouse-gamepad"/);
  assert.match(html, /id="causal-scene"/);
  assert.match(html, /id="causal-input-surface"[^>]*oncontextmenu="return false"/);
  assert.match(html, /id="fullscreen-toggle"[^>]*aria-pressed="false"/);
  assert.match(html, /src="\/src\/p2p-causal-beta-entry\.js"/);
  assert.match(html, /online WASM/i);
  assert.match(html, /<h3 id="online-heading">Partida privada<\/h3>/i);
  assert.match(html, /id="causal-action"[^>]*disabled/);
  assert.doesNotMatch(html, /id="privacy-ack"|confirmPrivacy|window\.confirm/i);
  assert.doesNotMatch(html, /tu rival puede conocer tu dirección IP/i);
  assert.match(html, /id="causal-snapshot"/);
  assert.match(html, /html, body \{[^}]*overflow: hidden/);
  assert.match(html, /\.causal-scene \{[^}]*position: absolute/);
  assert.match(html, /id="diagnostics-toggle"[^>]*type="checkbox"/);
  assert.match(html, /id="causal-diagnostics"[^>]*hidden/);
  assert.match(html, /id="causal-audio-action"/);
  assert.match(html, /id="causal-audio-volume"[^>]+type="range"/);
  assert.match(html, /id="causal-audio-mute"[^>]+aria-pressed="false"/);
  assert.match(html, /<summary>Controles<\/summary>/);
  assert.match(html, /<summary>Sonido<\/summary>/);
  assert.doesNotMatch(html, /Práctica local · nitro infinito/);
  assert.match(html, /<div hidden aria-hidden="true"><p class="eyebrow">Combat Cars · WASM/);
  assert.match(html, /id="causal-target"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(html, /id="causal-hud-score"[^>]*aria-label="Marcador"/);
  assert.match(html, /class="causal-hud"[^>]*hidden/);
  assert.doesNotMatch(html, /controles y snapshots viajan por WebRTC/i);
  assert.doesNotMatch(html, /touch-controls|pointer:\s*coarse|Controles táctiles/);
  assert.doesNotMatch(html, /client\.js|server\.mjs|rocketsim-native/i);
  assert.match(source, /P2PWasmCausalRoomSession/);
  assert.match(source, /createP2PWasmCombatHost/);
  assert.match(source, /sendCausalCommand/);
  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /preventBrowserContextMenu/);
  assert.match(source, /stopGameplayContextGesture/);
  assert.doesNotMatch(source, /addEventListener\?\.\("pointerdown", stopGameplayContextGesture/);
  assert.doesNotMatch(source, /stopImmediatePropagation/);
  assert.match(source, /gameplayInputSurface/);
  assert.match(source, /gameTarget: gameplayInputSurface/);
  assert.match(html, /oncontextmenu="return false"/);
  assert.match(source, /requestFullscreen/);
  assert.match(lobbySource, /unified-join/);
  assert.match(source, /webkitRequestFullscreen/);
  assert.match(source, /mozRequestFullScreen/);
  assert.match(source, /msRequestFullscreen/);
  assert.match(source, /documentRef\.documentElement \|\| documentRef\.querySelector/);
  assert.match(html, /:fullscreen \{/);
  assert.match(html, /:-webkit-full-screen \{/);
  assert.match(html, /:-moz-full-screen \{/);
  assert.match(html, /:-ms-fullscreen \{/);
});

test("desktop menu stays bounded and scrollable in short viewports", async () => {
  const html = await readFile(new URL("p2p-causal-beta.html", root), "utf8");
  assert.match(html, /\.menu-overlay \{[^}]*overflow: auto/);
  assert.match(html, /\.menu-overlay \{[^}]*max-height: min\(calc\(100dvh - 1\.5rem\), 38rem\)/);
  assert.match(html, /\.menu-overlay \{[^}]*scrollbar-gutter: stable/);
  assert.match(html, /width: min\(26rem, calc\(100% - 1\.5rem\)\)/);
  assert.match(html, /<summary>Sonido<\/summary>/);
  assert.match(html, /<summary>Controles<\/summary>/);
});

test("main menu exposes the persistent multiplayer arena and short-code join without a confirmation gate", async () => {
  const html = await readFile(new URL("p2p-causal-beta.html", root), "utf8");
  const entry = await readFile(new URL("src/p2p-causal-beta-entry.js", root), "utf8");
  const multi = await readFile(new URL("p2p-multiplayer.html", root), "utf8");
  const multiEntry = await readFile(new URL("src/p2p-multiplayer-entry.js", root), "utf8");
  assert.match(html, /id="match-mode"/);
  assert.match(html, /id="unified-create"[^>]*>Crear sala/);
  assert.match(html, /id="room-code"/);
  assert.match(html, /id="unified-join"[^>]*>Unirse/);
  assert.doesNotMatch(html, /multi-room-code|open-multi-mode|join-multi-mode|Unirse a grupo/);
  assert.doesNotMatch(html, /Puedes crear una sala|Crea una sala y comparte|Para jugar con más personas|Clave de 10 caracteres|Privacidad de la partida|Permitir conexión directa/);
  assert.doesNotMatch(html, /confirmPrivacy|privacy-ack|window\.confirm/i);
  assert.match(entry, /searchParams\.set\("create", "1"\)/);
  assert.match(entry, /searchParams\.set\("join", roomCode\)/);
  assert.doesNotMatch(entry, /legacyCreate\?\.click|legacyJoin\?\.click/);
  assert.match(multi, /id="scoreboard"/);
  assert.match(multi, /id="start-match"/);
  assert.match(multi, /id="team-choice-blue"/);
  assert.match(multi, /id="match-countdown"/);
  assert.match(multi, /<script type="importmap">\{"imports":\{"three":"\/vendor\/three\/three\.module\.js"\}\}<\/script>/);
  assert.match(multiEntry, /client\.joinRoomByCode\(value, \{ reconnect \}\)/);
  assert.match(multiEntry, /P2PWasmMultiplayerHostChannel/);
  assert.match(multiEntry, /startHostMatch/);
  assert.match(multiEntry, /P2P_LOBBY_DURATION_SECONDS/);
  assert.match(multiEntry, /const audioPresenter = createP2PWasmCausalAudioPresenter\(\)/);
  assert.match(multiEntry, /disposeAudioPresenter: false/);
  assert.match(multiEntry, /audioPresenter\.present\?\./);
});

test("online room entry restores a personal key and uses a short code only for joining another host", async () => {
  const beta = await readFile(new URL("p2p-causal-beta.html", root), "utf8");
  const multi = await readFile(new URL("p2p-multiplayer.html", root), "utf8");
  const betaEntry = await readFile(new URL("src/p2p-causal-beta-entry.js", root), "utf8");
  const multiEntry = await readFile(new URL("src/p2p-multiplayer-entry.js", root), "utf8");
  assert.match(beta, /Clave de sala \(obligatoria para unirse\)/);
  assert.match(beta, /placeholder="Pega la clave para unirte"/);
  assert.match(beta, /Nombre de piloto \(obligatorio para crear o unirse\)/);
  assert.doesNotMatch(beta, /Opcional al crear|opcional al crear/i);
  assert.match(multi, /<input id="name"[^>]*required/);
  assert.match(multi, /id="join-code"/);
  assert.match(multi, /Unirse a otra sala/);
  assert.doesNotMatch(multi, /id="create"|>Crear sala</);
  assert.match(multi, /id="join"[^>]*disabled/);
  assert.match(betaEntry, /normalizedOnlineName/);
  assert.match(betaEntry, /unifiedCreate\.disabled = !normalizedOnlineName\(\)/);
  assert.match(betaEntry, /unifiedJoin\.disabled = !normalizedOnlineName\(\)/);
  assert.match(multiEntry, /updateRoomActionAvailability/);
  assert.match(multiEntry, /join\.disabled = !hasName \|\| !hasJoinCode/);
  assert.match(multiEntry, /requirePlayerName\(\)/);
});

test("beta action is the single bounded pilot command", () => {
  assert.deepEqual(SAFE_TEST_COMMAND, {
    controls: { throttle: 0, steer: 0, boost: false, jump: false },
    fire: false,
    targetId: null,
  });
  assert.equal(Object.isFrozen(SAFE_TEST_COMMAND), true);
  assert.equal(Object.isFrozen(SAFE_TEST_COMMAND.controls), true);
});

test("beta snapshot projection exposes exactly two cars without room credentials", () => {
  const snapshot = normalizeCausalBetaSnapshot({
    tick: 4,
    score: { blue: 1, red: 0 },
    physical: [
      { id: "p2p-host", x: 1, h: 2, z: 3 },
      { id: "p2p-pilot", x: -1, h: 2, z: -3 },
    ],
    cars: [
      { id: "p2p-host", team: "blue", hp: 100, alive: true },
      { id: "p2p-pilot", team: "red", hp: 100, alive: true },
    ],
  });
  assert.deepEqual(snapshot, {
    tick: 4,
    score: { blue: 1, red: 0 },
    cars: [
      { id: "p2p-host", team: "blue", hp: 100, alive: true, position: { x: 1, h: 2, z: 3 } },
      { id: "p2p-pilot", team: "red", hp: 100, alive: true, position: { x: -1, h: 2, z: -3 } },
    ],
  });
  assert.equal("roomId" in snapshot, false);
  assert.equal(normalizeCausalBetaSnapshot({ cars: [] }), null);
});

test("beta presentation uses a compact view-model and never serializes the wire envelope", () => {
  const element = { textContent: "" };
  const state = {
    time: 1 / 60,
    score: { blue: 0, red: 1 },
    cars: [
      { name: "HOST", alive: true, hp: 100, x: 1, z: 2, h: 3 },
      { name: "PILOTO", alive: false, hp: 0, x: -1, z: -2, h: 3 },
    ],
    rockets: [],
  };
  renderCausalBetaState(element, state);
  assert.match(element.textContent, /tick 1/);
  assert.match(element.textContent, /HOST/);
  assert.match(element.textContent, /cohetes activos: 0/);
  assert.doesNotMatch(element.textContent, /roomId|sessionId|Secret/);
});

test("beta HUD labels the local role and rival from authoritative render state", () => {
  const values = new Map([
    ["causal-hud", { hidden: true }],
    ["causal-hud-connection", { textContent: "" }],
    ["causal-hud-role", { textContent: "" }],
    ["causal-hud-score", { textContent: "" }],
    ["causal-hud-own", { textContent: "" }],
    ["causal-hud-rival", { textContent: "" }],
    ["causal-hud-event", { textContent: "" }],
    ["causal-hud-tick", { textContent: "" }],
  ]);
  const documentRef = { getElementById: id => values.get(id) };
  const result = renderP2PCausalBetaHud(documentRef, {
    time: 2 / 60,
    score: { blue: 3, red: 1 },
    cars: [
      { id: "p2p-host", name: "HOST", alive: true, hp: 87, boost: 64, jumps: 1, surfaceType: "wall", boosting: true, speed: 55.8, supersonic: true, rocketCooldown: .42, kills: 3, deaths: 1, respawn: 0, jumpState: "dodge", pitch: Math.PI / 2, yaw: -Math.PI / 4, roll: Math.PI, angularVelocity: { pitch: 1.25, yaw: -0.5, roll: 3 } },
      { id: "p2p-pilot", name: "PILOTO", alive: false, hp: 0, boost: 0, jumps: 0, surfaceType: "air", speed: 0, rocketCooldown: 0, kills: 1, deaths: 3, respawn: 2.3, jumpState: "airborne", pitch: 0, yaw: 0, roll: 0, angularVelocity: { pitch: 0, yaw: 0, roll: 0 } },
    ],
    events: [{ kind: "elimination", text: "HOST elimina a PILOTO", at: 2 }],
  }, { role: "pilot", connection: "Canal P2P activo · sincronizado" });
  assert.deepEqual(result, { ownId: "p2p-pilot", rivalId: "p2p-host", role: "PILOTO" });
  assert.equal(values.get("causal-hud").hidden, false);
  assert.equal(values.get("causal-hud-role").textContent, "TÚ · PILOTO");
  assert.equal(values.get("causal-hud-score").textContent, "3  —  1");
  assert.equal(values.get("causal-hud-own").textContent, "TÚ · VIDA 0% · NITRO 0% · FUERA");
  assert.equal(values.get("causal-hud-rival").textContent, "RIVAL · VIDA 87% · NITRO 64% · DODGE");
  assert.equal(values.get("causal-hud-rival").hidden, true);
  assert.equal(values.get("causal-hud-event").textContent, "BAJA · HOST elimina a PILOTO");
  assert.equal(values.get("causal-hud-own").hidden, true);
  assert.equal(values.get("causal-hud-event").hidden, true);
  assert.equal(values.get("causal-hud-tick").textContent, "");
  assert.equal(values.get("causal-hud-tick").hidden, true);
  assert.equal(values.get("causal-hud-connection").textContent, "ONLINE");
  assert.doesNotMatch(values.get("causal-hud-rival").textContent, /SALTOS|VELOCIDAD|ACTITUD|GIRO|BAJAS|CAÍDAS|COHETE|RECARGA|SUPERSÓNICO/i);
});

test("beta HUD keeps practice mode focused on the local car", () => {
  const values = new Map([
    ["causal-hud", { hidden: true }],
    ["causal-hud-connection", { textContent: "" }],
    ["causal-hud-role", { textContent: "" }],
    ["causal-hud-score", { textContent: "" }],
    ["causal-hud-own", { textContent: "" }],
    ["causal-hud-rival", { textContent: "", hidden: false }],
    ["causal-hud-event", { textContent: "", hidden: false }],
    ["causal-hud-pads", { textContent: "PICKUPS · SIN DATOS", hidden: false }],
    ["causal-hud-tick", { textContent: "debug", hidden: false }],
    ["causal-hud-fps", { textContent: "FPS 60", hidden: false }],
  ]);
  const documentRef = { getElementById: id => values.get(id) };
  renderP2PCausalBetaHud(documentRef, {
    time: 1,
    score: { blue: 0, red: 0 },
    cars: [{ id: "p2p-host", alive: true, hp: 100, boost: 100, grounded: true, surfaceType: "ground" }],
    events: [],
  }, { role: "host", connection: "Práctica local · Nitro infinito", localName: "TÚ" });
  assert.equal(values.get("causal-hud-connection").textContent, "PRÁCTICA");
  assert.equal(values.get("causal-hud-rival").textContent, "");
  assert.equal(values.get("causal-hud-rival").hidden, true);
  assert.equal(values.get("causal-hud-own").textContent, "TÚ · VIDA 100% · NITRO 100% · SUELO");
  assert.equal(values.get("causal-hud-event").hidden, true);
  assert.equal(values.get("causal-hud-pads").hidden, true);
  assert.equal(values.get("causal-hud-tick").hidden, true);
  assert.equal(values.get("causal-hud-fps").hidden, true);
  assert.equal(values.get("causal-hud-role").hidden, true);
  assert.equal(values.get("causal-hud-connection").hidden, true);
});

test("ONLINE-IDENTITY-22 bounds local and remote names and only projects a validated peer announcement", async () => {
  assert.equal(normalizeP2PPlayerName("  Álex <script> 🚀 piloto muy largo  ", "host"), "Álex script pilo");
  assert.equal(normalizeP2PPlayerName({ toString: () => "forged" }, "host"), "HOST");
  const valid = JSON.stringify({
    protocolVersion: 1,
    type: "wasm-causal-combat-identity",
    roomId: "beta_room_123456",
    sessionId: "p2p-room-beta_room_123456",
    role: "pilot",
    name: "Rival <b>",
  });
  const decoded = decodeP2PPlayerIdentityEnvelope(valid, {
    roomId: "beta_room_123456",
    sessionId: "p2p-room-beta_room_123456",
    expectedRole: "pilot",
  });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.identity.name, "Rival b");
  assert.equal(decodeP2PPlayerIdentityEnvelope(valid.replace('"role":"pilot"', '"role":"host"'), {
    roomId: "beta_room_123456",
    sessionId: "p2p-room-beta_room_123456",
    expectedRole: "pilot",
  }).ok, false);

  const harness = makeBetaHarness();
  harness.elements.get("player-name").value = "Host <i>";
  await harness.elements.get("primary").fire("click");
  harness.client.emit("ready", { role: "host" });
  assert.equal(harness.session.options.identityName, "Host i");
  harness.session.emit("causal-ready", { role: "host", name: harness.session.options.identityName });
  harness.session.options.onIdentity({ role: "pilot", name: "Rival <b>" });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  assert.match(harness.elements.get("causal-hud-own").textContent, /^Host i ·/);
  assert.match(harness.elements.get("causal-hud-rival").textContent, /^Rival b ·/);
  harness.beta.destroy();
});

class BetaFakeElement {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(item => item !== listener));
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }

  async fire(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }

  focus() {}
  select() {}
}

class BetaFakeClient {
  static instances = [];

  constructor({ origin }) {
    this.origin = origin;
    this.listeners = new Map();
    this.connectCalls = [];
    this.closeCalls = 0;
    BetaFakeClient.instances.push(this);
  }

  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  async createRoom() {
    return {
      roomId: "beta_room_123456",
      hostSecret: "h".repeat(43),
      guestSecret: "g".repeat(43),
      expiresAt: Date.now() + 10 * 60_000,
    };
  }

  connect(room) { this.connectCalls.push(room); }

  close() {
    this.closeCalls += 1;
    this.emit("closed", { reason: "local" });
  }
}

class BetaFakeCausalRoomSession {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.startCalls = 0;
    this.closeCalls = 0;
    BetaFakeCausalRoomSession.instances.push(this);
  }

  start() {
    this.startCalls += 1;
    this.options.onEvent({ type: "negotiating" });
    return this;
  }

  emit(type, fields = {}) { this.options.onEvent({ type, ...fields }); }

  emitSnapshot(snapshot, metadata = {}) {
    const value = this.options.presentation && snapshot?.physical && snapshot?.cars
      ? createP2PWasmCausalCombatPresentationEnvelope({
        roomId: this.options.roomId,
        sessionId: this.options.sessionId,
        sequence: snapshot.tick,
        snapshot: {
          tick: snapshot.tick,
          lastInputSequence: snapshot.lastInputSequence,
          physical: snapshot.physical,
          presentation: snapshot.physical.map(car => ({
            id: car.id,
            team: car.team,
            orientation: { x: 0, y: 0, z: 0, w: 1 },
            boost: 100,
            grounded: true,
            wheelCount: 4,
            jumps: 2,
            jumpState: "grounded",
            actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 },
            boosting: false,
            supersonic: false,
            powerslide: 0,
            angularVelocity: { pitch: 0, yaw: 0, roll: 0 },
            wheelContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
            worldContact: { hasContact: true, normal: { x: 0, y: 1, z: 0 } },
          })),
          combat: { score: snapshot.score, round: { state: snapshot.winner ? "complete" : "active", scoreToWin: 15, winner: snapshot.winner || null, serial: 1 }, cars: snapshot.cars, rockets: snapshot.rockets, events: snapshot.events, eliminated: [], respawns: [] },
        },
      })
      : snapshot;
    this.options.onSnapshot(typeof value === "string" ? JSON.parse(value) : value, {
      roomId: this.options.roomId,
      sessionId: this.options.sessionId,
      role: this.options.role,
      ...metadata,
    });
  }

  close() {
    this.closeCalls += 1;
    this.options.onEvent({ type: "closed" });
  }
}

function causalPresentationSnapshot(tick = 1) {
  return {
    tick,
    lastInputSequence: tick,
    physical: [
      { id: "p2p-host", team: "blue", x: tick, z: -4, h: 2, yaw: 0, vx: 0, vz: 0, vh: 0 },
      { id: "p2p-pilot", team: "red", x: -tick, z: 4, h: 2, yaw: 0, vx: 0, vz: 0, vh: 0 },
    ],
    score: { blue: 1, red: 0 },
    cars: [
      { id: "p2p-host", team: "blue", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
      { id: "p2p-pilot", team: "red", hp: 100, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0, alive: true },
    ],
    rockets: [],
    events: [],
  };
}

function makeBetaHarness({ presentationRendererFactory, requestAnimationFrameFn, cancelAnimationFrameFn, setIntervalFn, clearIntervalFn, nowFn, audioPresenter = null, onBeforeOnlinePresentationStart } = {}) {
  const ids = [
    "status", "primary", "room-panel", "invite-url", "room-caption", "invite-note",
    "player-name", "copy-invite", "leave", "causal-action", "causal-snapshot", "causal-state", "causal-target", "causal-canvas", "causal-audio-action", "causal-audio-mute", "causal-audio-volume", "causal-audio-volume-value", "causal-audio-status",
    "causal-hud", "causal-hud-connection", "causal-hud-role", "causal-hud-score", "causal-hud-own", "causal-hud-rival", "causal-hud-event", "causal-hud-pads", "causal-hud-tick",
    "renderer-loading-overlay", "renderer-loading-status", "game-menu-toggle", "game-menu-overlay", "game-menu-close", "fullscreen-toggle",
    "causal-diagnostics", "diagnostics-toggle",
  ];
  const elements = new Map(ids.map((id) => [id, new BetaFakeElement()]));
  elements.get("causal-diagnostics").hidden = true;
  const notice = new BetaFakeElement();
  const canvas = elements.get("causal-canvas");
  canvas.width = 640;
  canvas.height = 360;
  const documentElement = new BetaFakeElement();
  documentElement.dataset = {};
  const documentRef = {
    getElementById: (id) => elements.get(id),
    querySelector: (selector) => selector === ".notice" ? notice : selector === "canvas" ? canvas : null,
    documentElement,
    listeners: new Map(),
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
    },
    async fire(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) await listener(event);
    },
  };
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
    removeItem: (key) => storageValues.delete(key),
  };
  const locationRef = {
    hash: "",
    pathname: "/p2p-causal-beta.html",
    search: "",
    href: "https://game.example/p2p-causal-beta.html",
  };
  const historyRef = { replaceState() {} };
  BetaFakeClient.instances = [];
  BetaFakeCausalRoomSession.instances = [];
  const beta = startP2PCausalBeta({
    documentRef,
    locationRef,
    historyRef,
    storage,
    localStorageRef: storage,
    origin: "https://signal.example",
    Client: BetaFakeClient,
    CausalRoomSession: BetaFakeCausalRoomSession,
    presentation: true,
    presentationRendererFactory,
    requestAnimationFrameFn,
    cancelAnimationFrameFn,
    setIntervalFn,
    clearIntervalFn,
    audioPresenter,
    onBeforeOnlinePresentationStart,
    ...(nowFn ? { nowFn } : {}),
  });
  return {
    beta,
    client: BetaFakeClient.instances[0],
    elements,
    canvas,
    documentRef,
    storage,
    get session() { return BetaFakeCausalRoomSession.instances[0]; },
  };
}

test("fullscreen button requests the root element in the original click gesture and reflects actual browser state", async () => {
  const harness = makeBetaHarness();
  const { documentRef } = harness;
  let requested = 0;
  let exited = 0;
  documentRef.documentElement.requestFullscreen = function requestFullscreen() {
    requested += 1;
    documentRef.fullscreenElement = this;
    return Promise.resolve();
  };
  documentRef.exitFullscreen = function exitFullscreen() {
    exited += 1;
    documentRef.fullscreenElement = null;
    return Promise.resolve();
  };

  await harness.elements.get("fullscreen-toggle").fire("click", { preventDefault() {} });
  await documentRef.fire("fullscreenchange");
  assert.equal(requested, 1);
  assert.equal(harness.elements.get("fullscreen-toggle").textContent, "Salir de pantalla completa");
  assert.equal(harness.elements.get("fullscreen-toggle").getAttribute("aria-pressed"), "true");

  await harness.elements.get("fullscreen-toggle").fire("click", { preventDefault() {} });
  await documentRef.fire("fullscreenchange");
  assert.equal(exited, 1);
  assert.equal(harness.elements.get("fullscreen-toggle").textContent, "Pantalla completa");
  assert.equal(harness.elements.get("fullscreen-toggle").getAttribute("aria-pressed"), "false");
  harness.beta.destroy();
});

async function openBeta(options = {}) {
  const harness = makeBetaHarness(options);
  harness.elements.get("player-name").value = "Host";
  await harness.elements.get("primary").fire("click");
  harness.client.emit("ready", { role: "host" });
  assert.equal(harness.session.startCalls, 1);
  return harness;
}

test("arena controls remain gated until renderer.ready resolves", async () => {
  let resolveReady;
  const scheduled = [];
  const harness = await openBeta({
    requestAnimationFrameFn: callback => { scheduled.push(callback); return scheduled.length; },
    presentationRendererFactory: () => ({
      update() {}, render() {}, dispose() {},
      ready: () => new Promise(resolve => { resolveReady = resolve; }),
    }),
  });
  harness.session.emit("causal-ready", { role: "pilot", name: "Pilot" });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  assert.equal(harness.beta.getUiState(), "loading");
  assert.equal(harness.elements.get("causal-action").disabled, true);
  assert.equal(harness.elements.get("renderer-loading-overlay").hidden, false);
  assert.equal(scheduled.length, 0);
  resolveReady();
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
  assert.equal(harness.beta.getUiState(), "ready");
  assert.equal(harness.elements.get("causal-action").disabled, false);
  assert.equal(harness.elements.get("renderer-loading-overlay").hidden, true);
  assert.equal(scheduled.length, 1);
  harness.beta.destroy();
});

test("offline-first shell hands the canvas over only when the first authoritative snapshot creates online presentation", async () => {
  const calls = [];
  const harness = await openBeta({
    presentationRendererFactory: () => ({ update() {}, render() {}, dispose() {} }),
    onBeforeOnlinePresentationStart: context => calls.push(context),
  });
  harness.session.emit("causal-ready", { role: "pilot", name: "Pilot" });
  assert.equal(calls.length, 0, "signaling readiness must not interrupt local practice");
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, "pilot");
  harness.session.emitSnapshot(causalPresentationSnapshot(2));
  assert.equal(calls.length, 1, "the shared canvas is handed over once per presentation session");
  harness.beta.destroy();
});

test("renderer.ready rejection enters an explicit presentation error state", async () => {
  const harness = await openBeta({
    presentationRendererFactory: () => ({
      update() {}, render() {}, dispose() {},
      ready: async () => { throw new Error("asset boot failed"); },
    }),
  });
  harness.session.emit("causal-ready", { role: "pilot", name: "Pilot" });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.beta.getUiState(), "error");
  assert.equal(harness.elements.get("causal-action").disabled, true);
  assert.match(harness.elements.get("causal-state").textContent, /asset boot failed/i);
  harness.beta.destroy();
});

test("menu toggle and Escape preserve the underlying arena state", async () => {
  const harness = await openBeta();
  assert.equal(harness.beta.getUiState(), "waiting");
  harness.beta.toggleMenu(true);
  assert.equal(harness.beta.getUiState(), "menu");
  assert.equal(harness.elements.get("game-menu-overlay").hidden, false);
  for (const listener of harness.documentRef.listeners.get("keydown") || []) listener({ key: "Escape", preventDefault() {} });
  assert.equal(harness.beta.getUiState(), "waiting");
  assert.equal(harness.elements.get("game-menu-overlay").hidden, true);
  harness.beta.destroy();
});

test("diagnostics are opt in, persisted locally, and sampled no faster than 4Hz", async () => {
  let now = 0;
  const harness = await openBeta({ nowFn: () => now });
  const details = harness.elements.get("causal-diagnostics");
  const snapshot = harness.elements.get("causal-snapshot");
  const toggle = harness.elements.get("diagnostics-toggle");
  const initial = snapshot.textContent;
  assert.equal(harness.beta.isDiagnosticsEnabled(), false);
  assert.equal(details.hidden, true);

  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  assert.equal(snapshot.textContent, initial, "disabled diagnostics must not receive snapshots");

  harness.beta.setDiagnosticsEnabled(true);
  assert.equal(harness.storage.getItem(P2P_CAUSAL_DIAGNOSTICS_STORAGE_KEY), "1");
  assert.equal(toggle.checked, true);
  assert.equal(details.hidden, false);
  const first = snapshot.textContent;

  now = P2P_CAUSAL_DIAGNOSTICS_INTERVAL_MS - 1;
  harness.session.emitSnapshot(causalPresentationSnapshot(2));
  assert.equal(snapshot.textContent, first, "diagnostics must not update before the 250ms budget");

  now = P2P_CAUSAL_DIAGNOSTICS_INTERVAL_MS;
  harness.session.emitSnapshot(causalPresentationSnapshot(3));
  assert.notEqual(snapshot.textContent, first, "diagnostics may update at the 4Hz boundary");

  harness.beta.setDiagnosticsEnabled(false);
  assert.equal(harness.storage.getItem(P2P_CAUSAL_DIAGNOSTICS_STORAGE_KEY), null);
  assert.equal(details.hidden, true);
  const frozen = snapshot.textContent;
  now += P2P_CAUSAL_DIAGNOSTICS_INTERVAL_MS;
  harness.session.emitSnapshot(causalPresentationSnapshot(4));
  assert.equal(snapshot.textContent, frozen, "turning diagnostics off freezes the detail view");
  harness.beta.destroy();
});

test("transport lifecycle failure enters the public error state", async () => {
  const harness = await openBeta();
  harness.beta.handleSessionEvent({ type: "lifecycle", state: "error" });
  assert.equal(harness.beta.getUiState(), "error");
  harness.beta.destroy();
});

test("causal beta presents the bounded ICE state without transport details", async () => {
  const harness = await openBeta();
  harness.session.emit("ice-state", { state: "checking", candidate: "candidate:private", ip: "192.0.2.1" });
  assert.equal(harness.elements.get("causal-state").textContent, `Causal: ${P2P_ROOM_LIFECYCLE_LABELS.negotiating}`);
  assert.equal(harness.elements.get("causal-hud-connection").textContent, "", "HUD stays empty until an authoritative snapshot exists");
  assert.doesNotMatch(harness.elements.get("causal-state").textContent, /candidate|192\.0\.2\.1|roomId|sessionId/i);
  harness.beta.destroy();
});

test("causal beta creates the injected presentation surface and leaves GPU submission to RAF", async () => {
  const factoryCalls = [];
  const updates = [];
  const renders = [];
  let releaseCalls = 0;
  const harness = await openBeta({
    presentationRendererFactory: (...args) => {
      factoryCalls.push(args);
      return {
        update: (state) => updates.push(state),
        render: () => renders.push(true),
        dispose: () => { releaseCalls += 1; },
      };
    },
  });
  const invalid = { cars: [] };
  harness.session.emitSnapshot(invalid);
  assert.equal(factoryCalls.length, 0, "an invalid causal snapshot must not create a renderer");

  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  assert.equal(factoryCalls.length, 1);
  const factoryInput = factoryCalls[0][0];
  const firstState = factoryInput.state;
  assert.equal(factoryInput.canvas, harness.canvas);
  assert.equal(factoryInput.role, "host");
  assert.equal(factoryInput.roomId, "beta_room_123456");
  assert.equal(factoryInput.sessionId, "p2p-room-beta_room_123456");
  assert.equal(factoryInput.documentRef, harness.documentRef);
  assert.equal(firstState.settings.roomId, "beta_room_123456");
  assert.equal(firstState.settings.sessionId, "p2p-room-beta_room_123456");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].settings.roomId, "beta_room_123456");
  assert.equal(renders.length, 0, "snapshot receipt must not submit a second GPU render");

  harness.session.emitSnapshot(causalPresentationSnapshot(2));
  assert.equal(factoryCalls.length, 1, "the factory is only used for the first valid snapshot");
  assert.equal(updates.length, 2);
  assert.equal(updates[1].time, 2 / 60);
  assert.equal(renders.length, 0, "snapshot receipt must not submit a second GPU render");
  assert.equal(releaseCalls, 0);
  harness.beta.destroy();
});

test("causal beta consumes optional metadata without making it part of the causal snapshot", async () => {
  let metadataCalls = 0;
  const harness = await openBeta({
    presentationRendererFactory: () => ({
      update() {},
      render() {},
      setMetadata: value => { metadataCalls += value.sequence; },
      dispose() {},
    }),
  });
  assert.equal(harness.session.options.metadata, true, "the public beta opts into metadata while legacy adapters remain optional");
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  harness.session.options.onMetadata({
    protocolVersion: 1,
    type: "wasm-causal-combat-metadata",
    roomId: "beta_room_123456",
    sessionId: "p2p-room-beta_room_123456",
    sequence: 1,
    players: [
      { id: "p2p-host", team: "blue", name: "Host" },
      { id: "p2p-pilot", team: "red", name: "Pilot" },
    ],
    pads: [
      { id: "pad-01", x: 2, h: 0, z: -3, amount: 100, cooldown: 0, active: true },
      { id: "pad-02", x: -2, h: 0, z: 3, amount: 100, cooldown: 5, active: false },
    ],
  }, { roomId: "beta_room_123456", sessionId: "p2p-room-beta_room_123456" });
  assert.equal(harness.elements.get("causal-hud-pads").textContent, "PICKUPS · 1/2 ACTIVOS");
  assert.equal(metadataCalls, 1);
  assert.equal(harness.elements.get("causal-snapshot").textContent.includes("pads"), false, "metadata remains outside the causal state readout");
  harness.beta.destroy();
});

test("causal beta samples the presentation buffer on animation frames and cancels on destroy", async () => {
  const scheduled = [];
  const cancelled = [];
  let updates = 0;
  const harness = await openBeta({
    requestAnimationFrameFn: callback => { scheduled.push(callback); return scheduled.length; },
    cancelAnimationFrameFn: id => cancelled.push(id),
    presentationRendererFactory: () => ({ update: () => { updates += 1; }, render() {}, dispose() {} }),
  });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  assert.equal(scheduled.length, 1, "the first valid presentation starts a frame loop");
  scheduled.shift()();
  assert.equal(updates, 2, "a frame samples the buffer independently of packet arrival");
  harness.beta.destroy();
  assert.ok(cancelled.length >= 1, "destroy must cancel the pending presentation frame");
});

test("causal target status distinguishes an offscreen lock without changing authority", () => {
  assert.equal(formatP2PCausalTargetStatus(null), "SIN OBJETIVO · Q para bloquear");
  assert.equal(formatP2PCausalTargetStatus("p2p-pilot", { remoteName: "Rival", screenVisible: false }), "OBJETIVO BLOQUEADO · Rival · FUERA DE PANTALLA");
});

test("causal pickup status makes optional metadata freshness explicit", () => {
  const metadata = { pads: [{ active: true }, { active: false }] };
  assert.equal(formatP2PCausalMetadataStatus(null), "PICKUPS · SIN DATOS");
  assert.equal(formatP2PCausalMetadataStatus(metadata), "PICKUPS · 1/2 ACTIVOS");
  assert.equal(
    formatP2PCausalMetadataStatus(metadata, { ageMs: P2P_CAUSAL_METADATA_STALE_MS }),
    "PICKUPS · 1/2 ACTIVOS · DATOS ATRASADOS",
  );
  assert.equal(formatP2PCausalMetadataStatus(metadata, { failed: true }), "PICKUPS · METADATOS NO DISPONIBLES");
});

test("causal beta clears stale or failed pickup visuals without closing the causal match", async () => {
  let now = 0;
  const scheduled = [];
  const metadataCalls = [];
  const harness = await openBeta({
    nowFn: () => now,
    requestAnimationFrameFn: callback => { scheduled.push(callback); return scheduled.length; },
    presentationRendererFactory: () => ({
      update() {}, render() {}, dispose() {},
      setMetadata: value => { metadataCalls.push(value?.sequence ?? null); return true; },
    }),
  });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  const metadata = sequence => ({
    protocolVersion: 1,
    type: "wasm-causal-combat-metadata",
    roomId: "beta_room_123456",
    sessionId: "p2p-room-beta_room_123456",
    sequence,
    players: [
      { id: "p2p-host", team: "blue", name: "Host" },
      { id: "p2p-pilot", team: "red", name: "Pilot" },
    ],
    pads: [{ id: "pad-01", x: 2, h: 0, z: -3, amount: 100, cooldown: 0, active: true }],
  });
  harness.session.options.onMetadata(metadata(1), { roomId: "beta_room_123456", sessionId: "p2p-room-beta_room_123456" });
  assert.deepEqual(metadataCalls, [1]);
  assert.equal(harness.elements.get("causal-hud-pads").dataset.metadataState, "fresh");

  now = P2P_CAUSAL_METADATA_STALE_MS + 1;
  scheduled.shift()();
  assert.equal(harness.elements.get("causal-hud-pads").textContent, "PICKUPS · 1/1 ACTIVOS · DATOS ATRASADOS");
  assert.equal(harness.elements.get("causal-hud-pads").dataset.metadataState, "stale");
  assert.deepEqual(metadataCalls, [1, null], "a stale pickup layout must leave the renderer");

  harness.session.options.onMetadata(metadata(2), { roomId: "beta_room_123456", sessionId: "p2p-room-beta_room_123456" });
  assert.deepEqual(metadataCalls, [1, null, 2]);
  harness.session.emit("metadata-error");
  assert.equal(harness.elements.get("causal-hud-pads").textContent, "PICKUPS · METADATOS NO DISPONIBLES");
  assert.equal(harness.elements.get("causal-hud-pads").dataset.metadataState, "failed");
  assert.deepEqual(metadataCalls, [1, null, 2, null]);
  assert.notEqual(harness.beta.getUiState(), "error", "an optional metadata fault must not end the causal match");
  harness.beta.destroy();
});

test("causal beta persists local volume and mute without putting audio state on the causal session", async () => {
  const audio = {
    state: { volume: .3, muted: false, supported: true },
    getAudioState() { return { ...this.state }; },
    setVolume(value) { this.state.volume = Number(value); return this.state.volume; },
    setMuted(value) { this.state.muted = Boolean(value); return this.state.muted; },
    async unlock() { return true; },
    async dispose() {},
  };
  const harness = makeBetaHarness({ audioPresenter: audio });
  await harness.elements.get("causal-audio-volume").fire("input", { target: { value: ".64" } });
  await harness.elements.get("causal-audio-mute").fire("click");
  assert.equal(harness.storage.getItem(P2P_CAUSAL_AUDIO_VOLUME_STORAGE_KEY), "0.64");
  assert.equal(harness.storage.getItem(P2P_CAUSAL_AUDIO_MUTED_STORAGE_KEY), "1");
  assert.equal(harness.elements.get("causal-audio-mute").getAttribute("aria-pressed"), "true");
  assert.equal(harness.elements.get("causal-audio-volume-value").textContent, "64%");
  assert.equal(harness.session, undefined, "audio controls must not create or send a causal command");
  harness.beta.destroy();
});

test("causal beta unlocks audio from the first desktop game gesture", async () => {
  let unlockCalls = 0;
  const audio = {
    state: { volume: .3, muted: false, supported: true, unlocked: false, contextState: "suspended" },
    getAudioState() { return { ...this.state }; },
    setVolume(value) { this.state.volume = Number(value); return this.state.volume; },
    setMuted(value) { this.state.muted = Boolean(value); return this.state.muted; },
    async unlock() {
      unlockCalls += 1;
      this.state.unlocked = true;
      this.state.contextState = "running";
      return true;
    },
    async dispose() {},
  };
  const harness = makeBetaHarness({ audioPresenter: audio });
  for (const listener of harness.documentRef.listeners.get("keydown") || []) {
    await listener({ key: "w", target: { tagName: "BODY" } });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(unlockCalls, 1);
  assert.equal(harness.elements.get("causal-audio-status").textContent, "Audio activo · listo para jugar.");
  assert.equal(harness.storage.getItem(P2P_CAUSAL_AUDIO_MUTED_STORAGE_KEY), "0");
  harness.beta.destroy();
});

test("causal beta releases the presentation surface once for every terminal event and destroy", async () => {
  for (const terminalEvent of ["closed", "peer-left", "error", "destroy"]) {
    let releaseCalls = 0;
    const harness = await openBeta({
      presentationRendererFactory: () => ({
        update() {},
        render() {},
        dispose: () => { releaseCalls += 1; },
      }),
    });
    harness.session.emitSnapshot(causalPresentationSnapshot(1));
    if (terminalEvent === "destroy") {
      harness.beta.destroy();
      harness.beta.destroy();
    } else {
      harness.session.emit(terminalEvent, terminalEvent === "error" ? { error: new Error("renderer test") } : {});
      harness.session.emit(terminalEvent, terminalEvent === "error" ? { error: new Error("renderer test") } : {});
      harness.beta.destroy();
    }
    assert.equal(releaseCalls, 1, `${terminalEvent} must dispose the renderer idempotently`);
  }
});

test("causal beta ignores snapshots queued after destroy or terminal session events", async () => {
  let updates = 0;
  const harness = await openBeta({
    presentationRendererFactory: () => ({ update: () => { updates += 1; }, render() {}, dispose() {} }),
  });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  harness.beta.destroy();
  harness.session.emitSnapshot(causalPresentationSnapshot(2));
  assert.equal(updates, 1, "a late snapshot must not resurrect a disposed renderer");

  const second = await openBeta({
    presentationRendererFactory: () => ({ update: () => { updates += 1; }, render() {}, dispose() {} }),
  });
  second.session.emitSnapshot(causalPresentationSnapshot(1));
  second.session.emit("closed");
  second.session.emitSnapshot(causalPresentationSnapshot(2));
  assert.equal(updates, 2, "a terminal session must ignore queued snapshots");
  second.beta.destroy();
});

test("causal beta re-arms its presentation when a host replaces a departed guest", async () => {
  let factoryCalls = 0;
  let updates = 0;
  const harness = await openBeta({
    presentationRendererFactory: () => {
      factoryCalls += 1;
      return { update: () => { updates += 1; }, render() {}, dispose() {} };
    },
  });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  harness.session.emit("peer-left");
  assert.equal(updates, 1);

  // The lobby keeps the room and starts a fresh causal session after the
  // guest leaves. Its negotiating event must make the beta accept snapshots
  // from that replacement rather than remaining permanently terminal.
  harness.beta.handleSessionEvent({ type: "negotiating" });
  harness.session.emitSnapshot(causalPresentationSnapshot(2));
  assert.equal(updates, 2);
  assert.equal(factoryCalls, 2, "a replacement session must get a fresh renderer");
  harness.beta.destroy();
});

test("causal beta disposes a renderer that throws and never retries it", async () => {
  let updates = 0;
  let disposals = 0;
  const harness = await openBeta({
    presentationRendererFactory: () => ({
      update: () => { updates += 1; throw new Error("lost context"); },
      render() {},
      dispose: () => { disposals += 1; },
    }),
  });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  harness.session.emitSnapshot(causalPresentationSnapshot(2));
  assert.equal(updates, 1);
  assert.equal(disposals, 1);
  assert.match(harness.elements.get("causal-state").textContent, /error de presentación/i);
  assert.match(harness.elements.get("causal-state").textContent, /lost context/i);
  harness.beta.destroy();
  assert.equal(disposals, 1);
});

test("a failing presentation factory does not close or crash the causal session", async () => {
  let factoryCalls = 0;
  const harness = await openBeta({
    presentationRendererFactory: () => {
      factoryCalls += 1;
      throw new Error("renderer unavailable");
    },
  });
  harness.session.emitSnapshot(causalPresentationSnapshot(1));
  assert.equal(factoryCalls, 1);
  assert.equal(harness.session.closeCalls, 0);
  assert.equal(harness.beta.controller.session, harness.session);
  assert.match(harness.elements.get("causal-state").textContent, /error de presentación/i);
  assert.match(harness.elements.get("causal-state").textContent, /renderer unavailable/i);
  harness.session.emit("causal-message");
  assert.equal(harness.elements.get("causal-state").textContent, `Causal: ${P2P_ROOM_LIFECYCLE_LABELS.active}`);
  harness.beta.destroy();
});

test("ONLINE-LIFECYCLE-25 beta projects every lifecycle state without transport details", async () => {
  const harness = await openBeta();
  const states = ["waitingOpponent", "negotiating", "channelReady", "active", "waitingReplacement", "hostLeft", "error"];
  for (const state of states) {
    harness.beta.handleSessionEvent({ type: "lifecycle", state });
    assert.equal(harness.elements.get("causal-state").textContent, `Causal: ${P2P_ROOM_LIFECYCLE_LABELS[state]}`);
  }
  harness.beta.handleSessionEvent({ type: "lifecycle", state: "waitingReplacement" });
  harness.beta.handleSessionEvent({ type: "closed" });
  assert.equal(harness.elements.get("causal-state").textContent, `Causal: ${P2P_ROOM_LIFECYCLE_LABELS.waitingReplacement}`);
  harness.beta.handleSessionEvent({ type: "lifecycle", state: "hostLeft" });
  harness.beta.handleSessionEvent({ type: "closed" });
  assert.equal(harness.elements.get("causal-state").textContent, `Causal: ${P2P_ROOM_LIFECYCLE_LABELS.hostLeft}`);
  assert.doesNotMatch(harness.elements.get("causal-state").textContent, /https?:|secret|sdp|candidate|192\.0\.2\.1/i);
  harness.beta.destroy();
});

