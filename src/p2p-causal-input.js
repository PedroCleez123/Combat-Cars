// Presentation-side input intent only. This module never advances WASM, owns
// a clock, or applies physics. The host remains the sole simulation authority.

// This is the public counterpart of src/client.js: do not create a second
// control scheme for the online game. Mouse buttons map to the desktop Arsenal
// bindings, while aim target selection is supplied by the live session state.
import { composeVehicleInput } from "./control-mapping.js";
import { mergeVehicleActions, readGamepadActions } from "./gamepad-input.js";

export const P2P_DEFAULT_BINDINGS = Object.freeze({
  forward: "w", back: "s", left: "a", right: "d", drift: "shift", rollLeft: "control", rollRight: " ",
  jump: "mouse-right", boost: "mouse-left", fire: "f", lockTarget: "q",
});
export const P2P_BINDING_LABELS = Object.freeze({
  forward: "Acelerar", back: "Frenar / marcha atrás", left: "Girar izquierda", right: "Girar derecha",
  drift: "Derrape / air-roll", rollLeft: "Air roll direccional izquierda", rollRight: "Air roll direccional derecha",
  jump: "Saltar / doble salto", boost: "Nitro", fire: "Lanzar cohete", lockTarget: "Bloquear objetivo",
});

// The public causal command deliberately wraps the simulation controls under
// `controls` together with edge actions (`fire`, `targetId`).  Waiting-room
// transport only accepts the controls object, so keep that projection in one
// place instead of allowing callers to accidentally read the wrapper as if it
// were the wire shape.
export function p2pLobbyControlsFromCommand(command = {}) {
  const controls = command && typeof command.controls === "object" && command.controls !== null
    ? command.controls
    : {};
  const numberOrZero = value => Number.isFinite(value) ? value : 0;
  return {
    throttle: numberOrZero(controls.throttle),
    steer: numberOrZero(controls.steer),
    pitch: numberOrZero(controls.pitch),
    yaw: numberOrZero(controls.yaw),
    roll: numberOrZero(controls.roll),
    boost: Boolean(controls.boost),
    jump: Boolean(controls.jump),
    drift: Boolean(controls.drift),
    airRoll: Boolean(controls.airRoll),
    handbrake: Boolean(controls.handbrake),
  };
}

const TOUCH_INPUT_KEYS = Object.freeze({ boost: "mouse-left", jump: "mouse-right", fire: "f", lockTarget: "q", drift: "shift", rollLeft: "control", rollRight: " ", airRoll: "shift" });
const RIVAL_BY_ROLE = Object.freeze({ host: "p2p-pilot", pilot: "p2p-host" });

