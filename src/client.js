import * as THREE from "/node_modules/three/build/three.module.js";
import { appendCalibrationHistory, buildCalibrationComparisonReport, compareCalibrationSessions, parseCalibrationHistory } from "./calibration-history.js";
import { CALIBRATION_STEPS, beginCalibrationSession, buildCalibrationReport, calibrationStepHasEvidence, completeCalibrationStep, recordCalibrationSample, recommendedCalibrationDecision } from "./calibration-session.js";
import { SnapshotInterpolator } from "./snapshot-interpolation.js";
import { consumeInputAcknowledgement, recordInputTransmission } from "./input-ack.js";
import { composeVehicleInput } from "./control-mapping.js";
import { mergeVehicleActions, readGamepadActions } from "./gamepad-input.js";
import { createCameraFollowState, resetCameraFollowState, stepCameraFollow, CAMERA_FOLLOW_TUNING } from "./camera-follow.js";
import { getArenaVisualProfile } from "./arena-visual-profile.js";
import { createMob02BrowserPlayback, stepMob02BrowserPlayback } from "./mob02-browser-playback.js";
import { buildMobAir01Report, createMobAir01BrowserPlayback, stepMobAir01BrowserPlayback } from "./mob-air-01-browser-playback.js";
import { buildHitbox01Report, createHitbox01BrowserObservation, stepHitbox01BrowserObservation } from "./hitbox-01-browser-observation.js";
import { createVis03BrowserPlayback, stepVis03BrowserPlayback } from "./vis03-browser-playback.js";
import { createClientHello, LAN_HEARTBEAT_INTERVAL_MS } from "./lan-session-protocol.js";
import { createStateLiveness, recordAuthoritativeState, shouldReconnectForStateStall } from "./lan-client-liveness.js";
import { vehicleVisualAlignment } from "./vehicle-visual-alignment.js";
import { rocketSimArenaForWorldMode, rocketSimArenaProfile } from "./rocketsim-arena-profile.js";

const canvas = document.querySelector("#game");
const ui = {
  blue: document.querySelector("#blue"), red: document.querySelector("#red"),
  status: document.querySelector("#status"), objective: document.querySelector("#objective"), readout: document.querySelector("#readout"), events: document.querySelector("#events"), scoreboard: document.querySelector(".scoreboard")
};
const held = new Set();
const defaultBindings = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", drift: "ShiftLeft", rollLeft: "ControlLeft", rollRight: "Space", jump: "MouseRight", boost: "MouseLeft", fire: "KeyF", restart: "KeyR" };
const actionLabels = { forward: "Acelerar", back: "Frenar / marcha atrás", left: "Girar izquierda", right: "Girar derecha", drift: "Derrape / air roll", rollLeft: "Air roll direccional izquierda", rollRight: "Air roll direccional derecha", jump: "Saltar / doble salto", boost: "Nitro", fire: "Lanzar cohete", restart: "Reiniciar ronda" };
let bindings = loadBindings();
let pendingBinding = null;
const mouseHeld = new Set();
let state = null, renderState = null, localId = null, localTeam = null, socket = null, lastInputAt = 0, inputSequence = 0, acknowledgedInput = 0, inputRoundTripMs = null, previousEvent = "", lastFrameAt = performance.now();
const mob02Enabled = new URLSearchParams(location.search).get("mob02") === "1";
const mob02Playback = mob02Enabled ? createMob02BrowserPlayback() : null;
let mob02LastPhase = null;
const mobAir01Enabled = !mob02Enabled && new URLSearchParams(location.search).get("mobair01") === "1";
const mobAir01Direction = new URLSearchParams(location.search).get("dodge") || "diagonal";
const mobAir01Playback = mobAir01Enabled ? createMobAir01BrowserPlayback({ dodgeDirection: mobAir01Direction }) : null;
let mobAir01LastPhase = null;
let mobAir01ReportLogged = false;
const hitbox01Enabled = !mob02Enabled && !mobAir01Enabled && new URLSearchParams(location.search).get("hitbox01") === "1";
const hitbox01Playback = hitbox01Enabled ? createHitbox01BrowserObservation() : null;
let hitbox01LastPhase = null;
let hitbox01ReportLogged = false;
const vis03Enabled = !mob02Enabled && !mobAir01Enabled && !hitbox01Enabled && new URLSearchParams(location.search).get("vis03") === "1";
const vis03Playback = vis03Enabled ? createVis03BrowserPlayback() : null;
let vis03LastPhase = null;
const pendingInputTimes = new Map();
const snapshotInterpolator = new SnapshotInterpolator();
const lanRoomId = new URLSearchParams(location.search).get("room") || "local";
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
const matchControls = {
  arena: document.querySelector("#arena-mode"), vehicles: document.querySelector("#vehicle-limit"), bots: document.querySelector("#bot-count"),
  vehicleValue: document.querySelector("#vehicle-limit-value"), botValue: document.querySelector("#bot-count-value"),
  summary: document.querySelector("#match-summary"), apply: document.querySelector("#match-apply")
};
let matchConfigDirty = false;
const calibrationCoach = {
  root: document.querySelector("#calibration-coach"),
  stepCount: document.querySelector("#calibration-step-count"),
  title: document.querySelector("#calibration-step-title"),
  instruction: document.querySelector("#calibration-step-instruction"),
  expected: document.querySelector("#calibration-step-expected"),
  result: document.querySelector("#calibration-result"),
  note: document.querySelector("#calibration-note"),
  start: document.querySelector("#calibration-start"),
  next: document.querySelector("#calibration-next"),
  copy: document.querySelector("#calibration-copy"),
  historyStatus: document.querySelector("#calibration-history-status"),
  historyCopy: document.querySelector("#calibration-history-copy"),
  historyClear: document.querySelector("#calibration-history-clear"),
  report: document.querySelector("#calibration-report"),
  status: document.querySelector("#calibration-session-status")
};
let calibrationSession = null;
const calibrationHistoryKey = "arsenal-calibration-history-v1";
let calibrationHistory = loadCalibrationHistory();

function loadBindings() {
  try { return { ...defaultBindings, ...JSON.parse(localStorage.getItem("arsenal-bindings") || "{}")} ; } catch { return { ...defaultBindings }; }
}
function saveBindings() { localStorage.setItem("arsenal-bindings", JSON.stringify(bindings)); }
function loadCalibrationHistory() {
  try { return parseCalibrationHistory(localStorage.getItem(calibrationHistoryKey)); } catch { return []; }
}
function saveCalibrationHistory() {
  try { localStorage.setItem(calibrationHistoryKey, JSON.stringify(calibrationHistory)); } catch { /* A full or disabled store must not block play. */ }
}
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

