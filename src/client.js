import * as THREE from "/node_modules/three/build/three.module.js";
// Use the vendored browser module. electron-builder deliberately excludes
// Three's examples tree from app.asar; importing that development-only path
// made the portable show "No se pudo cargar /src/client.js".
import { mergeVertices } from "/src/assets/utils/BufferGeometryUtils.js";
import { SnapshotInterpolator } from "./snapshot-interpolation.js";
import { consumeInputAcknowledgement, recordInputTransmission } from "./input-ack.js";
import { composeVehicleInput } from "./control-mapping.js";
import { mergeVehicleActions, readGamepadActions } from "./gamepad-input.js";
import { cameraFollowInput, createCameraFollowState, resetCameraFollowState, stepCameraFollow, CAMERA_FOLLOW_TUNING } from "./camera-follow.js";
import { getArenaFogSettings, getArenaVisualProfile, normalizeArenaVisualQuality } from "./arena-visual-profile.js";
import { createScrapyardShellMaterial, createScrapyardTireMaterial } from "./arena-scrapyard-material.js";
import { createClientHello, LAN_HEARTBEAT_INTERVAL_MS, normalizePilotName } from "./lan-session-protocol.js";
import { createLanInviteUrl, describePilotCapacity } from "./lan-session-ui.js";
import { createStateLiveness, recordAuthoritativeState, shouldReconnectForStateStall } from "./lan-client-liveness.js";
import { vehicleVisualAlignment } from "./vehicle-visual-alignment.js";
import { rocketSimArenaCameraFar, rocketSimArenaForWorldMode, rocketSimArenaProfile, rocketSimArenaSurfaceFootprint, rocketSimArenaVisualSpec } from "./rocketsim-arena-profile.js";
import { formatCombatHudReadout } from "./combat-hud.js";
import { describePlayerExperienceState } from "./player-experience-state.js";
import { describeEventFeedback } from "./event-feedback.js";
import { createVisualSmokePlayback, forceVisualSmokePhase, stepVisualSmokePlayback } from "./visual-smoke-playback.js";
import { aimWeaponMountAt, createVehicleVisualModel, spinVehicleWheels } from "./vehicle-visual-model.js";
import { combatAlphaObstacleVisualSpec, createArenaDecoration, createCombatAlphaCoverVisuals } from "./arena-decoration.js";
import { createAudioMixer } from "./audio-mixer.js";
import { createAssetAwarePrewarmGate, createBoundedPool, createDefaultFramebufferPrewarmer, createFirstEffectDiagnostics, createFrameMetrics, createRenderTargetPrewarmer, readRendererInfo } from "./client-performance.js";
import { computeAimDirection, createAimLockState, toggleAimLock, updateAimLock } from "./aim-lock.js";
import { consumeOnlineAccessTokenFragment } from "./online-access-token.js";

// Access links carry their JWT only in the fragment, which is not sent in the
// HTTP request. Remove it before the rest of the app can create/share URLs.
const onlineAccess = consumeOnlineAccessTokenFragment({ hash: location.hash, storage: sessionStorage });
if (onlineAccess.hadAccessTokenFragment) history.replaceState(null, "", `${location.pathname}${location.search}`);
const onlineAccessToken = onlineAccess.token;

const canvas = document.querySelector("#game");
const ui = {
  blue: document.querySelector("#blue"), red: document.querySelector("#red"),
  status: document.querySelector("#status"), objective: document.querySelector("#objective"), aimLock: document.querySelector("#aim-lock"), aimMarker: document.querySelector("#aim-marker"), readout: document.querySelector("#readout"), performance: document.querySelector("#performance-readout"), events: document.querySelector("#events"), scoreboard: document.querySelector(".scoreboard"), loading: document.querySelector("#combat-loading"), loadingTitle: document.querySelector("#combat-loading-title"), loadingDetail: document.querySelector("#combat-loading-detail"), loadingContinue: document.querySelector("#combat-loading-continue")
};
const held = new Set();
const defaultBindings = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", drift: "ShiftLeft", rollLeft: "ControlLeft", rollRight: "Space", jump: "MouseRight", boost: "MouseLeft", fire: "KeyF", lockTarget: "KeyQ", restart: "KeyR" };
const actionLabels = { forward: "Acelerar", back: "Frenar / marcha atrás", left: "Girar izquierda", right: "Girar derecha", drift: "Derrape / air roll", rollLeft: "Air roll direccional izquierda", rollRight: "Air roll direccional derecha", jump: "Saltar / doble salto", boost: "Nitro", fire: "Lanzar cohete", lockTarget: "Bloquear objetivo", restart: "Reiniciar ronda" };
let bindings = loadBindings();
let pendingBinding = null;
const mouseHeld = new Set();
let state = null, renderState = null, localId = null, localTeam = null, socket = null, lastInputAt = 0, inputSequence = 0, acknowledgedInput = 0, inputRoundTripMs = null, previousEvent = "", previousEventAudioKey = "", lastFrameAt = performance.now(), frameNumber = 0;
let connectionPhase = "loading", connectionDetail = "", localSessionOwner = null;
const AUDIO_VOLUME_STORAGE_KEY = "arsenal-audio-volume";
const AUDIO_MUTED_STORAGE_KEY = "arsenal-audio-muted";
function readAudioPreferences() {
  try {
    const rawVolume = Number.parseFloat(localStorage.getItem(AUDIO_VOLUME_STORAGE_KEY) || "");
    const volume = Number.isFinite(rawVolume) ? Math.min(1, Math.max(0, rawVolume)) : .3;
    return { volume, muted: localStorage.getItem(AUDIO_MUTED_STORAGE_KEY) === "1" };
  } catch {
    return { volume: .3, muted: false };
  }
}
const audioMixer = createAudioMixer(readAudioPreferences());
let audioUnlocked = false;
if (typeof window !== "undefined") window.__arsenalAudioMixer = audioMixer;
// The first combat effect is allowed only after its renderer and audio paths
// have been deliberately paid under a loading cover. This is presentation
// state: it never delays the authoritative server, socket, or simulation.
const combatPresentation = {
  audioRequested: false,
  audioReady: false,
  visualReady: false,
  ready: false,
  reason: "Conectando con la arena…",
};
function renderCombatLoading() {
  if (!ui.loading) return;
  ui.loading.hidden = combatPresentation.ready;
  if (ui.loadingTitle) ui.loadingTitle.textContent = combatPresentation.ready ? "COMBATE LISTO" : "PREPARANDO COMBATE";
  if (ui.loadingDetail) ui.loadingDetail.textContent = combatPresentation.reason;
  if (ui.loadingContinue) {
    const waitingForGesture = !combatPresentation.audioRequested;
    ui.loadingContinue.hidden = combatPresentation.ready;
    ui.loadingContinue.disabled = !waitingForGesture;
    ui.loadingContinue.textContent = waitingForGesture ? "ACTIVAR Y CARGAR" : "CARGANDO…";
  }
}
function requestCombatVisualWarmup(reason = "Preparando recursos visuales de combate…") {
  combatPresentation.visualReady = false;
  combatPresentation.ready = false;
  combatPresentation.reason = combatPresentation.audioReady ? reason : "Haz clic para activar audio y preparar el combate…";
  held.clear(); mouseHeld.clear();
  renderCombatLoading();
}
function refreshCombatPresentation() {
  const warmup = rocketEffectsPrewarm?.getSnapshot?.();
  combatPresentation.visualReady = Boolean(warmup?.settled);
  if (!combatPresentation.audioRequested) {
    combatPresentation.reason = "Haz clic para activar audio y preparar el combate…";
  } else if (!combatPresentation.audioReady) {
    combatPresentation.reason = "Cargando sonidos de motor, nitro y combate…";
  } else if (!combatPresentation.visualReady) {
    combatPresentation.reason = "Calentando efectos de cohetes y explosiones…";
  } else {
    combatPresentation.ready = true;
    combatPresentation.reason = "Combate listo.";
  }
  renderCombatLoading();
  if (combatPresentation.ready) canvas.focus({ preventScroll: true });
}
async function prepareCombatPresentation(event) {
  if (event?.isTrusted === false || combatPresentation.audioRequested) return;
  combatPresentation.audioRequested = true;
  combatPresentation.reason = "Activando audio…";
  renderCombatLoading();
  const unlocked = await unlockAudioFromGesture(event);
  if (unlocked) {
    combatPresentation.reason = "Cargando sonidos de motor, nitro y combate…";
    renderCombatLoading();
    // The mixer has a bounded fallback, so an unavailable file cannot trap the
    // player here. Its generated fallback remains available in that case.
    await audioMixer.preloadCombat();
  }
  combatPresentation.audioReady = true;
  refreshCombatPresentation();
}
const audioMotionState = { speed: 0, braking: false, drifting: false, nitro: false };
function resetAudioMotionState() {
  audioMotionState.speed = 0;
  audioMotionState.braking = false;
  audioMotionState.drifting = false;
  audioMotionState.nitro = false;
  audioMixer.setMotorState({ active: false });
  audioMixer.setNitroState({ active: false });
  audioMixer.setDriftState({ active: false });
}
const visualSmokeEnabled = new URLSearchParams(location.search).get("visualSmoke") === "1";
// Presentation-only tier, defaulting high. `?quality=low` selects the existing
// opaque fallback without touching simulation, network or HUD state.
const visualQuality = normalizeArenaVisualQuality(new URLSearchParams(location.search).get("quality"));
const visualSmokePlayback = visualSmokeEnabled ? createVisualSmokePlayback() : null;
if (visualSmokeEnabled) window.__arsenalVisualSmoke = { phase: "boot", captureHold: false, captureHoldStartedAt: null, cameraWarmup: 0, cameraSamples: [] };
const pendingInputTimes = new Map();
const snapshotInterpolator = new SnapshotInterpolator();
const lanRoomId = new URLSearchParams(location.search).get("room") || "local";
const sessionNameInput = document.querySelector("#session-name");
const sessionConnectionOutput = document.querySelector("#session-connection");
const sessionRoleOutput = document.querySelector("#session-role");
const sessionPilotsOutput = document.querySelector("#session-pilots");
const sessionInviteStatus = document.querySelector("#session-invite-status");
function loadPilotName() {
  try { return normalizePilotName(localStorage.getItem("arsenal-name")); } catch { return "PILOTO"; }
}
let localPilotName = loadPilotName();
if (sessionNameInput) sessionNameInput.value = localPilotName;
function persistPilotName() {
  localPilotName = normalizePilotName(sessionNameInput?.value);
  if (sessionNameInput) sessionNameInput.value = localPilotName;
  try { localStorage.setItem("arsenal-name", localPilotName); } catch { /* Storage may be unavailable in private browsing. */ }
}
sessionNameInput?.addEventListener("change", persistPilotName);
sessionNameInput?.addEventListener("input", persistPilotName);
sessionNameInput?.addEventListener("blur", persistPilotName);
function renderSessionPanel() {
  const room = document.querySelector("#session-room");
  if (room) room.textContent = lanRoomId;
  if (sessionConnectionOutput) sessionConnectionOutput.textContent = ({ loading: "Iniciando", connecting: "Conectando", synchronizing: "Sincronizando", playing: "Conectado", error: "Error", reconnecting: "Reconectando" })[connectionPhase] || connectionPhase;
  if (sessionRoleOutput) {
    const team = localTeam === "blue" ? "AZUL" : localTeam === "red" ? "ROJO" : null;
    sessionRoleOutput.textContent = localSessionOwner === null
      ? "Esperando al servidor"
      : `${localSessionOwner ? "Anfitrión" : "Piloto"}${team ? ` · ${team}` : ""}`;
  }
  if (sessionPilotsOutput) sessionPilotsOutput.textContent = describePilotCapacity(state);
}
renderSessionPanel();
document.querySelector("#session-invite-copy")?.addEventListener("click", async () => {
  const inviteUrl = createLanInviteUrl(location.href, lanRoomId);
  if (sessionInviteStatus) sessionInviteStatus.textContent = "";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API no disponible");
    await navigator.clipboard.writeText(inviteUrl);
    if (sessionInviteStatus) sessionInviteStatus.textContent = "Enlace LAN copiado. Compártelo con alguien conectado a la misma red.";
  } catch {
    if (sessionInviteStatus) sessionInviteStatus.textContent = `Copia y comparte por LAN este enlace: ${inviteUrl}`;
  }
});
const lanSessionId = (() => {
  try {
    const stored = sessionStorage.getItem("arsenal-session-id");
    if (stored) return stored;
    const created = `web-${crypto.randomUUID()}`;
    sessionStorage.setItem("arsenal-session-id", created);
    return created;
  } catch {
    return `web-${Math.random().toString(36).slice(2)}`;
  }
})();
let heartbeatTimer = null, stateLivenessTimer = null, stateLiveness = null;

function loadBindings() {
  try { return { ...defaultBindings, ...JSON.parse(localStorage.getItem("arsenal-bindings") || "{}")} ; } catch { return { ...defaultBindings }; }
}
function saveBindings() { localStorage.setItem("arsenal-bindings", JSON.stringify(bindings)); }
function bindingName(code) { return { MouseLeft: "Clic izquierdo", MouseRight: "Clic derecho", ControlLeft: "Ctrl izquierdo", ShiftLeft: "Mayús izquierdo", Space: "Espacio" }[code] || code.replace(/^Key/, ""); }
function renderBindingPanel() {
  const root = document.querySelector("#bindings"); if (!root) return;
  root.replaceChildren();
  for (const [action, label] of Object.entries(actionLabels)) {
    const row = document.createElement("div"); row.className = "binding-row";
    const name = document.createElement("span"); name.textContent = label;
    const button = document.createElement("button"); button.type = "button"; button.dataset.action = action; button.textContent = pendingBinding === action ? "Pulsa…" : bindingName(bindings[action]);
    if (pendingBinding === action) button.classList.add("listening");
    button.addEventListener("click", () => { pendingBinding = action; renderBindingPanel(); });
    row.append(name, button); root.append(row);
  }
}
function finishBinding(code) { if (!pendingBinding) return; bindings[pendingBinding] = code; pendingBinding = null; saveBindings(); renderBindingPanel(); }
function toggleControls(show) { const panel = document.querySelector("#controls-panel"), button = document.querySelector("#controls-button"); panel.hidden = !show; button.setAttribute("aria-expanded", String(show)); if (show) renderBindingPanel(); }
document.querySelector("#controls-button").addEventListener("click", () => toggleControls(document.querySelector("#controls-panel").hidden));
document.querySelector("#controls-close").addEventListener("click", () => toggleControls(false));
document.querySelector("#controls-reset").addEventListener("click", () => { bindings = { ...defaultBindings }; saveBindings(); pendingBinding = null; renderBindingPanel(); });
renderBindingPanel();

