import { bootP2PRoomLobby, p2pRoomLifecycleLabel } from "./p2p-room-lobby.js";
import { isP2PIceConnectionState } from "./p2p-room-config.js";
import { P2PWasmRenderBuffer } from "./p2p-wasm-render-state.js";
import { P2PWasmPresentationRenderBuffer } from "../tools/wasm-spike/p2p-wasm-presentation-render-state.mjs";
import {
  createP2PCausalInput,
  P2P_BINDING_LABELS,
  P2P_DEFAULT_BINDINGS,
  p2pBindingName,
  p2pBindingTokenFromEvent,
} from "./p2p-causal-input.js";
import { renderP2PCausalBetaHud } from "./p2p-causal-beta-hud.js";
import { P2PWasmCausalRoomSession } from "../tools/wasm-spike/p2p-wasm-causal-room-session.mjs";
// Keep the diagnostic factory import available for isolated smoke fixtures;
// the public beta below deliberately selects the full local-game authority.
import { createP2PWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-combat-host.mjs";
import { createP2PFullWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-full-combat-host.mjs";
import { normalizeP2PPlayerName } from "./p2p-player-identity.js";
import { createAuthoritativeStateSource } from "./authoritative-state-source.js";

/** One bounded, neutral pilot input used only by the beta smoke action. */
export const SAFE_TEST_COMMAND = Object.freeze({
  controls: Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false }),
  fire: false,
  targetId: null,
});

export const P2P_CAUSAL_CONTROL_INTERVAL_MS = 1000 / 60;
export const P2P_CAUSAL_DIAGNOSTICS_INTERVAL_MS = 250;
export const P2P_CAUSAL_DIAGNOSTICS_STORAGE_KEY = "arsenal.p2p.diagnostics";
export const P2P_CAUSAL_BINDINGS_STORAGE_KEY = "arsenal.p2p.bindings";
export const P2P_CAUSAL_AUDIO_VOLUME_STORAGE_KEY = "arsenal.p2p.audio-volume";
export const P2P_CAUSAL_AUDIO_MUTED_STORAGE_KEY = "arsenal.p2p.audio-muted";
// The host normally publishes pickup metadata every 15 simulation ticks. Keep
// a deliberately generous local freshness window so transient rendering or
// scheduling jitter does not flicker the arena, while a stopped side-channel
// cannot leave old pickup availability presented as current.
export const P2P_CAUSAL_METADATA_STALE_MS = 2_000;

/** Public presentation states for the arena-first beta shell. */
export const P2P_CAUSAL_UI_STATES = Object.freeze([
  "loading",
  "waiting",
  "ready",
  "playing",
  "menu",
  "error",
  "round-complete",
]);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Keep the beta presentation independent from host internals and room
 * credentials. The causal protocol already validates this shape; this second
 * projection makes the UI explicitly presentation-only.
 */
export function normalizeCausalBetaSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.cars)
    || snapshot.cars.length !== 2) return null;
  const physical = Array.isArray(snapshot.physical) ? snapshot.physical : [];
  const physicalById = new Map(physical.map(car => [car?.id, car]));
  const cars = snapshot.cars.map(car => {
    if (!car || typeof car.id !== "string" || typeof car.team !== "string") return null;
    const body = physicalById.get(car.id);
    return {
      id: car.id,
      team: car.team,
      hp: finite(car.hp),
      alive: Boolean(car.alive),
      position: body && typeof body === "object"
        ? { x: finite(body.x), h: finite(body.h), z: finite(body.z) }
        : null,
    };
  });
  if (cars.some(car => car === null)) return null;
  return Object.freeze({
    tick: finite(snapshot.tick),
    score: snapshot.score && typeof snapshot.score === "object"
      ? { blue: finite(snapshot.score.blue), red: finite(snapshot.score.red) }
      : null,
    cars,
  });
}

export function renderCausalBetaSnapshot(element, snapshot) {
  const normalized = normalizeCausalBetaSnapshot(snapshot);
  if (element) element.textContent = normalized
    ? JSON.stringify(normalized, null, 2)
    : "Esperando un snapshot causal normalizado de los dos coches…";
  return normalized;
}

/** Render only the presentation view-model; never expose the wire envelope. */
export function renderCausalBetaState(element, state) {
  if (!element) return state;
  if (!state) {
    element.textContent = "Esperando un snapshot causal normalizado de los dos coches…";
    return null;
  }
  const tick = Math.round(state.time * 60);
  const lines = [
    `tick ${tick} · marcador azul ${state.score.blue} — rojo ${state.score.red}`,
    ...state.cars.map(car => `${car.name} · ${car.alive ? "activo" : "fuera"} · vida ${car.hp} · posición ${car.x.toFixed(1)}, ${car.z.toFixed(1)}, ${car.h.toFixed(1)}`),
    `cohetes activos: ${state.rockets.length}`,
  ];
  element.textContent = lines.join("\n");
  return state;
}

function setText(documentRef, id, value) {
  const element = documentRef.getElementById(id);
  if (element) element.textContent = value;
  return element;
}

export function formatP2PCausalTargetStatus(targetId, { remoteName = "RIVAL", screenVisible = true } = {}) {
  if (typeof targetId !== "string" || targetId.length === 0) return "SIN OBJETIVO · Q para bloquear";
  const visibility = screenVisible === false ? " · FUERA DE PANTALLA" : "";
  return `OBJETIVO BLOQUEADO · ${remoteName || "RIVAL"}${visibility}`;
}

/**
 * Pickup state is optional presentation metadata, never causal authority.
 * Report its freshness explicitly so a player does not act on a frozen pad
 * indicator while the control/snapshot channel remains healthy.
 */
export function formatP2PCausalMetadataStatus(metadata, { ageMs = null, failed = false } = {}) {
  if (failed) return "PICKUPS · METADATOS NO DISPONIBLES";
  const pads = Array.isArray(metadata?.pads) ? metadata.pads : [];
  if (pads.length === 0) return "PICKUPS · SIN DATOS";
  const active = pads.filter(pad => pad?.active === true).length;
  const stale = Number.isFinite(ageMs) && ageMs >= P2P_CAUSAL_METADATA_STALE_MS;
  return `PICKUPS · ${active}/${pads.length} ACTIVOS${stale ? " · DATOS ATRASADOS" : ""}`;
}