function renderMatchConfig(settings = null) {
  const rocketsim = settings?.movementBackend === "rocketsim" || state?.settings?.movementBackend === "rocketsim";
  if (settings && !matchConfigDirty) {
    matchControls.arena.value = rocketsim ? "rocketsim" : settings.arena || "scrapyard";
    matchControls.vehicles.value = settings.vehicleLimit;
    matchControls.bots.value = Math.min(settings.botCount, settings.vehicleLimit);
  }
  const calibration = !rocketsim && matchControls.arena.value === "calibration";
  if (calibration) { matchControls.vehicles.value = 1; matchControls.bots.value = 0; }
  const vehicleLimit = Number(matchControls.vehicles.value), botCount = Math.min(Number(matchControls.bots.value), vehicleLimit);
  matchControls.bots.value = botCount; matchControls.bots.max = vehicleLimit;
  matchControls.arena.disabled = rocketsim;
  matchControls.vehicles.disabled = calibration;
  matchControls.bots.disabled = calibration || rocketsim;
  matchControls.vehicleValue.textContent = vehicleLimit; matchControls.botValue.textContent = botCount;
  matchControls.summary.textContent = rocketsim
    ? (state?.rules?.combat ? "Combate RocketSim LAN: capacidad humana configurable; bots no disponibles todavía." : "Práctica RocketSim LAN: capacidad humana configurable; bots no disponibles todavía.")
    : calibration
    ? "Calibración: suelo, paredes y techo; sin bots, pads, combate ni obstáculos. Nitro ilimitado."
    : vehicleLimit === 1 && botCount === 0 ? "Práctica individual: 1 coche total y 0 bots." : `Hasta ${vehicleLimit} coches; objetivo de ${botCount} bots IA. Los pilotos humanos ocupan los huecos.`;
  matchControls.apply.textContent = rocketsim ? "Aplicar capacidad" : "Aplicar y reiniciar";
}
for (const control of [matchControls.arena, matchControls.vehicles, matchControls.bots]) control.addEventListener("input", () => { matchConfigDirty = true; renderMatchConfig(); });
matchControls.apply.addEventListener("click", () => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const rocketsim = state?.settings?.movementBackend === "rocketsim";
  const settings = rocketsim
    ? { vehicleLimit: Number(matchControls.vehicles.value), botCount: 0 }
    : { arena: matchControls.arena.value, vehicleLimit: Number(matchControls.vehicles.value), botCount: Number(matchControls.bots.value) };
  socket.send(JSON.stringify({ type: "configure", settings }));
  matchConfigDirty = false;
});
renderMatchConfig();