async function unlockAudioFromGesture(event) {
  // `isTrusted` is false for programmatic events. A real pointer/key gesture
  // is the only path allowed to resume Web Audio; unavailable contexts simply
  // return false and leave the textual HUD feedback untouched.
  if (event?.isTrusted === false || audioUnlocked) return audioUnlocked;
  try { audioUnlocked = await audioMixer.unlock(); } catch { audioUnlocked = false; }
  renderAudioControls();
  return audioUnlocked;
}

const muteControl = document.querySelector("#audio-mute, [data-audio-mute]");
const volumeControl = document.querySelector("#audio-volume, [data-audio-volume]");
const volumeValue = document.querySelector("#audio-volume-value, [data-audio-volume-value]");
const audioStatus = document.querySelector("#audio-status, [data-audio-status]");
function persistAudioPreferences() {
  try {
    const current = audioMixer.getState();
    localStorage.setItem(AUDIO_VOLUME_STORAGE_KEY, String(current.volume));
    localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, current.muted ? "1" : "0");
  } catch { /* private browsing or unavailable storage must not block play */ }
}
function renderAudioControls() {
  const current = audioMixer.getState();
  const percent = Math.round(current.volume * 100);
  if (volumeControl) {
    volumeControl.value = String(current.volume);
    volumeControl.setAttribute("aria-valuetext", `${percent}%`);
  }
  if (volumeValue) volumeValue.textContent = `${percent}%`;
  if (muteControl) {
    muteControl.textContent = current.muted ? "Activar sonido" : "Silenciar";
    muteControl.setAttribute("aria-pressed", String(current.muted));
  }
  if (audioStatus) {
    audioStatus.textContent = !current.supported
      ? "Audio no disponible · feedback visual activo"
      : current.muted
        ? "Audio silenciado"
        : audioUnlocked
          ? `Audio activo · ${percent}%`
          : "Interactúa con el juego para activar el audio";
  }
}
if (muteControl) muteControl.addEventListener("click", () => { audioMixer.setMuted(!audioMixer.getState().muted); persistAudioPreferences(); renderAudioControls(); });
if (volumeControl) volumeControl.addEventListener("input", event => { audioMixer.setVolume(event.target.value); persistAudioPreferences(); renderAudioControls(); });
renderAudioControls();
ui.loadingContinue?.addEventListener("click", event => { void prepareCombatPresentation(event); });
renderCombatLoading();
addEventListener("pointerdown", event => { void prepareCombatPresentation(event); }, { passive: true });

