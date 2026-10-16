// RocketSim publishes a car position at its native vehicle pivot. The web
// snapshot intentionally subtracts the resting height so a level car reads
// h=0 on the Arsenal floor. Render geometry must put that pivot back before
// applying attitude; otherwise a flipped model rotates around the floor and
// visibly enters it even while native collision is correct.
//
// These Octane dimensions come from the public RocketSim source used by the
// bridge: rocketsim-r1/src/Sim/Car/CarConfig/CarConfig.cpp. They describe the
// authoritative collision volume; this module only maps the temporary
// Three.js chassis into its vertical contact envelope.

export const ROCKETSIM_PRACTICE_SCALE = 56 / 2300;
export const ROCKETSIM_VISUAL_PIVOT_HEIGHT = 17 * ROCKETSIM_PRACTICE_SCALE;
export const ROCKETSIM_OCTANE_HITBOX_TOP = (20.755 + 38.6591 / 2) * ROCKETSIM_PRACTICE_SCALE;

// Bounds of the current authored prototype, excluding cosmetic trails and
// status UI. Keep these next to the factory geometry in client.js when that
// prototype is replaced by a proper car asset.
export const PROTOTYPE_CHASSIS_MIN_Y = .09;
export const PROTOTYPE_CHASSIS_MAX_Y = 1.77;
export const ROCKETSIM_PROTOTYPE_CHASSIS_SCALE =
  (ROCKETSIM_VISUAL_PIVOT_HEIGHT + ROCKETSIM_OCTANE_HITBOX_TOP) /
  (PROTOTYPE_CHASSIS_MAX_Y - PROTOTYPE_CHASSIS_MIN_Y);

export function vehicleVisualAlignment({ height = 0, movementBackend = "js" } = {}) {
  const rocketSim = movementBackend === "rocketsim";
  const pivotHeight = rocketSim ? ROCKETSIM_VISUAL_PIVOT_HEIGHT : 0;
  return {
    rootHeight: height + pivotHeight,
    // Match the visual wheel envelope to the floor when the car's native
    // suspension is level, while an inverted roof reaches the native box
    // contact plane. This is presentation only; RocketSim remains collision
    // authority.
    modelOffsetY: rocketSim
      ? -pivotHeight - PROTOTYPE_CHASSIS_MIN_Y * ROCKETSIM_PROTOTYPE_CHASSIS_SCALE
      : 0,
    modelScale: rocketSim ? ROCKETSIM_PROTOTYPE_CHASSIS_SCALE : 1,
  };
}

// Kept free of Three.js so the coordinate contract can be tested directly.
export function modelPointHeight({ height = 0, localHeight = 0, orientationUpY = 1, movementBackend = "js" } = {}) {
  const alignment = vehicleVisualAlignment({ height, movementBackend });
  return alignment.rootHeight + (alignment.modelOffsetY + localHeight * alignment.modelScale) * orientationUpY;
}