function inCalibrationArena() { return state?.settings?.arena === "calibration" && state?.settings?.movementBackend !== "rocketsim"; }
function inRocketSimCurvedPractice() { return state?.settings?.practiceArena === "arsenal-curved-practice"; }
function inRocketSimCorneredPractice() { return state?.settings?.practiceArena === "arsenal-expanded-cornered-practice"; }
function inRocketSimBlockPractice() { return state?.settings?.practiceArena === "arsenal-expanded-block-practice"; }
function inRocketSimRampPractice() { return state?.settings?.practiceArena === "arsenal-expanded-ramp-practice"; }
function inRocketSimCombatAlpha() { return state?.settings?.practiceArena === "combat-alpha"; }
function inRocketSimPractice() { return state?.settings?.movementBackend === "rocketsim"; }
function sessionBuildLabel() { return `local · ${new Date().toLocaleString("es-ES")}`; }
function renderCalibrationCoach() {
  const calibration = inCalibrationArena();
  calibrationCoach.root.hidden = !calibration;
  if (!calibration) return;
  const active = calibrationSession?.active;
  const completed = calibrationSession?.results.length || 0;
  const step = active ? CALIBRATION_STEPS[calibrationSession.stepIndex] : null;
  calibrationCoach.stepCount.textContent = `${completed}/${CALIBRATION_STEPS.length}`;
  calibrationCoach.title.textContent = step?.title || (calibrationSession?.status === "complete" ? "Sesión completada" : "Sesión guiada");
  calibrationCoach.instruction.textContent = step?.instruction || "Inicia una sesión y completa una maniobra cada vez. Pulsa R antes de un paso si quieres volver a una salida limpia.";
  calibrationCoach.expected.textContent = step ? `Esperado: ${step.expected}` : "Cada paso registra solo snapshots autoritativos y el ACK observado.";
  calibrationCoach.result.disabled = !active;
  calibrationCoach.note.disabled = !active;
  const hasEvidence = calibrationStepHasEvidence(calibrationSession);
  const allowNoEvidence = active?.samples >= 2 && calibrationCoach.result.value === "sin-evidencia";
  calibrationCoach.next.disabled = !active || (!hasEvidence && !allowNoEvidence);
  calibrationCoach.start.textContent = calibrationSession?.status === "complete" ? "Nueva sesión" : calibrationSession?.status === "active" ? "Reiniciar sesión" : "Iniciar sesión";
  calibrationCoach.copy.disabled = !calibrationSession || completed === 0;
  const comparison = compareCalibrationSessions(calibrationHistory);
  calibrationCoach.historyStatus.textContent = `Historial local: ${calibrationHistory.length} sesiones · ${comparison.text}`;
  calibrationCoach.historyCopy.disabled = calibrationHistory.length < 2;
  calibrationCoach.historyClear.disabled = calibrationHistory.length === 0;
  calibrationCoach.status.textContent = active && !hasEvidence && !allowNoEvidence
    ? "Completa la maniobra: hacen falta dos snapshots y evidencia de vuelo. Si no puedes observarla, selecciona «Sin evidencia»."
    : calibrationSession
    ? `${recommendedCalibrationDecision(calibrationSession)}`
    : "No cambia la física: registra la evidencia para decidir un único ajuste.";
}
function captureCalibrationSnapshot(snapshot, acknowledgementMs, now) {
  if (!calibrationSession?.active || snapshot?.settings?.arena !== "calibration") return;
  const me = snapshot.cars?.find(car => car.id === localId);
  if (me) recordCalibrationSample(calibrationSession, me, acknowledgementMs, now);
}
function interruptCalibrationSession() {
  if (!calibrationSession?.active) return;
  calibrationSession.status = "interrupted";
  calibrationSession.active = null;
}
function startCalibrationSession() {
  if (!inCalibrationArena()) return;
  calibrationSession = beginCalibrationSession(new Date().toISOString(), sessionBuildLabel());
  calibrationCoach.note.value = "";
  calibrationCoach.result.value = "correcto";
  calibrationCoach.report.hidden = true;
  calibrationCoach.report.value = "";
  renderCalibrationCoach();
}
function finishCalibrationStep() {
  if (!calibrationSession?.active) return;
  const completedBefore = calibrationSession.status === "complete";
  completeCalibrationStep(calibrationSession, calibrationCoach.result.value, calibrationCoach.note.value, new Date().toISOString());
  if (!completedBefore && calibrationSession.status === "complete") {
    calibrationHistory = appendCalibrationHistory(calibrationHistory, calibrationSession);
    saveCalibrationHistory();
  }
  calibrationCoach.note.value = "";
  calibrationCoach.result.value = "correcto";
  renderCalibrationCoach();
}
async function revealAndCopyCalibrationReport(report, successText) {
  calibrationCoach.report.value = report;
  calibrationCoach.report.hidden = false;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(report);
    else {
      calibrationCoach.report.focus(); calibrationCoach.report.select();
      if (!document.execCommand("copy")) throw new Error("copy command rejected");
    }
    calibrationCoach.status.textContent = successText;
  } catch {
    calibrationCoach.report.focus(); calibrationCoach.report.select();
    calibrationCoach.status.textContent = "No se pudo copiar automáticamente: el informe sigue visible y seleccionado para copiarlo manualmente.";
  }
}
function copyCalibrationReport() {
  return revealAndCopyCalibrationReport(buildCalibrationReport(calibrationSession), "Informe copiado y visible. Pégalo en el registro de física o compártelo para decidir el siguiente ajuste.");
}
function copyCalibrationComparison() {
  if (calibrationHistory.length < 2) return;
  return revealAndCopyCalibrationReport(buildCalibrationComparisonReport(calibrationHistory), "Comparación copiada y visible. Si señala el mismo candidato dos veces, ya se puede investigar solo ese grupo.");
}
function clearCalibrationHistory() {
  calibrationHistory = [];
  try { localStorage.removeItem(calibrationHistoryKey); } catch { /* The in-memory history is already cleared. */ }
  renderCalibrationCoach();
}
calibrationCoach.start.addEventListener("click", startCalibrationSession);
calibrationCoach.next.addEventListener("click", finishCalibrationStep);
calibrationCoach.copy.addEventListener("click", copyCalibrationReport);
calibrationCoach.result.addEventListener("change", renderCalibrationCoach);
calibrationCoach.historyCopy.addEventListener("click", copyCalibrationComparison);
calibrationCoach.historyClear.addEventListener("click", clearCalibrationHistory);
renderCalibrationCoach();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
const initialVisualProfile = getArenaVisualProfile();
scene.background = new THREE.Color(initialVisualProfile.background);
scene.fog = new THREE.Fog(initialVisualProfile.fog, initialVisualProfile.fogNear, initialVisualProfile.fogFar);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, .1, 250);
camera.up.set(0, 1, 0);
const cameraFollowState = createCameraFollowState();
const cameraFocus = new THREE.Vector3();
const cleanPracticeCameraBounds = Object.freeze({ minPositionY: 2.8, maxPositionY: 21.2, minFocusY: .8, maxFocusY: 22.2 });
const expandedPracticeCameraBounds = Object.freeze({ minPositionY: 2.8, maxPositionY: 27.2, minFocusY: .8, maxFocusY: 28.2 });
let cameraFocusInitialized = false;
let cameraFollowCarId = null, cameraFollowRespawnSerial = null;
const carMeshes = new Map();
const rocketMeshes = new Map();
const padMeshes = new Map();
const world = new THREE.Group();
const cameraCovers = [];
let worldMode = "";
let lighting = null;
scene.add(world);

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: .2, ...options });
}

function applyArenaVisualProfile(mode) {
  const profile = getArenaVisualProfile(mode);
  scene.background.setHex(profile.background);
  scene.fog.color.setHex(profile.fog);
  scene.fog.near = profile.fogNear;
  scene.fog.far = profile.fogFar;
  palette.floor.color.setHex(profile.floor);
  palette.steel.color.setHex(profile.steel);
  renderer.toneMappingExposure = profile.lighting.exposure;
  if (lighting) {
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
  const hemisphere = new THREE.HemisphereLight(0xb8d8eb, 0x102018, 2.1); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe2b0, 3.45); sun.position.set(-35, 55, 32); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -80; sun.shadow.camera.right = 80; sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65; scene.add(sun);
  const blueWash = new THREE.PointLight(0x249fe8, 28, 52, 2); blueWash.position.set(-50, 11, -34); scene.add(blueWash);
  const redWash = new THREE.PointLight(0xff4f52, 28, 52, 2); redWash.position.set(50, 11, 34); scene.add(redWash);
  return { hemisphere, sun, blueWash, redWash };
}