function inRocketSimCurvedPractice() { return state?.settings?.practiceArena === "arsenal-curved-practice"; }
function inRocketSimCorneredPractice() { return state?.settings?.practiceArena === "arsenal-expanded-cornered-practice"; }
function inRocketSimBlockPractice() { return state?.settings?.practiceArena === "arsenal-expanded-block-practice"; }
function inRocketSimRampPractice() { return state?.settings?.practiceArena === "arsenal-expanded-ramp-practice"; }
function inRocketSimCombatAlpha() { return state?.settings?.practiceArena === "combat-alpha"; }
function inRocketSimPractice() { return state?.settings?.movementBackend === "rocketsim"; }

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const frameMetrics = createFrameMetrics();
const firstEffectDiagnostics = createFirstEffectDiagnostics({ renderer, metrics: frameMetrics, getFrame: () => frameNumber });
const performanceDiagnostics = Object.freeze({
  getSnapshot: () => readRendererInfo(renderer, frameMetrics, { qualityTier: visualQuality }),
  getFirstEffect: () => firstEffectDiagnostics.getSnapshot(),
  getEffects: () => firstEffectDiagnostics.getEffects(),
  // Useful for first-rocket reports: this distinguishes a received state
  // from a completed one-shot warmup.
  getRocketWarmup: () => rocketEffectsPrewarm.getSnapshot(),
});
if (typeof window !== "undefined") Object.defineProperty(window, "__arsenalPerformance", { configurable: false, enumerable: false, writable: false, value: performanceDiagnostics });
const scene = new THREE.Scene();
const initialVisualProfile = getArenaVisualProfile(undefined, { quality: visualQuality });
scene.background = new THREE.Color(initialVisualProfile.background);
const initialFog = getArenaFogSettings(initialVisualProfile);
scene.fog = initialFog ? new THREE.Fog(initialFog.color, initialFog.near, initialFog.far) : null;
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, .1, 250);
camera.up.set(0, 1, 0);
const cameraFollowState = createCameraFollowState();
const cameraFocus = new THREE.Vector3();
const aimLock = createAimLockState();
const aimProjectionPoint = new THREE.Vector3();
const aimForward = new THREE.Vector3(1, 0, 0);
const aimTargetWorld = new THREE.Vector3();
const aimLaserStart = new THREE.Vector3();
const aimLaserEnd = new THREE.Vector3();
const aimLaserGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const aimLaserCore = new THREE.Mesh(aimLaserGeometry, new THREE.MeshBasicMaterial({ color: 0xb5f5ff, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
const aimLaserHalo = new THREE.Mesh(aimLaserGeometry, new THREE.MeshBasicMaterial({ color: 0x38dfff, transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
const aimLaserDirection = new THREE.Vector3();
const aimLaserCenter = new THREE.Vector3();
const aimLaserUp = new THREE.Vector3(0, 1, 0);
const aimLaserOrientation = new THREE.Quaternion();
for (const beam of [aimLaserHalo, aimLaserCore]) { beam.frustumCulled = false; beam.visible = false; scene.add(beam); }
let aimCandidates = [];
const aimCandidatePool = [];
const cleanPracticeCameraBounds = Object.freeze({ minPositionY: 2.8, maxPositionY: 21.2, minFocusY: .8, maxFocusY: 22.2 });
const expandedPracticeCameraBounds = Object.freeze({ minPositionY: 2.8, maxPositionY: 27.2, minFocusY: .8, maxFocusY: 28.2 });
let activeCameraHorizontalBounds = null;
let activeCameraVerticalBounds = null;
let cameraFocusInitialized = false;
let cameraFollowCarId = null, cameraFollowRespawnSerial = null;
const carMeshes = new Map();
// Asset promises are presentation-only. They gate the first projectile draw
// while the authoritative socket continues to receive and render state.
const vehicleAssetReadiness = new Set();
const rocketMeshes = new Map();
const rocketPoolCapacity = 24;
const explosionPoolCapacity = 24;
const padMeshes = new Map();
const world = new THREE.Group();
const cameraCovers = [];
let worldMode = "";
let lighting = null;
let arenaDecoration = null;
let scrapyardSkin = null;
let obstacleSkin = null;
let coverSkin = null;
let coverVisuals = null;
scene.add(world);

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: .2, ...options });
}

function applyArenaVisualProfile(mode) {
  const profile = getArenaVisualProfile(mode, { quality: visualQuality });
  scene.background.setHex(profile.background);
  const fog = getArenaFogSettings(profile);
  if (!fog) {
    scene.fog = null;
  } else {
    if (!scene.fog) scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    else {
      scene.fog.color.setHex(fog.color);
      scene.fog.near = fog.near;
      scene.fog.far = fog.far;
    }
  }
  palette.floor.color.setHex(profile.floor);
  palette.steel.color.setHex(profile.steel);
  renderer.toneMappingExposure = profile.lighting.exposure;
  if (lighting) {
    lighting.hemisphere.color.setHex(profile.lighting.hemisphereSky ?? 0xb8d8eb);
    lighting.hemisphere.groundColor.setHex(profile.lighting.hemisphereGround ?? 0x102018);
    lighting.hemisphere.intensity = profile.lighting.hemisphere;
    lighting.sun.intensity = profile.lighting.sun;
    lighting.blueWash.intensity = profile.lighting.wash;
    lighting.redWash.intensity = profile.lighting.wash;
  }
  return profile;
}

function smoothing(rate, dt) { return 1 - Math.exp(-rate * Math.min(dt, .05)); }
function lerpAngle(current, target, amount) { return current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * amount; }

const palette = {
  floor: material(0x15262e, { roughness: .92 }), steel: material(0x3a515d, { metalness: .55 }),
  rust: material(0x71493a, { roughness: .85 }), hazard: material(0xd0913a, { metalness: .4 }),
  blue: material(0x168ed3, { roughness: .32, metalness: .55, emissive: 0x073b5d, emissiveIntensity: .35 }),
  red: material(0xd03d43, { roughness: .34, metalness: .5, emissive: 0x541015, emissiveIntensity: .35 }),
  glass: material(0x8ed7e4, { roughness: .18, metalness: .1, emissive: 0x123c48, emissiveIntensity: .45 }),
  tire: material(0x10161b, { roughness: .82 }), black: material(0x151b20),
  booster: material(0xffa529, { roughness: .25, emissive: 0xc94a00, emissiveIntensity: 2 }),
  concrete: material(0x263841, { roughness: .96 }), silver: material(0x7d97a1, { metalness: .8, roughness: .28 }),
  blueLight: material(0x59cfff, { emissive: 0x168ed3, emissiveIntensity: 2, roughness: .22 }),
  redLight: material(0xff6665, { emissive: 0xd03d43, emissiveIntensity: 2, roughness: .22 })
};

function mesh(geometry, mat, cast = true) {
  const object = new THREE.Mesh(geometry, mat); object.castShadow = cast; object.receiveShadow = true; return object;
}
function box(parent, size, position, mat, rotation = [0, 0, 0]) {
  const object = mesh(new THREE.BoxGeometry(...size), mat); object.position.set(...position); object.rotation.set(...rotation); parent.add(object); return object;
}

function barrel(parent, x, z, tint = palette.rust) {
  const drum = mesh(new THREE.CylinderGeometry(.48, .48, 1.25, 14), tint); drum.position.set(x, .63, z); parent.add(drum);
  for (const y of [.22, 1.02]) { const ring = mesh(new THREE.TorusGeometry(.49, .05, 6, 14), palette.black, false); ring.position.set(x, y, z); ring.rotation.x = Math.PI / 2; parent.add(ring); }
}

function buildRamp(parent, x, z, ascend = 1) {
  const halfX = 8, halfZ = 9, rise = 2.45;
  const vertices = new Float32Array([
    -halfX, 0, -halfZ, halfX, 0, -halfZ, halfX, 0, halfZ, -halfX, 0, halfZ,
    -halfX, 0, -halfZ, halfX, rise, -halfZ, halfX, rise, halfZ, -halfX, 0, halfZ
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const root = mesh(geometry, palette.hazard); root.position.set(x, 0, z); root.rotation.y = ascend < 0 ? Math.PI : 0; parent.add(root);
  for (const localX of [-5.5, -1.5, 2.5, 6]) {
    const height = ((localX + halfX) / (halfX * 2)) * rise;
    box(root, [.3, .06, 17.2], [localX, height + .05, 0], palette.black);
  }
  return root;
}

function setupLighting() {
  const initialLighting = getArenaVisualProfile(undefined, { quality: visualQuality }).lighting;
  const hemisphere = new THREE.HemisphereLight(
    initialLighting.hemisphereSky ?? 0xb8d8eb,
    initialLighting.hemisphereGround ?? 0x102018,
    initialLighting.hemisphere ?? 2.1,
  ); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe2b0, 3.45); sun.position.set(-35, 55, 32); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -80; sun.shadow.camera.right = 80; sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65; scene.add(sun);
  const blueWash = new THREE.PointLight(0x249fe8, 28, 52, 2); blueWash.position.set(-50, 11, -34); scene.add(blueWash);
  const redWash = new THREE.PointLight(0xff4f52, 28, 52, 2); redWash.position.set(50, 11, 34); scene.add(redWash);
  return { hemisphere, sun, blueWash, redWash };
}

// Keep the visual boom just inside the authoritative arena volume. This is
// deliberately derived from the same named profile used by the renderer: a
// combat-alpha camera must not retain the old practice-only 69 x 51 rectangle.
function cameraHorizontalBoundsForArena(arena) {
  if (!arena || !Number.isFinite(arena.halfWidth) || !Number.isFinite(arena.halfDepth)) return null;
  const inset = Math.max(1.35, Math.min(2.4, (Number(arena.curveRadius) || 0) * .22));
  return Object.freeze({
    minX: -arena.halfWidth + inset,
    maxX: arena.halfWidth - inset,
    minZ: -arena.halfDepth + inset,
    maxZ: arena.halfDepth - inset,
  });
}

function cameraVerticalBoundsForArena(arena) {
  if (!arena || !Number.isFinite(arena.height)) return null;
  const extraHeight = Math.max(0, arena.height - 36);
  return Object.freeze({
    minPositionY: 2.8,
    maxPositionY: 27.2 + extraHeight,
    minFocusY: .8,
    maxFocusY: 28.2 + extraHeight,
  });
}

function buildWorld(mode = "rocketsim-combat-alpha") {
  arenaDecoration?.dispose?.();
  coverVisuals?.dispose?.();
  scrapyardSkin?.dispose?.();
  obstacleSkin?.dispose?.();
  coverSkin?.dispose?.();
  arenaDecoration = null;
  coverVisuals = null;
  scrapyardSkin = null;
  obstacleSkin = null;
  coverSkin = null;
  world.clear(); padMeshes.clear(); cameraCovers.length = 0;
  const visualProfile = applyArenaVisualProfile(mode);
  const rocketSimArena = rocketSimArenaProfile(rocketSimArenaForWorldMode(mode));
  camera.far = rocketSimArenaCameraFar(rocketSimArena);
  camera.updateProjectionMatrix();
  activeCameraHorizontalBounds = cameraHorizontalBoundsForArena(rocketSimArena);
  activeCameraVerticalBounds = cameraVerticalBoundsForArena(rocketSimArena);
  const arenaVisualSpec = rocketSimArenaVisualSpec(rocketSimArena);
  const expanded = rocketSimArena?.expanded === true;
  const width = rocketSimArena ? rocketSimArena.halfWidth * 2 : 124;
  const depth = rocketSimArena ? rocketSimArena.halfDepth * 2 : 92;
  const height = rocketSimArena ? rocketSimArena.height : 24;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  if (lighting?.sun?.shadow?.camera && rocketSimArena) {
    const shadowCamera = lighting.sun.shadow.camera;
    // The combat arena is now 264×408×108. Keep the complete playable volume
    // inside the directional-light frustum so the enlarged outer lanes do not
    // lose vehicle/pickup shadows at the old 160×130 bounds.
    const shadowHalfExtent = Math.max(65, halfDepth, halfWidth);
    shadowCamera.left = -shadowHalfExtent;
    shadowCamera.right = shadowHalfExtent;
    shadowCamera.top = shadowHalfExtent;
    shadowCamera.bottom = -shadowHalfExtent;
    shadowCamera.updateProjectionMatrix?.();
  }
  const curveRadius = rocketSimArena?.curveRadius || 0;
  const cornered = rocketSimArena?.cornered === true;
  const combatAlpha = mode === "rocketsim-combat-alpha";
  const surfacePresentation = {
    opaque: visualProfile.surface?.opaque === true,
    unified: visualProfile.surface?.unified === true,
    showFloorGrid: visualProfile.showGrid ?? visualProfile.surface?.showGrid ?? visualProfile.surface?.showFloorGrid ?? true,
    showCeilingGrid: visualProfile.showGrid ?? visualProfile.surface?.showGrid ?? visualProfile.surface?.showCeilingGrid ?? true,
    showCurveLines: visualProfile.showCurveOverlay ?? visualProfile.surface?.showCurveOverlay ?? visualProfile.surface?.showCurveLines ?? true,
    showBoundaryDebugLines: visualProfile.surface?.showBoundaryDebugLines ?? true,
  };
  // The decoration owns the combat-alpha landmarks and team wash lights.
  // Keep the older global wash lights available for the other arena skins,
  // but avoid rendering two sets of equivalent lights in combat-alpha.
  if (lighting?.blueWash && lighting?.redWash) {
    lighting.blueWash.visible = !combatAlpha;
    lighting.redWash.visible = !combatAlpha;
  }
  // Presentation-only boundary materials. RocketSim remains the sole source
  // of collision; transparency is deliberately applied to the Three.js skin.
  let shellMaterial = null;
  if (surfacePresentation.unified) {
    if (visualProfile.surface?.skin === "industrial-scrapyard") {
      scrapyardSkin = createScrapyardShellMaterial({ THREE, renderer, quality: visualQuality });
      shellMaterial = scrapyardSkin.material;
    } else {
      shellMaterial = material(visualProfile.surface.materialColor ?? visualProfile.steel, {
        transparent: false,
        opacity: 1,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        emissive: visualProfile.surface.materialEmissive ?? visualProfile.boundaryGlow,
        emissiveIntensity: visualProfile.surface.materialEmissiveIntensity ?? visualProfile.boundaryGlowIntensity,
        metalness: visualProfile.surface.materialMetalness ?? .22,
        roughness: visualProfile.surface.materialRoughness ?? .74,
      });
    }
  }
  const boundaryMaterial = shellMaterial || material(visualProfile.steel, {
    transparent: !surfacePresentation.opaque,
    opacity: visualProfile.wallOpacity,
    // Transparent double-sided walls previously allowed depth-order flicker
    // and made the ceiling intermittently draw over the car. Keep the skin
    // translucent but make its depth contribution deterministic.
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    side: THREE.DoubleSide,
    emissive: visualProfile.boundaryGlow,
    emissiveIntensity: visualProfile.boundaryGlowIntensity,
    metalness: .32,
    roughness: .58,
  });
  const surfaceFootprint = rocketSimArenaSurfaceFootprint(arenaVisualSpec) || [{ x: 0, z: 0, width, depth }];
  const unifiedShell = surfacePresentation.unified && Boolean(shellMaterial && arenaVisualSpec?.curveRadius > 0);
  if (!unifiedShell) {
    for (const rectangle of surfaceFootprint) {
      const floor = mesh(new THREE.PlaneGeometry(rectangle.width, rectangle.depth), shellMaterial || palette.floor);
      floor.rotation.x = -Math.PI / 2; floor.position.set(rectangle.x, -.17, rectangle.z); world.add(floor);
    }
  }
  if (surfacePresentation.showFloorGrid) {
    const grid = new THREE.GridHelper(width, expanded ? 36 : 31, visualProfile.gridMajor, visualProfile.gridMinor); grid.scale.z = depth / width; grid.position.y = -.14; grid.material.transparent = true; grid.material.opacity = .42; world.add(grid);
  }
  const wallSegments = arenaVisualSpec?.wallSegments || [
    { axis: "z", fixed: -halfWidth, min: -halfDepth, max: halfDepth, minY: 0, maxY: height },
    { axis: "z", fixed: halfWidth, min: -halfDepth, max: halfDepth, minY: 0, maxY: height },
    { axis: "x", fixed: -halfDepth, min: -halfWidth, max: halfWidth, minY: 0, maxY: height },
    { axis: "x", fixed: halfDepth, min: -halfWidth, max: halfWidth, minY: 0, maxY: height },
  ];
  if (!unifiedShell) {
    for (const segment of wallSegments) {
      const segmentHeight = segment.maxY - segment.minY;
      const centerY = segment.minY + segmentHeight / 2;
      const midpoint = (segment.min + segment.max) / 2;
      if (segment.axis === "z") {
        box(world, [1, segmentHeight, segment.max - segment.min], [segment.fixed, centerY, midpoint], boundaryMaterial);
      } else {
        box(world, [segment.max - segment.min, segmentHeight, 1], [midpoint, centerY, segment.fixed], boundaryMaterial);
      }
    }
  }
  const ceilingMaterial = shellMaterial || new THREE.MeshStandardMaterial({
    color: visualProfile.ceiling,
    transparent: !surfacePresentation.opaque,
    opacity: visualProfile.ceilingOpacity,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    side: THREE.DoubleSide,
    emissive: visualProfile.boundaryGlow,
    emissiveIntensity: visualProfile.boundaryGlowIntensity,
    roughness: .62,
    metalness: .18,
  });
  if (unifiedShell) {
    addUnifiedRocketSimArenaShell({
      spec: arenaVisualSpec,
      surfaceFootprint,
      material: shellMaterial,
      wallSegments,
    });
  } else {
    for (const rectangle of surfaceFootprint) {
      const ceiling = mesh(new THREE.PlaneGeometry(rectangle.width, rectangle.depth), ceilingMaterial, false);
      ceiling.rotation.x = Math.PI / 2; ceiling.position.set(rectangle.x, height, rectangle.z); world.add(ceiling);
    }
  }
  if (surfacePresentation.showCeilingGrid) {
    const roofGrid = new THREE.GridHelper(width, expanded ? 18 : 16, visualProfile.gridMajor, visualProfile.gridMinor);
    roofGrid.scale.z = depth / width; roofGrid.position.y = height - .025;
    roofGrid.material.transparent = true; roofGrid.material.opacity = .24; roofGrid.material.depthWrite = false;
    world.add(roofGrid);
  }
  if (mode === "calibration" || rocketSimArena) {
    if (!combatAlpha) addPracticeLandmarks({ width, depth, height, cornerRadius: curveRadius, visualProfile, cornered, teamAxis: "z" });
    if (arenaVisualSpec?.curveRadius > 0 && !unifiedShell) addRocketSimCurveVisual({ spec: arenaVisualSpec, visualProfile, shellMaterial });
    if (expanded) {
      if (mode === "rocketsim-expanded-block-practice") addRocketSimBlockVisual();
      if (mode === "rocketsim-expanded-ramp-practice") addRocketSimRampVisual();
      if (combatAlpha) {
        // These are render-only skins for fixed native colliders. Their
        // brighter industrial material is intentionally scoped to combat so
        // the practice diagnostics preserve their established appearance.
        const obstacleVisual = combatAlphaObstacleVisualSpec();
        const obstacleFinish = visualProfile.obstacles;
        const hazardBandHeight = Math.max(.08, Math.min(.6, Number(obstacleFinish.hazardBandHeight) || .38));
        const fallbackObstacleMaterial = () => material(obstacleFinish.body, {
          roughness: obstacleFinish.bodyRoughness ?? .86,
          metalness: obstacleFinish.bodyMetalness ?? .12,
          emissive: obstacleFinish.bodyEmissive,
          emissiveIntensity: obstacleFinish.bodyEmissiveIntensity,
          side: THREE.DoubleSide,
        });
        let obstacleMaterial = null;
        if (visualProfile.surface?.skin === "industrial-scrapyard") {
          try {
            obstacleSkin = createScrapyardShellMaterial({ THREE, renderer, quality: visualQuality });
          obstacleMaterial = obstacleSkin.material;
          // Keep the ART-03 fallback legible as an obstacle while textures load.
          obstacleMaterial.color?.setHex?.(obstacleFinish.body);
          obstacleMaterial.emissive?.setHex?.(obstacleFinish.bodyEmissive);
          obstacleMaterial.emissiveIntensity = obstacleFinish.bodyEmissiveIntensity;
          obstacleMaterial.roughness = obstacleFinish.bodyRoughness ?? .86;
          obstacleMaterial.metalness = obstacleFinish.bodyMetalness ?? .12;
          const activeSkin = obstacleSkin;
          activeSkin.ready.then((ready) => {
            if (!ready || obstacleSkin !== activeSkin) return;
            const baseCompile = obstacleMaterial.onBeforeCompile;
            if (typeof baseCompile !== "function") return;
            obstacleMaterial.onBeforeCompile = (shader) => {
              baseCompile(shader);
              const token = "smoothstep(0.8, 3.2, scrapyardPosition.y)";
              if (shader.fragmentShader.includes(token)) {
                shader.fragmentShader = shader.fragmentShader.replace(
                  token,
                  `smoothstep(0.04, ${hazardBandHeight.toFixed(2)}, scrapyardPosition.y)`,
                );
              }
            };
            obstacleMaterial.customProgramCacheKey = () => `arena-obstacle-scrapyard-${hazardBandHeight}`;
            obstacleMaterial.needsUpdate = true;
          }).catch(() => {});
          } catch {
            obstacleMaterial = fallbackObstacleMaterial();
          }
        }
        obstacleMaterial ||= fallbackObstacleMaterial();
        const obstacleCapMaterial = material(obstacleFinish.cap, {
          roughness: obstacleFinish.capRoughness ?? .58,
          metalness: obstacleFinish.capMetalness ?? .52,
          emissive: obstacleFinish.capEmissive,
          emissiveIntensity: obstacleFinish.capEmissiveIntensity,
        });
        try {
          coverSkin = createScrapyardTireMaterial({
            THREE,
            renderer,
            quality: visualQuality,
          });
        } catch {
          coverSkin = null;
        }
        coverVisuals = createCombatAlphaCoverVisuals({
          THREE,
          parent: world,
          materials: {
            container: obstacleMaterial,
            hazard: obstacleCapMaterial,
            tire: coverSkin?.material,
          },
        });
        addRocketSimBlockVisual(
          obstacleVisual.block.x,
          obstacleVisual.block.z,
          surfacePresentation.showBoundaryDebugLines,
          obstacleMaterial,
          obstacleCapMaterial,
          obstacleVisual.block.width,
          obstacleVisual.block.height,
          obstacleVisual.block.depth,
        );
        addRocketSimRampVisual(
          obstacleVisual.ramp.x,
          obstacleVisual.ramp.z,
          surfacePresentation.showBoundaryDebugLines,
          obstacleMaterial,
          obstacleVisual.ramp.run,
          obstacleVisual.ramp.width,
          obstacleVisual.ramp.height,
        );
      }
    }
    if (combatAlpha) {
      arenaDecoration = createArenaDecoration({
        THREE,
        parent: world,
        mode,
        arena: rocketSimArena,
        profile: visualProfile,
      });
      if (!surfacePresentation.showBoundaryDebugLines) {
        arenaDecoration?.traverse?.(object => {
          if (object.isLine || object.isLineSegments) object.visible = false;
        });
      }
    }
    return;
  }

  for (const [x, z, sx, sz, height, mat] of [[-14, -19, 11, 6, 5, palette.steel], [15, 20, 11, 6, 5, palette.rust], [-12, 19, 8, 8, 6, palette.steel], [15, -20, 8, 8, 6, palette.rust], [-54, 36, 5, 5, 12, palette.rust], [54, -36, 5, 5, 12, palette.rust]]) {
    box(world, [sx, height, sz], [x, height / 2, z], mat);
    box(world, [sx + .25, .22, sz + .25], [x, height + .12, z], palette.hazard);
  }
  cameraCovers.push([-14, -19, 5.5, 3], [15, 20, 5.5, 3], [-12, 19, 4, 4], [15, -20, 4, 4], [-54, 36, 2.5, 2.5], [54, -36, 2.5, 2.5]);
  for (const [x, z, tint] of [[-20, -25, palette.rust], [-18.8, -25, palette.rust], [22, 24, palette.steel], [23.2, 24, palette.steel], [-47, 27, palette.rust], [47, -27, palette.steel]]) barrel(world, x, z, tint);
  for (const [x, z, angle] of [[-35, 18, .5], [34, -17, -.7], [-2, 28, 1.1], [5, -29, -.9]]) {
    const scrap = mesh(new THREE.CylinderGeometry(.55, .8, 5.5, 7), palette.silver); scrap.position.set(x, 1.2, z); scrap.rotation.z = Math.PI / 2; scrap.rotation.y = angle; world.add(scrap);
  }
  buildRamp(world, -30, -8, 1); buildRamp(world, 30, 8, -1);
  const crane = new THREE.Group(); crane.position.set(0, 0, -43); world.add(crane);
  box(crane, [1.5, 15, 1.5], [-17, 7.5, 0], palette.rust); box(crane, [1.5, 15, 1.5], [17, 7.5, 0], palette.rust); box(crane, [36, 1.5, 1.5], [0, 15, 0], palette.rust); box(crane, [19, .7, .7], [5, 11, 0], palette.hazard, [0, 0, -.05]);
  const pads = [[-43, -27], [43, -27], [-43, 27], [43, 27], [0, -34], [0, 34], [-24, 0], [24, 0], [-7, -14], [7, 14]];
  pads.forEach(([x, z], id) => {
    const root = new THREE.Group(); root.position.set(x, .08, z); world.add(root);
    const disk = mesh(new THREE.CylinderGeometry(1.35, 1.35, .16, 24), palette.booster); root.add(disk);
    const ring = mesh(new THREE.TorusGeometry(1.6, .06, 8, 24), palette.hazard, false); ring.rotation.x = Math.PI / 2; ring.position.y = .12; root.add(ring); root.userData = { disk, ring }; padMeshes.set(id, root);
    const beam = mesh(new THREE.CylinderGeometry(.65, 1.2, 2.1, 16, 1, true), material(0xffc35a, { transparent: true, opacity: .2, emissive: 0xff8d19, emissiveIntensity: 1.7 }), false); beam.position.y = 1.05; root.add(beam);
    const light = new THREE.PointLight(0xffaa31, 2.4, 8); light.position.y = 1.2; root.add(light); root.userData.beam = beam; root.userData.light = light;
  });
}

function addRocketSimBlockVisual(x = 0, z = 0, showDebugLines = true, bodyMaterial = palette.concrete, capMaterial = palette.hazard, width = 14, height = 3.25, depth = 18) {
  // Exact Arsenal-world dimensions of the native btBoxShape in ARENA-05.
  const block = box(world, [width, height, depth], [x, height / 2, z], bodyMaterial);
  box(world, [width + .2, .16, depth + .2], [x, height + .08, z], capMaterial);
  if (showDebugLines) {
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(block.geometry), new THREE.LineBasicMaterial({ color: 0xb5edf0, transparent: true, opacity: .72 }));
    outline.position.copy(block.position); world.add(outline);
  }
}

function addRocketSimRampVisual(x = 0, z = 0, showDebugLines = true, rampMaterial = null, run = 10, width = 9, height = 3.5) {
  // Same six Arsenal-space vertices as the cached native ARENA-06 wedge.
  const vertices = new Float32Array([
    -run, 0, -width,  run, 0, -width,  -run, 0, width,
     run, 0, width,   run, height, -width,  run, height, width,
  ]);
  const indices = [0, 2, 1, 1, 2, 3, 0, 1, 4, 2, 5, 3, 1, 3, 5, 1, 5, 4, 0, 4, 5, 0, 5, 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ramp = new THREE.Mesh(geometry, rampMaterial || material(0x667f83, { roughness: .82, metalness: .16, side: THREE.DoubleSide }));
  ramp.position.set(x, 0, z); world.add(ramp);
  if (showDebugLines) {
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffc35a, transparent: true, opacity: .65 }));
    edge.position.set(x, 0, z); world.add(edge);
  }
}

function addPracticeLandmarks({ width, depth, height, cornerRadius, visualProfile, cornered, teamAxis = "z" }) {
  const surface = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .38, depthWrite: false, side: THREE.DoubleSide });
  const floorMark = (size, position, color) => {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(...size), surface(color));
    mark.rotation.x = -Math.PI / 2; mark.position.set(...position); world.add(mark);
  };
  floorMark([width * .84, .22], [0, -.125, 0], visualProfile.landmark);
  floorMark([width * .18, .12], [0, -.123, -depth * .27], visualProfile.blueZone);
  floorMark([width * .18, .12], [0, -.123, depth * .27], visualProfile.redZone);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(width, depth) * .075, .12, 8, 48), surface(visualProfile.landmark));
  ring.rotation.x = Math.PI / 2; ring.position.y = -.1; world.add(ring);
  addCombatReadabilityAccents({ width, depth, height, visualProfile, teamAxis });
  if (!cornered) return;
  const guideMaterial = new THREE.LineBasicMaterial({ color: visualProfile.guide, transparent: true, opacity: .3 });
  const insetX = width / 2 - cornerRadius, insetZ = depth / 2 - cornerRadius;
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const x = sx * (insetX + cornerRadius * Math.SQRT1_2);
    const z = sz * (insetZ + cornerRadius * Math.SQRT1_2);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, .08, z),
      new THREE.Vector3(x, height * .48, z),
      new THREE.Vector3(x, height - .2, z),
    ]);
    world.add(new THREE.Line(geometry, guideMaterial));
  }
}

