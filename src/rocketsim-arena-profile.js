const CLEAN_ARENA = Object.freeze({
  halfWidth: 62,
  halfDepth: 46,
  height: 24,
  curveRadius: 0,
  cornered: false,
  expanded: false,
});

const CURVED_ARENA = Object.freeze({
  ...CLEAN_ARENA,
  curveRadius: 256 * 56 / 2300,
});

const EXPANDED_ARENA = Object.freeze({
  halfWidth: 72,
  halfDepth: 54,
  height: 30,
  curveRadius: 8,
  cornered: true,
  expanded: true,
});

// The native bridge remains the collision authority. These Arsenal-world
// dimensions mirror its named arena profiles so Node's projectile failsafe and
// Three.js presentation cannot retain the old clean-arena limits by accident.
export const ROCKETSIM_ARENA_PROFILES = Object.freeze({
  "arsenal-practice": CLEAN_ARENA,
  "arsenal-curved-practice": CURVED_ARENA,
  "arsenal-expanded-curved-practice": Object.freeze({ ...EXPANDED_ARENA, cornered: false }),
  "arsenal-expanded-cornered-practice": EXPANDED_ARENA,
  "arsenal-expanded-block-practice": EXPANDED_ARENA,
  "arsenal-expanded-ramp-practice": EXPANDED_ARENA,
  "combat-alpha": EXPANDED_ARENA,
});

const WORLD_MODE_ARENAS = Object.freeze({
  "rocketsim-curved-practice": "arsenal-curved-practice",
  "rocketsim-expanded-curved-practice": "arsenal-expanded-curved-practice",
  "rocketsim-expanded-cornered-practice": "arsenal-expanded-cornered-practice",
  "rocketsim-expanded-block-practice": "arsenal-expanded-block-practice",
  "rocketsim-expanded-ramp-practice": "arsenal-expanded-ramp-practice",
  "rocketsim-combat-alpha": "combat-alpha",
});

export function rocketSimArenaProfile(arena) {
  return ROCKETSIM_ARENA_PROFILES[arena] || null;
}

export function rocketSimArenaForWorldMode(mode) {
  return WORLD_MODE_ARENAS[mode] || null;
}

export function rocketSimCombatBounds(arena) {
  const profile = rocketSimArenaProfile(arena);
  if (!profile) return null;
  return {
    halfWidth: profile.halfWidth,
    halfDepth: profile.halfDepth,
    ceilingHeight: profile.height,
  };
}