function buildWorld(mode = "calibration") {
  world.clear(); padMeshes.clear(); cameraCovers.length = 0;
  const visualProfile = applyArenaVisualProfile(mode);
  const rocketSimArena = rocketSimArenaProfile(rocketSimArenaForWorldMode(mode));
  const expanded = rocketSimArena?.expanded === true;
  const width = rocketSimArena ? rocketSimArena.halfWidth * 2 : 124;
  const depth = rocketSimArena ? rocketSimArena.halfDepth * 2 : 92;
  const height = rocketSimArena ? rocketSimArena.height : 24;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const curveRadius = rocketSimArena?.curveRadius || 0;
  const flatWallHeight = curveRadius > 0 ? height - curveRadius * 2 : height;
  const flatWallCenterY = curveRadius + flatWallHeight / 2;
  const cornered = rocketSimArena?.cornered === true;
  // Presentation-only boundary materials. RocketSim remains the sole source
  // of collision; transparency is deliberately applied to the Three.js skin.
  const boundaryMaterial = material(visualProfile.steel, {
    transparent: true,
    opacity: visualProfile.wallOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    emissive: visualProfile.boundaryGlow,
    emissiveIntensity: visualProfile.boundaryGlowIntensity,
    metalness: .32,
    roughness: .58,
  });
  const floor = mesh(new THREE.PlaneGeometry(width, depth), palette.floor); floor.rotation.x = -Math.PI / 2; floor.position.y = -.17; world.add(floor);
  const grid = new THREE.GridHelper(width, expanded ? 36 : 31, visualProfile.gridMajor, visualProfile.gridMinor); grid.scale.z = depth / width; grid.position.y = -.14; grid.material.transparent = true; grid.material.opacity = .42; world.add(grid);
  const wallSpan = cornered ? depth - curveRadius * 2 : depth;
  const wallWidth = cornered ? width - curveRadius * 2 : width;
  box(world, [1, flatWallHeight, wallSpan], [-halfWidth, flatWallCenterY, 0], boundaryMaterial); box(world, [1, flatWallHeight, wallSpan], [halfWidth, flatWallCenterY, 0], boundaryMaterial);
  box(world, [wallWidth, flatWallHeight, 1], [0, flatWallCenterY, -halfDepth], boundaryMaterial); box(world, [wallWidth, flatWallHeight, 1], [0, flatWallCenterY, halfDepth], boundaryMaterial);
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: visualProfile.ceiling,
    transparent: true,
    opacity: visualProfile.ceilingOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    emissive: visualProfile.boundaryGlow,
    emissiveIntensity: visualProfile.boundaryGlowIntensity,
    roughness: .62,
    metalness: .18,
  });
  const ceiling = mesh(new THREE.PlaneGeometry(width, depth), ceilingMaterial, false);
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = height; world.add(ceiling);
  const roofGrid = new THREE.GridHelper(width, expanded ? 18 : 16, visualProfile.gridMajor, visualProfile.gridMinor);
  roofGrid.scale.z = depth / width; roofGrid.position.y = height - .025;
  roofGrid.material.transparent = true; roofGrid.material.opacity = .24; roofGrid.material.depthWrite = false;
  world.add(roofGrid);
  if (mode === "calibration" || rocketSimArena) {
    const combatAlpha = mode === "rocketsim-combat-alpha";
    addPracticeLandmarks({ width, depth, height, cornerRadius: curveRadius, visualProfile, cornered, teamAxis: combatAlpha ? "x" : "z" });
    if (mode === "rocketsim-curved-practice") addRocketSimCurveVisual({ halfWidth: 62, halfDepth: 46, height, radius: curveRadius, visualProfile });
    if (expanded) {
      addRocketSimCurveVisual({ halfWidth, halfDepth, height, radius: curveRadius, visualProfile, corners: cornered });
      if (mode === "rocketsim-expanded-block-practice") addRocketSimBlockVisual();
      if (mode === "rocketsim-expanded-ramp-practice") addRocketSimRampVisual();
      if (combatAlpha) {
        addRocketSimBlockVisual(0, -20);
        addRocketSimRampVisual(0, 20);
        addCombatAlphaLandmarks({ width, depth, visualProfile });
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

function addRocketSimBlockVisual(x = 0, z = 0) {
  // Exact Arsenal-world dimensions of the native btBoxShape in ARENA-05.
  const block = box(world, [14, 4, 18], [x, 2, z], palette.concrete);
  box(world, [14.2, .16, 18.2], [x, 4.08, z], palette.hazard);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(block.geometry), new THREE.LineBasicMaterial({ color: 0xb5edf0, transparent: true, opacity: .72 }));
  outline.position.copy(block.position); world.add(outline);
}

function addRocketSimRampVisual(x = 0, z = 0) {
  // Same six Arsenal-space vertices as the cached native ARENA-06 wedge.
  const run = 10, width = 9, height = 4.5;
  const vertices = new Float32Array([
    -run, 0, -width,  run, 0, -width,  -run, 0, width,
     run, 0, width,   run, height, -width,  run, height, width,
  ]);
  const indices = [0, 2, 1, 1, 2, 3, 0, 1, 4, 2, 5, 3, 1, 3, 5, 1, 5, 4, 0, 4, 5, 0, 5, 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ramp = new THREE.Mesh(geometry, material(0x667f83, { roughness: .82, metalness: .16, side: THREE.DoubleSide }));
  ramp.position.set(x, 0, z); world.add(ramp);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffc35a, transparent: true, opacity: .65 }));
  edge.position.set(x, 0, z); world.add(edge);
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

function addCombatAlphaLandmarks({ width, depth, visualProfile }) {
  const beacon = (x, z, color) => {
    const root = new THREE.Group(); root.position.set(x, 0, z); world.add(root);
    const ring = mesh(new THREE.TorusGeometry(1.05, .09, 8, 24), material(color, { emissive: color, emissiveIntensity: 1.25, roughness: .3 }), false);
    ring.rotation.x = Math.PI / 2; ring.position.y = .11; root.add(ring);
    const mast = mesh(new THREE.CylinderGeometry(.075, .11, 3.4, 10), material(color, { emissive: color, emissiveIntensity: .8, roughness: .35 }), false);
    mast.position.y = 1.7; root.add(mast);
    const light = new THREE.PointLight(color, 3.8, 12, 2); light.position.y = 2.7; root.add(light);
  };
  for (const z of [-30, 0, 30]) {
    beacon(-60, z, visualProfile.blueZone);
    beacon(60, z, visualProfile.redZone);
  }
  const guideMaterial = new THREE.LineBasicMaterial({ color: visualProfile.guide, transparent: true, opacity: .44 });
  for (const z of [-11, 11]) {
    const guide = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-width * .37, .055, z), new THREE.Vector3(width * .37, .055, z),
    ]);
    world.add(new THREE.Line(guide, guideMaterial));
  }
  const center = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.65, 36), new THREE.MeshBasicMaterial({ color: visualProfile.landmark, transparent: true, opacity: .52, side: THREE.DoubleSide }));
  center.rotation.x = -Math.PI / 2; center.position.y = .04; world.add(center);
}