function addCombatReadabilityAccents({ width, depth, height, visualProfile, teamAxis = "z" }) {
  const wash = (color, position, rotation, size) => {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: visualProfile.combatWashOpacity, depthWrite: false, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
    panel.position.set(...position); panel.rotation.set(...rotation); world.add(panel);
  };
  if (teamAxis === "x") {
    wash(visualProfile.combatBlueWash, [-width / 2 + .025, height * .28, 0], [0, Math.PI / 2, 0], [depth * .72, height * .48]);
    wash(visualProfile.combatRedWash, [width / 2 - .025, height * .28, 0], [0, -Math.PI / 2, 0], [depth * .72, height * .48]);
  } else {
    wash(visualProfile.combatBlueWash, [0, height * .28, -depth / 2 + .025], [0, 0, 0], [width * .72, height * .48]);
    wash(visualProfile.combatRedWash, [0, height * .28, depth / 2 - .025], [0, Math.PI, 0], [width * .72, height * .48]);
  }

  const lineMaterial = new THREE.LineBasicMaterial({ color: visualProfile.perimeter, transparent: true, opacity: visualProfile.perimeterOpacity });
  const y = .035;
  const inset = .55;
  const points = [
    new THREE.Vector3(-width / 2 + inset, y, -depth / 2 + inset),
    new THREE.Vector3(width / 2 - inset, y, -depth / 2 + inset),
    new THREE.Vector3(width / 2 - inset, y, depth / 2 - inset),
    new THREE.Vector3(-width / 2 + inset, y, depth / 2 - inset),
    new THREE.Vector3(-width / 2 + inset, y, -depth / 2 + inset),
  ];
  world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
}

function addUnifiedRocketSimArenaShell({ spec, surfaceFootprint, material: shellMaterial, wallSegments }) {
  const geometries = [];
  const prepare = geometry => {
    geometry.deleteAttribute?.("uv");
    // Normals must be generated only after all coincident edge vertices have
    // been welded; computing them per piece leaves visible bands at seams.
    geometry.deleteAttribute?.("normal");
    geometries.push(geometry);
  };
  // All planes meet the native curve endpoints at y=0/height.  They are
  // intentionally zero-thickness render surfaces; RocketSim remains the
  // collision authority and supplies the actual wall volume.
  for (const rectangle of surfaceFootprint) {
    const floor = new THREE.PlaneGeometry(rectangle.width, rectangle.depth);
    floor.rotateX(-Math.PI / 2); floor.translate(rectangle.x, 0, rectangle.z); prepare(floor);
    const ceiling = new THREE.PlaneGeometry(rectangle.width, rectangle.depth);
    ceiling.rotateX(Math.PI / 2); ceiling.translate(rectangle.x, spec.height, rectangle.z); prepare(ceiling);
  }
  for (const segment of wallSegments) {
    const segmentHeight = segment.maxY - segment.minY;
    const centerY = segment.minY + segmentHeight / 2;
    const midpoint = (segment.min + segment.max) / 2;
    const wall = new THREE.PlaneGeometry(segment.max - segment.min, segmentHeight);
    if (segment.axis === "z") {
      wall.rotateY(Math.PI / 2); wall.translate(segment.fixed, centerY, midpoint);
    } else {
      wall.translate(midpoint, centerY, segment.fixed);
    }
    prepare(wall);
  }
  addRocketSimCurveVisual({ spec, visualProfile: COMBAT_ALPHA_PROFILE_FALLBACK, geometrySink: geometries });
  // Keep one render entity and one material, but weld each parametric patch
  // independently. A global merge makes the four corner fillets intersect at
  // zero-area triangles and produces black diagonal artifacts in WebGL.
  const shellGroup = new THREE.Group();
  shellGroup.name = "arena-unified-shell";
  for (const geometry of geometries) {
    const welded = mergeVertices(geometry, 1e-4);
    welded.computeVertexNormals();
    shellGroup.add(mesh(welded, shellMaterial, false));
  }
  world.add(shellGroup);
}

// Kept separate from the imported profile to avoid a circular dependency in
// this browser module; only the curve helper's line/material defaults are
// needed when collecting geometry into the unified shell.
const COMBAT_ALPHA_PROFILE_FALLBACK = Object.freeze({
  curve: 0x496f78,
  curveOpacity: 1,
  boundaryGlow: 0x16333b,
  boundaryGlowIntensity: .16,
  surface: Object.freeze({ opaque: true, showCurveLines: false }),
});