const KEY_CODES = Object.freeze({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", KeyQ: "q", KeyF: "f", KeyR: "r" });

export function p2pBindingTokenFromEvent(event) {
  if (event?.type === "mousedown" || event?.type === "pointerdown" || Number.isInteger(event?.button)) {
    return event.button === 0 ? "mouse-left" : event.button === 2 ? "mouse-right" : null;
  }
  const code = typeof event?.code === "string" ? event.code : "";
  if (code === "ShiftLeft" || code === "ShiftRight") return "shift";
  if (code === "ControlLeft" || code === "ControlRight") return "control";
  if (code === "Space") return " ";
  if (KEY_CODES[code]) return KEY_CODES[code];
  if (code === "ArrowUp") return "arrowup";
  if (code === "ArrowDown") return "arrowdown";
  if (code === "ArrowLeft") return "arrowleft";
  if (code === "ArrowRight") return "arrowright";
  // Rebindings preserve the physical key like src/client.js. The established
  // Arsenal defaults above retain their compact legacy tokens, while a newly
  // selected letter key remains stable across keyboard layouts.
  if (/^Key[A-Z]$/u.test(code)) return code;
  return typeof event?.key === "string" ? event.key.toLowerCase() : "";
}

export function p2pBindingName(token) {
  return ({
    "mouse-left": "Clic izquierdo", "mouse-right": "Clic derecho", control: "Ctrl izquierdo",
    shift: "Mayús izquierdo", " ": "Espacio", arrowup: "Flecha arriba", arrowdown: "Flecha abajo",
    arrowleft: "Flecha izquierda", arrowright: "Flecha derecha",
  })[token] || String(token || "").replace(/^Key/, "").toUpperCase();
}

function editableTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  const name = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  return name === "input" || name === "textarea" || name === "select";
}

function defaultTargetAllowed(role, targetId) {
  return targetId === RIVAL_BY_ROLE[role];
}

function commandFor(role, held, fire, targetId = null, fullControls = false, bindings = P2P_DEFAULT_BINDINGS, targetAllowed = defaultTargetAllowed) {
  const pilot = role === "pilot";
  const host = role === "host";
  if (!pilot && !host) throw new TypeError("El rol de control causal debe ser host o pilot.");
  if (targetId !== null && !targetAllowed(role, targetId)) throw new TypeError("El objetivo causal no pertenece al roster permitido.");
  const down = action => held.has(bindings[action])
    || (bindings[action] === "w" && held.has("arrowup"))
    || (bindings[action] === "s" && held.has("arrowdown"))
    || (bindings[action] === "a" && held.has("arrowleft"))
    || (bindings[action] === "d" && held.has("arrowright"));
  const mapped = composeVehicleInput({
    forward: down("forward"), back: down("back"), left: down("left"), right: down("right"),
    drift: down("drift"), rollLeft: down("rollLeft"), rollRight: down("rollRight"),
    boost: down("boost"), jump: down("jump"),
  });
  const controls = {
    throttle: mapped.throttle,
    steer: mapped.steer,
    boost: mapped.boost,
    jump: mapped.jump,
  };
  if (fullControls) {
    // RocketSimPracticeMatch uses these values when the local client omits
    // explicit pitch/yaw. Send the identical relationship on the full P2P
    // contract rather than silently overriding it with zeroes.
    Object.assign(controls, {
      pitch: -controls.throttle,
      yaw: mapped.airRoll ? 0 : controls.steer,
      roll: mapped.roll,
      drift: mapped.drift,
      airRoll: mapped.airRoll,
      handbrake: mapped.drift,
    });
  }
  return Object.freeze({
    controls: Object.freeze(controls),
    fire,
    targetId,
  });
}

/**
 * Translate a deliberately small keyboard slice into explicit bounded
 * commands. F is an edge (one command); held movement keys are sampled by the
 * caller's paced transport loop. Inputs focused in a text field stay local to
 * that field and cannot accidentally control the public session.
 */
export function createP2PCausalInput({
  eventTarget = typeof window !== "undefined" ? window : null,
  documentTarget = typeof document !== "undefined" ? document : null,
  controlRoot = null,
  gameTarget = null,
  fullControls = false,
  bindings: initialBindings = P2P_DEFAULT_BINDINGS,
  bindingCapture = null,
  getGamepads = () => typeof navigator !== "undefined" ? navigator.getGamepads?.() : null,
  targetAllowed = defaultTargetAllowed,
} = {}) {
  if (!eventTarget || typeof eventTarget.addEventListener !== "function" || typeof eventTarget.removeEventListener !== "function") {
    throw new TypeError("El controlador causal necesita un EventTarget de navegador.");
  }
  if (typeof targetAllowed !== "function") throw new TypeError("El validador de objetivos causales no es válido.");
  const held = new Set();
  let bindings = Object.freeze({ ...P2P_DEFAULT_BINDINGS, ...(initialBindings || {}) });
  const keyboardHeld = new Set();
  const pointerHeld = new Map();
  let fireQueued = false;
  let targetToggleQueued = false;
  let targetId = null;
  let gamepadFireHeld = false;

  const currentGameTarget = () => typeof gameTarget === "function" ? gameTarget() : gameTarget;
  const isGamePointerTarget = target => {
    const surface = currentGameTarget();
    if (!surface) return true;
    if (target === surface || surface.contains?.(target)) return true;
    return Boolean(target?.closest?.("[data-gameplay-surface='true']"));
  };

  const keyForTouchControl = button => {
    const token = button?.dataset?.causalInput;
    return typeof token === "string" ? (TOUCH_INPUT_KEYS[token] || token) : null;
  };
  const syncKey = key => {
    if (keyboardHeld.has(key) || [...pointerHeld.values()].some(input => input.key === key)) held.add(key);
    else held.delete(key);
    if (!controlRoot?.querySelectorAll) return;
    for (const button of controlRoot.querySelectorAll("[data-causal-input]")) {
      if (keyForTouchControl(button) === key) button.setAttribute("aria-pressed", held.has(key) ? "true" : "false");
    }
  };
  const releasePointer = pointerId => {
    const active = pointerHeld.get(pointerId);
    if (!active) return;
    pointerHeld.delete(pointerId);
    syncKey(active.key);
  };
  const clear = () => {
    const affectedKeys = new Set([...held, ...keyboardHeld, ...[...pointerHeld.values()].map(input => input.key)]);
    held.clear();
    keyboardHeld.clear();
    pointerHeld.clear();
    fireQueued = false;
    targetToggleQueued = false;
    targetId = null;
    gamepadFireHeld = false;
    if (controlRoot?.querySelectorAll) {
      for (const button of controlRoot.querySelectorAll("[data-causal-input]")) button.setAttribute("aria-pressed", "false");
    }
    for (const key of affectedKeys) syncKey(key);
  };
  const onKeyDown = event => {
    if (bindingCapture?.(event) === true) return;
    if (editableTarget(event?.target)) return;
    const key = p2pBindingTokenFromEvent(event);
    const boundKeys = new Set([...Object.values(bindings), "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    if (!boundKeys.has(key)) return;
    if (key === bindings.fire && !event.repeat) fireQueued = true;
    else if (key === bindings.lockTarget && !event.repeat) targetToggleQueued = true;
    else {
      keyboardHeld.add(key);
      syncKey(key);
    }
    if (key === " " || key.startsWith("arrow")) event.preventDefault?.();
  };
  const onKeyUp = event => {
    if (editableTarget(event?.target)) return;
    const key = p2pBindingTokenFromEvent(event);
    const boundKeys = new Set([...Object.values(bindings), "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    if (!boundKeys.has(key)) return;
    keyboardHeld.delete(key);
    syncKey(key);
    if (key === " " || key.startsWith("arrow")) event.preventDefault?.();
  };
  const onMouseDown = event => {
    if (bindingCapture?.(event) === true) return;
    if (editableTarget(event?.target)) return;
    if (!isGamePointerTarget(event?.target)) return;
    const key = p2pBindingTokenFromEvent(event);
    if (!key || !Object.values(bindings).includes(key)) return;
    held.add(key);
    event.preventDefault?.();
  };
  const onMouseUp = event => {
    const key = event?.button === 0 ? "mouse-left" : event?.button === 2 ? "mouse-right" : null;
    if (key) held.delete(key);
  };
  const onContextMenu = event => {
    // Leave native browser menus available for the game's controls and text
    // fields. The multiplayer entry owns the capture guard for the canvas.
    if (editableTarget(event?.target) || event?.target?.closest?.("button, summary")) return;
    event.preventDefault?.();
  };
  const onPointerDown = event => {
    const button = event?.target?.closest?.("[data-causal-input]");
    if (!button || !controlRoot?.contains?.(button) || button.disabled) return;
    const key = keyForTouchControl(button);
    const pointerId = event.pointerId;
    if (!key || !Object.values(bindings).includes(key) || !Number.isInteger(pointerId)) return;
    if (pointerHeld.has(pointerId)) releasePointer(pointerId);
    const wasHeld = held.has(key);
    if (!wasHeld && key === bindings.lockTarget) targetToggleQueued = true;
    pointerHeld.set(pointerId, { key, button });
    syncKey(key);
    if (!wasHeld && key === bindings.fire) fireQueued = true;
    event.preventDefault?.();
    try { button.setPointerCapture?.(pointerId); } catch { /* The browser may have already ended this pointer. */ }
  };
  const onPointerEnd = event => releasePointer(event?.pointerId);
  const onVisibilityChange = () => { if (documentTarget?.hidden || documentTarget?.visibilityState === "hidden") clear(); };
  const keyboardActions = () => {
    const down = action => held.has(bindings[action])
      || (bindings[action] === "w" && held.has("arrowup"))
      || (bindings[action] === "s" && held.has("arrowdown"))
      || (bindings[action] === "a" && held.has("arrowleft"))
      || (bindings[action] === "d" && held.has("arrowright"));
    return {
      forward: down("forward"), back: down("back"), left: down("left"), right: down("right"),
      drift: down("drift"), rollLeft: down("rollLeft"), rollRight: down("rollRight"),
      boost: down("boost"), jump: down("jump"),
    };
  };

  eventTarget.addEventListener("keydown", onKeyDown);
  eventTarget.addEventListener("keyup", onKeyUp);
  eventTarget.addEventListener("mousedown", onMouseDown);
  eventTarget.addEventListener("mouseup", onMouseUp);
  eventTarget.addEventListener("contextmenu", onContextMenu);
  eventTarget.addEventListener("blur", clear);
  eventTarget.addEventListener("pagehide", clear);
  controlRoot?.addEventListener?.("pointerdown", onPointerDown);
  controlRoot?.addEventListener?.("pointerup", onPointerEnd);
  controlRoot?.addEventListener?.("pointercancel", onPointerEnd);
  controlRoot?.addEventListener?.("lostpointercapture", onPointerEnd);
  documentTarget?.addEventListener?.("visibilitychange", onVisibilityChange);

  return Object.freeze({
    setBindings(nextBindings = {}) {
      if (!nextBindings || typeof nextBindings !== "object") throw new TypeError("Las teclas causales no son válidas.");
      bindings = Object.freeze({ ...P2P_DEFAULT_BINDINGS, ...nextBindings });
      clear();
    },
    getBindings() { return { ...bindings }; },
    nextCommand(role, { candidateTargetId = null } = {}) {
      const gamepad = readGamepadActions(getGamepads?.());
      const gamepadFire = gamepad.connected && gamepad.actions.fire === true;
      if (gamepadFire && !gamepadFireHeld) fireQueued = true;
      gamepadFireHeld = gamepadFire;
      const fire = fireQueued;
      fireQueued = false;
      if (role !== "host" && role !== "pilot") throw new TypeError("El rol de control causal debe ser host o pilot.");
      const eligibleCandidate = candidateTargetId !== null && targetAllowed(role, candidateTargetId) ? candidateTargetId : null;
      if (targetToggleQueued) {
        targetId = targetId === null ? eligibleCandidate : null;
        targetToggleQueued = false;
      }
      // The renderer passes the living rival from the latest validated host
      // snapshot. Keep a lock while that same car remains live, and release it
      // immediately when the rival is eliminated or no longer in the roster.
      if (targetId !== null && eligibleCandidate !== targetId) targetId = null;
      const command = commandFor(role, held, fire, targetId, fullControls, bindings, targetAllowed);
      const mapped = composeVehicleInput(mergeVehicleActions(keyboardActions(), gamepad.actions));
      const controls = {
        throttle: mapped.throttle,
        steer: mapped.steer,
        boost: mapped.boost,
        jump: mapped.jump,
      };
      if (fullControls) Object.assign(controls, {
        pitch: -controls.throttle,
        yaw: mapped.airRoll ? 0 : controls.steer,
        roll: mapped.roll,
        drift: mapped.drift,
        airRoll: mapped.airRoll,
        handbrake: mapped.drift,
      });
      return Object.freeze({ ...command, controls: Object.freeze(controls) });
    },
    isTargetLocked() { return targetId !== null; },
    getTargetId() { return targetId; },
    clear,
    destroy() {
      clear();
      eventTarget.removeEventListener("keydown", onKeyDown);
      eventTarget.removeEventListener("keyup", onKeyUp);
      eventTarget.removeEventListener("mousedown", onMouseDown);
      eventTarget.removeEventListener("mouseup", onMouseUp);
      eventTarget.removeEventListener("contextmenu", onContextMenu);
      eventTarget.removeEventListener("blur", clear);
      eventTarget.removeEventListener("pagehide", clear);
      controlRoot?.removeEventListener?.("pointerdown", onPointerDown);
      controlRoot?.removeEventListener?.("pointerup", onPointerEnd);
      controlRoot?.removeEventListener?.("pointercancel", onPointerEnd);
      controlRoot?.removeEventListener?.("lostpointercapture", onPointerEnd);
      documentTarget?.removeEventListener?.("visibilitychange", onVisibilityChange);
    },
  });
}