function addRocketSimCurveVisual({ halfWidth, halfDepth, height, radius, visualProfile, corners = false }) {
  const segments = 32;
  const materialCurve = material(visualProfile.curve, {
    roughness: .72,
    metalness: .16,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: visualProfile.curveOpacity,
    depthWrite: false,
    emissive: visualProfile.boundaryGlow,
    emissiveIntensity: visualProfile.boundaryGlowIntensity,
  });
  const stripeMaterial = new THREE.LineBasicMaterial({ color: visualProfile.curveStripe, transparent: true, opacity: .24 });
  for (const side of ["positiveX", "negativeX", "positiveZ", "negativeZ"]) {
    const positions = [], indices = [];
    const center = side === "positiveX" || side === "negativeX" ? (side === "positiveX" ? halfWidth - radius : -halfWidth + radius) : (side === "positiveZ" ? halfDepth - radius : -halfDepth + radius);
    const extrusionMin = side === "positiveX" || side === "negativeX" ? -halfDepth + radius : -halfWidth + radius;
    const extrusionMax = side === "positiveX" || side === "negativeX" ? halfDepth - radius : halfWidth - radius;
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
    world.add(new THREE.Mesh(geometry, materialCurve));
    world.add(new THREE.LineSegments(geometry, stripeMaterial));
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
      world.add(new THREE.Mesh(geometry, materialCurve));
      world.add(new THREE.LineSegments(geometry, stripeMaterial));
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
        world.add(new THREE.Mesh(verticalGeometry, materialCurve));
        world.add(new THREE.LineSegments(verticalGeometry, stripeMaterial));
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
      world.add(new THREE.Mesh(ceilingGeometry, materialCurve));
      world.add(new THREE.LineSegments(ceilingGeometry, stripeMaterial));
    }
  }
}

lighting = setupLighting();
worldMode = "calibration";
buildWorld(worldMode);

function createCar(car) {
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
  const launcher = mesh(new THREE.CylinderGeometry(.22, .28, 1.72, 12), palette.black); launcher.rotation.z = Math.PI / 2; launcher.position.set(1.98, 1.38, 0); attitude.add(launcher);
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
  root.userData = { flame, actionPulse, actionPulseRemaining: 0, actionSerials: { ...(car.actionSerials || {}) }, speedTrails, teamMat, hitFlash: 0, lastHp: car.hp, attitude, target: new THREE.Vector3(), targetOrientation: new THREE.Quaternion(), wheelSpinners, steeringWheels, health, healthFill }; scene.add(root); carMeshes.set(car.id, root); return root;
}

function clearMissing(collection, ids) { for (const [id, object] of collection) if (!ids.has(id)) { scene.remove(object); collection.delete(id); } }
function consumeActionSerials(root, serials = {}) {
  for (const kind of ["jump", "doubleJump", "dodge", "respawn"]) {
    const next = Number(serials[kind] || 0), previous = root.userData.actionSerials[kind];
    if (previous !== undefined && next > previous) {
      root.userData.actionPulseRemaining = kind === "respawn" ? .34 : .2;
      root.userData.actionPulse.material.color.set(kind === "dodge" ? 0xffd06a : root.userData.teamMat.color);
    }
    root.userData.actionSerials[kind] = next;
  }
}
function updateActionPulse(root, dt) {
  root.userData.actionPulseRemaining = Math.max(0, root.userData.actionPulseRemaining - dt);
  const amount = root.userData.actionPulseRemaining / .34;
  root.userData.actionPulse.visible = amount > 0;
  if (amount <= 0) return;
  const scale = 1.1 + (1 - amount) * 1.4;
  root.userData.actionPulse.scale.setScalar(scale);
  root.userData.actionPulse.material.opacity = Math.min(.88, amount * 1.35);
}
function updateCars(dt, frameState) {
  const rotationAmount = smoothing(28, dt);
  const movementBackend = frameState.settings?.movementBackend || "js";
  const ids = new Set();
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
    root.userData.flame.visible = Boolean(car.boosting); root.userData.flame.scale.set(.86 + Math.random() * .18, .86 + Math.random() * .18, car.boosting ? .95 + Math.random() * .55 : 0);
    root.userData.flame.material.color.set(car.team === "blue" ? 0x72d9ff : 0xff713e);
    root.userData.speedTrails.visible = Boolean(car.supersonic); root.userData.speedTrails.scale.x = .72 + Math.min(car.speed || 0, 65) / 65 * .52;
    if (car.hp < root.userData.lastHp - .05) root.userData.hitFlash = .16;
    root.userData.lastHp = car.hp; root.userData.hitFlash = Math.max(0, root.userData.hitFlash - dt);
    root.userData.teamMat.emissiveIntensity = .35 + root.userData.hitFlash * 10;
    for (const wheel of root.userData.wheelSpinners) { wheel.tire.rotation.z += (car.forwardSpeed || 0) * .035; wheel.rim.rotation.z += (car.forwardSpeed || 0) * .035; }
    for (const wheel of root.userData.steeringWheels) wheel.rotation.y = (car.steer || 0) * -.38;
    root.userData.health.visible = car.respawn <= 0;
    root.userData.healthFill.scale.x = Math.max(.02, car.hp / 100);
    root.userData.healthFill.position.x = -.775 * (1 - root.userData.healthFill.scale.x);
  }
  clearMissing(carMeshes, ids);
}
function createRocket(rocket) {
  const root = new THREE.Group(); const colour = rocket.team === "blue" ? 0x88e6ff : 0xff8a6d;
  root.add(mesh(new THREE.SphereGeometry(.4, 12, 8), material(colour, { metalness: .65, roughness: .22, emissive: colour, emissiveIntensity: 1.4 })));
  const trail = mesh(new THREE.ConeGeometry(.22, 1.35, 10), material(colour, { transparent: true, opacity: .72, emissive: colour, emissiveIntensity: 2 }), false); trail.rotation.x = Math.PI / 2; trail.position.z = .78; root.add(trail);
  root.add(new THREE.PointLight(colour, 4.5, 10)); root.userData = { colour }; scene.add(root); rocketMeshes.set(rocket.id, root); return root;
}
function updateRockets(dt) {
  const amount = smoothing(65, dt);
  const ids = new Set();
  for (const rocket of state.rockets) { ids.add(rocket.id); const root = rocketMeshes.get(rocket.id) || createRocket(rocket); root.position.lerp(new THREE.Vector3(rocket.x, rocket.h, rocket.z), amount); root.lookAt(root.position.x + rocket.vx, root.position.y + rocket.vh, root.position.z + rocket.vz); }
  for (const [id, root] of rocketMeshes) if (!ids.has(id)) { createExplosion(root.position, root.userData.colour); scene.remove(root); rocketMeshes.delete(id); }
}