function addRocketSimCurveVisual({ spec, visualProfile, shellMaterial = null, geometrySink = null }) {
  const { halfWidth, halfDepth, height, curveRadius: radius, curvedSides, cornerFillets: corners, clipCurveEnds } = spec;
  const segments = 32;
  const materialCurve = shellMaterial || material(visualProfile.curve, {
    roughness: .72,
    metalness: .16,
    side: THREE.DoubleSide,
    transparent: visualProfile.surface?.opaque !== true,
    opacity: visualProfile.curveOpacity,
    depthWrite: visualProfile.surface?.opaque === true,
    emissive: visualProfile.boundaryGlow,
    emissiveIntensity: visualProfile.boundaryGlowIntensity,
  });
  const stripeMaterial = visualProfile.surface?.showCurveLines === false
    ? null
    : new THREE.LineBasicMaterial({ color: visualProfile.curveStripe, transparent: true, opacity: .24 });
  const addCurveLines = geometry => {
    if (stripeMaterial) world.add(new THREE.LineSegments(geometry, stripeMaterial));
  };
  for (const side of curvedSides) {
    const positions = [], indices = [];
    const center = side === "positiveX" || side === "negativeX" ? (side === "positiveX" ? halfWidth - radius : -halfWidth + radius) : (side === "positiveZ" ? halfDepth - radius : -halfDepth + radius);
    const curveEndInset = clipCurveEnds ? radius : 0;
    const extrusionMin = side === "positiveX" || side === "negativeX" ? -halfDepth + curveEndInset : -halfWidth + curveEndInset;
    const extrusionMax = side === "positiveX" || side === "negativeX" ? halfDepth - curveEndInset : halfWidth - curveEndInset;
    const addArc = (thetaStart, thetaEnd, centerY) => {
      const point = (theta, extrusion) => {
        const radial = radius * Math.cos(theta), y = centerY + radius * Math.sin(theta);
        if (side === "positiveX") return [center + radial, y, extrusion];
        if (side === "negativeX") return [center - radial, y, extrusion];
        if (side === "positiveZ") return [extrusion, y, center + radial];
        return [extrusion, y, center - radial];
      };
      for (let index = 0; index < segments; index += 1) {
        const theta0 = thetaStart + (thetaEnd - thetaStart) * index / segments;
        const theta1 = thetaStart + (thetaEnd - thetaStart) * (index + 1) / segments;
        const points = [point(theta0, extrusionMin), point(theta1, extrusionMin), point(theta0, extrusionMax), point(theta1, extrusionMax)];
        const base = positions.length / 3;
        for (const [x, y, z] of points) positions.push(x, y, z);
        if (side === "negativeX" || side === "positiveZ") indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        else indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    };
    addArc(-Math.PI / 2, 0, radius);
    addArc(0, Math.PI / 2, height - radius);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    if (geometrySink) { geometry.deleteAttribute("normal"); geometrySink.push(geometry); }
    else world.add(new THREE.Mesh(geometry, materialCurve));
    if (!geometrySink) addCurveLines(geometry);
  }
  if (corners) {
    const cornerSegments = 16;
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const positions = [], indices = [];
      const centerX = sx * (halfWidth - radius), centerZ = sz * (halfDepth - radius);
      const point = (theta, phi) => [centerX + sx * radius * Math.cos(theta) * Math.cos(phi), radius + radius * Math.sin(theta), centerZ + sz * radius * Math.cos(theta) * Math.sin(phi)];
      for (let ti = 0; ti < segments; ti += 1) for (let pi = 0; pi < cornerSegments; pi += 1) {
        const theta0 = -Math.PI / 2 + Math.PI / 2 * ti / segments, theta1 = -Math.PI / 2 + Math.PI / 2 * (ti + 1) / segments;
        const phi0 = Math.PI / 2 * pi / cornerSegments, phi1 = Math.PI / 2 * (pi + 1) / cornerSegments;
        const base = positions.length / 3;
        for (const p of [point(theta0, phi0), point(theta1, phi0), point(theta0, phi1), point(theta1, phi1)]) positions.push(...p);
        if (sx * sz < 0) indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        else indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      if (geometrySink) { geometry.deleteAttribute("normal"); geometrySink.push(geometry); }
      else world.add(new THREE.Mesh(geometry, materialCurve));
      if (!geometrySink) addCurveLines(geometry);
      if (corners) {
        const verticalPositions = [], verticalIndices = [];
        const verticalSegments = 2;
        for (let vi = 0; vi < verticalSegments; vi += 1) for (let pi = 0; pi < cornerSegments; pi += 1) {
          const y0 = radius + (height - radius * 2) * vi / verticalSegments;
          const y1 = radius + (height - radius * 2) * (vi + 1) / verticalSegments;
          const phi0 = Math.PI / 2 * pi / cornerSegments, phi1 = Math.PI / 2 * (pi + 1) / cornerSegments;
          const point = (phi, y) => [centerX + sx * radius * Math.cos(phi), y, centerZ + sz * radius * Math.sin(phi)];
          const base = verticalPositions.length / 3;
          for (const p of [point(phi0, y0), point(phi0, y1), point(phi1, y0), point(phi1, y1)]) verticalPositions.push(...p);
          if (sx * sz < 0) verticalIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          else verticalIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        const verticalGeometry = new THREE.BufferGeometry(); verticalGeometry.setAttribute("position", new THREE.Float32BufferAttribute(verticalPositions, 3)); verticalGeometry.setIndex(verticalIndices); verticalGeometry.computeVertexNormals();
        if (geometrySink) { verticalGeometry.deleteAttribute("normal"); geometrySink.push(verticalGeometry); }
        else world.add(new THREE.Mesh(verticalGeometry, materialCurve));
        if (!geometrySink) addCurveLines(verticalGeometry);
      }
      const ceilingPositions = [], ceilingIndices = [];
      const ceilingPoint = (theta, phi) => [
        centerX + sx * radius * Math.cos(theta) * Math.cos(phi),
        height - radius + radius * Math.sin(theta),
        centerZ + sz * radius * Math.cos(theta) * Math.sin(phi),
      ];
      for (let ti = 0; ti < segments; ti += 1) for (let pi = 0; pi < cornerSegments; pi += 1) {
        const theta0 = Math.PI / 2 * ti / segments, theta1 = Math.PI / 2 * (ti + 1) / segments;
        const phi0 = Math.PI / 2 * pi / cornerSegments, phi1 = Math.PI / 2 * (pi + 1) / cornerSegments;
        const base = ceilingPositions.length / 3;
        for (const p of [ceilingPoint(theta0, phi0), ceilingPoint(theta1, phi0), ceilingPoint(theta0, phi1), ceilingPoint(theta1, phi1)]) ceilingPositions.push(...p);
        if (sx * sz < 0) ceilingIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        else ceilingIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
      const ceilingGeometry = new THREE.BufferGeometry(); ceilingGeometry.setAttribute("position", new THREE.Float32BufferAttribute(ceilingPositions, 3)); ceilingGeometry.setIndex(ceilingIndices); ceilingGeometry.computeVertexNormals();
      if (geometrySink) { ceilingGeometry.deleteAttribute("normal"); geometrySink.push(ceilingGeometry); }
      else world.add(new THREE.Mesh(ceilingGeometry, materialCurve));
      if (!geometrySink) addCurveLines(ceilingGeometry);
    }
  }
}

lighting = setupLighting();
worldMode = "rocketsim-combat-alpha";
buildWorld(worldMode);

function createLegacyCar(car) {
  const root = new THREE.Group();
  const attitude = new THREE.Group(); root.add(attitude);
  const teamMat = (car.team === "blue" ? palette.blue : palette.red).clone();
  const accent = car.team === "blue" ? palette.blueLight : palette.redLight;
  const body = box(attitude, [3.55, .66, 1.84], [0, .88, 0], teamMat);
  body.geometry.translate(.06, 0, 0);
  box(attitude, [1.22, .33, 1.63], [1.36, .95, 0], palette.black);
  box(attitude, [1.65, .72, 1.42], [-.28, 1.41, 0], palette.glass, [0, 0, -.08]);
  box(attitude, [.62, .24, 1.9], [-1.4, .92, 0], palette.silver);
  box(attitude, [.22, .28, 1.94], [1.74, .86, 0], accent);
  for (const z of [-.78, .78]) {
    box(attitude, [.44, .18, .14], [1.62, 1.08, z], palette.silver);
    box(attitude, [.32, .13, .12], [-1.76, 1.05, z], accent);
  }
  const weaponMountRoot = new THREE.Group(); weaponMountRoot.name = "weapon-mount"; weaponMountRoot.position.set(.48, 1.76, 0); attitude.add(weaponMountRoot);
  const weaponBase = mesh(new THREE.CylinderGeometry(.34, .34, .12, 16), palette.silver); weaponBase.name = "weapon-mount-base"; weaponBase.position.y = .05; weaponMountRoot.add(weaponBase);
  const weaponTurret = new THREE.Group(); weaponTurret.name = "weapon-turret"; weaponTurret.position.y = .12; weaponMountRoot.add(weaponTurret);
  const weaponHousing = box(weaponTurret, [.68, .3, .6], [0, .16, 0], palette.black); weaponHousing.name = "weapon-turret-housing";
  const launcher = mesh(new THREE.CylinderGeometry(.105, .105, 1.55, 12), palette.silver); launcher.name = "weapon-barrel"; launcher.rotation.z = -Math.PI / 2; launcher.position.set(.82, .16, 0); weaponTurret.add(launcher);
  const weaponMuzzle = new THREE.Object3D(); weaponMuzzle.name = "weapon-muzzle"; weaponMuzzle.position.set(1.62, .16, 0); weaponTurret.add(weaponMuzzle);
  const weaponMount = { root: weaponMountRoot, base: weaponBase, turret: weaponTurret, housing: weaponHousing, barrel: launcher, muzzle: weaponMuzzle };
  const wheelSpinners = [], steeringWheels = [];
  for (const x of [-1.05, 1.02]) for (const z of [-.91, .91]) {
    const carrier = new THREE.Group(); carrier.position.set(x, .52, z); attitude.add(carrier);
    const tire = mesh(new THREE.CylinderGeometry(.43, .43, .3, 18), palette.tire); tire.rotation.x = Math.PI / 2; carrier.add(tire);
    const rim = mesh(new THREE.CylinderGeometry(.25, .25, .315, 12), palette.silver); rim.rotation.x = Math.PI / 2; carrier.add(rim);
    wheelSpinners.push({ tire, rim }); if (x > 0) steeringWheels.push(carrier);
  }
  const flame = mesh(new THREE.ConeGeometry(.3, 1.65, 12), palette.booster); flame.rotation.z = -Math.PI / 2; flame.position.set(-2.08, .92, 0); flame.visible = false; attitude.add(flame);
  const actionPulse = mesh(new THREE.TorusGeometry(.78, .045, 6, 18), material(car.team === "blue" ? 0x9eeaff : 0xff9c8d, { transparent: true, opacity: 0, emissive: car.team === "blue" ? 0x168ed3 : 0xd03d43, emissiveIntensity: 2.2, depthWrite: false }), false);
  actionPulse.rotation.x = Math.PI / 2; actionPulse.position.y = .18; actionPulse.visible = false; attitude.add(actionPulse);
  const speedTrails = new THREE.Group(); speedTrails.visible = false; attitude.add(speedTrails);
  const trailMat = material(car.team === "blue" ? 0x68ddff : 0xff785a, { transparent: true, opacity: .78, emissive: car.team === "blue" ? 0x168ed3 : 0xd03d43, emissiveIntensity: 2.2, depthWrite: false });
  for (const z of [-.57, .57]) {
    const trail = mesh(new THREE.ConeGeometry(.11, 3.4, 8), trailMat, false); trail.rotation.z = Math.PI / 2; trail.position.set(-3.5, .84, z); speedTrails.add(trail);
  }
  const health = new THREE.Group(); health.position.set(0, 2.65, 0); attitude.add(health);
  const healthBack = mesh(new THREE.BoxGeometry(1.65, .12, .12), palette.black, false); health.add(healthBack);
  const healthFill = mesh(new THREE.BoxGeometry(1.55, .08, .08), accent, false); healthFill.position.x = -.05; health.add(healthFill);
  root.userData = { flame, actionPulse, actionPulseRemaining: 0, actionSerials: { ...(car.actionSerials || {}) }, speedTrails, teamMat, hitFlash: 0, lastHp: car.hp, attitude, weaponMount, target: new THREE.Vector3(), targetOrientation: new THREE.Quaternion(), wheelSpinners, steeringWheels, health, healthFill }; scene.add(root); carMeshes.set(car.id, root); return root;
}

function createCar(car) {
  let root;
  try {
    root = createVehicleVisualModel({ THREE, team: car.team, palette });
  } catch (error) {
    // A renderer or partial Three.js namespace can reject the optional skin.
    // Keep the established mesh contract alive so presentation failure cannot
    // affect authoritative state, hitboxes or input.
    console.warn("[Arsenal] procedural vehicle visual unavailable; using legacy car", error);
    return createLegacyCar(car);
  }
  root.userData.actionPulseRemaining = 0;
  root.userData.actionSerials = { ...(car.actionSerials || {}) };
  root.userData.hitFlash = 0;
  root.userData.lastHp = car.hp;
  root.userData.target = new THREE.Vector3();
  root.userData.targetOrientation = new THREE.Quaternion();
  root.userData.wheelSpinners ||= root.userData.wheels?.map(({ tire, rim }) => ({ tire, rim })) || [];
  root.userData.steeringWheels ||= root.userData.wheels?.filter(wheel => wheel.front).map(wheel => wheel.carrier) || [];
  root.userData.boosterFlames ||= root.userData.propulsors?.map(propulsor => propulsor.flame) || [];
  root.userData.flame ||= root.userData.boosterFlames[0] || null;
  root.userData.speedTrails ||= root.userData.references?.speedTrails || null;
  root.userData.weaponMount ||= root.userData.references?.weaponMount || null;
  root.userData.health ||= root.userData.healthBar?.group || null;
  root.userData.healthFill ||= root.userData.healthBar?.fill || null;
  const assetReady = root.userData.assetReady;
  if (assetReady && typeof assetReady.then === "function") {
    // Each joining car brings authored materials and local presentation
    // lights. A warmup completed before that skin settles no longer matches
    // the live shader/light configuration, so schedule a new idle warmup
    // before the next projectile or elimination effect is presented.
    rocketEffectsPrewarm.invalidate();
    requestCombatVisualWarmup(car.id === localId
      ? "Preparando la presentación de tu vehículo…"
      : "Sincronizando los recursos visuales del rival…");
    vehicleAssetReadiness.add(assetReady);
    // The authored skin loader hides procedural chassis meshes while it swaps
    // skins. The roof weapon is an independent presentation contract, so keep
    // that mount visible and addressable after the swap completes.
    Promise.resolve(assetReady).then(() => root.userData.weaponMount?.root?.traverse?.(child => { child.visible = true; }));
    // Fallback and success both settle this promise. Removing settled entries
    // lets the gate notice a later joining car without retaining its promise.
    Promise.resolve(assetReady).then(
      () => vehicleAssetReadiness.delete(assetReady),
      () => vehicleAssetReadiness.delete(assetReady),
    );
  }
  scene.add(root); carMeshes.set(car.id, root); return root;
}

function clearMissing(collection, ids) { for (const [id, object] of collection) if (!ids.has(id)) { scene.remove(object); collection.delete(id); } }
function consumeActionSerials(root, serials = {}) {
  for (const kind of ["jump", "doubleJump", "dodge", "respawn"]) {
    const next = Number(serials[kind] || 0), previous = root.userData.actionSerials[kind];
    if (previous !== undefined && next > previous) {
      root.userData.actionPulseRemaining = kind === "respawn" ? .34 : .2;
      root.userData.actionPulse?.material?.color?.set(kind === "dodge" ? 0xffd06a : root.userData.teamMat.color);
      // Action serials are authoritative observations. The mixer ignores
      // unsupported movement cues, while supported respawn cues remain safe
      // in browsers without Web Audio.
      if (kind !== "respawn") {
        const cue = kind === "dodge" ? "dodge" : kind === "doubleJump" ? "double-jump" : "jump";
        audioMixer.playCue(cue);
      }
    }
    root.userData.actionSerials[kind] = next;
  }
}
function updateActionPulse(root, dt) {
  root.userData.actionPulseRemaining = Math.max(0, root.userData.actionPulseRemaining - dt);
  const amount = root.userData.actionPulseRemaining / .34;
  if (!root.userData.actionPulse) return;
  root.userData.actionPulse.visible = amount > 0;
  if (amount <= 0) return;
  const scale = 1.1 + (1 - amount) * 1.4;
  root.userData.actionPulse.scale.setScalar(scale);
  root.userData.actionPulse.material.opacity = Math.min(.88, amount * 1.35);
}
function updateCars(dt, frameState) {
  const rotationAmount = smoothing(28, dt);
  const attitudeAmount = smoothing(18, dt);
  const movementBackend = frameState.settings?.movementBackend || "js";
  const ids = new Set();
  let localCarSeen = false;
  for (const car of frameState.cars) {
    ids.add(car.id); const root = carMeshes.get(car.id) || createCar(car); root.visible = car.respawn <= 0;
    consumeActionSerials(root, car.actionSerials);
    updateActionPulse(root, dt);
    // The frame state is already sampled between authoritative snapshots. A
    // second low-pass would make the chassis trail the server and the camera.
    const visualAlignment = vehicleVisualAlignment({ height: car.h, movementBackend });
    // Keep the authored mesh in its previous level position, but make its
    // local offset rotate with RocketSim's vehicle pivot during flips.
    root.userData.attitude.position.y = visualAlignment.modelOffsetY;
    root.userData.attitude.scale.setScalar(visualAlignment.modelScale);
    root.userData.target.set(car.x, visualAlignment.rootHeight, car.z); root.position.copy(root.userData.target);
    if (car.orientation) {
      root.userData.targetOrientation.set(car.orientation.x, car.orientation.y, car.orientation.z, car.orientation.w).normalize();
      root.quaternion.copy(root.userData.targetOrientation);
    } else {
      root.rotation.y = lerpAngle(root.rotation.y, -car.yaw, rotationAmount);
      root.userData.attitude.rotation.z = lerpAngle(root.userData.attitude.rotation.z, -car.pitch, attitudeAmount);
      root.userData.attitude.rotation.x = lerpAngle(root.userData.attitude.rotation.x, -car.roll, attitudeAmount);
    }
    root.userData.setBoostVisible?.(Boolean(car.boosting));
    const flames = root.userData.boosterFlames?.length ? root.userData.boosterFlames : [root.userData.flame];
    for (const flame of flames) {
      if (!flame) continue;
      flame.visible = Boolean(car.boosting);
      flame.scale.set(.86 + Math.random() * .18, .86 + Math.random() * .18, car.boosting ? .95 + Math.random() * .55 : 0);
      flame.material?.color?.set(car.team === "blue" ? 0x72d9ff : 0xff713e);
    }
    if (root.userData.speedTrails) {
      root.userData.speedTrails.visible = Boolean(car.supersonic);
      root.userData.speedTrails.scale.x = .72 + Math.min(car.speed || 0, 65) / 65 * .52;
    }
    if (car.hp < root.userData.lastHp - .05) root.userData.hitFlash = .16;
    root.userData.lastHp = car.hp; root.userData.hitFlash = Math.max(0, root.userData.hitFlash - dt);
    if (root.userData.teamMat) root.userData.teamMat.emissiveIntensity = .35 + root.userData.hitFlash * 10;
    const wheelSpin = (car.forwardSpeed || 0) * .035;
    spinVehicleWheels(root.userData.wheelSpinners, wheelSpin);
    for (const wheel of root.userData.steeringWheels) wheel.rotation.y = (car.steer || 0) * -.38;
    if (root.userData.health) root.userData.health.visible = car.respawn <= 0;
    if (root.userData.setHealth) root.userData.setHealth(car.hp);
    else if (root.userData.healthFill) {
      root.userData.healthFill.scale.x = Math.max(.02, car.hp / 100);
      root.userData.healthFill.position.x = -.775 * (1 - root.userData.healthFill.scale.x);
    }
    if (car.id === localId) {
      localCarSeen = true;
      const active = car.respawn <= 0;
      const speed = Math.max(0, Number(car.speed) || 0);
      const acceleration = (speed - audioMotionState.speed) / Math.max(dt, .016);
      const intensity = Math.min(1, speed / 56);
      const drifting = active && Number(car.powerslide || 0) > .35 && speed > 2;
      const braking = active && Math.abs(Number(car.forwardSpeed) || 0) > 2 && !Boolean(car.boosting)
        && (acceleration < -18 || held.has(bindings.back) || mouseHeld.has(bindings.back));
      const nitro = active && Boolean(car.boosting);
      // Rising edges are discrete cues; persistent states only update the
      // already-running loop voice and never create a frame-sized burst.
      if (braking && !audioMotionState.braking) audioMixer.playCue("brake", { intensity: Math.min(1, Math.abs(acceleration) / 60) });
      if (drifting && !audioMotionState.drifting) audioMixer.playCue("drift", { intensity: Math.min(1, Number(car.powerslide || 0)) });
      audioMixer.setMotorState({ active: active && (Math.abs(car.forwardSpeed || 0) > .5 || nitro), intensity, speed, acceleration });
      audioMixer.setNitroState({ active: nitro, intensity: Math.min(1, (Number(car.boost) || 0) / 100), speed, acceleration });
      audioMixer.setDriftState({ active: drifting, intensity: Math.min(1, Number(car.powerslide || 0)), speed, acceleration });
      audioMotionState.speed = speed;
      audioMotionState.braking = braking;
      audioMotionState.drifting = drifting;
      audioMotionState.nitro = nitro;
    }
  }
  if (!localCarSeen) resetAudioMotionState();
  clearMissing(carMeshes, ids);
}

function refreshAimCandidates(frameState) {
  aimCandidates.length = 0;
  const local = frameState?.cars?.find(car => car.id === localId);
  if (!local || local.respawn > 0 || !local.orientation || !localId || !state?.rules?.combat) return;
  const localMesh = carMeshes.get(localId);
  if (!localMesh) return;
  camera.updateMatrixWorld();
  localMesh.updateMatrixWorld();
  aimForward.set(1, 0, 0).applyQuaternion(localMesh.quaternion).normalize();
  const range = 90;
  for (const car of frameState.cars) {
    if (car.id === localId || car.team === localTeam || car.hp <= 0 || car.respawn > 0) continue;
    const dx = car.x - local.x, dy = (car.h + 1.2) - (local.h + 1.2), dz = car.z - local.z;
    const distance = Math.hypot(dx, dy, dz);
    aimProjectionPoint.set(car.x, car.h + 1.2, car.z).project(camera);
    const screenVisible = aimProjectionPoint.z >= -1 && aimProjectionPoint.z <= 1 && Math.abs(aimProjectionPoint.x) <= 1 && Math.abs(aimProjectionPoint.y) <= 1;
    const forwardDot = distance > 0 ? (dx * aimForward.x + dy * aimForward.y + dz * aimForward.z) / distance : -1;
    // We intentionally use viewport + forward visibility only. Decorative GLTF meshes and arena set dressing do not share RocketSim's collision geometry, so raycasting them would report false occlusion.
    const screenDistance = aimProjectionPoint.x * aimProjectionPoint.x + aimProjectionPoint.y * aimProjectionPoint.y;
    const candidate = aimCandidatePool[aimCandidates.length] || (aimCandidatePool[aimCandidates.length] = {});
    candidate.id = car.id; candidate.eligible = screenVisible && distance > 0 && distance <= range && forwardDot >= .12; candidate.screenVisible = screenVisible; candidate.distance = distance; candidate.screenDistance = screenDistance; candidate.deaths = car.deaths;
    aimCandidates.push(candidate);
  }
}

function updateAimLockAndLaser(frameState, nowSeconds) {
  refreshAimCandidates(frameState);
  updateAimLock(aimLock, aimCandidates, frameState?.cars || [], nowSeconds);
  const local = frameState?.cars?.find(car => car.id === localId);
  const localMesh = carMeshes.get(localId);
  const target = aimLock.valid ? frameState?.cars?.find(car => car.id === aimLock.targetId) : null;
  aimLock.direction = null;
  if (target) {
    aimTargetWorld.set(target.x, target.h + 1.2, target.z);
    aimProjectionPoint.copy(aimTargetWorld).project(camera);
    aimLock.direction = computeAimDirection(aimProjectionPoint);
    aimLock.visible = aimLock.direction.visible;
    aimLock.offscreen = aimLock.direction.offscreen;
  }
  const enabled = Boolean(local && localMesh && local.respawn <= 0 && target && state?.rules?.combat);
  if (!enabled) {
    const idleMount = localMesh?.userData.weaponMount || localMesh?.userData.references?.weaponMount;
    if (idleMount?.turret) idleMount.turret.quaternion.identity();
    aimLaserCore.visible = false; aimLaserHalo.visible = false; return;
  }
  localMesh.updateMatrixWorld(true);
  const weaponMount = localMesh.userData.weaponMount || localMesh.userData.references?.weaponMount;
  const turret = weaponMount?.turret;
  const muzzle = weaponMount?.muzzle;
  if (!turret || !muzzle) { aimLaserCore.visible = false; aimLaserHalo.visible = false; return; }
  // Aim in the turret's parent frame so the same world target works while
  // the car flips. The mount stays presentation-only and never feeds input.
  aimWeaponMountAt(weaponMount, aimTargetWorld);
  turret.updateMatrixWorld(true);
  muzzle.getWorldPosition(aimLaserStart);
  aimLaserEnd.copy(aimTargetWorld);
  const beamLength = aimLaserDirection.subVectors(aimLaserEnd, aimLaserStart).length();
  if (beamLength <= .05) { aimLaserCore.visible = false; aimLaserHalo.visible = false; return; }
  aimLaserDirection.normalize();
  aimLaserOrientation.setFromUnitVectors(aimLaserUp, aimLaserDirection);
  aimLaserCenter.addVectors(aimLaserStart, aimLaserEnd).multiplyScalar(.5);
  for (const beam of [aimLaserHalo, aimLaserCore]) {
    beam.position.copy(aimLaserCenter);
    beam.quaternion.copy(aimLaserOrientation);
    beam.scale.set(beam === aimLaserCore ? .012 : .035, beamLength, beam === aimLaserCore ? .012 : .035);
    beam.visible = true;
  }
  aimLaserCore.material.opacity = .8 + Math.sin(nowSeconds * 8) * .14;
  aimLaserHalo.material.opacity = .15 + Math.sin(nowSeconds * 8 + .7) * .05;
}
const rocketColours = Object.freeze({ blue: 0x88e6ff, red: 0xff8a6d });
const rocketBodyGeometry = new THREE.SphereGeometry(.4, 12, 8);
const rocketTrailGeometry = new THREE.ConeGeometry(.22, 1.35, 10);
const explosionCoreGeometry = new THREE.SphereGeometry(.34, 14, 10);
const explosionSparkGeometry = new THREE.SphereGeometry(1, 7, 6);
const rocketMaterials = Object.freeze(Object.fromEntries(Object.entries(rocketColours).map(([team, colour]) => [team, {
  body: material(colour, { metalness: .65, roughness: .22, emissive: colour, emissiveIntensity: 1.4 }),
  trail: material(colour, { transparent: true, opacity: .72, emissive: colour, emissiveIntensity: 2 }),
}])));
const explosionMaterials = Object.freeze(Object.fromEntries(Object.entries(rocketColours).map(([team, colour]) => [team, material(colour, { emissive: colour, emissiveIntensity: 2 })])));
function makeRocketVisual() {
  const root = new THREE.Group();
  // A tiny, fast projectile does not need a directional shadow. Avoiding it
  // removes a shadow-material variant from the first live rocket frame.
  const body = mesh(rocketBodyGeometry, rocketMaterials.blue.body, false);
  const trail = mesh(rocketTrailGeometry, rocketMaterials.blue.trail, false); trail.rotation.x = Math.PI / 2; trail.position.z = .78;
  const light = new THREE.PointLight(rocketColours.blue, 4.5, 10);
  root.add(body, trail, light); root.userData = { colour: rocketColours.blue, body, trail, light };
  return root;
}
const rocketPool = createBoundedPool(rocketPoolCapacity, makeRocketVisual);
function createRocket(rocket) {
  const root = rocketPool.acquire();
  if (!root) return null;
  firstEffectDiagnostics.record("rocket");
  const team = rocket.team === "blue" ? "blue" : "red"; const colour = rocketColours[team];
  root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1);
  root.userData.body.material = rocketMaterials[team].body; root.userData.trail.material = rocketMaterials[team].trail;
  root.userData.light.color.setHex(colour); root.userData.colour = colour;
  scene.add(root); rocketMeshes.set(rocket.id, root); return root;
}
function updateRockets(dt) {
  const amount = smoothing(65, dt);
  const ids = new Set();
  for (const rocket of state.rockets) { ids.add(rocket.id); const root = rocketMeshes.get(rocket.id) || createRocket(rocket); if (!root) continue; root.position.lerp(new THREE.Vector3(rocket.x, rocket.h, rocket.z), amount); root.lookAt(root.position.x + rocket.vx, root.position.y + rocket.vh, root.position.z + rocket.vz); }
  for (const [id, root] of rocketMeshes) if (!ids.has(id)) { createExplosion(root.position, root.userData.colour); scene.remove(root); rocketMeshes.delete(id); rocketPool.release(root); }
}

const explosions = [];
function makeExplosionVisual() {
  const root = new THREE.Group();
  const coreMaterial = material(0xffd889, { transparent: true, emissive: 0xff6d21, emissiveIntensity: 3 });
  const core = mesh(explosionCoreGeometry, coreMaterial, false); root.add(core);
  const sparks = [];
  for (let i = 0; i < 10; i += 1) {
    const spark = mesh(explosionSparkGeometry, explosionMaterials.blue, false);
    const direction = new THREE.Vector3();
    root.add(spark); sparks.push({ spark, direction });
  }
  const light = new THREE.PointLight(0xff8b44, 9, 15); root.add(light);
  return { root, core, coreMaterial, sparks, light, age: 0 };
}
const explosionPool = createBoundedPool(explosionPoolCapacity, makeExplosionVisual);
function createExplosion(position, colour) {
  const explosion = explosionPool.acquire();
  if (!explosion) return;
  firstEffectDiagnostics.record("explosion");
  const team = colour === rocketColours.blue ? "blue" : "red";
  explosion.root.position.copy(position); explosion.root.quaternion.identity(); explosion.root.scale.setScalar(1);
  explosion.core.scale.setScalar(1); explosion.coreMaterial.opacity = 1;
  explosion.age = 0;
  for (const { spark, direction } of explosion.sparks) {
    spark.position.set(0, 0, 0);
    const radius = .07 + Math.random() * .07; spark.scale.setScalar(radius);
    spark.material = explosionMaterials[team];
    direction.set(Math.random() - .5, Math.random() * .8, Math.random() - .5).normalize().multiplyScalar(5 + Math.random() * 6);
  }
  scene.add(explosion.root); explosions.push(explosion);
}
function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const explosion = explosions[i]; explosion.age += dt;
    const fade = Math.max(0, 1 - explosion.age / .55); explosion.core.scale.setScalar(1 + explosion.age * 6); explosion.core.material.opacity = fade; explosion.light.intensity = fade * 9;
    for (const { spark, direction } of explosion.sparks) { spark.position.addScaledVector(direction, dt); spark.scale.setScalar(fade); }
    if (fade <= 0) { scene.remove(explosion.root); explosions.splice(i, 1); explosionPool.release(explosion); }
  }
}

