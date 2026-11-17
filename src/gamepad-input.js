// Match the semantic controller contract audited in Rocket Arena: a small
// centred dead zone followed by a normalized response, rather than a hard
// cutoff that makes fine steering disappear near the centre.
export const GAMEPAD_DEADZONE = .12;
export const GAMEPAD_TRIGGER_THRESHOLD = .15;

const emptyActions = () => ({
  forward: false, back: false, left: false, right: false,
  drift: false, rollLeft: false, rollRight: false,
  jump: false, boost: false, fire: false,
  throttle: 0, steer: 0
});

function axis(value) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function deadzone(value, threshold = GAMEPAD_DEADZONE) {
  const normalized = axis(value);
  if (Math.abs(normalized) <= threshold) return 0;
  return Math.sign(normalized) * ((Math.abs(normalized) - threshold) / (1 - threshold));
}

function buttonDown(button) {
  return Boolean(button?.pressed) || Number(button?.value) >= .5;
}

function triggerValue(button) {
  const value = Number.isFinite(button?.value) ? Math.max(0, Math.min(1, button.value)) : buttonDown(button) ? 1 : 0;
  return value <= GAMEPAD_TRIGGER_THRESHOLD ? 0 : value;
}

/**
 * Reads one standard-mapped Gamepad API device into the same semantic actions
 * used by the keyboard. Keeping this adapter outside the renderer makes the
 * input contract testable and lets a local XInput device drive exact-duration
 * calibration traces without synthesising browser keyboard events.
 *
 * The layout follows the common Rocket League controller scheme: RT accelerates,
 * LT brakes/reverses, the left stick steers, A jumps, RB boosts, and LB is
 * powerslide/free air roll. X/B are directional left/right air roll. D-pad up
 * fires the Arsenal rocket; Y remains available for a future objective camera.
 */
export function readGamepadActions(gamepads) {
  const gamepad = Array.from(gamepads || []).find(candidate => candidate?.connected && candidate.mapping === "standard");
  const actions = emptyActions();
  if (!gamepad) return { connected: false, actions };

  const horizontal = gamepad.axes?.[0];
  actions.steer = deadzone(horizontal);
  actions.throttle = triggerValue(gamepad.buttons?.[7]) - triggerValue(gamepad.buttons?.[6]); // RT - LT
  actions.jump = buttonDown(gamepad.buttons?.[0]); // A
  actions.rollRight = buttonDown(gamepad.buttons?.[1]); // B
  actions.rollLeft = buttonDown(gamepad.buttons?.[2]); // X
  actions.drift = buttonDown(gamepad.buttons?.[4]); // LB
  actions.boost = buttonDown(gamepad.buttons?.[5]); // RB
  actions.fire = buttonDown(gamepad.buttons?.[12]); // D-pad up
  return { connected: true, actions };
}

export function mergeVehicleActions(...sources) {
  const merged = emptyActions();
  for (const source of sources) {
    for (const action of Object.keys(merged)) {
      if (action === "throttle" || action === "steer") merged[action] = Math.max(-1, Math.min(1, merged[action] + (Number(source?.[action]) || 0)));
      else merged[action] ||= Boolean(source?.[action]);
    }
  }
  return merged;
}