const explosions = [];
function createExplosion(position, colour) {
  const root = new THREE.Group(); root.position.copy(position); scene.add(root);
  const core = mesh(new THREE.SphereGeometry(.34, 14, 10), material(0xffd889, { transparent: true, emissive: 0xff6d21, emissiveIntensity: 3 }), false); root.add(core);
  const sparks = [];
  for (let i = 0; i < 10; i += 1) {
    const spark = mesh(new THREE.SphereGeometry(.07 + Math.random() * .07, 7, 6), material(colour, { emissive: colour, emissiveIntensity: 2 }), false);
    const direction = new THREE.Vector3(Math.random() - .5, Math.random() * .8, Math.random() - .5).normalize().multiplyScalar(5 + Math.random() * 6);
    root.add(spark); sparks.push({ spark, direction });
  }
  const light = new THREE.PointLight(0xff8b44, 9, 15); root.add(light); explosions.push({ root, core, sparks, light, age: 0 });
}
function updateExplosions(dt) {
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const explosion = explosions[i]; explosion.age += dt;
    const fade = Math.max(0, 1 - explosion.age / .55); explosion.core.scale.setScalar(1 + explosion.age * 6); explosion.core.material.opacity = fade; explosion.light.intensity = fade * 9;
    for (const { spark, direction } of explosion.sparks) { spark.position.addScaledVector(direction, dt); spark.scale.setScalar(fade); }
    if (fade <= 0) { scene.remove(explosion.root); explosions.splice(i, 1); }
  }
}
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
  const practiceBounds = expandedPractice ? expandedPracticeCameraBounds : cleanPracticeCameraBounds;
  const follow = stepCameraFollow(cameraFollowState, {
    x: car.position.x, h: car.position.y, z: car.position.z,
    speed: me.speed, forward: { x: fullForward.x, y: fullForward.y, z: fullForward.z },
    cameraVerticalBounds: cleanPractice ? practiceBounds : null,
  }, dt);
  const desired = new THREE.Vector3(follow.position.x, follow.position.y, follow.position.z);
  const cameraHalfWidth = expandedPractice ? 69 : 59;
  const cameraHalfDepth = expandedPractice ? 51 : 43;
  desired.x = THREE.MathUtils.clamp(desired.x, -cameraHalfWidth, cameraHalfWidth); desired.z = THREE.MathUtils.clamp(desired.z, -cameraHalfDepth, cameraHalfDepth); desired.y = cleanPractice ? THREE.MathUtils.clamp(desired.y, practiceBounds.minPositionY, practiceBounds.maxPositionY) : Math.max(desired.y, 2.8);
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
  const targetFov = 61 + Math.min(me.speed || 0, 65) / 65 * 12;
  if (Math.abs(camera.fov - targetFov) > .02) { camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, smoothing(5.2, dt)); camera.updateProjectionMatrix(); }
  camera.position.lerp(desired, smoothing(follow.positionSmoothing, dt));
  const focus = new THREE.Vector3(follow.focus.x, follow.focus.y, follow.focus.z);
  if (!cameraFocusInitialized) { cameraFocus.copy(focus); cameraFocusInitialized = true; }
  else cameraFocus.lerp(focus, smoothing(follow.focusSmoothing, dt));
  if (cleanPractice) cameraFocus.y = THREE.MathUtils.clamp(cameraFocus.y, practiceBounds.minFocusY, practiceBounds.maxFocusY);
  camera.up.set(0, 1, 0);
  camera.lookAt(cameraFocus);
}