const prewarmRenderTarget = createRenderTargetPrewarmer({
  renderer,
  createTarget: () => new THREE.WebGLRenderTarget(32, 32, { depthBuffer: true, stencilBuffer: false }),
  viewportTarget: new THREE.Vector4(),
  scissorTarget: new THREE.Vector4(),
  clearColorTarget: new THREE.Color(),
});
const prewarmDefaultFramebuffer = createDefaultFramebufferPrewarmer({
  renderer,
  viewportTarget: new THREE.Vector4(),
  scissorTarget: new THREE.Vector4(),
});

// Eagerly constructed pool items share these exact geometries and material
// variants. Temporarily attach representatives to the real scene and render to
// a tiny offscreen target so the main-scene light count and real draw calls are
// warmed before the first in-game rocket/explosion draw.
async function prewarmRocketEffects() {
  const rockets = [rocketPool.acquire(), rocketPool.acquire()];
  const explosionsToWarm = [explosionPool.acquire(), explosionPool.acquire()];
  const savedRockets = [];
  const savedExplosions = [];
  const temporaryRoots = [];
  let warmed = false;

  try {
    if (rockets.some(rocket => !rocket) || explosionsToWarm.some(explosion => !explosion)) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const center = camera.position.clone().addScaledVector(forward, 8);
    for (const [index, team] of ["blue", "red"].entries()) {
      const x = index === 0 ? -2.2 : 2.2;
      const rocket = rockets[index];
      savedRockets.push({
        rocket,
        position: rocket.position.clone(),
        bodyMaterial: rocket.userData.body.material,
        trailMaterial: rocket.userData.trail.material,
        lightColor: rocket.userData.light.color.clone(),
        lightVisible: rocket.userData.light.visible,
        colour: rocket.userData.colour,
      });
      rocket.position.copy(center).add(new THREE.Vector3(x, 0, 0));
      rocket.userData.body.material = rocketMaterials[team].body;
      rocket.userData.trail.material = rocketMaterials[team].trail;
      rocket.userData.light.color.setHex(rocketColours[team]);
      rocket.userData.light.visible = false;
      rocket.userData.colour = rocketColours[team];
      scene.add(rocket);
      temporaryRoots.push(rocket);

      const explosion = explosionsToWarm[index];
      savedExplosions.push({
        explosion,
        position: explosion.root.position.clone(),
        materials: explosion.sparks.map(({ spark }) => spark.material),
        lightVisible: explosion.light.visible,
      });
      explosion.root.position.copy(center).add(new THREE.Vector3(x, -.5, 0));
      for (const { spark } of explosion.sparks) spark.material = explosionMaterials[team];
      explosion.light.visible = false;
      scene.add(explosion.root);
      temporaryRoots.push(explosion.root);
    }
    const compileEffectLightVariant = async () => {
      // `compile()` starts program compilation, but Chrome can complete it
      // after a later draw. `compileAsync()` waits while this is still idle.
      if (typeof renderer.compileAsync === "function") await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
    };
    // Point-light count is part of Three.js' shader key. Warm every real
    // effect configuration: launch (one rocket), impact (one explosion), and
    // their brief overlap. Warming only the two-light overlap left the first
    // one-light rocket to compile a new program on the player's input frame.
    rockets[0].userData.light.visible = true;
    explosionsToWarm[0].light.visible = false;
    await compileEffectLightVariant();
    rockets[0].userData.light.visible = false;
    explosionsToWarm[0].light.visible = true;
    await compileEffectLightVariant();
    rockets[0].userData.light.visible = true;
    explosionsToWarm[0].light.visible = true;
    await compileEffectLightVariant();
    prewarmRenderTarget(scene, camera);
    // Some GPU drivers still defer pipeline setup until a draw reaches the
    // default framebuffer. The one-pixel pass is hidden by the loading cover,
    // then all renderer state is restored before normal presentation resumes.
    prewarmDefaultFramebuffer(scene, camera);
    warmed = true;
  } catch {
    // Prewarming is opportunistic; a restricted or lost WebGL context must not
    // prevent the normal scene from starting.
  } finally {
    for (const root of temporaryRoots) scene.remove(root);
    for (const saved of savedRockets) {
      saved.rocket.position.copy(saved.position);
      saved.rocket.userData.body.material = saved.bodyMaterial;
      saved.rocket.userData.trail.material = saved.trailMaterial;
      saved.rocket.userData.light.color.copy(saved.lightColor);
      saved.rocket.userData.light.visible = saved.lightVisible;
      saved.rocket.userData.colour = saved.colour;
    }
    for (const saved of savedExplosions) {
      saved.explosion.root.position.copy(saved.position);
      saved.explosion.sparks.forEach(({ spark }, index) => { spark.material = saved.materials[index]; });
      saved.explosion.light.visible = saved.lightVisible;
    }
    for (const rocket of rockets) if (rocket) rocketPool.release(rocket);
    for (const explosion of explosionsToWarm) if (explosion) explosionPool.release(explosion);
  }
  return warmed;
}
const rocketEffectsPrewarm = createAssetAwarePrewarmGate({
  warm: prewarmRocketEffects,
  getAssetReadyPromises: () => vehicleAssetReadiness,
});
function updatePads() {
  for (const pad of state.pads) {
    const root = padMeshes.get(pad.id); if (!root) continue;
    const available = pad.timer <= 0; root.userData.disk.material.emissiveIntensity = available ? 2 : .06; root.userData.ring.material.opacity = available ? 1 : .18; root.userData.ring.material.transparent = true; root.userData.ring.rotation.z += .025;
    root.userData.beam.visible = available; root.userData.beam.rotation.y += .02; root.userData.light.intensity = available ? 2.4 : .12; root.scale.y = available ? 1 : .3;
  }
}
function moveCamera(dt, frameState) {
  const me = frameState.cars.find(car => car.id === localId) || frameState.cars[0]; if (!me) return;
  const car = carMeshes.get(me.id); if (!car) return;
  const respawnSerial = me.actionSerials?.respawn ?? null;
  if (cameraFollowCarId !== me.id || (respawnSerial !== null && respawnSerial !== cameraFollowRespawnSerial)) {
    resetCameraFollowState(cameraFollowState);
    cameraFollowCarId = me.id;
    cameraFollowRespawnSerial = respawnSerial;
    cameraFocusInitialized = false;
  }
  // The chassis keeps its full quaternion, but the camera follows only a
  // damped horizontal heading. Air roll therefore remains visible on the car
  // without rotating the horizon or moving the focus sideways in one frame.
  const fullForward = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion).normalize();
  const expandedPractice = worldMode === "rocketsim-expanded-curved-practice" || worldMode === "rocketsim-expanded-cornered-practice" || worldMode === "rocketsim-expanded-block-practice" || worldMode === "rocketsim-expanded-ramp-practice" || worldMode === "rocketsim-combat-alpha";
  const cleanPractice = worldMode === "calibration" || worldMode === "rocketsim-curved-practice" || expandedPractice;
  const practiceBounds = activeCameraVerticalBounds || (expandedPractice ? expandedPracticeCameraBounds : cleanPracticeCameraBounds);
  // Aim lock is a local presentation mode: use the same interpolated target
  // the laser and HUD consume, but never create a new network/physics input.
  const lockedTarget = aimLock.valid
    ? frameState.cars.find(candidate => candidate.id === aimLock.targetId && candidate.hp > 0 && candidate.respawn <= 0) || null
    : null;
  const follow = stepCameraFollow(cameraFollowState, cameraFollowInput({
    x: car.position.x, h: car.position.y, z: car.position.z,
    speed: me.speed, forward: { x: fullForward.x, y: fullForward.y, z: fullForward.z },
    grounded: me.grounded, surfaceType: me.surfaceType, wallRide: me.wallRide,
    surfaceNormal: me.surfaceNormal || me.worldContact?.normal || me.wheelContact?.normal || null,
    cameraVerticalBounds: cleanPractice ? practiceBounds : null,
    cameraHorizontalBounds: activeCameraHorizontalBounds,
    followTarget: lockedTarget ? { id: lockedTarget.id, x: lockedTarget.x, h: lockedTarget.h, z: lockedTarget.z } : null,
  }), dt);
  const desired = new THREE.Vector3(follow.position.x, follow.position.y, follow.position.z);
  desired.y = cleanPractice ? THREE.MathUtils.clamp(desired.y, practiceBounds.minPositionY, practiceBounds.maxPositionY) : Math.max(desired.y, 2.8);
  for (const [x, z, halfX, halfZ] of cameraCovers) {
    if (Math.abs(desired.x - x) > halfX + .8 || Math.abs(desired.z - z) > halfZ + .8) continue;
    const fromX = desired.x - x, fromZ = desired.z - z;
    if (halfX - Math.abs(fromX) < halfZ - Math.abs(fromZ)) desired.x = x + Math.sign(fromX || -1) * (halfX + .8);
    else desired.z = z + Math.sign(fromZ || -1) * (halfZ + .8);
  }
  for (const other of frameState.cars) {
    if (other.id === me.id || other.respawn > 0) continue;
    const dx = desired.x - other.x, dz = desired.z - other.z, distance = Math.hypot(dx, dz);
    if (distance >= 3.2) continue;
    const scale = 3.2 / Math.max(distance, .01); desired.x = other.x + dx * scale; desired.z = other.z + dz * scale;
  }
  if (me.respawn > 0) desired.y = Math.max(desired.y, 13);
  // The follow controller owns the complete presentation frame (position,
  // direction/up and FOV), like the recovered Soccer Car camera contract.
  // Physics and aim-lock authority remain outside this visual interpolation.
  const targetFov = follow.fov;
  if (Math.abs(camera.fov - targetFov) > .02) { camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, smoothing(5.2, dt)); camera.updateProjectionMatrix(); }
  camera.position.lerp(desired, smoothing(follow.positionSmoothing, dt));
  const focus = new THREE.Vector3(follow.focus.x, follow.focus.y, follow.focus.z);
  if (!cameraFocusInitialized) { cameraFocus.copy(focus); cameraFocusInitialized = true; }
  else cameraFocus.lerp(focus, smoothing(follow.focusSmoothing, dt));
  if (cleanPractice) cameraFocus.y = THREE.MathUtils.clamp(cameraFocus.y, practiceBounds.minFocusY, practiceBounds.maxFocusY);
  camera.up.set(follow.up.x, follow.up.y, follow.up.z);
  camera.lookAt(cameraFocus);
  if (visualSmokeEnabled) {
    const smoke = window.__arsenalVisualSmoke;
    const samples = smoke?.cameraSamples;
    if (Array.isArray(samples)) {
      const warmup = Number(smoke.cameraWarmup) > 0;
      samples.push({
        t: performance.now() / 1000,
        frameDt: dt,
        phase: window.__arsenalVisualSmoke.phase,
        mode: follow.mode,
        warmup,
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        focus: { x: cameraFocus.x, y: cameraFocus.y, z: cameraFocus.z },
        heading: follow.heading,
      });
      if (samples.length > 720) samples.splice(0, samples.length - 720);
      if (warmup && follow.mode === "air") smoke.cameraWarmup = Math.max(0, Number(smoke.cameraWarmup) - 1);
    }
  }
}

