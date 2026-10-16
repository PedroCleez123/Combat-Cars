const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Converts the physical keyboard actions into the vehicle input contract.
 *
 * `drift` is deliberately the free-air-roll modifier. Directional roll keys
 * remain an independent axis, so they can be combined with air yaw. This
 * mirrors the observed control relationship without coupling the renderer to
 * the simulation implementation.
 */
export function composeVehicleInput(actions = {}) {
  const down = action => Boolean(actions[action]);
  const analogue = action => Number.isFinite(actions[action]) ? clamp(actions[action], -1, 1) : 0;
  const steer = clamp((down("right") ? 1 : 0) - (down("left") ? 1 : 0) + analogue("steer"), -1, 1);
  const freeAirRoll = down("drift");
  const directionalRoll = (down("rollRight") ? 1 : 0) - (down("rollLeft") ? 1 : 0);
  const roll = clamp(directionalRoll + (freeAirRoll ? steer : 0), -1, 1);
  return {
    throttle: clamp((down("forward") ? 1 : 0) - (down("back") ? 1 : 0) + analogue("throttle"), -1, 1),
    steer,
    jump: down("jump"),
    boost: down("boost"),
    drift: freeAirRoll,
    airRoll: freeAirRoll,
    roll,
    fire: down("fire")
  };
}