function input() {
  const down = action => held.has(bindings[action]) || mouseHeld.has(bindings[action]);
  const keyboard = {
    forward: down("forward"), back: down("back"), left: down("left"), right: down("right"),
    drift: down("drift"), rollLeft: down("rollLeft"), rollRight: down("rollRight"),
    jump: down("jump"), boost: down("boost"), fire: down("fire")
  };
  const controller = readGamepadActions(navigator.getGamepads?.());
  const manualInput = composeVehicleInput(mergeVehicleActions(keyboard, controller.actions));
  if (mob02Playback) {
    const me = state?.cars?.find(car => car.id === localId) || state?.cars?.[0] || null;
    const playback = stepMob02BrowserPlayback(mob02Playback, { now: performance.now() / 1000, car: me });
    if (playback.phase !== mob02LastPhase) {
      mob02LastPhase = playback.phase;
      console.info(`[MOB-02] phase=${playback.phase}`, { grounded: me?.grounded, surfaceType: me?.surfaceType, wallRide: me?.wallRide, speed: me?.speed });
    }
    if (playback.restartRequested && !playback.restartSent && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "restart" }));
      playback.restartSent = true;
    }
    return playback.input;
  }
  if (mobAir01Playback) {
    // Campaigns are per pilot. Do not fall back to the first native car while
    // a welcome/roster rebuild is in flight: that car may belong to another
    // tab and a restart/input would affect the shared authoritative match.
    const me = localId ? state?.cars?.find(car => car.id === localId) || null : null;
    const playback = stepMobAir01BrowserPlayback(mobAir01Playback, { now: performance.now() / 1000, car: me, snapshotTime: state?.time, playerCount: state?.settings?.humans });
    if (playback.phase !== mobAir01LastPhase) {
      mobAir01LastPhase = playback.phase;
      console.info(`[MOB-AIR-01] phase=${playback.phase}`, { car: me, report: playback.report });
    }
    if (playback.restartRequested && !playback.restartSent && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "restart" }));
      playback.restartSent = true;
    }
    if (playback.done && !mobAir01ReportLogged) {
      mobAir01ReportLogged = true;
      console.info("[MOB-AIR-01] report", buildMobAir01Report(mobAir01Playback));
    }
    return playback.input;
  }
  if (hitbox01Playback) {
    const me = localId ? state?.cars?.find(car => car.id === localId) || null : null;
    const bridgeRevision = Number.parseInt(String(state?.settings?.bridgeLabel || "").replace(/^R/i, ""), 10);
    const playback = stepHitbox01BrowserObservation(hitbox01Playback, {
      now: performance.now() / 1000,
      car: me,
      snapshotTime: state?.time,
      playerCount: state?.settings?.humans,
      movementBackend: state?.settings?.movementBackend,
      bridgeRevision,
      manualInput,
    });
    if (playback.phase !== hitbox01LastPhase) {
      hitbox01LastPhase = playback.phase;
      console.info(`[HITBOX-01] phase=${playback.phase}`, { car: me, report: playback.report });
    }
    if (playback.restartRequested && !hitbox01Playback.restartSent && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "restart" }));
      hitbox01Playback.restartSent = true;
    }
    if (playback.done && !hitbox01ReportLogged) {
      hitbox01ReportLogged = true;
      console.info("[HITBOX-01] report", buildHitbox01Report(hitbox01Playback));
    }
    return playback.input;
  }
  if (!vis03Playback) return manualInput;
  const playback = stepVis03BrowserPlayback(vis03Playback, {
    now: performance.now() / 1000,
    localTeam,
    cars: state?.cars || [],
  });
  if (playback.phase !== vis03LastPhase) {
    vis03LastPhase = playback.phase;
    console.info(`[VIS-03] phase=${playback.phase}`, { localTeam, cars: state?.cars?.length || 0 });
  }
  return playback.input;
}
function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const connection = new WebSocket(`${protocol}://${location.host}`);
  socket = connection;
  stateLiveness = createStateLiveness({ now: performance.now() });
  ui.status.textContent = "Conectando a la arena 3D…";
  connection.addEventListener("open", () => {
    if (socket !== connection) return;
    resetCameraFollowState(cameraFollowState); cameraFollowCarId = null; cameraFollowRespawnSerial = null; cameraFocusInitialized = false;
    connection.send(JSON.stringify(createClientHello({ sessionId: lanSessionId, roomId: lanRoomId, name: localStorage.getItem("arsenal-name") || "PILOTO" })));
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
    console.error("[Arsenal] WebSocket error", event);
    ui.status.textContent = "ERROR WEBSOCKET · revisa la consola o DEBUG_LAN=1";
  });
  connection.addEventListener("message", ({ data }) => { if (socket !== connection) return; const message = JSON.parse(data); if (message.type === "welcome") { localId = message.id; localTeam = message.team; ui.status.textContent = `TÚ · EQUIPO ${localTeam === "blue" ? "AZUL" : "ROJO"}`; } if (message.type === "state") { recordAuthoritativeState(stateLiveness, performance.now()); state = message.state; const now = performance.now() / 1000; const acknowledgement = consumeInputAcknowledgement(pendingInputTimes, acknowledgedInput, message.inputAcknowledged, now); acknowledgedInput = acknowledgement.acknowledged; if (acknowledgement.roundTripMs !== null) inputRoundTripMs = acknowledgement.roundTripMs; if (inCalibrationArena()) captureCalibrationSnapshot(state, acknowledgement.roundTripMs, now); else interruptCalibrationSession(); snapshotInterpolator.push(state, now); renderState = snapshotInterpolator.sample(now); const nextWorldMode = state.settings?.practiceArena === "arsenal-curved-practice" ? "rocketsim-curved-practice" : state.settings?.practiceArena === "arsenal-expanded-curved-practice" ? "rocketsim-expanded-curved-practice" : state.settings?.practiceArena === "arsenal-expanded-cornered-practice" ? "rocketsim-expanded-cornered-practice" : state.settings?.practiceArena === "arsenal-expanded-block-practice" ? "rocketsim-expanded-block-practice" : state.settings?.practiceArena === "arsenal-expanded-ramp-practice" ? "rocketsim-expanded-ramp-practice" : state.settings?.practiceArena === "combat-alpha" ? "rocketsim-combat-alpha" : state.settings?.arena || "scrapyard"; if (worldMode !== nextWorldMode) { worldMode = nextWorldMode; buildWorld(worldMode); } renderMatchConfig(state.settings); renderCalibrationCoach(); } if (message.type === "error") ui.status.textContent = message.text; });
  connection.addEventListener("close", () => { if (socket !== connection) return; if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } if (stateLivenessTimer) { clearInterval(stateLivenessTimer); stateLivenessTimer = null; } stateLiveness = null; snapshotInterpolator.reset(); resetCameraFollowState(cameraFollowState); cameraFollowCarId = null; cameraFollowRespawnSerial = null; cameraFocusInitialized = false; renderState = null; ui.status.textContent = "Servidor desconectado; reintentando…"; setTimeout(connect, 1200); });
}
connect();