function input() {
  // Do not queue a held fire/jump key during the one-time presentation
  // preparation. The server keeps simulating, but gameplay intent begins only
  // once the loading cover has released.
  if (!combatPresentation.ready && !visualSmokePlayback) {
    return { throttle: 0, steer: 0, jump: false, boost: false, drift: false, airRoll: false, roll: 0, fire: false };
  }
  const down = action => held.has(bindings[action]) || mouseHeld.has(bindings[action]);
  const keyboard = {
    forward: down("forward"), back: down("back"), left: down("left"), right: down("right"),
    drift: down("drift"), rollLeft: down("rollLeft"), rollRight: down("rollRight"),
    jump: down("jump"), boost: down("boost"), fire: down("fire")
  };
  const controller = readGamepadActions(navigator.getGamepads?.());
  const manualInput = composeVehicleInput(mergeVehicleActions(keyboard, controller.actions));
  if (visualSmokePlayback) {
    if (window.__arsenalVisualSmoke?.armed) visualSmokePlayback.armed = true;
    const smoke = window.__arsenalVisualSmoke;
    const nowSeconds = performance.now() / 1000;
    const captureHold = Boolean(smoke?.captureHold);
    if (smoke && !captureHold && Number.isFinite(smoke.captureHoldStartedAt)) {
      const heldSeconds = Math.max(0, nowSeconds - smoke.captureHoldStartedAt);
      if (visualSmokePlayback.startedAt !== null) visualSmokePlayback.startedAt += heldSeconds;
      // The page-level timestamp is authoritative when capturePage() blocks
      // RAF; do not apply the pure playback fallback a second time.
      visualSmokePlayback.captureHoldStartedAt = null;
      smoke.captureHoldStartedAt = null;
    }
    if (smoke?.captureNextPhase) {
      forceVisualSmokePhase(visualSmokePlayback, smoke.captureNextPhase, nowSeconds);
      smoke.captureNextPhase = null;
    }
    if (visualSmokePlayback.restartRequested && !visualSmokePlayback.restartSent && socket?.readyState === WebSocket.OPEN) {
      resetCameraFollowState(cameraFollowState);
      cameraFollowCarId = null;
      cameraFocusInitialized = false;
      if (window.__arsenalVisualSmoke) window.__arsenalVisualSmoke.cameraWarmup = 2;
      socket.send(JSON.stringify({ type: "restart" }));
      visualSmokePlayback.restartSent = true;
    }
    visualSmokePlayback.captureHold = captureHold;
    const me = localId ? state?.cars?.find(car => car.id === localId) || null : null;
    const playback = stepVisualSmokePlayback(visualSmokePlayback, { now: nowSeconds, car: me });
    if (window.__arsenalVisualSmoke) window.__arsenalVisualSmoke.phase = playback.phase;
    return playback.input;
  }
  return { ...manualInput, ...(aimLock.valid ? { targetId: aimLock.targetId } : {}) };
}
function connect() {
  localId = null; localTeam = null; localSessionOwner = null;
  toggleAimLock(aimLock, []);
  aimLaserCore.visible = false; aimLaserHalo.visible = false;
  if (ui.aimMarker) ui.aimMarker.dataset.active = "false";
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const connection = new WebSocket(`${protocol}://${location.host}`);
  socket = connection;
  connectionPhase = "connecting";
  connectionDetail = "";
  renderSessionPanel();
  stateLiveness = createStateLiveness({ now: performance.now() });
  ui.status.textContent = "Conectando a la arena 3D…";
  connection.addEventListener("open", () => {
    if (socket !== connection) return;
    resetCameraFollowState(cameraFollowState); cameraFollowCarId = null; cameraFollowRespawnSerial = null; cameraFocusInitialized = false;
    connection.send(JSON.stringify({ ...createClientHello({ sessionId: lanSessionId, roomId: lanRoomId, name: localPilotName }), ...(onlineAccessToken ? { accessToken: onlineAccessToken } : {}) }));
    heartbeatTimer = setInterval(() => { if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "heartbeat" })); }, LAN_HEARTBEAT_INTERVAL_MS);
    stateLivenessTimer = setInterval(() => {
      if (socket !== connection || connection.readyState !== WebSocket.OPEN || !stateLiveness) return;
      if (shouldReconnectForStateStall(stateLiveness, performance.now())) {
        ui.status.textContent = "Estado autoritativo detenido; reconectando…";
        connection.close();
      }
    }, 1000);
  });
  connection.addEventListener("error", event => {
    if (socket !== connection) return;
    connectionPhase = "error";
    connectionDetail = "ERROR WEBSOCKET · REVISA LA CONSOLA O DEBUG_LAN=1";
    console.error("[Arsenal] WebSocket error", event);
    ui.status.textContent = connectionDetail;
    renderSessionPanel();
  });
  connection.addEventListener("message", ({ data }) => { if (socket !== connection) return; const message = JSON.parse(data); if (message.type === "welcome") { localId = message.id; localTeam = message.team; localSessionOwner = typeof message.owner === "boolean" ? message.owner : null; connectionPhase = "synchronizing"; } if (message.type === "session-owner") { if (typeof message.owner === "boolean") localSessionOwner = message.owner; } if (message.type === "state") { recordAuthoritativeState(stateLiveness, performance.now()); state = message.state; connectionPhase = "playing"; connectionDetail = ""; const acknowledgement = consumeInputAcknowledgement(pendingInputTimes, acknowledgedInput, message.inputAcknowledged, performance.now() / 1000); acknowledgedInput = acknowledgement.acknowledged; if (acknowledgement.roundTripMs !== null) inputRoundTripMs = acknowledgement.roundTripMs; snapshotInterpolator.push(state, performance.now() / 1000); renderState = snapshotInterpolator.sample(performance.now() / 1000); const nextWorldMode = state.settings?.practiceArena === "arsenal-curved-practice" ? "rocketsim-curved-practice" : state.settings?.practiceArena === "arsenal-expanded-curved-practice" ? "rocketsim-expanded-curved-practice" : state.settings?.practiceArena === "arsenal-expanded-cornered-practice" ? "rocketsim-expanded-cornered-practice" : state.settings?.practiceArena === "arsenal-expanded-block-practice" ? "rocketsim-expanded-block-practice" : state.settings?.practiceArena === "arsenal-expanded-ramp-practice" ? "rocketsim-expanded-ramp-practice" : state.settings?.practiceArena === "combat-alpha" ? "rocketsim-combat-alpha" : state.settings?.arena || "scrapyard"; if (worldMode !== nextWorldMode) { worldMode = nextWorldMode; buildWorld(worldMode); } rocketEffectsPrewarm.markSceneReady(); } if (message.type === "error") { connectionPhase = "error"; connectionDetail = message.text; connection.onlineAccessFailure = message.code === "online-access-token-required" || message.code === "online-access-token-invalid"; ui.status.textContent = message.text; } renderSessionPanel(); });
  connection.addEventListener("close", () => { if (socket !== connection) return; if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } if (stateLivenessTimer) { clearInterval(stateLivenessTimer); stateLivenessTimer = null; } stateLiveness = null; snapshotInterpolator.reset(); resetCameraFollowState(cameraFollowState); cameraFollowCarId = null; cameraFollowRespawnSerial = null; cameraFocusInitialized = false; renderState = null; state = null; localId = null; localTeam = null; localSessionOwner = null; audioMixer.clear(); resetAudioMotionState(); if (connection.onlineAccessFailure) { renderSessionPanel(); return; } connectionPhase = "reconnecting"; connectionDetail = ""; renderSessionPanel(); ui.status.textContent = "Servidor desconectado; reintentando…"; setTimeout(connect, 1200); });
}
camera.position.set(0, 20, 24); camera.lookAt(0, 0, 0);
connect();