/** Start the beta once, with the causal room adapter explicitly injected. */
export function startP2PCausalBeta({
  documentRef = typeof document !== "undefined" ? document : null,
  CausalRoomSession = P2PWasmCausalRoomSession,
  causalHostFactory = createP2PFullWasmCombatHost,
  createInput = createP2PCausalInput,
  setIntervalFn = typeof setInterval === "function" ? setInterval : null,
  clearIntervalFn = typeof clearInterval === "function" ? clearInterval : null,
  requestAnimationFrameFn = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null,
  cancelAnimationFrameFn = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null,
  nowFn = () => typeof performance !== "undefined" ? performance.now() : Date.now(),
  presentation = false,
  // The online presentation waits for its first two-car snapshot before it
  // can create the renderer and controls. Prime the pilot channel once after
  // welcome so the host clock emits that initial frame without user input.
  primePilotOnWelcome = presentation,
  presentationCanvas = documentRef?.getElementById?.("causal-scene")
    || documentRef?.getElementById?.("causal-canvas")
    || documentRef?.querySelector?.("canvas")
    || null,
  presentationRendererFactory = null,
  audioPresenter = null,
  metadata = true,
  onOnlineSessionEvent = () => {},
  // A browser shell can keep a local practice renderer alive while signaling
  // negotiates. It gets this one synchronous handoff immediately before the
  // online renderer claims the shared canvas for its first authoritative
  // snapshot. That prevents both a black gap and two WebGL renderers owning
  // the same canvas at once.
  onBeforeOnlinePresentationStart = () => {},
  ...lobbyOptions
} = {}) {
  if (!documentRef) return null;
  if (typeof metadata !== "boolean") throw new TypeError("La opción de metadatos online debe ser booleana.");
  const action = documentRef.getElementById("causal-action");
  const audioAction = documentRef.getElementById("causal-audio-action");
  const audioMute = documentRef.getElementById("causal-audio-mute");
  const audioVolume = documentRef.getElementById("causal-audio-volume");
  const audioVolumeValue = documentRef.getElementById("causal-audio-volume-value");
  const audioStatus = documentRef.getElementById("causal-audio-status");
  const targetStatus = documentRef.getElementById("causal-target");
  const loadingOverlay = documentRef.getElementById("renderer-loading-overlay");
  const loadingStatus = documentRef.getElementById("renderer-loading-status");
  const menuToggle = documentRef.getElementById("game-menu-toggle");
  const fullscreenToggle = documentRef.getElementById("fullscreen-toggle");
  const menuOverlay = documentRef.getElementById("game-menu-overlay");
  const menuClose = documentRef.getElementById("game-menu-close");
  const snapshotElement = documentRef.getElementById("causal-snapshot");
  const diagnosticsDetails = documentRef.getElementById("causal-diagnostics")
    || documentRef.querySelector?.(".causal-diagnostics")
    || null;
  const diagnosticsToggle = documentRef.getElementById("diagnostics-toggle");
  const bindingsRoot = documentRef.getElementById("causal-bindings");
  const bindingsReset = documentRef.getElementById("causal-bindings-reset");
  const stateElement = documentRef.getElementById("causal-state");
  let causalReady = false;
  let commandSent = false;
  let controller;
  let renderBuffer = null;
  let authoritativeStateSource = null;
  let presentationRenderer = null;
  let presentationRendererReady = false;
  let presentationReadyPromise = null;
  let presentationRendererFailed = false;
  let presentationErrorMessage = null;
  let destroyed = false;
  let sessionEnded = false;
  let lifecycleState = null;
  let sessionRole = null;
  let localPlayerName = "PILOTO";
  let remotePlayerName = null;
  let metadataState = null;
  let metadataReceivedAt = null;
  let metadataFailed = false;
  let metadataAppliedToRenderer = false;
  let hudState = null;
  let presentationFrame = null;
  let localTargetId = null;
  let presentationFrameCount = 0;
  let presentationFpsWindowStart = Date.now();
  let latestDiagnosticState = null;
  let diagnosticsLastUpdate = -Infinity;
  let diagnosticsEnabled = false;
  let bindings = { ...P2P_DEFAULT_BINDINGS };
  let pendingBinding = null;
  const presentationCanvasElement = presentationCanvas || documentRef.getElementById("causal-scene");
  const gameplayInputSurface = documentRef.getElementById("causal-input-surface") || presentationCanvasElement;
  // Request fullscreen from the root, not the arena <main>.  Chromium, Firefox,
  // Edge, Opera and Brave all support the standard API here; using the root also
  // avoids a browser treating a nested, transformed gameplay element as a
  // non-fullscreenable target.
  const fullscreenTarget = documentRef.documentElement || documentRef.querySelector?.("main") || null;
  const fullscreenElement = () => documentRef.fullscreenElement
    || documentRef.webkitFullscreenElement
    || documentRef.mozFullScreenElement
    || documentRef.msFullscreenElement
    || null;
  const requestFullscreenMethod = target => target?.requestFullscreen
    || target?.webkitRequestFullscreen
    || target?.mozRequestFullScreen
    || target?.msRequestFullscreen
    || null;
  const exitFullscreenMethod = () => documentRef.exitFullscreen
    || documentRef.webkitExitFullscreen
    || documentRef.mozCancelFullScreen
    || documentRef.msExitFullscreen
    || null;
  const fullscreenSupported = () => Boolean(
    fullscreenElement() || (fullscreenTarget && requestFullscreenMethod(fullscreenTarget)),
  );
  const resolveFullscreenResult = result => {
    // Older prefixed APIs return void. Modern browser APIs return a Promise.
    if (result && typeof result.then === "function") {
      void Promise.resolve(result)
        .then(updateFullscreenButton, updateFullscreenButton)
        .catch(() => {});
      return;
    }
    updateFullscreenButton();
  };
  const updateFullscreenButton = () => {
    if (!fullscreenToggle) return;
    const active = Boolean(fullscreenElement());
    fullscreenToggle.textContent = active ? "Salir de pantalla completa" : "Pantalla completa";
    fullscreenToggle.setAttribute("aria-pressed", String(active));
    fullscreenToggle.disabled = !active && !fullscreenSupported();
    fullscreenToggle.setAttribute("aria-disabled", String(fullscreenToggle.disabled));
  };
  const toggleFullscreen = event => {
    // Keep the request in the original click task. Delaying this behind an
    // async boundary makes Chrome reject it as lacking a user activation.
    event?.preventDefault?.();
    const activeElement = fullscreenElement();
    const method = activeElement ? exitFullscreenMethod() : requestFullscreenMethod(fullscreenTarget);
    const receiver = activeElement ? documentRef : fullscreenTarget;
    if (typeof method !== "function" || !receiver) {
      updateFullscreenButton();
      return;
    }
    try {
      resolveFullscreenResult(method.call(receiver));
    } catch {
      // A browser or embedded context can reject fullscreen.  Keep gameplay
      // active and retain the button so the player can retry after focusing it.
      updateFullscreenButton();
    }
  };
  const preventBrowserContextMenu = event => {
    const target = event?.target;
    const tagName = typeof target?.tagName === "string" ? target.tagName.toLowerCase() : "";
    if (target === gameplayInputSurface || gameplayInputSurface?.contains?.(target)
      || target === presentationCanvasElement || presentationCanvasElement?.contains?.(target)) {
      event.preventDefault?.();
    } else if (!target?.isContentEditable && !["input", "textarea", "select", "button"].includes(tagName)) {
      // Keep the game surface and its surrounding arena free of browser chrome
      // while leaving menu fields and buttons native and accessible.
      return;
    }
  };
  const preventGameplayRightMouseDefault = event => {
    const target = event?.target;
    if (event?.button !== 2) return;
    if (target === gameplayInputSurface || gameplayInputSurface?.contains?.(target)
      || target === presentationCanvasElement || presentationCanvasElement?.contains?.(target)) event.preventDefault?.();
  };
  const stopGameplayContextGesture = event => {
    const target = event?.target;
    if (target !== gameplayInputSurface && !gameplayInputSurface?.contains?.(target)
      && target !== presentationCanvasElement && !presentationCanvasElement?.contains?.(target)) return;
    if (event?.type === "auxclick" || event?.button === 2) {
      event.preventDefault?.();
    }
  };
  fullscreenToggle?.addEventListener("click", toggleFullscreen);
  documentRef.addEventListener?.("fullscreenchange", updateFullscreenButton);
  documentRef.addEventListener?.("webkitfullscreenchange", updateFullscreenButton);
  documentRef.addEventListener?.("mozfullscreenchange", updateFullscreenButton);
  documentRef.addEventListener?.("MSFullscreenChange", updateFullscreenButton);
  // Capture before browser/extension handlers so the canvas never exposes a
  // context menu, including while the document is in fullscreen mode.
  documentRef.addEventListener?.("contextmenu", preventBrowserContextMenu, true);
  documentRef.addEventListener?.("mousedown", preventGameplayRightMouseDefault, true);
  documentRef.addEventListener?.("auxclick", stopGameplayContextGesture, true);
  presentationCanvasElement?.addEventListener?.("contextmenu", stopGameplayContextGesture, true);
  gameplayInputSurface?.addEventListener?.("contextmenu", stopGameplayContextGesture, true);
  updateFullscreenButton();
  const externalPeerIdentityObserver = lobbyOptions.onPeerIdentity;

  const renderHud = (state = hudState, connection = "Conectando…") => {
    hudState = state || null;
    return renderP2PCausalBetaHud(documentRef, hudState, {
      role: sessionRole,
      connection,
      localName: localPlayerName,
      remoteName: remotePlayerName,
    });
  };

  const disposePresentationRenderer = () => {
    if (presentationFrame !== null && typeof cancelAnimationFrameFn === "function") cancelAnimationFrameFn(presentationFrame);
    presentationFrame = null;
    try { presentationRenderer?.dispose?.(); } catch { /* Renderer cleanup is best effort. */ }
    presentationRenderer = null;
    metadataAppliedToRenderer = false;
  };
  let controls = null;
  let controlTimer = null;
  let transientControlFailures = 0;
  let roundComplete = false;
  let uiState = "loading";
  let stateBeforeMenu = "loading";
  const diagnosticsStorage = lobbyOptions.localStorageRef
    || (typeof localStorage !== "undefined" ? localStorage : null);
  const readAudioPreferences = () => {
    try {
      const parsed = Number.parseFloat(diagnosticsStorage?.getItem?.(P2P_CAUSAL_AUDIO_VOLUME_STORAGE_KEY) || "");
      return {
        volume: Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : .3,
        muted: diagnosticsStorage?.getItem?.(P2P_CAUSAL_AUDIO_MUTED_STORAGE_KEY) === "1",
      };
    } catch { return { volume: .3, muted: false }; }
  };
  const persistAudioPreferences = state => {
    if (!state) return;
    try {
      diagnosticsStorage?.setItem?.(P2P_CAUSAL_AUDIO_VOLUME_STORAGE_KEY, String(state.volume));
      diagnosticsStorage?.setItem?.(P2P_CAUSAL_AUDIO_MUTED_STORAGE_KEY, state.muted ? "1" : "0");
    } catch { /* Storage is optional. */ }
  };
  const renderAudioControls = () => {
    const current = audioPresenter?.getAudioState?.() || null;
    if (!current) {
      if (audioMute) audioMute.disabled = true;
      if (audioVolume) audioVolume.disabled = true;
      return null;
    }
    const percent = Math.round((Number(current.volume) || 0) * 100);
    if (audioMute) {
      audioMute.disabled = false;
      audioMute.textContent = current.muted ? "Activar sonido" : "Silenciar";
      audioMute.setAttribute("aria-pressed", String(current.muted));
    }
    if (audioVolume) {
      audioVolume.disabled = false;
      audioVolume.value = String(current.volume);
      audioVolume.setAttribute("aria-valuetext", `${percent}%`);
    }
    if (audioVolumeValue) audioVolumeValue.textContent = `${percent}%`;
    return current;
  };
  const initialAudioPreferences = readAudioPreferences();
  audioPresenter?.setVolume?.(initialAudioPreferences.volume);
  audioPresenter?.setMuted?.(initialAudioPreferences.muted);
  const readBindings = () => {
    try {
      const parsed = JSON.parse(diagnosticsStorage?.getItem?.(P2P_CAUSAL_BINDINGS_STORAGE_KEY) || "null");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...P2P_DEFAULT_BINDINGS, ...Object.fromEntries(Object.keys(P2P_DEFAULT_BINDINGS).map(key => [key, typeof parsed[key] === "string" && parsed[key].length <= 24 ? parsed[key] : P2P_DEFAULT_BINDINGS[key]])) }
        : { ...P2P_DEFAULT_BINDINGS };
    } catch { return { ...P2P_DEFAULT_BINDINGS }; }
  };
  const saveBindings = () => {
    try { diagnosticsStorage?.setItem?.(P2P_CAUSAL_BINDINGS_STORAGE_KEY, JSON.stringify(bindings)); } catch { /* Storage is optional. */ }
  };
  bindings = readBindings();
  const renderBindings = () => {
    if (!bindingsRoot || typeof documentRef.createElement !== "function") return;
    bindingsRoot.replaceChildren();
    for (const [actionName, label] of Object.entries(P2P_BINDING_LABELS)) {
      const row = documentRef.createElement("div");
      row.className = "causal-binding-row";
      const name = documentRef.createElement("span");
      name.textContent = label;
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.dataset.action = actionName;
      button.textContent = pendingBinding === actionName ? "Pulsa…" : p2pBindingName(bindings[actionName]);
      button.addEventListener("click", () => { pendingBinding = actionName; renderBindings(); });
      row.append(name, button);
      bindingsRoot.append(row);
    }
  };
  const captureBinding = event => {
    if (!pendingBinding) return false;
    if (event?.key === "Escape" || event?.code === "Escape") {
      pendingBinding = null;
      renderBindings();
      event.preventDefault?.();
      return true;
    }
    const token = p2pBindingTokenFromEvent(event);
    if (!token) return false;
    bindings = { ...bindings, [pendingBinding]: token };
    pendingBinding = null;
    saveBindings();
    controls?.setBindings?.(bindings);
    renderBindings();
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  };
  renderBindings();
  documentRef.addEventListener?.("keydown", captureBinding);
  documentRef.addEventListener?.("mousedown", captureBinding);
  bindingsReset?.addEventListener?.("click", () => {
    bindings = { ...P2P_DEFAULT_BINDINGS };
    pendingBinding = null;
    saveBindings();
    controls?.setBindings?.(bindings);
    renderBindings();
  });
  const readDiagnosticsPreference = () => {
    try {
      return diagnosticsStorage?.getItem?.(P2P_CAUSAL_DIAGNOSTICS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  };
  const persistDiagnosticsPreference = enabled => {
    try {
      if (enabled) diagnosticsStorage?.setItem?.(P2P_CAUSAL_DIAGNOSTICS_STORAGE_KEY, "1");
      else diagnosticsStorage?.removeItem?.(P2P_CAUSAL_DIAGNOSTICS_STORAGE_KEY);
    } catch {
      // A blocked storage backend must never affect the simulation or renderer.
    }
  };
  const diagnosticNow = () => {
    try {
      const value = Number(nowFn());
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };
  const setDiagnosticsEnabled = (enabled, { persist = true } = {}) => {
    diagnosticsEnabled = Boolean(enabled);
    if (diagnosticsToggle) diagnosticsToggle.checked = diagnosticsEnabled;
    if (diagnosticsDetails) diagnosticsDetails.hidden = !diagnosticsEnabled;
    if (persist) persistDiagnosticsPreference(diagnosticsEnabled);
    diagnosticsLastUpdate = -Infinity;
    if (diagnosticsEnabled) {
      if (latestDiagnosticState) renderCausalBetaState(snapshotElement, latestDiagnosticState);
      else if (snapshotElement) renderCausalBetaState(snapshotElement, null);
      diagnosticsLastUpdate = diagnosticNow();
    }
    return diagnosticsEnabled;
  };
  const maybeRenderDiagnostics = state => {
    latestDiagnosticState = state || null;
    if (!diagnosticsEnabled) return false;
    const now = diagnosticNow();
    if (now - diagnosticsLastUpdate < P2P_CAUSAL_DIAGNOSTICS_INTERVAL_MS) return false;
    renderCausalBetaState(snapshotElement, state);
    diagnosticsLastUpdate = now;
    return true;
  };

  const setUiState = (next, message = null) => {
    if (!P2P_CAUSAL_UI_STATES.includes(next)) return uiState;
    uiState = next;
    if (documentRef.documentElement?.dataset) documentRef.documentElement.dataset.p2pUiState = next;
    if (menuOverlay) menuOverlay.hidden = next !== "menu";
    if (menuToggle) menuToggle.setAttribute("aria-expanded", next === "menu" ? "true" : "false");
    if (loadingOverlay) loadingOverlay.hidden = !(next === "loading");
    if (loadingStatus && message) loadingStatus.textContent = message;
    return uiState;
  };

  const setRendererLoading = (message = "Preparando arena…") => {
    if (loadingStatus) loadingStatus.textContent = message;
    if (!presentationRendererReady) setArenaState("loading");
  };

  const toggleMenu = force => {
    const open = typeof force === "boolean" ? force : uiState !== "menu";
    if (open) {
      if (uiState !== "menu") stateBeforeMenu = uiState;
      stopControls();
      setUiState("menu");
      menuClose?.focus?.();
    } else {
      // The offline-first entry can already be rendering a playable WASM
      // arena while the causal controller remains in its initial loading
      // state. Never resurrect that overlay merely because the player closes
      // the menu; its hidden flag is the source of truth for the visible
      // practice renderer.
      const restore = stateBeforeMenu === "menu"
        ? "ready"
        : stateBeforeMenu === "loading" && loadingOverlay?.hidden === true
          ? "ready"
          : stateBeforeMenu;
      setUiState(restore);
      if (causalReady && presentationRendererReady) startControls(sessionRole);
      menuToggle?.focus?.();
    }
    return uiState;
  };

  // Network and snapshot updates continue while the menu is open. Keep the
  // latest arena state for Escape to restore without tearing down the overlay.
  const setArenaState = (next, message = null) => {
    if (uiState === "menu") {
      stateBeforeMenu = next;
      if (loadingStatus && message) loadingStatus.textContent = message;
      return next;
    }
    return setUiState(next, message);
  };

  const renderTargetStatus = (targetId, candidate = null) => {
    if (!targetStatus) return;
    const locked = typeof targetId === "string" && targetId.length > 0;
    localTargetId = locked ? targetId : null;
    const nextText = formatP2PCausalTargetStatus(targetId, {
      remoteName: remotePlayerName || "RIVAL",
      screenVisible: candidate?.screenVisible !== false,
    });
    if (targetStatus.textContent !== nextText) targetStatus.textContent = nextText;
    targetStatus.dataset.locked = locked ? "true" : "false";
  };
  const metadataHealth = () => {
    if (metadataFailed) return "failed";
    if (!metadataState || metadataReceivedAt === null) return "missing";
    return diagnosticNow() - metadataReceivedAt >= P2P_CAUSAL_METADATA_STALE_MS ? "stale" : "fresh";
  };
  const renderMetadataStatus = (value = undefined, { failed = false } = {}) => {
    if (value === null) {
      metadataState = null;
      metadataReceivedAt = null;
      metadataFailed = failed;
    } else if (value && typeof value === "object") {
      metadataState = value;
      metadataReceivedAt = diagnosticNow();
      metadataFailed = false;
    }
    const health = metadataHealth();
    const element = documentRef.getElementById("causal-hud-pads");
    if (element) {
      const nextText = formatP2PCausalMetadataStatus(metadataState, {
        ageMs: metadataReceivedAt === null ? null : Math.max(0, diagnosticNow() - metadataReceivedAt),
        failed: health === "failed",
      });
      if (element.textContent !== nextText) element.textContent = nextText;
      // Metadata is diagnostic-only. Keep the player HUD quiet regardless of
      // freshness; the normalized value remains available to the opt-in
      // diagnostics path and to the presentation renderer below.
      element.hidden = true;
      element.dataset.metadataState = health;
    }
    // Never retain an old visual pickup layout once the optional channel is
    // stale or failed. The causal gameplay state stays uninterrupted; only a
    // non-authoritative affordance is cleared until newer metadata arrives.
    if (health === "fresh" && presentationRenderer && !metadataAppliedToRenderer) {
      const applied = presentationRenderer.setMetadata?.(metadataState);
      metadataAppliedToRenderer = applied !== false;
    } else if (health !== "fresh" && presentationRenderer && metadataAppliedToRenderer) {
      presentationRenderer.setMetadata?.(null);
      metadataAppliedToRenderer = false;
    }
    return health;
  };

  // The published beta is desktop-only. Keyboard and mouse are the only
  // player inputs, so UI state has no touch controls to synchronize.
  const syncTouchAvailability = () => {};

  const stopControls = () => {
    if (controlTimer !== null && typeof clearIntervalFn === "function") clearIntervalFn(controlTimer);
    controlTimer = null;
    transientControlFailures = 0;
    controls?.clear();
  };
  const liveRivalTargetId = role => {
    if (role !== "host" && role !== "pilot") return null;
    const rivalId = role === "host" ? "p2p-pilot" : "p2p-host";
    const rival = hudState?.cars?.find(car => car?.id === rivalId);
    if (rival?.alive !== true) return null;
    // The local client only needs range, frontal heading and camera projection
    // to acquire a target. Once acquired, it keeps the live authoritative car
    // while it leaves the screen; retain that same distinction online.
    if (controls?.isTargetLocked?.()) return rivalId;
    const candidates = presentationRenderer?.getAimCandidates?.() || [];
    return candidates.some(candidate => candidate.id === rivalId && candidate.eligible)
      ? rivalId
      : null;
  };
  const startControls = role => {
    stopControls();
    if ((role !== "host" && role !== "pilot") || !causalReady || !presentationRendererReady || typeof setIntervalFn !== "function") return;
    // Infinite boost is deliberately deferred to a later authoritative rules
    // slice. This presentation gate must never invent or override boost state.
    try {
      controls ??= createInput({
        controlRoot: null,
        documentTarget: documentRef,
        gameTarget: gameplayInputSurface,
        fullControls: true,
        bindings,
        bindingCapture: captureBinding,
      });
    }
    catch {
      updateState("Causal: la sesión está lista, pero los controles del navegador no están disponibles.");
      return;
    }
    const send = () => {
      const command = controls.nextCommand(role, { candidateTargetId: liveRivalTargetId(role) });
      renderTargetStatus(command.targetId);
      presentationRenderer?.setTargetId?.(command.targetId);
      if (roundComplete) return;
      const result = role === "pilot"
        ? controller?.sendCausalCommand(command)
        : controller?.setCausalHostCommand(command);
      if (result?.accepted) {
        transientControlFailures = 0;
        return;
      }
      if (causalReady && /aún no está listo|todavía no está listo/i.test(result?.reason || "")) {
        // The causal-ready event may cross the lobby boundary one turn before
        // the injected session exposes its channel. Keep the paced loop alive
        // and retry; a transient race must not disable player controls.
        transientControlFailures += 1;
        if (transientControlFailures < 120) return;
      }
      if (causalReady) {
        stopControls();
        updateState(`Causal: ${result?.reason || "los controles dejaron de estar disponibles."}`);
      }
    };
    send();
    controlTimer = setIntervalFn(send, P2P_CAUSAL_CONTROL_INTERVAL_MS);
  };

  const updateState = value => { if (stateElement) stateElement.textContent = value; };
  const renderPresentationFailure = (message = presentationErrorMessage) => {
    const detail = typeof message === "string" && message.trim()
      ? message.trim().slice(0, 180)
      : "fallo desconocido de presentación";
    updateState(`Causal: error de presentación · ${detail}. Recarga la sala para reintentar.`);
    setUiState("error", `No se pudo preparar la arena: ${detail}`);
  };
  const updateLifecycleState = state => {
    lifecycleState = state;
    if (state === "error" && presentationErrorMessage) {
      renderPresentationFailure();
      return;
    }
    if (state === "waitingOpponent" || state === "negotiating") setArenaState("waiting");
    else if (state === "channelReady" && !presentationRendererReady) setArenaState("loading");
    else if (state === "channelReady") setArenaState("ready");
    else if (state === "active" && presentationRendererReady && !roundComplete) setArenaState("playing");
    else if (state === "waitingReplacement" || state === "hostLeft") setArenaState("waiting");
    else if (state === "error") setUiState("error");
    updateState(`Causal: ${p2pRoomLifecycleLabel(state)}`);
  };
  const updateAudioStatus = value => { if (audioStatus) audioStatus.textContent = value; };
  let audioUnlockPromise = null;
  const unlockAudioFromGesture = () => {
    if (!audioPresenter?.unlock) return Promise.resolve(false);
    const current = audioPresenter.getAudioState?.();
    if (current?.unlocked === true || current?.contextState === "running") {
      renderAudioControls();
      return Promise.resolve(true);
    }
    if (audioUnlockPromise) return audioUnlockPromise;
    updateAudioStatus("Activando sonido…");
    audioUnlockPromise = Promise.resolve()
      .then(() => audioPresenter.unlock())
      .then(unlocked => {
        const next = renderAudioControls();
        persistAudioPreferences(next);
        if (unlocked) {
          updateAudioStatus(next?.muted
            ? "Audio silenciado · feedback visual activo."
            : "Audio activo · listo para jugar.");
        } else {
          updateAudioStatus("El navegador no permitió activar el audio.");
        }
        return Boolean(unlocked);
      })
      .catch(() => {
        updateAudioStatus("No se pudo activar el audio; el feedback visual continúa.");
        return false;
      })
      .finally(() => { audioUnlockPromise = null; });
    return audioUnlockPromise;
  };
  const isAudioGesture = event => {
    const target = event?.target;
    const tagName = typeof target?.tagName === "string" ? target.tagName.toLowerCase() : "";
    if (target?.isContentEditable || ["input", "textarea", "select"].includes(tagName)) return false;
    if (pendingBinding) return false;
    if (event?.type === "keydown" && ["Alt", "Control", "Meta", "Shift", "Tab", "Escape"].includes(event.key)) return false;
    return true;
  };
  const handleAudioGesture = event => {
    if (!isAudioGesture(event)) return;
    void unlockAudioFromGesture();
  };
  const renderPresentationState = (state, frameAt = null) => {
    if (!presentationRenderer || !state) return false;
    presentationRenderer.update(state);
    presentationRenderer.render();
    if (Number.isFinite(frameAt)) presentationRenderer.recordFrame?.(frameAt);
    return true;
  };
  const stopPresentationLoop = () => {
    if (presentationFrame !== null && typeof cancelAnimationFrameFn === "function") cancelAnimationFrameFn(presentationFrame);
    presentationFrame = null;
  };
  const presentationLoop = frameAt => {
    presentationFrame = null;
    if (destroyed || sessionEnded || !presentationRenderer || !renderBuffer) return;
    try {
      renderPresentationState(renderBuffer.sample(), frameAt);
      if (localTargetId) {
        const candidate = presentationRenderer.getAimCandidates?.().find(item => item?.id === localTargetId) || null;
        renderTargetStatus(localTargetId, candidate);
      }
      renderMetadataStatus();
      presentationFrameCount += 1;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - presentationFpsWindowStart;
      if (elapsed >= 1000) {
        const fps = Math.round(presentationFrameCount * 1000 / elapsed);
        setText(documentRef, "causal-hud-fps", `FPS ${fps} · RENDER ONLINE`);
        presentationFrameCount = 0;
        presentationFpsWindowStart = now;
      }
      if (typeof requestAnimationFrameFn === "function") presentationFrame = requestAnimationFrameFn(presentationLoop);
    } catch (error) {
      presentationRendererFailed = true;
      presentationRendererReady = false;
      stopPresentationLoop();
      stopControls();
      syncTouchAvailability();
      if (action) action.disabled = true;
      disposePresentationRenderer();
      presentationErrorMessage = error instanceof Error ? error.message : "error de renderizado";
      updateLifecycleState("error");
    }
  };
  const startPresentationLoop = () => {
    if (presentationFrame !== null || typeof requestAnimationFrameFn !== "function" || !presentationRenderer || !renderBuffer) return;
    presentationFrame = requestAnimationFrameFn(presentationLoop);
  };
  const handleSessionEvent = (event = {}) => {
    try { onOnlineSessionEvent(event); } catch { /* An external offline shell cannot affect P2P lifecycle. */ }
    if (event.type === "lifecycle") {
      updateLifecycleState(event.state);
      if (event.state === "waitingReplacement" || event.state === "hostLeft" || event.state === "error") {
        causalReady = false;
        if (action) action.disabled = true;
        syncTouchAvailability();
      }
    } else if (event.type === "negotiating") {
      // A host may keep the room alive while replacing a departed guest. The
      // replacement is a new causal session, so clear terminal/session-local
      // presentation state before its first snapshot arrives.
      if (sessionEnded) {
        stopControls();
        stopPresentationLoop();
        authoritativeStateSource?.close();
        authoritativeStateSource = null;
        renderBuffer = null;
        disposePresentationRenderer();
        audioPresenter?.clear?.();
      }
      sessionEnded = false;
      causalReady = false;
      presentationRendererReady = false;
      syncTouchAvailability();
      commandSent = false;
      sessionRole = null;
      localPlayerName = "PILOTO";
      remotePlayerName = null;
      renderMetadataStatus(null);
      latestDiagnosticState = null;
      diagnosticsLastUpdate = -Infinity;
      roundComplete = false;
      renderTargetStatus(null);
      presentationRendererFailed = false;
      presentationErrorMessage = null;
      presentationFrameCount = 0;
      presentationFpsWindowStart = diagnosticNow();
      if (action) action.disabled = true;
      setArenaState("loading", "Negociando canal P2P…");
      renderHud(null, "Negociando canal P2P…");
      updateLifecycleState("negotiating");
    } else if (event.type === "ice-state" && isP2PIceConnectionState(event.state)) {
      renderHud(hudState, "Canal P2P · negociando");
      updateLifecycleState("negotiating");
    } else if (event.type === "channel-open") {
      updateLifecycleState("channelReady");
    } else if (event.type === "causal-ready") {
      causalReady = true;
      syncTouchAvailability();
      sessionRole = event.role === "host" || event.role === "pilot" ? event.role : null;
      localPlayerName = normalizeP2PPlayerName(event.name, sessionRole === "host" ? "HOST" : "PILOTO");
      const pilot = event.role === "pilot";
      if (action) action.disabled = !pilot || commandSent || !presentationRendererReady;
      updateLifecycleState("channelReady");
      renderHud(hudState, "Canal P2P activo · esperando snapshot…");
      startControls(event.role);
    } else if (event.type === "causal-message") {
      if (!presentationErrorMessage) updateLifecycleState("active");
      renderHud(hudState, "Canal P2P activo · sincronizado");
    } else if (event.type === "metadata-error" || event.type === "metadata-channel-closed") {
      // A metadata fault must be visible, but it is explicitly not a causal
      // transport fault: controls, RocketSim and snapshots remain live.
      renderMetadataStatus(null, { failed: true });
    } else if (event.type === "error") {
      causalReady = false;
      presentationRendererReady = false;
      sessionEnded = true;
      syncTouchAvailability();
      if (action) action.disabled = true;
      stopControls();
      stopPresentationLoop();
      authoritativeStateSource?.close();
      authoritativeStateSource = null;
      renderBuffer = null;
      disposePresentationRenderer();
      audioPresenter?.clear?.();
      renderHud(null, "Canal P2P con error");
      updateLifecycleState("error");
    } else if (event.type === "closed" || event.type === "peer-left") {
      causalReady = false;
      presentationRendererReady = false;
      sessionEnded = true;
      syncTouchAvailability();
      if (action) action.disabled = true;
      stopControls();
      stopPresentationLoop();
      authoritativeStateSource?.close();
      authoritativeStateSource = null;
      renderBuffer = null;
      disposePresentationRenderer();
      audioPresenter?.clear?.();
      renderHud(null, "Canal P2P cerrado");
      if (lifecycleState !== "waitingReplacement" && lifecycleState !== "hostLeft" && lifecycleState !== "error") {
        updateLifecycleState(event.type === "peer-left" && event.role === "host" ? "hostLeft" : "error");
      }
    } else if (event.type === "presentation-error") {
      presentationErrorMessage = event.error?.message || event.message || "fallo de presentación causal";
      renderPresentationFailure();
      updateLifecycleState("error");
    }
  };

  controller = bootP2PRoomLobby({
    ...lobbyOptions,
    documentRef,
    CausalRoomSession,
    causalHostFactory,
    presentation,
    primePilotOnWelcome,
    onSessionEvent: handleSessionEvent,
    onPeerIdentity: (identity) => {
      try { externalPeerIdentityObserver?.(identity); } catch { /* External presentation observers cannot affect the session. */ }
      if (!identity || (identity.role !== "host" && identity.role !== "pilot")) return;
      const expectedRole = sessionRole === "host" ? "pilot" : sessionRole === "pilot" ? "host" : null;
      if (expectedRole && identity.role !== expectedRole) return;
      remotePlayerName = normalizeP2PPlayerName(identity.name, identity.role === "host" ? "HOST" : "PILOTO");
      renderHud(hudState, "Canal P2P activo · identidad confirmada");
      renderTargetStatus(null);
    },
    metadata,
    onMetadata: (value, context = {}) => {
      if (destroyed || sessionEnded || !value || typeof value !== "object") return;
      if (context.roomId && controller?.session?.context?.roomId && context.roomId !== controller.session.context.roomId) return;
      renderMetadataStatus(value);
    },
    onCausalSnapshot: (snapshot, metadata = {}) => {
      if (destroyed || sessionEnded) return;
      try {
        if (!sessionRole && (metadata.role === "host" || metadata.role === "pilot")) sessionRole = metadata.role;
        if (presentation) {
          renderBuffer ??= new P2PWasmPresentationRenderBuffer({ roomId: metadata.roomId, sessionId: metadata.sessionId });
        } else {
          renderBuffer ??= new P2PWasmRenderBuffer({ roomId: metadata.roomId, sessionId: metadata.sessionId });
        }
        authoritativeStateSource ??= createAuthoritativeStateSource({ buffer: renderBuffer });
        const state = authoritativeStateSource.push(snapshot);
        if (!state) throw new Error("El buffer de presentación no produjo un estado visual.");
        renderHud(state, "Canal P2P activo · sincronizado");
        maybeRenderDiagnostics(state);
        audioPresenter?.present?.(state, { role: sessionRole });
        if (state.settings?.roundState === "complete") {
          roundComplete = true;
          setArenaState("round-complete");
          syncTouchAvailability();
          if (action) action.disabled = true;
          const winnerLabel = state.winner === "blue" ? "AZUL" : state.winner === "red" ? "ROJO" : "EL GANADOR";
          updateState(`Causal: ronda cerrada · gana ${winnerLabel}. Pulsa R para reiniciar.`);
        } else if (roundComplete) {
          roundComplete = false;
          if (presentationRendererReady) setArenaState("playing");
          syncTouchAvailability();
          updateState("Causal: nueva ronda autoritativa · controles reanudados.");
        }
        presentationErrorMessage = null;
        if (presentation && !presentationRenderer && !presentationRendererFailed && typeof presentationRendererFactory === "function" && state) {
          try {
            try { onBeforeOnlinePresentationStart({ role: sessionRole, roomId: metadata.roomId, sessionId: metadata.sessionId }); } catch { /* A local fallback cannot block an online match. */ }
            const created = presentationRendererFactory({ canvas: presentationCanvas, state, role: sessionRole, roomId: metadata.roomId, sessionId: metadata.sessionId, documentRef });
            if (!created || typeof created.update !== "function" || typeof created.render !== "function") {
              throw new TypeError("La fábrica de presentación no devolvió un renderer válido.");
            }
            presentationRenderer = created;
            presentationRenderer.setTargetId?.(localTargetId);
            presentationRendererReady = false;
            setRendererLoading("Cargando vehículos y arena…");
            const ready = typeof presentationRenderer.ready === "function"
              ? presentationRenderer.ready()
              : null;
            if (ready && typeof ready.then === "function") {
              presentationReadyPromise = Promise.resolve(ready).then(() => {
                if (destroyed || sessionEnded || !presentationRenderer) return;
                presentationRendererReady = true;
                if (loadingOverlay) loadingOverlay.hidden = true;
                setArenaState(roundComplete ? "round-complete" : causalReady ? "ready" : "waiting");
                syncTouchAvailability();
                if (action) action.disabled = sessionRole !== "pilot" || commandSent || roundComplete;
                startControls(sessionRole);
                startPresentationLoop();
              }).catch(error => {
                presentationRendererReady = false;
                presentationRendererFailed = true;
                presentationErrorMessage = error instanceof Error ? error.message : "el renderer no pudo preparar la arena";
                stopPresentationLoop();
                disposePresentationRenderer();
                syncTouchAvailability();
                renderPresentationFailure();
                updateLifecycleState("error");
              });
            } else {
              presentationRendererReady = true;
              if (loadingOverlay) loadingOverlay.hidden = true;
              setArenaState(roundComplete ? "round-complete" : causalReady ? "ready" : "waiting");
              syncTouchAvailability();
              if (action) action.disabled = sessionRole !== "pilot" || commandSent || roundComplete;
              startControls(sessionRole);
              startPresentationLoop();
            }
          } catch (error) {
            presentationRendererFailed = true;
            presentationRendererReady = false;
            stopControls();
            syncTouchAvailability();
            if (action) action.disabled = true;
            disposePresentationRenderer();
            presentationErrorMessage = error instanceof Error ? error.message : "la fábrica de presentación falló";
            try { onOnlineSessionEvent({ type: "presentation-error", error }); } catch { /* A local fallback cannot block error reporting. */ }
            renderPresentationFailure();
            updateLifecycleState("error");
          }
        }
        if (presentationRenderer && state) {
          // Snapshot receipt owns interpolation state, not GPU submission.
          // The RAF loop is the single presentation clock. Rendering here as
          // well rendered a full Three scene once per snapshot *and* once per
          // animation frame, which is most visible after lock/fire activates
          // the laser and projectile feedback.
          presentationRenderer.update(state);
          renderMetadataStatus();
        }
      } catch (error) {
        const rendererWasActive = Boolean(presentationRenderer);
        if (rendererWasActive) {
          presentationRendererFailed = true;
          presentationRendererReady = false;
          stopControls();
          disposePresentationRenderer();
        }
        syncTouchAvailability();
        if (action) action.disabled = true;
        authoritativeStateSource?.close();
        authoritativeStateSource = null;
        renderBuffer = null;
        renderHud(null, "Canal P2P sin snapshot válido");
        if (diagnosticsEnabled) maybeRenderDiagnostics(null);
        presentationErrorMessage = error instanceof Error ? error.message : "error de adaptación desconocido";
        presentationRendererReady = false;
        syncTouchAvailability();
        renderPresentationFailure();
        updateLifecycleState("error");
      }
    },
  });

  action?.addEventListener("click", () => {
    if (!causalReady || !presentationRendererReady || commandSent || uiState === "menu") return;
    const result = controller?.sendCausalCommand(SAFE_TEST_COMMAND);
    if (!result?.accepted) {
      updateState(`Causal: ${result?.reason || "el canal aún no está listo."}`);
      return;
    }
    commandSent = true;
    action.disabled = true;
    updateState("Causal: acción de prueba enviada; esperando snapshot autoritativo.");
  });

  audioAction?.addEventListener("click", async () => {
    if (!audioPresenter?.unlock) {
      updateAudioStatus("Audio no disponible en esta sesión.");
      return;
    }
    audioAction.disabled = true;
    updateAudioStatus("Activando y preparando audio…");
    try {
      const unlocked = await unlockAudioFromGesture();
      updateAudioStatus(unlocked ? "Audio activo · recursos preparados." : "El navegador no permitió activar el audio.");
    } catch {
      updateAudioStatus("No se pudo preparar el audio; el feedback visual continúa activo.");
    } finally {
      audioAction.disabled = false;
      renderAudioControls();
    }
  });
  audioMute?.addEventListener("click", () => {
    const current = audioPresenter?.getAudioState?.();
    if (!current) return;
    audioPresenter?.setMuted?.(!current.muted);
    const next = renderAudioControls();
    persistAudioPreferences(next);
    updateAudioStatus(next?.muted ? "Audio silenciado · feedback visual activo." : "Audio configurado · feedback listo.");
  });
  audioVolume?.addEventListener("input", event => {
    audioPresenter?.setVolume?.(event?.target?.value);
    const next = renderAudioControls();
    persistAudioPreferences(next);
  });

  if (action) action.disabled = true;
  if (menuToggle) {
    menuToggle.addEventListener("click", () => { void unlockAudioFromGesture(); toggleMenu(); });
    menuToggle.setAttribute("aria-expanded", "false");
  }
  if (menuClose) menuClose.addEventListener("click", () => { void unlockAudioFromGesture(); toggleMenu(false); });
  documentRef.addEventListener?.("pointerdown", handleAudioGesture, { passive: true });
  documentRef.addEventListener?.("keydown", handleAudioGesture, { passive: true });
  if (diagnosticsToggle) diagnosticsToggle.addEventListener("change", () => {
    setDiagnosticsEnabled(diagnosticsToggle.checked === true);
  });
  documentRef.addEventListener?.("keydown", event => {
    if (event?.key !== "Escape") return;
    if (uiState === "menu") {
      event.preventDefault?.();
      toggleMenu(false);
    }
  });
  setDiagnosticsEnabled(readDiagnosticsPreference(), { persist: false });
  if (!diagnosticsEnabled) setText(documentRef, "causal-snapshot", "Esperando un snapshot causal normalizado de los dos coches…");
  renderHud(null, "Esperando una sala…");
  setUiState("loading", "Preparando arena…");
  updateAudioStatus(audioPresenter ? "Pulsa para activar audio cuando quieras jugar." : "Audio de beta no disponible.");
  renderAudioControls();
  renderTargetStatus(null);
  renderMetadataStatus(null);
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    causalReady = false;
    presentationRendererReady = false;
    sessionEnded = true;
    syncTouchAvailability();
    stopControls();
    stopPresentationLoop();
    controls?.destroy();
    controls = null;
    authoritativeStateSource?.close();
    authoritativeStateSource = null;
    renderBuffer = null;
    disposePresentationRenderer();
    void audioPresenter?.dispose?.();
    controller?.destroy?.();
    documentRef.removeEventListener?.("keydown", captureBinding);
    documentRef.removeEventListener?.("mousedown", captureBinding);
    documentRef.removeEventListener?.("pointerdown", handleAudioGesture);
    documentRef.removeEventListener?.("keydown", handleAudioGesture);
    documentRef.removeEventListener?.("fullscreenchange", updateFullscreenButton);
    documentRef.removeEventListener?.("webkitfullscreenchange", updateFullscreenButton);
    documentRef.removeEventListener?.("mozfullscreenchange", updateFullscreenButton);
    documentRef.removeEventListener?.("MSFullscreenChange", updateFullscreenButton);
    fullscreenToggle?.removeEventListener?.("click", toggleFullscreen);
    documentRef.removeEventListener?.("contextmenu", preventBrowserContextMenu, true);
    documentRef.removeEventListener?.("mousedown", preventGameplayRightMouseDefault, true);
    documentRef.removeEventListener?.("auxclick", stopGameplayContextGesture, true);
    presentationCanvasElement?.removeEventListener?.("contextmenu", stopGameplayContextGesture, true);
    gameplayInputSurface?.removeEventListener?.("contextmenu", stopGameplayContextGesture, true);
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", destroy, { once: true });
  return {
    controller,
    handleSessionEvent,
    renderSnapshot: snapshot => diagnosticsEnabled ? renderCausalBetaSnapshot(snapshotElement, snapshot) : normalizeCausalBetaSnapshot(snapshot),
    renderState: state => {
      latestDiagnosticState = state || null;
      return diagnosticsEnabled ? renderCausalBetaState(snapshotElement, state) : state;
    },
    renderHud: state => renderHud(state),
    renderMetadata: value => renderMetadataStatus(value),
    setDiagnosticsEnabled,
    isDiagnosticsEnabled: () => diagnosticsEnabled,
    getUiState: () => uiState,
    toggleMenu,
    destroy,
  };
}

function shouldAutoStart(documentRef) {
  return documentRef?.documentElement?.dataset?.p2pCausalBetaAutoStart !== "false";
}

if (typeof document !== "undefined" && shouldAutoStart(document)) startP2PCausalBeta();