function isInteractiveControl(target) {
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target?.tagName);
}
addEventListener("keydown", event => {
  if (pendingBinding) { event.preventDefault(); if (event.code === "Escape") pendingBinding = null; else finishBinding(event.code); renderBindingPanel(); return; }
  if (isInteractiveControl(event.target)) { held.clear(); mouseHeld.clear(); return; }
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
  const calibration = state.settings?.arena === "calibration";
  const rocketsimPractice = inRocketSimPractice();
  const rocketsimCombat = rocketsimPractice && state.rules?.combat;
  const combatRoundState = state.settings?.roundState || "active";
  const combatGoal = state.settings?.scoreToWin || state.rules?.scoreToWin || 15;
  const combatPhase = combatRoundState === "waiting" ? " · ESPERANDO RIVAL" : combatRoundState === "complete" ? " · RONDA CERRADA" : "";
  ui.scoreboard.hidden = calibration && !rocketsimPractice || rocketsimPractice && !rocketsimCombat;
  if (state.settings) {
    const bridgeLabel = rocketsimPractice && state.settings.bridgeLabel ? ` · ${state.settings.bridgeLabel}` : "";
    const bridgeRevision = Number.parseInt(String(state.settings.bridgeLabel || "").replace(/^R/i, ""), 10);
    // The presentation can draw the upper curve independently. Make an old
    // native executable visible in the HUD so it cannot be mistaken for a
    // collision regression in the R19 wall-to-ceiling geometry.
    const ceilingPhysicsWarning = rocketsimCombat && inRocketSimCombatAlpha() && Number.isFinite(bridgeRevision) && bridgeRevision < 19
      ? " · R19 NECESARIO PARA TECHO" : "";
    ui.objective.textContent = rocketsimPractice
      ? rocketsimCombat ? `COMBATE ROCKETSIM${inRocketSimCombatAlpha() ? " · COMBAT-ALPHA" : ""}${bridgeLabel}${ceilingPhysicsWarning} · PRIMERO A ${combatGoal} · ${state.settings.humans}/${state.settings.vehicleLimit} PILOTOS${combatPhase}` : inRocketSimRampPractice() ? `PRÁCTICA ROCKETSIM · RAMPA DE PRUEBA · ESQUINAS CURVAS${bridgeLabel}` : inRocketSimBlockPractice() ? `PRÁCTICA ROCKETSIM · BLOQUE DE PRUEBA · ESQUINAS CURVAS${bridgeLabel}` : inRocketSimCorneredPractice() ? `PRÁCTICA ROCKETSIM · ESQUINAS CURVAS · SUELO · PAREDES · TECHO${bridgeLabel}` : (inRocketSimCurvedPractice() || state.settings?.practiceArena === "arsenal-expanded-curved-practice") ? `PRÁCTICA ROCKETSIM · TRANSICIONES CURVAS · SUELO · PAREDES · TECHO${bridgeLabel}` : `PRÁCTICA ROCKETSIM · SUELO · PAREDES · TECHO${bridgeLabel}`
      : calibration ? "CALIBRACIÓN DE MOVILIDAD · SUELO · PAREDES · TECHO"
      : state.settings.vehicleLimit === 1 && state.settings.bots === 0 ? "PRÁCTICA DE FÍSICA · SIN BOTS" : `PRIMERO A 15 · ${state.settings.humans} PILOTOS · ${state.settings.bots} BOTS`;
    if (hitbox01Playback) {
      const hitboxReport = buildHitbox01Report(hitbox01Playback);
      ui.objective.textContent = hitboxReport.done
        ? `HITBOX-01 · ${hitboxReport.outcome || "FIN"} · CONTROL DEL JUGADOR`
        : hitboxReport.phase === "awaiting-solo-player"
          ? "HITBOX-01 · CIERRA OTRAS PESTAÑAS · CONTROL DEL JUGADOR"
          : "HITBOX-01 · OBSERVACIÓN INVERTIDA · CONTROLES AUTOMÁTICOS";
    }
  }
  const me = state.cars.find(car => car.id === localId);
  if (me) {
    const dodgeReadout = me.dodging ? `\nDODGE      ${me.dodgeCancelling ? "CANCELANDO " : ""}${(me.dodgeRemaining || 0).toFixed(2)}s` : "";
    const supportReadout = me.surfaceType === "cover" ? "\nAPOYO      COBERTURA" : "";
    const angular = me.angularVelocity || { pitch: 0, yaw: 0, roll: 0 };
    const angle = value => `${Math.round((value || 0) * 180 / Math.PI)}°`;
    const networkReadout = (calibration || rocketsimPractice) ? `\nRED         ACK ${acknowledgedInput} · ${inputRoundTripMs === null ? "—" : `${Math.round(inputRoundTripMs)} ms`}` : "";
    // The clean calibration profile is specifically for movement work. Show
    // the authoritative action and attitude there so a playtest can identify
    // an inversion or an unwanted axis without exposing debug data in combat.
    const calibrationReadout = (calibration || rocketsimPractice)
      ? `\nESTADO     ${me.jumpState || (me.grounded ? "grounded" : "airborne")}\nACTITUD    P ${angle(me.pitch)} · Y ${angle(me.yaw)} · R ${angle(me.roll)}\nGIRO       P ${Number(angular.pitch || 0).toFixed(1)} · Y ${Number(angular.yaw || 0).toFixed(1)} · R ${Number(angular.roll || 0).toFixed(1)}`
      : "";
    const mobAirReadout = mobAir01Playback
      ? (() => {
        const report = buildMobAir01Report(mobAir01Playback);
        return `\nMOB-AIR    ${report.phase} · ${report.dodgeDirection} · J ${report.firstJumpObserved ? "sí" : "—"} · 2 ${report.directedSecondJumpObserved ? "sí" : "—"} · D ${report.dodgeObserved ? "sí" : "—"}${report.recoveryResult ? ` · R ${report.recoveryResult}` : ""}`;
      })()
      : "";
    const hitboxReadout = hitbox01Playback
      ? (() => {
        const report = buildHitbox01Report(hitbox01Playback);
        return `\nHITBOX-01  ${report.phase} · INV ${report.inversionObserved ? "sí" : "—"} · CONTACTO ${report.invertedGroundContact ? "sí" : "—"} · UP ${report.minimumUpY.toFixed(2)}${report.outcome ? ` · R ${report.outcome}` : ""}`;
      })()
      : "";
    ui.readout.textContent = `INTEGRIDAD ${Math.ceil(me.hp)}%\nNITRO      ${calibration && !rocketsimPractice ? "∞ · CALIBRACIÓN" : `${Math.floor(me.boost)}%`}\nVELOCIDAD  ${Math.floor(me.speed || 0)}${me.supersonic ? " · SUPERSÓNICO" : ""}\nSALTOS     ${me.jumps}/2${supportReadout}${dodgeReadout}${calibrationReadout}${networkReadout}${mobAirReadout}${hitboxReadout}${me.respawn > 0 ? `\nREAPARICIÓN ${me.respawn.toFixed(1)}s` : ""}`;
  }
  if (state.winner) ui.status.textContent = `${state.winner === localTeam ? "VICTORIA" : "DERROTA"} · pulsa R para otra ronda`;
  else if (localTeam) ui.status.textContent = `TÚ · EQUIPO ${localTeam === "blue" ? "AZUL" : "ROJO"}`;
  const newest = state.events.at(-1); if (newest && newest.text !== previousEvent) { previousEvent = newest.text; ui.events.textContent = newest.text; ui.events.dataset.kind = newest.kind || ""; }
}
function frame() {
  const now = performance.now();
  const frameDt = Math.min(.05, (now - lastFrameAt) / 1000); lastFrameAt = now;
  if (socket?.readyState === WebSocket.OPEN && now - lastInputAt > 1000 / 60) { const sequence = ++inputSequence; const sentAt = now / 1000; recordInputTransmission(pendingInputTimes, sequence, sentAt); socket.send(JSON.stringify({ type: "input", sequence, input: input() })); lastInputAt = now; }
  if (state && renderState) { renderState = snapshotInterpolator.sample(now / 1000); updateCars(frameDt, renderState); updateRockets(frameDt); updateExplosions(frameDt); updatePads(); moveCamera(frameDt, renderState); updateHud(); }
  renderer.render(scene, camera); requestAnimationFrame(frame);
}
camera.position.set(0, 20, 24); camera.lookAt(0, 0, 0); frame();
