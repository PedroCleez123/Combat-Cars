// Offline-first entry mode for the public Pages arena. It reuses the exact
// RocketSim WASM warm-up authority used by the online host: no WebRTC room,
// remote state or fake movement is needed before a player opens the menu.
import { createP2PCausalInput } from "./p2p-causal-input.js";
import { createP2PFullWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-full-combat-host.mjs";
import { renderP2PCausalBetaHud } from "./p2p-causal-beta-hud.js";

export const P2P_OFFLINE_PRACTICE_INTERVAL_MS = 1000 / 60;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function surfaceType(telemetry) {
  const contact = telemetry?.wheelContact?.hasContact ? telemetry.wheelContact : telemetry?.worldContact?.hasContact ? telemetry.worldContact : null;
  if (!contact) return telemetry?.grounded ? "ground" : "air";
  if (contact.normal?.y < -.65) return "ceiling";
  if (Math.abs(contact.normal?.y) < .35) return "wall";
  return "ground";
}

/**
 * Adapt the local warm-up host's already-authoritative snapshot for the same
 * Three.js renderer that displays online state. The one-player roster is
 * intentional: practice never pretends that an absent rival is connected.
 */
export function createP2POfflinePracticePresentationState(snapshot) {
  const physical = Array.isArray(snapshot?.physical) ? snapshot.physical : [];
  const presentation = Array.isArray(snapshot?.presentation) ? snapshot.presentation : [];
  const combatCars = Array.isArray(snapshot?.combat?.cars) ? snapshot.combat.cars : [];
  if (physical.length !== 1 || presentation.length !== 1 || combatCars.length !== 1
    || physical[0]?.id !== "p2p-host" || presentation[0]?.id !== "p2p-host" || combatCars[0]?.id !== "p2p-host"
    || !Number.isSafeInteger(snapshot?.tick) || snapshot.tick < 1) {
    throw new TypeError("El snapshot de práctica WASM no tiene un único coche local válido.");
  }
  const body = physical[0];
  const telemetry = presentation[0];
  const combat = combatCars[0];
  const velocity = { x: finite(body.vx), y: finite(body.vh), z: finite(body.vz) };
  const contact = telemetry.wheelContact?.hasContact ? telemetry.wheelContact : telemetry.worldContact?.hasContact ? telemetry.worldContact : null;
  const kind = surfaceType(telemetry);
  return Object.freeze({
    time: snapshot.tick / 60,
    score: { blue: 0, red: 0 },
    winner: null,
    settings: {
      arena: "combat-alpha", practiceArena: "combat-alpha", humans: 1, bots: 0, vehicleLimit: 1,
      profile: "PRÁCTICA ROCKETSIM WASM", movementBackend: "rocketsim", roundState: "practice",
      scoreToWin: null, roundSerial: 1, p2p: false, offlinePractice: true,
    },
    rules: { pads: false, combat: false, unlimitedBoost: true, ramps: false, covers: false, scoreToWin: null },
    cars: Object.freeze([Object.freeze({
      id: body.id, team: "blue", name: "TÚ", x: finite(body.x), h: finite(body.h), z: finite(body.z), yaw: finite(body.yaw),
      orientation: { ...telemetry.orientation }, vx: velocity.x, vh: velocity.y, vz: velocity.z, velocity,
      speed: Math.hypot(velocity.x, velocity.y, velocity.z),
      forwardSpeed: velocity.x * Math.cos(finite(body.yaw)) + velocity.z * Math.sin(finite(body.yaw)),
      hp: finite(combat.hp, 100), respawn: finite(combat.respawn), kills: 0, deaths: 0, rocketCooldown: 0,
      alive: combat.alive === true, boost: finite(telemetry.boost), jumps: Number.isSafeInteger(telemetry.jumps) ? telemetry.jumps : 0,
      grounded: telemetry.grounded === true, boosting: telemetry.boosting === true, supersonic: telemetry.supersonic === true,
      powerslide: finite(telemetry.powerslide), angularVelocity: { ...telemetry.angularVelocity },
      wheelCount: Number.isSafeInteger(telemetry.wheelCount) ? telemetry.wheelCount : 0,
      wheelContact: telemetry.wheelContact ? { hasContact: telemetry.wheelContact.hasContact === true, normal: { ...telemetry.wheelContact.normal } } : { hasContact: false, normal: { x: 0, y: 1, z: 0 } },
      worldContact: telemetry.worldContact ? { hasContact: telemetry.worldContact.hasContact === true, normal: { ...telemetry.worldContact.normal } } : { hasContact: false, normal: { x: 0, y: 1, z: 0 } },
      surfaceType: kind, surfaceNormal: contact ? { ...contact.normal } : null,
      contacts: contact ? [{ kind, normal: { ...contact.normal }, point: { x: finite(body.x), y: finite(body.h), z: finite(body.z) }, wheelCount: Number.isSafeInteger(telemetry.wheelCount) ? telemetry.wheelCount : 0, normalVelocity: null, separation: 0 }] : [],
      wallRide: kind === "wall", ceilingContact: kind === "ceiling", jumpState: telemetry.jumpState || "grounded", actionSerials: { ...telemetry.actionSerials },
    })]),
    rockets: Object.freeze([]), pads: Object.freeze([]), events: Object.freeze([]), inputAcknowledged: 0,
  });
}

/** Start the offline-first, infinite-boost free-drive loop. */
export function startP2POfflinePractice({
  documentRef = typeof document !== "undefined" ? document : null,
  canvasId = "causal-scene",
  inputSurfaceId = "causal-input-surface",
  hostFactory = createP2PFullWasmCombatHost,
  createInput = createP2PCausalInput,
  presentationRendererFactory,
  audioPresenter = null,
  setIntervalFn = typeof setInterval === "function" ? setInterval : null,
  clearIntervalFn = typeof clearInterval === "function" ? clearInterval : null,
  requestAnimationFrameFn = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null,
  cancelAnimationFrameFn = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null,
  disposeAudioPresenter = true,
  onFrame = () => {},
  onPresentationState = () => {},
  onError = () => {},
} = {}) {
  if (!documentRef || typeof hostFactory !== "function" || typeof createInput !== "function" || typeof presentationRendererFactory !== "function") return null;
  const canvas = documentRef.getElementById?.(canvasId) || null;
  if (!canvas) return null;
  // Keep game input on an inert layer above WebGL. Some desktop browsers
  // expose a canvas context menu as an image menu even when it is cancelled;
  // this layer has no image semantics and still bubbles the same mouse event
  // to the shared RocketSim input controller.
  const inputSurface = documentRef.getElementById?.(inputSurfaceId) || canvas;
  const stateElement = documentRef.getElementById?.("causal-state") || documentRef.getElementById?.("status") || null;
  const headerTitle = documentRef.getElementById?.("arena-title") || null;
  const loadingOverlay = documentRef.getElementById?.("renderer-loading-overlay") || null;
  const loadingStatus = documentRef.getElementById?.("renderer-loading-status") || stateElement;
  const menuOverlay = documentRef.getElementById?.("game-menu-overlay") || null;
  let stopped = false;
  let host = null;
  let renderer = null;
  let input = null;
  let interval = null;
  let frame = null;
  let advancing = false;

  const setStatus = value => { if (stateElement) stateElement.textContent = value; };
  const setLoading = value => { if (loadingStatus) loadingStatus.textContent = value; };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (interval !== null && clearIntervalFn) clearIntervalFn(interval);
    if (frame !== null && cancelAnimationFrameFn) cancelAnimationFrameFn(frame);
    interval = null;
    frame = null;
    input?.destroy?.();
    input = null;
    renderer?.dispose?.();
    renderer = null;
    audioPresenter?.clear?.();
    if (disposeAudioPresenter) void audioPresenter?.dispose?.();
    host?.close?.();
    host = null;
  };
  const handoff = () => {
    if (stopped) return renderer;
    stopped = true;
    if (interval !== null && clearIntervalFn) clearIntervalFn(interval);
    if (frame !== null && cancelAnimationFrameFn) cancelAnimationFrameFn(frame);
    interval = null;
    frame = null;
    input?.destroy?.();
    input = null;
    audioPresenter?.clear?.();
    if (disposeAudioPresenter) void audioPresenter?.dispose?.();
    host?.close?.();
    host = null;
    return renderer;
  };
  const fail = error => {
    if (stopped) return;
    const message = error instanceof Error ? error.message : "No se pudo iniciar la práctica local.";
    const userMessage = error?.code === "WEBGL_UNAVAILABLE" || error?.code === "WEBGL_RENDER_FAILED" || /WebGL/i.test(message)
      ? `${message || "WebGL 2 no está disponible."} Activa la aceleración por hardware y vuelve a cargar.`
      : message;
    stop();
    if (headerTitle) headerTitle.textContent = "Práctica local no disponible";
    setStatus(`Práctica local: error · ${userMessage}`);
    if (loadingOverlay) loadingOverlay.hidden = false;
    setLoading(`No se pudo preparar la práctica: ${userMessage}`);
    try { onError(error); } catch { /* Observers never alter the fallback. */ }
  };
  const present = snapshot => {
    const state = createP2POfflinePracticePresentationState(snapshot);
    renderer?.update?.(state);
    renderP2PCausalBetaHud(documentRef, state, { role: "host", connection: "Práctica local · Nitro infinito", localName: "TÚ" });
    audioPresenter?.present?.(state, { role: "host" });
    onPresentationState(state);
    return state;
  };
  const render = frameAt => {
    frame = null;
    if (stopped || !renderer) return;
    try {
      renderer.render();
      const timestamp = Number.isFinite(frameAt) ? frameAt : (typeof performance !== "undefined" ? performance.now() : Date.now());
      renderer.recordFrame?.(timestamp);
      onFrame(timestamp);
    }
    catch (error) { fail(error); return; }
    if (requestAnimationFrameFn) frame = requestAnimationFrameFn(render);
  };
  const tick = async () => {
    if (stopped || advancing || !host || menuOverlay?.hidden === false) {
      if (menuOverlay?.hidden === false) input?.clear?.();
      return;
    }
    advancing = true;
    try {
      const command = input.nextCommand("host");
      const accepted = host.setHostCommand(command);
      if (!accepted?.accepted) throw new Error(accepted?.reason || "La práctica rechazó el control local.");
      present(await host.advance(1));
    } catch (error) {
      fail(error);
    } finally {
      advancing = false;
    }
  };
  const ready = (async () => {
    try {
      setLoading("Cargando práctica local WASM…");
      host = await hostFactory({ warmup: true });
      if (stopped) return;
      const initial = await host.advance(1);
      renderer = presentationRendererFactory({ canvas, role: "host" });
      if (!renderer || typeof renderer.update !== "function" || typeof renderer.render !== "function") throw new TypeError("El renderer de práctica no es válido.");
      await renderer.ready?.();
      if (stopped) return;
      present(initial);
      if (headerTitle) headerTitle.textContent = "Entrenamiento libre";
      setStatus("Práctica local · Nitro infinito · Abre Menú para crear o unirte a una sala privada.");
      if (loadingOverlay) loadingOverlay.hidden = true;
      const eventTarget = documentRef.defaultView || (typeof window !== "undefined" ? window : null);
      if (!eventTarget) throw new TypeError("La práctica local necesita una ventana para los controles.");
      input = createInput({ eventTarget, documentTarget: documentRef, gameTarget: inputSurface, fullControls: true });
      if (requestAnimationFrameFn) frame = requestAnimationFrameFn(render);
      if (setIntervalFn) interval = setIntervalFn(() => { void tick(); }, P2P_OFFLINE_PRACTICE_INTERVAL_MS);
    } catch (error) {
      fail(error);
    }
  })();
  return Object.freeze({ stop, handoff, getRenderer: () => renderer, ready, isRunning: () => !stopped });
}
