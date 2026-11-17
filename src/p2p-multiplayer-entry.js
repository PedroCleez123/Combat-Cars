import { P2P_ICE_SERVERS, P2P_MATCH_MAX_PLAYERS, P2P_MATCH_MODES, p2pMatchPlayerRange, createP2PMatchRoster, P2P_SIGNAL_ORIGIN, isP2PMatchMode } from "./p2p-room-config.js";
import { P2PMultiSignalingClient, consumeP2PMultiInviteFragment } from "./p2p-multiparty-signaling-client.js";
import { clearP2PPersistentGuestRoom, clearP2PPersistentHostRoom, loadP2PPersistentGuestRoom, loadP2PPersistentHostRoom, saveP2PPersistentGuestRoom, saveP2PPersistentHostRoom } from "./p2p-persistent-room-storage.js";
import { P2PMultiplayerWebRTCStar } from "./p2p-multiplayer-webrtc.js";
import { createP2PWasmMultiplayerCombatHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-host.mjs";
import { P2PWasmMultiplayerHostChannel, P2PWasmMultiplayerPilotChannel } from "../tools/wasm-spike/p2p-wasm-multiplayer-channel.mjs";
import { createP2PWasmMultiplayerLobbyHost } from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-host.mjs";
import { P2PWasmMultiplayerLobbyHostChannel, P2PWasmMultiplayerLobbyGuestChannel } from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-channel.mjs";
import { createP2PMultiplayerPresentationState } from "./p2p-multiplayer-presentation-state.js";
import { createP2PMultiplayerLobbyPresentationState } from "./p2p-multiplayer-lobby-presentation-state.js";
import { createP2PScoreboardModel, shouldShowP2PScoreboard } from "./p2p-scoreboard.js";
import { createCausalBetaPresentationRenderer } from "./p2p-causal-beta-renderer.js";
import { createP2PWasmCausalAudioPresenter } from "../tools/wasm-spike/p2p-wasm-causal-audio.mjs";
import { startP2POfflinePractice } from "./p2p-offline-practice.js";
import { createP2PFpsCounter } from "./p2p-fps-counter.js";
import { createP2PBoostMeter } from "./p2p-boost-meter.js";
import { createP2PCausalInput, p2pLobbyControlsFromCommand } from "./p2p-causal-input.js";
import { SnapshotInterpolator } from "./snapshot-interpolation.js";
import { chooseP2PAimTarget } from "./p2p-aim-targeting.js";
import { P2P_LOBBY_DURATION_SECONDS, createP2PLobbyState, decodeP2PLobbyMessage, normalizeP2PLobbyPlayerSlots } from "./p2p-multiplayer-lobby.js";
import { createP2PGuestConnectionRecovery, createP2PHostSlotRecovery } from "./p2p-guest-connection-recovery.js";

const el = id => document.getElementById(id);
const status = text => { if (el("status")) el("status").textContent = text; };
const fpsCounter = createP2PFpsCounter({ element: el("fps-counter") });
const boostMeter = createP2PBoostMeter(document);
const recordPresentationFrame = timestamp => fpsCounter.recordFrame(timestamp);
const resetFpsCounterAfterVisibility = () => {
  if (document.visibilityState === "visible") fpsCounter.reset();
};
document.addEventListener("visibilitychange", resetFpsCounterAfterVisibility);
const multiplayerArena = el("multiplayer-arena");
const gameplayInputSurface = el("gameplay-input-surface") || el("scene");
const fullscreenToggle = el("fullscreen-toggle");
const fullscreenElement = () => document.fullscreenElement
  || document.webkitFullscreenElement
  || document.mozFullScreenElement
  || document.msFullscreenElement
  || null;
const fullscreenRequest = target => target?.requestFullscreen
  || target?.webkitRequestFullscreen
  || target?.mozRequestFullScreen
  || target?.msRequestFullscreen
  || null;
const fullscreenExit = () => document.exitFullscreen
  || document.webkitExitFullscreen
  || document.mozCancelFullScreen
  || document.msExitFullscreen
  || null;
const updateFullscreenButton = () => {
  if (!fullscreenToggle) return;
  const active = Boolean(fullscreenElement());
  fullscreenToggle.textContent = active ? "Salir de pantalla completa" : "Pantalla completa";
  fullscreenToggle.setAttribute("aria-label", active ? "Salir de pantalla completa" : "Activar pantalla completa");
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.disabled = !active && !fullscreenRequest(multiplayerArena);
};
const toggleFullscreen = event => {
  event?.preventDefault?.();
  const active = fullscreenElement();
  const receiver = active ? document : multiplayerArena;
  const method = active ? fullscreenExit() : fullscreenRequest(multiplayerArena);
  if (typeof method !== "function" || !receiver) { updateFullscreenButton(); return; }
  try {
    const result = method.call(receiver);
    if (result && typeof result.then === "function") void Promise.resolve(result).then(updateFullscreenButton, updateFullscreenButton);
    else updateFullscreenButton();
  } catch { updateFullscreenButton(); }
};
const isGameplaySurfaceTarget = target => Boolean(
  gameplayInputSurface && (target === gameplayInputSurface || gameplayInputSurface.contains?.(target)),
);
const preventBrowserContextMenu = event => {
  if (isGameplaySurfaceTarget(event?.target)) event.preventDefault?.();
};
const preventGameplayRightMouseDefault = event => {
  if (event?.button === 2 && isGameplaySurfaceTarget(event?.target)) event.preventDefault?.();
};
const stopGameplayContextGesture = event => {
  if (!isGameplaySurfaceTarget(event?.target)) return;
  if (event?.type === "auxclick" || event?.button === 2) event.preventDefault?.();
};
fullscreenToggle?.addEventListener("click", toggleFullscreen);
for (const eventName of ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]) document.addEventListener(eventName, updateFullscreenButton);
document.addEventListener("contextmenu", preventBrowserContextMenu, true);
document.addEventListener("mousedown", preventGameplayRightMouseDefault, true);
document.addEventListener("auxclick", stopGameplayContextGesture, true);
updateFullscreenButton();
const cleanupDesktopControls = () => {
  fullscreenToggle?.removeEventListener("click", toggleFullscreen);
  for (const eventName of ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]) document.removeEventListener(eventName, updateFullscreenButton);
  document.removeEventListener("contextmenu", preventBrowserContextMenu, true);
  document.removeEventListener("mousedown", preventGameplayRightMouseDefault, true);
  document.removeEventListener("auxclick", stopGameplayContextGesture, true);
};
let invite = consumeP2PMultiInviteFragment({ hash: location.hash }).invite;
const bootingFromInvite = Boolean(invite);
if (invite) history.replaceState(null, "", `${location.pathname}${location.search}`);
let guestSlot = invite?.slot || null;
let renderer = null; let input = null; let sequence = 0; let latest = null; let star = null; let channel = null;
let activeClient = null; let hostInputTimer = null; let guestInputTimer = null; let lobbyInputTimer = null; let renderFrame = null; let lastPresentationFaultAt = -Infinity;
let practice = null; let roomContext = null; let pendingGuestMessages = new Map();
let presentationFailed = false;
const updateBoostMeter = (state, { role = "host", unlimited = false } = {}) => {
  const localCar = state?.cars?.find?.(car => car?.id === localId(role === "guest" || role === "pilot" ? "guest" : "host")) || null;
  boostMeter?.update(localCar?.boost, localCar?.boosting, unlimited);
};
const getPerformanceDiagnostics = () => Object.freeze({
  fps: fpsCounter.getSnapshot(),
  renderer: renderer?.metrics?.() || practice?.getRenderer?.()?.metrics?.() || null,
});
if (typeof window !== "undefined") {
  Object.defineProperty(window, "__COMBAT_CARS_DIAGNOSTICS__", {
    configurable: true,
    get: getPerformanceDiagnostics,
  });
}
let lobbyHost = null; let lobbyChannel = null; let lobbyGuestChannel = null;
let returningToOfflinePractice = false; let hostMigrationInProgress = false;
let hostPersonalRecoveryInProgress = false; let pageUnloading = false;
let personalRoomBootstrapPromise = null;
let guestConnectionEpoch = 0;
let roomJoinInFlight = false;
const snapshotInterpolator = new SnapshotInterpolator();
const hostSlotRecovery = createP2PHostSlotRecovery({
  onNeutralize: slot => channel?.resetSlotConnection?.(slot),
  onReplace: slot => star?.replace?.(slot),
});
// Keep one presenter for the whole page. The practice renderer is handed off
// when the authoritative match starts, so replacing it here would reset the
// browser AudioContext and leave online snapshots silent.
const audioPresenter = createP2PWasmCausalAudioPresenter();
let audioUnlockPromise = null;
const unlockAudioFromGesture = () => {
  if (!audioUnlockPromise) audioUnlockPromise = Promise.resolve(audioPresenter.unlock?.()).catch(() => false).then(unlocked => {
    if (!unlocked) audioUnlockPromise = null;
    return unlocked;
  });
  return audioUnlockPromise;
};
const guestRecovery = createP2PGuestConnectionRecovery({
  onRetry: event => { void retryGuestTransport(event); },
  onAwaitingPromotion: () => status("Conexión interrumpida · comprobando si la sala elige un nuevo host…"),
  onExhausted: () => status("No se pudo conectar con el host. La sala conserva tu plaza; pulsa Unirse de nuevo para reintentar."),
});
const localId = role => role === "host" ? "p2p-host" : `p2p-guest-${guestSlot}`;
// The personal room always keeps its six signaling slots. The selected mode
// controls teams and the roster allowed to start, never whether a waiting
// player loses their persistent seat while the host experiments with modes.
const selectedCapacity = _mode => P2P_MATCH_MAX_PLAYERS;
const syncCapacityControl = () => {};
const normalizedPlayerName = () => String(el("name")?.value || "").replace(/\s+/gu, " ").trim().slice(0, 16);
const playerName = () => normalizedPlayerName();
const defaultPlayerName = () => {
  try { return String(localStorage.getItem("arsenal.p2p.player-name") || localStorage.getItem("arsenal-name") || "PILOTO").replace(/\s+/gu, " ").trim().slice(0, 16) || "PILOTO"; } catch { return "PILOTO"; }
};
const updateRoomActionAvailability = () => {
  const hasName = Boolean(normalizedPlayerName());
  const hasJoinCode = Boolean(String(el("join-code")?.value || "").trim());
  const join = el("join");
  if (join) join.disabled = !hasName || !hasJoinCode;
};
const requirePlayerName = () => {
  const value = normalizedPlayerName();
  if (value) return value;
  status("Escribe un nombre para unirte a una sala.");
  el("name")?.focus?.();
  return null;
};
const teamMode = mode => mode !== P2P_MATCH_MODES.FREE_FOR_ALL;
const teamLimit = mode => mode === P2P_MATCH_MODES.TEAMS_3V3 ? 3 : mode === P2P_MATCH_MODES.TEAMS_2V2 ? 2 : 1;
const defaultTeam = slot => slot % 2 === 0 ? "blue" : "red";
function assignWaitingTeams(players, mode) {
  const counts = { blue: 0, red: 0 }; const limit = teamLimit(mode);
  return players.map(player => {
    if (!teamMode(mode)) return { ...player, team: null };
    const team = counts.blue < limit ? "blue" : counts.red < limit ? "red" : null;
    if (team) counts[team] += 1;
    return { ...player, team };
  });
}
const ROOM_PHASE_ORDER = Object.freeze({ "room-open": 0, lobby: 1, "team-selection": 1, starting: 2, playing: 3, complete: 4 });
const phaseOrder = phase => Number.isSafeInteger(ROOM_PHASE_ORDER[phase]) ? ROOM_PHASE_ORDER[phase] : -1;
const canAdvanceRoomPhase = (current, next) => phaseOrder(next) >= phaseOrder(current) && phaseOrder(next) >= 0;
const isWaitingPhase = phase => phase === "room-open" || phase === "team-selection" || phase === "lobby";
const isTeamSelectionPhase = phase => phase === "team-selection" || phase === "lobby";
const setRoomPhase = phase => {
  if (!roomContext || !canAdvanceRoomPhase(roomContext.phase, phase)) return false;
  roomContext.phase = phase;
  return true;
};
const setRoomVisible = visible => {
  el("room")?.classList.toggle("hidden", !visible);
  el("multiplayer-lobby-panel")?.classList.toggle("hidden", !visible);
  const details = el("lobby-panel-disclosure");
  if (visible && details) details.open = true;
};
function showPersonalRoomBootstrap(error = null) {
  setRoomVisible(true);
  const failed = error instanceof Error;
  if (el("lobby-title")) el("lobby-title").textContent = failed ? "Sala personal no disponible" : "Preparando tu sala personal";
  if (el("room-info")) el("room-info").textContent = failed
    ? "No se pudo crear o restaurar tu sala. La práctica local sigue disponible."
    : "Creando tu clave personal… podrás compartirla en unos instantes.";
  if (el("room-code")) el("room-code").value = failed ? "SIN CONEXIÓN" : "PREPARANDO";
  if (el("copy-room-code")) el("copy-room-code").disabled = true;
  if (el("lobby-player-count")) el("lobby-player-count").textContent = failed ? "Sin conexión a salas" : "Asignando clave…";
  if (el("lobby-match-state")) el("lobby-match-state").textContent = failed ? "Reintenta cuando quieras" : "Sala personal";
  el("host-mode-control") && (el("host-mode-control").hidden = true);
  el("configure-room") && (el("configure-room").hidden = true);
  el("team-picker") && (el("team-picker").hidden = true);
  el("start-match") && (el("start-match").hidden = true);
  el("return-personal-room") && (el("return-personal-room").hidden = true);
  el("lobby-players")?.replaceChildren();
  const retry = el("retry-personal-room");
  if (retry) retry.hidden = !failed;
  if (failed) status(error.message || "No se pudo abrir tu sala personal.");
}
function bootstrapPersonalRoom() {
  if (roomContext?.role === "host") return Promise.resolve();
  if (personalRoomBootstrapPromise) return personalRoomBootstrapPromise;
  showPersonalRoomBootstrap();
  const pending = hostRoom().catch(error => {
    showPersonalRoomBootstrap(error instanceof Error ? error : new Error("No se pudo abrir tu sala personal."));
    throw error;
  });
  const tracked = pending.finally(() => {
    if (personalRoomBootstrapPromise === tracked) personalRoomBootstrapPromise = null;
  });
  personalRoomBootstrapPromise = tracked;
  return tracked;
}
const lostPersistentHostOwnership = error => error?.code === "room-not-owner" || error?.code === "room-expired";
async function recoverFormerHostPersonalRoom(reason = "closed") {
  if (pageUnloading || returningToOfflinePractice || hostPersonalRecoveryInProgress || roomContext?.role !== "host") return false;
  hostPersonalRecoveryInProgress = true;
  // A transient close does not prove that ownership moved. The normal personal
  // bootstrap first asks the Worker to restore the saved key. hostRoom rotates
  // it only if that authenticated request confirms that another player became
  // host, so an intermittent network cut never needlessly changes keys.
  const detail = reason === "room-expired" ? "La sala anterior ha caducado." : "La conexión de la sala anterior se ha cerrado.";
  returnToOfflinePractice(`${detail} Recuperando tu sala personal…`);
  try {
    await bootstrapPersonalRoom();
    return true;
  } catch {
    status("No se pudo crear tu nueva sala personal. Puedes reintentarla desde el menú.");
    return false;
  } finally {
    hostPersonalRecoveryInProgress = false;
  }
}
// The room controls live inside a native <details> menu. Keep that menu
// available from the header, but close its panel once the lobby hands the
// canvas over to the active match so it cannot cover the arena.
const closeMatchMenu = () => {
  const menu = el("multiplayer-menu");
  if (menu) menu.open = false;
};
function currentPlayers() { return roomContext ? [...roomContext.players.values()].sort((a, b) => a.slot - b.slot) : []; }
function currentRoster({ requireBalanced = false } = {}) {
  if (!roomContext) return null;
  const players = currentPlayers(); const range = p2pMatchPlayerRange(roomContext.mode);
  if (!range || players.length < range.min || players.length > range.max) return null;
  if (requireBalanced && teamMode(roomContext.mode)) { const blue = players.filter(player => player.team === "blue").length; const red = players.filter(player => player.team === "red").length; if (blue !== red) return null; }
  const ids = players.map(player => player.id); const teams = teamMode(roomContext.mode) ? Object.fromEntries(players.map(player => [player.id, player.team])) : null;
  return { ids, teamsByPlayerId: teams, roster: createP2PMatchRoster({ mode: roomContext.mode, playerIds: ids, teamsByPlayerId: teams }) };
}
function renderLobby() {
  if (!roomContext) return;
  if (phaseOrder(roomContext.phase) >= ROOM_PHASE_ORDER.playing) setRoomVisible(false);
  const players = currentPlayers(); const range = p2pMatchPlayerRange(roomContext.mode);
  if (el("lobby-player-count")) el("lobby-player-count").textContent = `${players.length}/${roomContext.maxPlayers} pilotos`;
  if (el("lobby-match-state")) el("lobby-match-state").textContent = roomContext.phase === "playing" ? "En partida" : roomContext.phase === "starting" ? "Iniciando" : roomContext.phase === "room-open" ? "Sala abierta" : "Selección de equipos";
  if (el("lobby-title")) el("lobby-title").textContent = roomContext.role === "host" ? "Tu sala personal" : "Sala compartida";
  if (el("room-info")) el("room-info").textContent = roomContext.mode ? `${roomContext.mode.toUpperCase()} · cambia el modo hasta iniciar` : "Sala personal abierta · nitro infinito · sin PvP";
  const list = el("lobby-players");
  if (list) list.replaceChildren(...players.map(player => { const item = document.createElement("div"); item.className = "lobby-player-slot"; item.dataset.team = player.team || "none"; item.textContent = `${player.name}${player.id === localId(roomContext.role) ? " · TÚ" : ""}`; return item; }));
  const picker = el("team-picker"); if (picker) picker.hidden = !roomContext.mode || !teamMode(roomContext.mode) || !isTeamSelectionPhase(roomContext.phase);
  const local = roomContext.players.get(localId(roomContext.role));
  for (const team of ["blue", "red"]) el(`team-choice-${team}`)?.setAttribute("aria-pressed", String(local?.team === team));
  const configure = el("configure-room");
  if (configure) { configure.hidden = roomContext.role !== "host" || !isWaitingPhase(roomContext.phase); configure.disabled = false; configure.textContent = roomContext.phase === "room-open" ? "Aplicar modo y abrir equipos" : "Aplicar cambio de modo"; }
  const hostModeControl = el("host-mode-control"); if (hostModeControl) hostModeControl.hidden = roomContext.role !== "host" || !isWaitingPhase(roomContext.phase);
  const modeControl = el("mode"); if (modeControl) { if (roomContext.mode) modeControl.value = roomContext.mode; modeControl.disabled = roomContext.role !== "host" || !isWaitingPhase(roomContext.phase); }
  const returnPersonal = el("return-personal-room"); if (returnPersonal) returnPersonal.hidden = roomContext.role !== "guest";
  const returnPersonalMenu = el("return-personal-menu"); if (returnPersonalMenu) returnPersonalMenu.hidden = roomContext.role !== "guest";
  const retryPersonal = el("retry-personal-room"); if (retryPersonal) retryPersonal.hidden = true;
  if (el("copy-room-code")) el("copy-room-code").disabled = false;
  const start = el("start-match"); const ready = Boolean(currentRoster({ requireBalanced: true }));
  if (start) { start.hidden = roomContext.role !== "host" || !isTeamSelectionPhase(roomContext.phase); start.disabled = !ready; }
  if (el("match-countdown")) el("match-countdown").hidden = roomContext.phase !== "playing";
}
function lobbyStateText() { return roomContext ? createP2PLobbyState({ roomId: roomContext.roomId, phase: roomContext.phase, mode: roomContext.mode, maxPlayers: roomContext.maxPlayers, durationSeconds: roomContext.durationSeconds, players: currentPlayers() }) : null; }
function broadcastLobbyState() { if (!roomContext || roomContext.role !== "host" || !star) return; const text = lobbyStateText(); for (const player of currentPlayers()) if (player.slot > 0) { try { star.send(player.slot, text); } catch {} } renderLobby(); }
function applyLobbyState(state) {
  if (!roomContext || state.roomId !== roomContext.roomId || !canAdvanceRoomPhase(roomContext.phase, state.phase)) return;
  if (state.phase === "room-open" ? state.mode !== null : !isP2PMatchMode(state.mode)) return;
  if (roomContext.phase !== "room-open" && state.mode !== roomContext.mode && !(isTeamSelectionPhase(roomContext.phase) && state.phase === "team-selection")) return;
  setRoomPhase(state.phase);
  roomContext.mode = state.mode;
  roomContext.maxPlayers = state.maxPlayers;
  roomContext.durationSeconds = state.durationSeconds;
  roomContext.players = new Map(normalizeP2PLobbyPlayerSlots(state.players).map(player => [player.id, player]));
  renderLobby();
  if (state.phase === "team-selection" && roomContext.role === "guest" && !lobbyGuestChannel) void beginGuestTeamSelection(state);
  if (state.phase === "playing" && !channel && roomContext.role === "guest") startGuestMatch(state);
}
function acceptTeamChoice(playerId, team) { if (!roomContext || !teamMode(roomContext.mode) || !isTeamSelectionPhase(roomContext.phase)) return false; const current = roomContext.players.get(playerId); if (!current || current.team === team) return true; const occupied = currentPlayers().filter(player => player.id !== playerId && player.team === team).length; if (occupied >= teamLimit(roomContext.mode)) return false; roomContext.players.set(playerId, { ...current, team }); return true; }
function handleHostLobbyMessage(slot, text) { const message = decodeP2PLobbyMessage(text, { roomId: roomContext?.roomId }); if (!roomContext || !message || !isWaitingPhase(roomContext.phase)) return false; const id = `p2p-guest-${slot}`; const existing = roomContext.players.get(id); if (message.type === "hello" && roomContext.phase === "room-open") { roomContext.players.set(id, { id, slot, name: message.name, team: null }); broadcastLobbyState(); return true; } if (!existing) return false; if (message.type === "hello") roomContext.players.set(id, { ...existing, name: message.name }); if (message.type === "team") acceptTeamChoice(id, message.team); broadcastLobbyState(); return true; }
function formatCountdown(seconds) { const total = Math.max(0, Math.ceil(Number(seconds) || 0)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function updateCountdown(state) {
  const remaining = state?.settings?.matchRemainingSeconds;
  const clock = el("match-countdown");
  if (clock) { clock.hidden = !Number.isFinite(remaining); if (!clock.hidden) clock.textContent = formatCountdown(remaining); }
  const scoreboardTime = el("scoreboard-time");
  if (scoreboardTime) { scoreboardTime.hidden = !Number.isFinite(remaining); if (!scoreboardTime.hidden) scoreboardTime.textContent = formatCountdown(remaining); }
}

const startPractice = () => { practice?.stop?.(); practice = startP2POfflinePractice({ canvasId: "scene", inputSurfaceId: "gameplay-input-surface", presentationRendererFactory: ({ canvas, role }) => createCausalBetaPresentationRenderer({ canvas, role, focusCarId: guestSlot ? localId("guest") : "p2p-host" }), audioPresenter, disposeAudioPresenter: false, onFrame: recordPresentationFrame, onPresentationState: state => updateBoostMeter(state, { role: "host", unlimited: true }) }); return practice; };
startPractice();
const stopPresentationLoop = () => { if (renderFrame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(renderFrame); renderFrame = null; };
const showPresentationFailure = error => {
  presentationFailed = true;
  stopPresentationLoop();
  const message = String(error?.message || error || "El renderizado 3D no está disponible.");
  const overlay = el("renderer-loading-overlay");
  const loadingStatus = el("renderer-loading-status");
  if (overlay) overlay.hidden = false;
  if (loadingStatus) loadingStatus.textContent = `${message} Recarga la página después de corregir el problema gráfico.`;
  status(`Error de renderizado 3D · ${message}`);
};
const startPresentationLoop = () => {
  if (presentationFailed || renderFrame !== null || typeof requestAnimationFrame !== "function") return;
  const render = timestamp => {
    renderFrame = null;
    try {
      const sampled = snapshotInterpolator.sample(performance.now() / 1000);
      if (sampled && renderer) {
        renderer.update?.(sampled);
        renderer.render?.();
        renderer.recordFrame?.(timestamp);
        fpsCounter.recordFrame(timestamp);
        updateBoostMeter(sampled, { role: roomContext?.role || "host", unlimited: isWaitingPhase(roomContext?.phase) });
      }
    } catch (error) {
      if (timestamp - lastPresentationFaultAt >= 1_000) {
        lastPresentationFaultAt = timestamp;
        console.error("Combat Cars 3D presentation failed", error);
        showPresentationFailure(error);
      }
    } finally {
      if (renderer && !presentationFailed) renderFrame = requestAnimationFrame(render);
    }
  };
  renderFrame = requestAnimationFrame(render);
};
function returnToOfflinePractice(message = "Conexión perdida · volviendo a la práctica local.") {
  if (returningToOfflinePractice || !roomContext) return false;
  returningToOfflinePractice = true;
  presentationFailed = false;
  hostSlotRecovery.clear();
  const guestInLobby = roomContext.role === "guest" && isWaitingPhase(roomContext.phase);

  for (const timer of [hostInputTimer, guestInputTimer, lobbyInputTimer]) if (timer !== null) clearInterval(timer);
  guestConnectionEpoch += 1;
  guestRecovery.connected();
  hostInputTimer = null;
  guestInputTimer = null;
  lobbyInputTimer = null;
  stopPresentationLoop();
  input?.destroy?.(); input = null;
  snapshotInterpolator.reset(null);
  latest = null;
  audioPresenter.clear?.();

  // Close local references before closing transports: their synchronous
  // `closed` events can re-enter this handler, which the guard above absorbs.
  const oldChannel = channel; channel = null;
  const oldLobbyChannel = lobbyChannel; lobbyChannel = null;
  const oldLobbyGuestChannel = lobbyGuestChannel; lobbyGuestChannel = null;
  const oldLobbyHost = lobbyHost; lobbyHost = null;
  const oldStar = star; star = null;
  const oldClient = activeClient; activeClient = null;
  oldChannel?.close?.();
  if (guestInLobby) oldLobbyGuestChannel?.leave?.();
  oldLobbyChannel?.close?.();
  oldLobbyHost?.close?.();
  oldStar?.close?.();
  oldClient?.close?.();

  // The online renderer was handed off from practice and therefore is no
  // longer owned by the stopped practice loop. Dispose it before constructing
  // the same one-car offline experience used on initial page entry.
  renderer?.dispose?.(); renderer = null;
  practice?.stop?.();
  roomContext = null;
  pendingGuestMessages = new Map();
  guestSlot = null;
  sequence = 0;
  invite = null;
  setRoomVisible(false);
  closeMatchMenu();
  const menu = el("game-menu-overlay");
  if (menu) menu.hidden = true;
  el("game-menu-toggle")?.setAttribute("aria-expanded", "false");
  el("room-code") && (el("room-code").value = "");
  const board = el("scoreboard");
  if (board) board.hidden = true;
  el("scoreboard-groups")?.replaceChildren();
  el("scoreboard-rows")?.replaceChildren();
  if (el("match-countdown")) el("match-countdown").hidden = true;
  if (el("scoreboard-time")) el("scoreboard-time").hidden = true;
  status(message);

  returningToOfflinePractice = false;
  startPractice();
  status("Entrenamiento local · Nitro infinito");
  return true;
}
async function returnToPersonalRoom() {
  if (roomContext?.role !== "guest") return;
  const personal = loadP2PPersistentHostRoom();
  if (!personal) { status("No se encontró tu sala personal persistente."); return; }
  returnToOfflinePractice("Volviendo a tu sala personal…");
  await openHostRoom(personal, { restored: true });
}
function createScoreboardRow(row) {
  const line = document.createElement("div");
  line.className = "scoreboard-row";
  if (row.team) line.dataset.team = row.team;
  const name = document.createElement("span"); name.textContent = row.name;
  const stats = document.createElement("strong"); stats.textContent = `K ${row.kills} · D ${row.deaths}`;
  line.append(name, stats);
  return line;
}
function renderScoreboard(state) {
  const board = el("scoreboard");
  const cars = Array.isArray(state?.cars) ? state.cars : [];
  const model = createP2PScoreboardModel(state, { namesById: Object.fromEntries(cars.map(car => [car.id, car.name])) });
  if (!board) return;
  updateCountdown(state);
  const groups = el("scoreboard-groups");
  const rows = el("scoreboard-rows");
  if (!shouldShowP2PScoreboard(state, model)) {
    board.hidden = true;
    groups?.replaceChildren(); rows?.replaceChildren();
    if (el("scoreboard-time")) el("scoreboard-time").hidden = true;
    return;
  }
  if (el("scoreboard-mode")) el("scoreboard-mode").textContent = model.mode.toUpperCase();
  if (groups) groups.replaceChildren(...(model.kind === "teams"
    ? model.groups.map(group => {
      const section = document.createElement("section"); section.className = "scoreboard-team"; section.dataset.team = group.team;
      const heading = document.createElement("div"); heading.className = "scoreboard-team-heading"; heading.textContent = `${group.label} ${group.points}`; section.append(heading, ...group.rows.map(createScoreboardRow)); return section;
    }) : []));
  if (rows) rows.replaceChildren(...(model.kind === "ffa" ? model.rows.map(createScoreboardRow) : []));
  board.hidden = false;
}
function lobbyControls(role) {
  const raw = input?.nextCommand?.(role === "guest" ? "pilot" : "host") || {};
  return p2pLobbyControlsFromCommand(raw);
}
async function handoffPracticeToLobby(role) {
  try { await practice?.ready; } catch { /* The authoritative lobby reports its own setup errors below. */ }
  if (!renderer) renderer = practice?.handoff?.() || null;
  if (!renderer) {
    const canvas = el("scene");
    if (!canvas) throw new Error("No se encontró el canvas del lobby.");
    renderer = createCausalBetaPresentationRenderer({ canvas, role, focusCarId: localId(role) });
    await renderer.ready?.();
  }
  renderer?.setFocusCarId?.(localId(role));
  input?.destroy?.();
  input = createP2PCausalInput({ fullControls: true, gameTarget: () => gameplayInputSurface });
}
function applyLobbySnapshot(snapshot, role) {
  if (!roomContext || snapshot.roomId !== roomContext.roomId) return;
  if (phaseOrder(roomContext.phase) > ROOM_PHASE_ORDER.lobby || !["room-open", "lobby"].includes(snapshot.phase)) return;
  const stableSnapshot = { ...snapshot, players: normalizeP2PLobbyPlayerSlots(snapshot.players) };
  if (stableSnapshot.phase === "room-open") roomContext.phase = "room-open";
  else if (roomContext.phase === "room-open") roomContext.phase = "team-selection";
  roomContext.mode = stableSnapshot.mode;
  roomContext.maxPlayers = stableSnapshot.maxPlayers;
  roomContext.players = new Map(stableSnapshot.players.map(player => [player.id, player]));
  renderLobby();
  const state = createP2PMultiplayerLobbyPresentationState(stableSnapshot, { roomId: roomContext.roomId, sessionId: `p2p-room-${roomContext.roomId}` });
  latest = state;
  snapshotInterpolator.push(state, performance.now() / 1000);
  renderScoreboard(state);
  void audioPresenter.present?.(state, { role: role === "guest" ? "pilot" : "host", carId: localId(role) });
  updateBoostMeter(state, { role, unlimited: true });
  renderer?.update?.(state); renderer?.render?.(); startPresentationLoop();
  status(`Lobby compartido · ${state.cars.length}/${snapshot.maxPlayers} pilotos · nitro infinito.`);
}
function stopLobbyControls({ announceLeave = false } = {}) {
  if (lobbyInputTimer !== null) clearInterval(lobbyInputTimer);
  lobbyInputTimer = null;
  input?.destroy?.(); input = null;
  if (announceLeave && roomContext?.role === "guest") lobbyGuestChannel?.leave?.();
  if (lobbyChannel === lobbyGuestChannel) lobbyChannel = null;
  lobbyGuestChannel = null;
}
async function beginGuestTeamSelection(state) {
  if (!roomContext || roomContext.role !== "guest" || lobbyGuestChannel || channel || !star) return;
  await handoffPracticeToLobby("guest");
  const credentials = roomContext.room;
  lobbyGuestChannel = new P2PWasmMultiplayerLobbyGuestChannel({ roomId: credentials.roomId, sessionId: `p2p-room-${credentials.roomId}`, slot: credentials.slot, name: playerName(), send: text => star.send(credentials.slot, text), onSnapshot: snapshot => applyLobbySnapshot(snapshot, "guest") });
  lobbyChannel = lobbyGuestChannel;
  lobbyGuestChannel.start();
  if (lobbyInputTimer !== null) clearInterval(lobbyInputTimer);
  lobbyInputTimer = setInterval(() => { if (lobbyGuestChannel?.isReadyForCommands?.()) lobbyGuestChannel.sendCommand(lobbyControls("guest"), ++sequence); }, 16);
  renderLobby();
  status(state.mode ? `Modo ${state.mode} preparado · elige equipo y espera al host.` : "Sala personal del host · conduce mientras llegan los demás.");
}
function resetOnlineRoundForHostMigration() {
  if (!roomContext) return;
  hostSlotRecovery.clear();
  for (const timer of [hostInputTimer, guestInputTimer, lobbyInputTimer]) if (timer !== null) clearInterval(timer);
  hostInputTimer = null; guestInputTimer = null; lobbyInputTimer = null;
  stopPresentationLoop();
  input?.destroy?.(); input = null;
  const oldChannel = channel; channel = null;
  const oldLobbyChannel = lobbyChannel; lobbyChannel = null;
  const oldLobbyGuestChannel = lobbyGuestChannel; lobbyGuestChannel = null;
  const oldLobbyHost = lobbyHost; lobbyHost = null;
  try { oldChannel?.close?.(); } catch {}
  // A migration is not a voluntary leave.  Closing the old guest adapter
  // locally must not send a `leave` frame to the successor host.
  try { oldLobbyGuestChannel?.close?.({ announceLeave: false }); } catch {}
  try { oldLobbyChannel?.close?.(); } catch {}
  try { oldLobbyHost?.close?.(); } catch {}
  snapshotInterpolator.reset(null); latest = null; audioPresenter.clear?.();
  // A promotion always starts a new waiting room. Retaining the previous
  // match mode/teams would advertise a stale roster while the authoritative
  // round has disappeared with its former host.
  roomContext.mode = null;
  roomContext.maxPlayers = P2P_MATCH_MAX_PLAYERS;
  roomContext.phase = "room-open";
  roomContext.room = { ...roomContext.room, mode: null, maxPlayers: P2P_MATCH_MAX_PLAYERS, phase: "room-open" };
  roomContext.players = new Map(currentPlayers().map(player => [player.id, { ...player, team: null }]));
  // The mode picker is host-local UI state while the room is open. Clear it
  // once at the migration boundary; do not clear it on every lobby snapshot,
  // or a host cannot select a mode before pressing its confirmation button.
  if (el("mode")) el("mode").value = "";
  setRoomVisible(true); renderLobby();
}
async function promoteGuestToHost(event) {
  if (!roomContext || roomContext.role !== "guest" || hostMigrationInProgress) return;
  hostMigrationInProgress = true;
  const previousSlot = guestSlot;
  const previousPlayers = currentPlayers();
  const previousEnvelopeSequence = lobbyHost?.nextEnvelopeSequence?.() || 0;
  const local = previousPlayers.find(player => player.id === `p2p-guest-${previousSlot}`);
  const initialPlayers = previousPlayers
    .filter(player => player.id !== "p2p-host" && player.id !== `p2p-guest-${previousSlot}`)
    .map(player => ({ ...player, team: null }));
  guestSlot = null;
  roomContext.role = "host";
  clearP2PPersistentGuestRoom();
  roomContext.room = { ...roomContext.room, hostSecret: activeClient?.credentials?.secret || roomContext.room.hostSecret };
  const resetPromise = activeClient?.resetRoom?.({ roomCode: roomContext.room.roomCode || roomContext.roomId, hostSecret: roomContext.room.hostSecret });
  resetOnlineRoundForHostMigration();
  let reset;
  try {
    reset = await resetPromise;
  } catch (error) {
    status(error instanceof Error ? error.message : "No se pudo restaurar la sala tras el cambio de host.");
    returnToOfflinePractice("No se pudo restaurar la sala tras el cambio de host.");
    return;
  }
  if (!reset) {
    returnToOfflinePractice("No se pudo restaurar la sala tras el cambio de host.");
    return;
  }
  roomContext.room = { ...roomContext.room, ...reset, hostSecret: roomContext.room.hostSecret };
  roomContext.mode = null;
  roomContext.maxPlayers = P2P_MATCH_MAX_PLAYERS;
  roomContext.phase = "room-open";
  saveP2PPersistentHostRoom({
    roomCode: roomContext.room.roomCode || roomContext.roomId, roomId: roomContext.roomId,
    hostSecret: roomContext.room.hostSecret, expiresAt: roomContext.room.expiresAt,
    mode: null, maxPlayers: P2P_MATCH_MAX_PLAYERS,
  });
  roomContext.players = new Map([
    { id: "p2p-host", slot: 0, name: local?.name || playerName(), team: null },
    ...initialPlayers,
  ].map(player => [player.id, player]));
  try {
    await handoffPracticeToLobby("host");
    lobbyHost = await createP2PWasmMultiplayerLobbyHost({ roomId: roomContext.roomId, sessionId: `p2p-room-${roomContext.roomId}`, mode: null, hostName: local?.name || playerName(), hostTeam: null, initialPlayers, initialEnvelopeSequence: previousEnvelopeSequence, bridgeFactory: undefined });
    const hostChannel = new P2PWasmMultiplayerLobbyHostChannel({ roomId: roomContext.roomId, sessionId: `p2p-room-${roomContext.roomId}`, lobbyHost, send: (slot, text) => star?.send(slot, text), onSnapshot: snapshot => applyLobbySnapshot(snapshot, "host"), joinedSlots: initialPlayers.filter(player => player.slot > 0).map(player => player.slot), allowKnownHello: true });
    lobbyChannel = hostChannel; await hostChannel.start();
    for (const [slot, messages] of pendingGuestMessages) for (const message of messages) await hostChannel.receive(slot, message);
    pendingGuestMessages = new Map();
    lobbyInputTimer = setInterval(() => { try { lobbyHost.setCommand("p2p-host", lobbyControls("host"), { sequence: ++sequence }); void hostChannel.advance(1); } catch {} }, 16);
    setRoomVisible(true); renderLobby(); status(`Nuevo host elegido · sala ${roomContext.roomId} · la sala conserva su clave.`);
  } catch (error) {
    status(error instanceof Error ? error.message : "No se pudo asumir la autoridad de la sala.");
    returnToOfflinePractice("No se pudo reconstruir la sala tras el cambio de host.");
  } finally { hostMigrationInProgress = false; }
}
const showState = (envelope, role) => { try { latest = createP2PMultiplayerPresentationState(envelope); snapshotInterpolator.push(latest, performance.now() / 1000); renderScoreboard(latest); updateCountdown(latest); const guest = role === "guest" || role === "pilot"; void audioPresenter.present?.(latest, { role: guest ? "pilot" : "host", carId: localId(guest ? "guest" : "host") }); updateBoostMeter(latest, { role, unlimited: false }); if (!renderer) { renderer = practice?.getRenderer?.() || null; practice?.handoff?.(); } renderer?.update?.(latest); renderer?.render?.(); startPresentationLoop(); status(latest.settings.roundState === "complete" ? "Partida terminada." : `Partida activa · ${latest.cars.length} pilotos · ${role === "host" ? "host WASM" : "piloto P2P"}`); } catch (error) { status(`Snapshot rechazado: ${error.message}`); } };
const command = (role, roster) => {
  const id = localId(role);
  const allowed = roster.targetsByPlayerId[id] || [];
  const candidates = renderer?.getAimCandidates?.() || [];
  const target = chooseP2PAimTarget(candidates, allowed);
  const next = input.nextCommand(role === "guest" ? "pilot" : "host", { candidateTargetId: target });
  renderer?.setTargetId?.(next.targetId);
  return next;
};
function startHostChannel(host, roster, room, activePlayers) { if (channel) return; channel = new P2PWasmMultiplayerHostChannel({ roomId: room.roomId, sessionId: `p2p-room-${room.roomId}`, host, slotPlayerIds: new Map(activePlayers.filter(player => player.slot > 0).map(player => [player.slot, player.id])), send: (slot, text) => star.send(slot, text), onSnapshot: (_snapshot, text) => showState(text, "host") }); input = createP2PCausalInput({ fullControls: true, gameTarget: () => gameplayInputSurface, targetAllowed: (_role, target) => roster.targetsByPlayerId["p2p-host"].includes(target) }); channel.start(); for (const [slot, messages] of pendingGuestMessages) for (const message of messages) channel.receive(slot, message); hostInputTimer = setInterval(() => { try { channel.host.setCommand("p2p-host", command("host", roster), { sequence: ++sequence }); } catch {} }, 16); status("Partida activa · 05:00 · W/A/S/D, clic izquierdo nitro, F cohete."); }
async function configureHostRoom() {
  if (!roomContext || roomContext.role !== "host" || !isWaitingPhase(roomContext.phase) || !activeClient) return;
  const mode = el("mode")?.value;
  const maxPlayers = selectedCapacity(mode);
  if (!isP2PMatchMode(mode)) return;
  status("Guardando el modo de la sala…");
  try {
    const configured = await activeClient.configureRoom({ roomCode: roomContext.roomId, hostSecret: roomContext.room.hostSecret, mode, maxPlayers });
    roomContext.mode = configured.mode; roomContext.maxPlayers = configured.maxPlayers; roomContext.room = { ...roomContext.room, ...configured };
    saveP2PPersistentHostRoom({ roomCode: roomContext.room.roomCode || roomContext.roomId, roomId: roomContext.roomId, hostSecret: roomContext.room.hostSecret, expiresAt: roomContext.room.expiresAt, mode: roomContext.mode, maxPlayers: roomContext.maxPlayers });
    const oldLobbyChannel = lobbyChannel; lobbyChannel = null;
    const oldLobbyHost = lobbyHost; lobbyHost = null;
    const previousEnvelopeSequence = oldLobbyHost?.nextEnvelopeSequence?.() || 0;
    oldLobbyChannel?.close?.(); oldLobbyHost?.close?.();
    if (lobbyInputTimer !== null) clearInterval(lobbyInputTimer);
    lobbyInputTimer = null;
    const players = assignWaitingTeams(currentPlayers(), mode);
    roomContext.players = new Map(players.map(player => [player.id, player]));
    await handoffPracticeToLobby("host");
    lobbyHost = await createP2PWasmMultiplayerLobbyHost({ roomId: roomContext.roomId, sessionId: `p2p-room-${roomContext.roomId}`, mode, hostName: playerName(), hostTeam: players.find(player => player.id === "p2p-host")?.team || defaultTeam(0), initialPlayers: players.filter(player => player.id !== "p2p-host"), initialEnvelopeSequence: previousEnvelopeSequence, bridgeFactory: undefined });
    const hostChannel = new P2PWasmMultiplayerLobbyHostChannel({ roomId: roomContext.roomId, sessionId: `p2p-room-${roomContext.roomId}`, lobbyHost, send: (slot, text) => star?.send(slot, text), onSnapshot: snapshot => applyLobbySnapshot(snapshot, "host"), joinedSlots: players.filter(player => player.slot > 0).map(player => player.slot), allowKnownHello: true });
    lobbyChannel = hostChannel; await hostChannel.start();
    if (lobbyInputTimer !== null) clearInterval(lobbyInputTimer);
    lobbyInputTimer = setInterval(() => { try { lobbyHost.setCommand("p2p-host", lobbyControls("host"), { sequence: ++sequence }); void hostChannel.advance(1); } catch {} }, 16);
    roomContext.phase = "team-selection"; renderLobby(); broadcastLobbyState();
    status(`Modo ${mode} preparado · los pilotos ya pueden elegir equipo.`);
  } catch (error) { status(error instanceof Error ? error.message : "No se pudo configurar la sala."); }
}
async function startHostMatch() { if (!roomContext || roomContext.role !== "host" || !isTeamSelectionPhase(roomContext.phase)) return; const match = currentRoster({ requireBalanced: true }); if (!match) { status("Aún faltan pilotos o equilibrar los equipos."); return; } const activePlayers = currentPlayers(); hostSlotRecovery.clear(); setRoomPhase("starting"); renderLobby(); broadcastLobbyState(); status("Preparando la partida…"); try { const names = Object.fromEntries(activePlayers.map(player => [player.id, player.name])); const host = await createP2PWasmMultiplayerCombatHost({ mode: roomContext.mode, playerIds: match.ids, names, teamsByPlayerId: match.teamsByPlayerId, durationSeconds: roomContext.durationSeconds }); if (lobbyInputTimer !== null) clearInterval(lobbyInputTimer); lobbyInputTimer = null; lobbyChannel?.close?.(); lobbyChannel = null; lobbyHost?.close?.(); lobbyHost = null; input?.destroy?.(); input = null; setRoomPhase("playing"); setRoomVisible(false); closeMatchMenu(); renderLobby(); broadcastLobbyState(); startHostChannel(host, match.roster, roomContext.room, activePlayers); } catch (error) { roomContext.phase = "team-selection"; setRoomVisible(true); renderLobby(); broadcastLobbyState(); status(error instanceof Error ? error.message : "No se pudo iniciar la partida."); } }
function startGuestMatch(state) { if (!roomContext || roomContext.role !== "guest" || channel) return; stopLobbyControls(); setRoomVisible(false); closeMatchMenu(); const ids = state.players.map(player => player.id); const teams = teamMode(state.mode) ? Object.fromEntries(state.players.map(player => [player.id, player.team])) : null; let roster; try { roster = createP2PMatchRoster({ mode: state.mode, playerIds: ids, teamsByPlayerId: teams }); } catch (error) { status(`Roster rechazado: ${error.message}`); return; } const id = localId("guest"); input = createP2PCausalInput({ fullControls: true, gameTarget: () => gameplayInputSurface, targetAllowed: (_role, target) => roster.targetsByPlayerId[id]?.includes(target) }); channel = new P2PWasmMultiplayerPilotChannel({ roomId: roomContext.roomId, sessionId: `p2p-room-${roomContext.roomId}`, send: text => star.send(guestSlot, text), onSnapshot: envelope => showState(envelope, "guest") }); try { channel.sendIdentity(playerName()); } catch {} guestInputTimer = setInterval(() => { try { channel?.sendCommand(command("guest", roster)); } catch {} }, 16); status(`Partida activa · ${formatCountdown(state.durationSeconds)}.`); }
async function openHostRoom(room, { restored = false } = {}) {
  const name = requirePlayerName(); if (!name) return;
  const { mode, maxPlayers } = room;
  const client = new P2PMultiSignalingClient({ origin: P2P_SIGNAL_ORIGIN }); activeClient = client;
  if (el("mode")) el("mode").value = mode || ""; syncCapacityControl();
  roomContext = { role: "host", room, roomId: room.roomId, mode, maxPlayers, durationSeconds: P2P_LOBBY_DURATION_SECONDS, phase: mode ? "team-selection" : "room-open", players: new Map([["p2p-host", { id: "p2p-host", slot: 0, name, team: mode && teamMode(mode) ? defaultTeam(0) : null }]]) };
  setRoomVisible(true); el("room-code").value = room.roomCode || room.roomId; renderLobby();
  await handoffPracticeToLobby("host");
  lobbyHost = await createP2PWasmMultiplayerLobbyHost({ roomId: room.roomId, sessionId: `p2p-room-${room.roomId}`, mode, hostName: name, hostTeam: mode && teamMode(mode) ? defaultTeam(0) : null, bridgeFactory: undefined });
  const hostChannel = new P2PWasmMultiplayerLobbyHostChannel({ roomId: room.roomId, sessionId: `p2p-room-${room.roomId}`, lobbyHost, send: (slot, text) => star?.send(slot, text), onSnapshot: snapshot => applyLobbySnapshot(snapshot, "host"), allowKnownHello: true });
  lobbyChannel = hostChannel; await hostChannel.start();
  const watchedClient = client;
  const handleHostSignalTerminal = (type, event) => {
    if (pageUnloading || activeClient !== watchedClient || roomContext?.role !== "host") return;
    void recoverFormerHostPersonalRoom(type === "error" ? event?.code : event?.reason);
  };
  // Register before opening the socket so a very fast Firefox failure cannot
  // outrun the owner-loss recovery listener.
  client.on("error", event => handleHostSignalTerminal("error", event));
  client.on("closed", event => handleHostSignalTerminal("closed", event));
  client.connect({ roomId: room.roomId, role: "host", secret: room.hostSecret, expiresAt: room.expiresAt });
  pendingGuestMessages = new Map();
  // A WebRTC session can emit both `peer-left` (data channel close) and
  // `closed` (session cleanup) for the same slot. Treat both signals as one
  // presence transition while the room is waiting, then clear the guard when
  // the replacement session opens so the slot can leave again later.
  const departedSlots = new Set();
  star = new P2PMultiplayerWebRTCStar({ role: "host", signaling: client, guestSlots: Array.from({ length: maxPlayers - 1 }, (_, index) => index + 1), iceServers: P2P_ICE_SERVERS, maxMessageBytes: 16 * 1024, onEvent: event => {
    if (event.type === "channel-message") {
      // The same WebRTC session survives the lobby-to-match handoff. Route
      // each frame to the authority that owns the current phase; never feed
      // combat commands into the closed lobby decoder.
      if (isWaitingPhase(roomContext?.phase)) {
        const activeLobbyChannel = lobbyChannel;
        if (activeLobbyChannel?.receive) void activeLobbyChannel.receive(event.slot, event.data);
        else if (roomContext.phase === "room-open") handleHostLobbyMessage(event.slot, event.data);
        else {
          const queued = pendingGuestMessages.get(event.slot) || [];
          queued.push(event.data);
          pendingGuestMessages.set(event.slot, queued.slice(-32));
        }
        return;
      }
      if (roomContext?.phase === "playing") { void channel?.receive(event.slot, event.data); }
      return;
    }
    if (event.type === "channel-open") {
      departedSlots.delete(event.slot);
      if (roomContext?.phase === "playing" && hostSlotRecovery.reconnected(event.slot)) {
        status("Piloto reconectado · la partida continúa.");
        return;
      }
      status("Piloto conectado · esperando nombre…");
      return;
    }
    if (event.type === "closed" || event.type === "peer-left" || event.type === "error") {
      // Once combat starts the lobby authority is closed and the combat
      // channel owns the connection lifecycle. Never remove or replace a
      // combat pilot through the waiting-lobby path.
      if (roomContext?.phase === "playing") {
        if (hostSlotRecovery.begin(event.slot)) status("Piloto reconectando · la partida continúa.");
        return;
      }
      if (!isWaitingPhase(roomContext?.phase) || departedSlots.has(event.slot)) return;
      departedSlots.add(event.slot);
      const activeLobbyChannel = lobbyChannel;
      if (activeLobbyChannel?.receive) void activeLobbyChannel.receive(event.slot, JSON.stringify({ protocolVersion: 1, type: "wasm-lobby-message", message: "leave", roomId: room.roomId, sessionId: `p2p-room-${room.roomId}`, playerId: `p2p-guest-${event.slot}` }));
      else if (roomContext.phase === "room-open") { roomContext.players.delete(`p2p-guest-${event.slot}`); broadcastLobbyState(); }
      star?.replace?.(event.slot);
    }
  } }).start();
  if (lobbyHost && lobbyChannel) {
    lobbyInputTimer = setInterval(() => { try { lobbyHost.setCommand("p2p-host", lobbyControls("host"), { sequence: ++sequence }); void lobbyChannel.advance(1); } catch {} }, 16);
  }
  status(restored ? "Sala restaurada · misma clave personal · comparte la clave cuando quieras." : "Sala personal lista · comparte la clave cuando quieras.");
}
async function createFreshPersonalRoom() {
  status("Creando tu sala personal…");
  const client = new P2PMultiSignalingClient({ origin: P2P_SIGNAL_ORIGIN });
  const room = await client.createRoom();
  saveP2PPersistentHostRoom({ roomCode: room.roomCode || room.roomId, roomId: room.roomId, hostSecret: room.hostSecret, expiresAt: room.expiresAt, mode: room.mode, maxPlayers: room.maxPlayers });
  await openHostRoom(room);
}
async function hostRoom() {
  const name = requirePlayerName(); if (!name) return;
  const saved = loadP2PPersistentHostRoom();
  if (saved) {
    // A browser launch is an entry into the owner's waiting room, never a
    // resumption of its last selected match.  Reset the authoritative record
    // before exposing the key so an old 1v1/2v2 selection cannot make a new
    // player appear incompatible with this personal room.
    status("Abriendo tu sala personal…");
    try {
      const client = new P2PMultiSignalingClient({ origin: P2P_SIGNAL_ORIGIN });
      const reset = await client.resetRoom({ roomCode: saved.roomCode || saved.roomId, hostSecret: saved.hostSecret });
      const room = { ...saved, ...reset, hostSecret: saved.hostSecret, mode: null, maxPlayers: P2P_MATCH_MAX_PLAYERS };
      saveP2PPersistentHostRoom({
        roomCode: room.roomCode || room.roomId, roomId: room.roomId, hostSecret: room.hostSecret,
        expiresAt: room.expiresAt, mode: null, maxPlayers: P2P_MATCH_MAX_PLAYERS,
      });
      await openHostRoom(room, { restored: true });
    } catch (error) {
      if (lostPersistentHostOwnership(error)) {
        // The Durable Object has promoted a remaining player. This browser
        // cannot and must not reclaim that public key; discard only its stale
        // local owner secret and create the same personal room a new browser
        // receives on first launch.
        clearP2PPersistentHostRoom();
        status("La sala anterior tiene un nuevo host. Creando tu nueva sala personal…");
        await createFreshPersonalRoom();
        return;
      }
      status(error instanceof Error ? error.message : "No se pudo abrir tu sala personal.");
      returnToOfflinePractice("No se pudo abrir tu sala personal; vuelve a intentarlo.");
    }
    return;
  }
  await createFreshPersonalRoom();
}
function releaseGuestTransport() {
  if (guestInputTimer !== null) clearInterval(guestInputTimer);
  if (lobbyInputTimer !== null) clearInterval(lobbyInputTimer);
  guestInputTimer = null;
  lobbyInputTimer = null;
  input?.destroy?.(); input = null;
  const oldChannel = channel; channel = null;
  const oldLobbyGuestChannel = lobbyGuestChannel; lobbyGuestChannel = null;
  if (lobbyChannel === oldLobbyGuestChannel) lobbyChannel = null;
  const oldStar = star; star = null;
  const oldClient = activeClient; activeClient = null;
  try { oldChannel?.close?.(); } catch {}
  // This is a transport retry, not a voluntary departure from the room.
  try { oldLobbyGuestChannel?.close?.({ announceLeave: false }); } catch {}
  try { oldStar?.close?.(); } catch {}
  try { oldClient?.close?.(); } catch {}
}

async function retryGuestTransport({ attempt = 1, reason = "transport" } = {}) {
  const context = roomContext;
  const recoverable = context?.role === "guest" && (isWaitingPhase(context.phase) || context.phase === "playing");
  const credentials = recoverable ? context.room : null;
  if (!credentials?.roomCode || !credentials?.participantId || !credentials?.reconnectToken) return;
  const resume = context.phase === "playing" ? {
    phase: "playing",
    mode: context.mode,
    maxPlayers: context.maxPlayers,
    durationSeconds: context.durationSeconds,
    players: currentPlayers().map(player => ({ ...player })),
  } : null;
  const retryEpoch = ++guestConnectionEpoch;
  releaseGuestTransport();
  status(`Reconectando con la sala… intento ${attempt}.`);
  try {
    const client = new P2PMultiSignalingClient({ origin: P2P_SIGNAL_ORIGIN });
    const joined = await client.joinRoomByCode(credentials.roomCode, { reconnect: credentials });
    if (retryEpoch !== guestConnectionEpoch || roomContext?.role !== "guest") return;
    await guestRoom(joined, { retry: true, resume });
  } catch (error) {
    if (retryEpoch !== guestConnectionEpoch || roomContext?.role !== "guest") return;
    status(`No se pudo reconectar todavía. ${error instanceof Error ? error.message : "Reintentando…"}`);
    guestRecovery.scheduleRetry({ reason: `${reason}-rejoin` });
  }
}

async function guestRoom(credentials, { retry = false, resume = null } = {}) {
  const name = requirePlayerName(); if (!name) return;
  const connectionEpoch = ++guestConnectionEpoch;
  guestSlot = credentials.slot; if (credentials.mode) el("mode").value = credentials.mode; syncCapacityControl();
  saveP2PPersistentGuestRoom({ roomCode: credentials.roomCode, roomId: credentials.roomId, participantId: credentials.participantId, reconnectToken: credentials.reconnectToken, expiresAt: credentials.expiresAt, mode: credentials.mode, maxPlayers: credentials.maxPlayers });
  try {
    const resumePlaying = retry && resume?.phase === "playing" && Array.isArray(resume.players) && resume.players.length >= 2;
    const mode = resumePlaying ? resume.mode : credentials.mode;
    const maxPlayers = resumePlaying ? resume.maxPlayers : credentials.maxPlayers;
    const durationSeconds = resumePlaying ? resume.durationSeconds : P2P_LOBBY_DURATION_SECONDS;
    const players = resumePlaying ? new Map(resume.players.map(player => [player.id, { ...player }])) : new Map();
    roomContext = { role: "guest", room: credentials, roomId: credentials.roomId, mode, maxPlayers, durationSeconds, phase: resumePlaying ? "playing" : (credentials.mode ? "team-selection" : "room-open"), players };
    setRoomVisible(!resumePlaying); el("room-code").value = credentials.roomCode; renderLobby();
    if (!resumePlaying) await handoffPracticeToLobby("guest");
    if (connectionEpoch !== guestConnectionEpoch || roomContext?.role !== "guest") return;
    const client = new P2PMultiSignalingClient({ origin: P2P_SIGNAL_ORIGIN }); activeClient = client;
    client.connect({ roomId: credentials.roomId, role: "guest", slot: credentials.slot, secret: credentials.guestSecret, expiresAt: credentials.expiresAt });
    status(retry ? (resumePlaying ? "Reconectando con la partida…" : "Reconectando con el host…") : "Conectando con el host… la sala sigue disponible mientras se negocia WebRTC.");
    const departedSlots = new Set();
    star = new P2PMultiplayerWebRTCStar({ role: "guest", signaling: client, slot: credentials.slot, failoverGuestSlots: Array.from({ length: Math.max(0, credentials.maxPlayers - 1) }, (_, index) => index + 1), iceServers: P2P_ICE_SERVERS, maxMessageBytes: 16 * 1024, onEvent: event => {
    if (connectionEpoch !== guestConnectionEpoch || activeClient !== client || !roomContext) return;
    // The same star object becomes the host star when this client wins the
    // deterministic election. Route subsequent peer events as authority;
    // the closure below is intentionally not a permanently-guest callback.
    if (roomContext?.role === "host") {
      if (event.type === "channel-message") {
        if (isWaitingPhase(roomContext.phase)) {
          const activeLobbyChannel = lobbyChannel;
          if (activeLobbyChannel?.receive) void activeLobbyChannel.receive(event.slot, event.data);
          else if (roomContext.phase === "room-open") handleHostLobbyMessage(event.slot, event.data);
          else {
            const queued = pendingGuestMessages.get(event.slot) || [];
            queued.push(event.data);
            pendingGuestMessages.set(event.slot, queued.slice(-32));
          }
        } else if (roomContext.phase === "playing") void channel?.receive(event.slot, event.data);
        return;
      }
      if (event.type === "channel-open") {
        departedSlots.delete(event.slot);
        if (roomContext.phase === "playing" && hostSlotRecovery.reconnected(event.slot)) {
          status("Piloto reconectado · la partida continúa.");
          return;
        }
        status("Piloto reconectado · recuperando el lobby…");
        return;
      }
      if (event.type === "closed" || event.type === "peer-left" || event.type === "error") {
        if (roomContext.phase === "playing") {
          if (hostSlotRecovery.begin(event.slot)) status("Piloto reconectando · la partida continúa.");
          return;
        }
        if (!isWaitingPhase(roomContext.phase) || departedSlots.has(event.slot)) return;
        departedSlots.add(event.slot);
        const activeLobbyChannel = lobbyChannel;
        if (activeLobbyChannel?.receive) void activeLobbyChannel.receive(event.slot, JSON.stringify({ protocolVersion: 1, type: "wasm-lobby-message", message: "leave", roomId: roomContext.roomId, sessionId: `p2p-room-${roomContext.roomId}`, playerId: `p2p-guest-${event.slot}` }));
        else if (roomContext.phase === "room-open") { roomContext.players.delete(`p2p-guest-${event.slot}`); broadcastLobbyState(); }
        star?.replace?.(event.slot);
      }
      return;
    }
    if (event.type === "host-transition") {
      guestRecovery.promotionObserved();
      resetOnlineRoundForHostMigration();
      status("El host anterior se ha desconectado · reconectando con el nuevo host…");
      return;
    }
    if (event.type === "host-promoted" && event.role === "host") { guestRecovery.promotionObserved(); void promoteGuestToHost(event); return; }
    if (event.type === "channel-open") {
      guestRecovery.connected();
      if (roomContext?.phase === "playing" && !channel) {
        startGuestMatch({ players: currentPlayers(), mode: roomContext.mode, durationSeconds: roomContext.durationSeconds });
        return;
      }
      // WebRTC lifecycle notifications can be repeated during recovery. Only
      // the first open for the waiting phase owns the lobby channel/timer.
      if (!isWaitingPhase(roomContext?.phase) || channel) return;
      if (lobbyGuestChannel) return;
      void beginGuestTeamSelection({ mode: roomContext.mode });
    }
    if (event.type === "channel-message") { if (lobbyGuestChannel?.receive(event.data)?.accepted) return; const lobby = decodeP2PLobbyMessage(event.data, { roomId: credentials.roomId }); if (lobby?.type === "state") applyLobbyState(lobby); else channel?.receive(event.data); }
    if (event.type === "peer-left") {
      guestRecovery.awaitHostPromotion({ reason: "peer-left" });
      return;
    }
    if (event.type === "error") {
      guestRecovery.scheduleRetry({ reason: "webrtc-error" });
      return;
    }
    if (event.type === "closed") guestRecovery.scheduleRetry({ reason: "transport-closed" });
  } }).start();
  } catch (error) {
    if (connectionEpoch !== guestConnectionEpoch || roomContext?.role !== "guest") return;
    releaseGuestTransport();
    status(error instanceof Error ? error.message : "No se pudo iniciar la conexión con la sala.");
    guestRecovery.scheduleRetry({ reason: "setup-failed" });
  }
}
async function joinRoomByCode() {
  const name = requirePlayerName(); if (!name) return;
  const value = el("join-code")?.value || "";
  if (!value.trim()) return status("Escribe la clave de sala.");
  if (roomJoinInFlight) return status("Ya se está intentando unir a una sala.");
  const normalizedCode = String(value).toUpperCase().replace(/[\s-]/gu, "");
  const activeGuestRoom = roomContext?.role === "guest"
    && isWaitingPhase(roomContext.phase)
    && (roomContext.roomId === normalizedCode || roomContext.room?.roomCode === normalizedCode)
    && (activeClient || star || lobbyGuestChannel || guestRecovery.snapshot().retryPending || guestRecovery.snapshot().promotionPending);
  if (activeGuestRoom) return status("Ya estás conectado o reconectando a esta sala.");
  roomJoinInFlight = true;
  el("join").disabled = true;
  try {
    status("Buscando sala…");
    const client = new P2PMultiSignalingClient({ origin: P2P_SIGNAL_ORIGIN });
    const saved = loadP2PPersistentGuestRoom();
    const reconnect = saved?.roomCode === normalizedCode ? saved : null;
    const joined = await client.joinRoomByCode(value, { reconnect });
    if (roomContext?.role === "host" || roomContext?.role === "guest") returnToOfflinePractice("Entrando en la sala compartida…");
    if (joined.mode) el("mode").value = joined.mode;
    el("room-code").value = joined.roomCode;
    invite = null;
    await guestRoom(joined);
  } catch (error) {
    status(error instanceof Error ? error.message : "No se pudo usar la clave.");
  } finally {
    roomJoinInFlight = false;
    el("join").disabled = false;
  }
}
window.addEventListener("beforeunload", () => { pageUnloading = true; guestRecovery.dispose(); cleanupDesktopControls(); if (hostInputTimer !== null) clearInterval(hostInputTimer); if (guestInputTimer !== null) clearInterval(guestInputTimer); if (lobbyInputTimer !== null) clearInterval(lobbyInputTimer); stopPresentationLoop(); if (roomContext?.role === "guest" && isWaitingPhase(roomContext.phase)) lobbyGuestChannel?.leave?.(); lobbyChannel?.close?.(); lobbyHost?.close?.(); channel?.close?.(); star?.close?.(); activeClient?.close?.(); practice?.stop?.(); void audioPresenter.dispose?.(); });
document.addEventListener("pointerdown", () => { void unlockAudioFromGesture(); }, { passive: true });
document.addEventListener("keydown", event => { if (!["Alt", "Control", "Meta", "Shift", "Tab", "Escape"].includes(event.key)) void unlockAudioFromGesture(); }, { passive: true });
el("join").onclick = () => joinRoomByCode();
el("name")?.addEventListener("input", updateRoomActionAvailability);
el("join-code")?.addEventListener("input", updateRoomActionAvailability);
el("configure-room")?.addEventListener("click", () => { void configureHostRoom(); });
el("start-match")?.addEventListener("click", () => { void startHostMatch(); });
for (const team of ["blue", "red"]) el(`team-choice-${team}`)?.addEventListener("click", () => { if (!roomContext || !isTeamSelectionPhase(roomContext.phase)) return; const id = localId(roomContext.role); const current = roomContext.players.get(id)?.team; const nextTeam = current === team ? null : team; if (roomContext.role === "host") { if (lobbyHost?.setTeam(id, nextTeam)) { void lobbyChannel?.advance?.(1); } else status("Ese equipo ya está completo."); } else { const result = lobbyGuestChannel?.sendTeam(nextTeam); if (!result?.accepted) status(result?.reason || "No se pudo cambiar de equipo."); } });
el("return-personal-room")?.addEventListener("click", () => { void returnToPersonalRoom(); });
el("return-personal-menu")?.addEventListener("click", () => { void returnToPersonalRoom(); });
el("retry-personal-room")?.addEventListener("click", () => { void bootstrapPersonalRoom().catch(() => {}); });
el("copy-room-code")?.addEventListener("click", async () => { const code = el("room-code")?.value?.trim(); if (!code) return; try { await navigator.clipboard.writeText(code); status("Clave copiada."); } catch { el("room-code")?.focus(); el("room-code")?.select(); } });
el("mode").onchange = syncCapacityControl;
if (el("name") && !String(el("name").value || "").trim()) el("name").value = defaultPlayerName();
el("name")?.addEventListener("change", () => { try { localStorage.setItem("arsenal.p2p.player-name", playerName()); } catch {} });
if (invite) {
  const externalInvite = invite;
  invite = null;
  queueMicrotask(async () => {
    try {
      // Even a deep-link guest first receives a personal key. It is suspended
      // only while this external room is active and restored on return.
      await bootstrapPersonalRoom();
      returnToOfflinePractice("Entrando en la sala compartida…");
      await guestRoom(externalInvite);
    } catch (error) { status(error instanceof Error ? error.message : "No se pudo abrir la invitación."); }
  });
}
const queryName = new URL(location.href).searchParams.get("name"); if (queryName && el("name")) el("name").value = queryName.slice(0, 16);
syncCapacityControl();
updateRoomActionAvailability();
const startupUrl = new URL(location.href); const startupJoinCode = startupUrl.searchParams.get("join");
if (startupJoinCode) { startupUrl.searchParams.delete("join"); history.replaceState(null, "", `${startupUrl.pathname}${startupUrl.search}`); queueMicrotask(async () => { try { await bootstrapPersonalRoom(); el("join-code").value = startupJoinCode; updateRoomActionAvailability(); await joinRoomByCode(); } catch {} }); }
else if (!bootingFromInvite) queueMicrotask(() => { void bootstrapPersonalRoom().catch(() => {}); });