function isInteractiveControl(target) {
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target?.tagName);
}
addEventListener("keydown", event => {
  void prepareCombatPresentation(event);
  if (pendingBinding) { event.preventDefault(); if (event.code === "Escape") pendingBinding = null; else finishBinding(event.code); renderBindingPanel(); return; }
  if (isInteractiveControl(event.target)) { held.clear(); mouseHeld.clear(); return; }
  if (!combatPresentation.ready && !visualSmokePlayback) {
    held.clear(); mouseHeld.clear();
    event.preventDefault();
    return;
  }
  if (!event.repeat && event.code === bindings.lockTarget) {
    refreshAimCandidates(renderState || state);
    toggleAimLock(aimLock, aimCandidates, performance.now() / 1000);
    event.preventDefault();
  }
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
  held.add(event.code);
  if (event.code === bindings.restart && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "restart" }));
});
addEventListener("keyup", event => { if (!isInteractiveControl(event.target)) held.delete(event.code); });
addEventListener("mousedown", event => {
  const code = event.button === 0 ? "MouseLeft" : event.button === 2 ? "MouseRight" : `Mouse${event.button}`;
  if (pendingBinding) { event.preventDefault(); finishBinding(code); return; }
  if (event.target !== canvas) return;
  event.preventDefault();
  if (!combatPresentation.ready && !visualSmokePlayback) {
    held.clear(); mouseHeld.clear();
    return;
  }
  if (code === bindings.restart && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "restart" }));
  mouseHeld.add(code);
});
canvas.addEventListener("pointerdown", () => {
  canvas.focus({ preventScroll: true });
}, { passive: true });
addEventListener("mouseup", event => { const code = event.button === 0 ? "MouseLeft" : event.button === 2 ? "MouseRight" : `Mouse${event.button}`; mouseHeld.delete(code); });
addEventListener("contextmenu", event => { if (event.target === canvas) event.preventDefault(); });
addEventListener("blur", () => { held.clear(); mouseHeld.clear(); });
addEventListener("focusin", event => { if (isInteractiveControl(event.target)) { held.clear(); mouseHeld.clear(); } });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !isInteractiveControl(document.activeElement)) {
    canvas.focus({ preventScroll: true });
  }
});
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

function updateHud() {
  ui.blue.textContent = state.score.blue; ui.red.textContent = state.score.red;
  const rocketsimPractice = inRocketSimPractice();
  const rocketsimCombat = rocketsimPractice && state.rules?.combat;
  const combatRoundState = state.settings?.roundState || "active";
  const combatGoal = state.settings?.scoreToWin || state.rules?.scoreToWin || 15;
  const combatPhase = combatRoundState === "waiting" ? " · ESPERANDO RIVAL" : combatRoundState === "complete" ? " · RONDA CERRADA" : "";
  ui.scoreboard.hidden = !rocketsimCombat;
  if (state.settings) {
    const bridgeLabel = rocketsimPractice && state.settings.bridgeLabel ? ` · ${state.settings.bridgeLabel}` : "";
    const bridgeRevision = Number.parseInt(String(state.settings.bridgeLabel || "").replace(/^R/i, ""), 10);
    // The presentation can draw the upper curve independently. Make an old
    // native executable visible in the HUD so it cannot be mistaken for a
    // collision regression in the R20 wall-to-ceiling geometry.
    const ceilingPhysicsWarning = rocketsimCombat && inRocketSimCombatAlpha() && Number.isFinite(bridgeRevision) && bridgeRevision < 20
      ? " · R20 NECESARIO PARA TECHO" : "";
    ui.objective.textContent = rocketsimPractice
      ? rocketsimCombat ? `COMBATE ROCKETSIM${inRocketSimCombatAlpha() ? " · COMBAT-ALPHA" : ""}${bridgeLabel}${ceilingPhysicsWarning} · PRIMERO A ${combatGoal} · ${state.settings.humans}/${state.settings.vehicleLimit} PILOTOS${combatPhase}` : inRocketSimRampPractice() ? `PRÁCTICA ROCKETSIM · RAMPA DE PRUEBA · ESQUINAS CURVAS${bridgeLabel}` : inRocketSimBlockPractice() ? `PRÁCTICA ROCKETSIM · BLOQUE DE PRUEBA · ESQUINAS CURVAS${bridgeLabel}` : inRocketSimCorneredPractice() ? `PRÁCTICA ROCKETSIM · ESQUINAS CURVAS · SUELO · PAREDES · TECHO${bridgeLabel}` : (inRocketSimCurvedPractice() || state.settings?.practiceArena === "arsenal-expanded-curved-practice") ? `PRÁCTICA ROCKETSIM · TRANSICIONES CURVAS · SUELO · PAREDES · TECHO${bridgeLabel}` : `PRÁCTICA ROCKETSIM · SUELO · PAREDES · TECHO${bridgeLabel}`
      : "COMBATE · ESPERANDO CONFIGURACIÓN ROCKETSIM";
  }
  const me = state.cars.find(car => car.id === localId);
  if (ui.aimLock) {
    const target = aimLock.targetId === null ? null : state.cars.find(car => car.id === aimLock.targetId);
    const lockState = !target || !aimLock.valid ? "SIN OBJETIVO" : `BLOQUEO · ${target.name || "RIVAL"}${aimLock.offscreen ? " · FUERA DE PANTALLA" : ""}`;
    ui.aimLock.textContent = `${lockState} · ${bindingName(bindings.lockTarget)}`;
    ui.aimLock.dataset.active = String(Boolean(target && aimLock.valid));
  }
  if (ui.aimMarker) {
    const direction = aimLock.direction;
    const markerVisible = Boolean(aimLock.valid && direction?.offscreen);
    ui.aimMarker.dataset.active = String(markerVisible);
    if (markerVisible) {
      ui.aimMarker.style.left = `${(0.5 + direction.edgeX * .46) * 100}%`;
      ui.aimMarker.style.top = `${(0.5 - direction.edgeY * .46) * 100}%`;
      ui.aimMarker.style.setProperty("--aim-angle", `${direction.angle * 180 / Math.PI}deg`);
    }
  }
  if (me) {
    const dodgeReadout = me.dodging ? `\nDODGE      ${me.dodgeCancelling ? "CANCELANDO " : ""}${(me.dodgeRemaining || 0).toFixed(2)}s` : "";
    const rocketReadout = rocketsimCombat ? formatCombatHudReadout(me) : "";
    const supportReadout = me.surfaceType === "cover" ? "\nAPOYO      COBERTURA" : "";
    const angular = me.angularVelocity || { pitch: 0, yaw: 0, roll: 0 };
    const angle = value => `${Math.round((value || 0) * 180 / Math.PI)}°`;
    const networkReadout = rocketsimPractice ? `\nRED         ACK ${acknowledgedInput} · ${inputRoundTripMs === null ? "—" : `${Math.round(inputRoundTripMs)} ms`}` : "";
    // RocketSim exposes the authoritative action and attitude for diagnostics;
    // the final combat HUD keeps those values compact and player-facing.
    const calibrationReadout = rocketsimPractice
      ? `\nESTADO     ${me.jumpState || (me.grounded ? "grounded" : "airborne")}\nACTITUD    P ${angle(me.pitch)} · Y ${angle(me.yaw)} · R ${angle(me.roll)}\nGIRO       P ${Number(angular.pitch || 0).toFixed(1)} · Y ${Number(angular.yaw || 0).toFixed(1)} · R ${Number(angular.roll || 0).toFixed(1)}`
      : "";
    ui.readout.textContent = `INTEGRIDAD ${Math.ceil(me.hp)}%${rocketReadout}\nNITRO      ${Math.floor(me.boost)}%\nVELOCIDAD  ${Math.floor(me.speed || 0)}${me.supersonic ? " · SUPERSÓNICO" : ""}\nSALTOS     ${me.jumps}/2${supportReadout}${dodgeReadout}${calibrationReadout}${networkReadout}${me.respawn > 0 ? `\nREAPARICIÓN ${me.respawn.toFixed(1)}s` : ""}`;
  }
  const experienceStatus = describePlayerExperienceState({ connection: connectionPhase, connectionDetail, state, localId, localTeam });
  ui.status.textContent = experienceStatus.text;
  const newest = state.events.at(-1);
  if (newest && newest.text !== previousEvent) {
    const feedback = describeEventFeedback(newest);
    previousEvent = newest.text;
    ui.events.textContent = feedback.text;
    ui.events.dataset.kind = feedback.visualKind;
    ui.events.dataset.audioCue = feedback.audioCue || "";
    ui.events.dataset.priority = feedback.priority;
  }
  if (newest) {
    const eventKey = `${newest.kind || ""}|${newest.at ?? ""}|${newest.text || ""}`;
    if (eventKey !== previousEventAudioKey) {
      previousEventAudioKey = eventKey;
      audioMixer.playFeedback(newest);
    }
  }
}
let lastPerformanceHudAt = 0;
function refreshPerformanceHud(now) {
  if (!ui.performance || now - lastPerformanceHudAt < 500) return;
  lastPerformanceHudAt = now;
  const snapshot = frameMetrics.getSnapshot();
  ui.performance.textContent = `${Math.round(snapshot.fps)} FPS · ${snapshot.frameTimeMs.toFixed(1)} ms`;
}
function frame() {
  const now = performance.now();
  frameNumber += 1;
  const rawFrameMs = Math.max(0, now - lastFrameAt);
  const frameDt = Math.min(.05, rawFrameMs / 1000); lastFrameAt = now;
  frameMetrics.recordFrame(now); refreshPerformanceHud(now);
  if (state && renderState) {
    renderState = snapshotInterpolator.sample(now / 1000);
    updateCars(frameDt, renderState);
    // The first state has resolved the arena and updateCars has installed the
    // real vehicle materials. Wait for authored skin promises, then warm in
    // idle before any rocket can be created or drawn. State and input remain
    // live while this presentation-only gate is pending.
    rocketEffectsPrewarm.attempt(scene, camera);
    refreshCombatPresentation();
    if (rocketEffectsPrewarm.getSnapshot().settled) updateRockets(frameDt);
    updateExplosions(frameDt); updatePads(); moveCamera(frameDt, renderState); updateAimLockAndLaser(renderState, now / 1000); updateHud();
  }
  else { aimLaserCore.visible = false; aimLaserHalo.visible = false; if (ui.aimMarker) ui.aimMarker.dataset.active = "false"; }
  if (socket?.readyState === WebSocket.OPEN && now - lastInputAt > 1000 / 60) { const sequence = ++inputSequence; const sentAt = now / 1000; recordInputTransmission(pendingInputTimes, sequence, sentAt); socket.send(JSON.stringify({ type: "input", sequence, input: input() })); lastInputAt = now; }
  arenaDecoration?.update?.({ time: now / 1000, pads: state?.pads });
  renderer.render(scene, camera); requestAnimationFrame(frame);
}
frame();
    connectionPhase = "synchronizing";
