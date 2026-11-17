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
  // Keep the opt-in practice profiles stable. Combat-alpha has its own
  // larger profile below so expanding combat cannot silently resize practice.
  halfWidth: 72,
  halfDepth: 54,
  height: 30,
  curveRadius: 8,
  cornered: true,
  expanded: true,
});

const EXPANDED_CURVED_ARENA = Object.freeze({
  ...EXPANDED_ARENA,
  cornered: false,
});

const COMBAT_ALPHA_ARENA = Object.freeze({
  // Public arena dimensions: 264 × 408 × 108 Arsenal units.  The width was
  // already 264; the requested expansion doubles its long axis and height.
  // Keep these values mirrored by both RocketSim bridges so visual geometry,
  // collision curves and gameplay limits remain one named volume.
  halfWidth: 132,
  halfDepth: 204,
  height: 108,
  curveRadius: 30,
  cornered: true,
  expanded: true,
});

// R20 is the first native bridge that contains the expanded wall-to-ceiling
// curves and corner patches. Starting an expanded world with an older bridge
// would silently make the rendered arena and collision arena disagree.
const R20_REQUIRED_ARENAS = new Set([
  "arsenal-expanded-curved-practice",
  "arsenal-expanded-cornered-practice",
  "arsenal-expanded-block-practice",
  "arsenal-expanded-ramp-practice",
  "combat-alpha",
]);

// The native bridge remains the collision authority. These Arsenal-world
// dimensions mirror its named arena profiles so Node's projectile failsafe and
// Three.js presentation cannot retain the old clean-arena limits by accident.
export const ROCKETSIM_ARENA_PROFILES = Object.freeze({
  "arsenal-practice": CLEAN_ARENA,
  "arsenal-curved-practice": CURVED_ARENA,
  "arsenal-expanded-curved-practice": EXPANDED_CURVED_ARENA,
  "arsenal-expanded-cornered-practice": EXPANDED_ARENA,
  "arsenal-expanded-block-practice": EXPANDED_ARENA,
  "arsenal-expanded-ramp-practice": EXPANDED_ARENA,
  "combat-alpha": COMBAT_ALPHA_ARENA,
  // The native-only combat lineup intentionally uses the clean six-plane
  // arena. Keep its projectile failsafe aligned with createCleanArena().
  "combat-lineup": CLEAN_ARENA,
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

/**
 * Conservative local camera far plane for a named RocketSim volume.
 *
 * The far plane must cover a view from one outer lane to its opposite corner,
 * not merely one half-extent.  This matters for combat-alpha after its
 * 264 × 408 × 108 expansion: retaining the old 250-unit plane reveals the
 * scene background through distant geometry and looks like artificial haze.
 */
export function rocketSimArenaCameraFar(profile) {
  if (!profile) return 250;
  const halfExtent = Math.max(0, Number(profile.halfWidth) || 0, Number(profile.halfDepth) || 0);
  return Math.max(250, Math.ceil(halfExtent * 4));
}

export function rocketSimArenaRequiresR20(arena) {
  return R20_REQUIRED_ARENAS.has(arena);
}

export function rocketSimBridgeSupportsArena(arena, bridgeLabel) {
  if (!rocketSimArenaRequiresR20(arena)) return true;
  const revision = /^R(\d+)$/i.exec(String(bridgeLabel || ""))?.[1];
  return revision !== undefined && Number(revision) >= 20;
}

const ARENA_SIDES = Object.freeze(["positiveX", "negativeX", "positiveZ", "negativeZ"]);
const VISUAL_TOPOLOGY = new WeakMap([
  [CLEAN_ARENA, Object.freeze({ curvedSides: Object.freeze([]), clipCurveEnds: false, cornerFillets: false })],
  [CURVED_ARENA, Object.freeze({ curvedSides: Object.freeze(["positiveX"]), clipCurveEnds: false, cornerFillets: false })],
  [EXPANDED_CURVED_ARENA, Object.freeze({ curvedSides: ARENA_SIDES, clipCurveEnds: true, cornerFillets: false })],
  [EXPANDED_ARENA, Object.freeze({ curvedSides: ARENA_SIDES, clipCurveEnds: true, cornerFillets: true })],
  [COMBAT_ALPHA_ARENA, Object.freeze({ curvedSides: ARENA_SIDES, clipCurveEnds: true, cornerFillets: true })],
]);

/**
 * Return the presentation topology mirrored from RocketSim's named arena.
 * The bridge remains the collision authority; this spec only describes which
 * native quarter-pipes and corner patches the client should draw.
 */
export function rocketSimArenaVisualSpec(profile) {
  if (!profile) return null;
  const radius = Math.max(0, Number(profile.curveRadius) || 0);
  const topology = VISUAL_TOPOLOGY.get(profile);
  const curvedSides = radius > 0
    ? (topology?.curvedSides || profile.curvedSides || (profile.cornered ? ARENA_SIDES : profile.halfWidth === 62 && profile.halfDepth === 46 ? ["positiveX"] : ARENA_SIDES)).filter(side => ARENA_SIDES.includes(side))
    : [];
  const clipCurveEnds = radius > 0 && (topology?.clipCurveEnds ?? profile.clipCurveEnds ?? (profile.cornered === true || (profile.halfWidth !== 62 || profile.halfDepth !== 46)));
  const cornerFillets = radius > 0 && (topology?.cornerFillets ?? profile.cornerFillets ?? profile.cornered === true);
  const { halfWidth, halfDepth } = profile;
  const endInset = clipCurveEnds ? radius : 0;
  const wallSegments = [
    { side: "positiveX", axis: "z", fixed: halfWidth, min: -halfDepth + endInset, max: halfDepth - endInset },
    { side: "negativeX", axis: "z", fixed: -halfWidth, min: -halfDepth + endInset, max: halfDepth - endInset },
    { side: "positiveZ", axis: "x", fixed: halfDepth, min: -halfWidth + endInset, max: halfWidth - endInset },
    { side: "negativeZ", axis: "x", fixed: -halfDepth, min: -halfWidth + endInset, max: halfWidth - endInset },
  ];
  for (const segment of wallSegments) {
    const curved = curvedSides.includes(segment.side);
    segment.minY = curved ? radius : 0;
    segment.maxY = curved ? profile.height - radius : profile.height;
  }
  return Object.freeze({
    halfWidth,
    halfDepth,
    height: profile.height,
    curveRadius: radius,
    curvedSides: Object.freeze(curvedSides),
    clipCurveEnds,
    cornerFillets,
    wallSegments: Object.freeze(wallSegments.map(segment => Object.freeze(segment))),
  });
}

/** Return non-overlapping floor/ceiling rectangles for native corner fillets. */
export function rocketSimArenaSurfaceFootprint(spec) {
  if (!spec) return Object.freeze([]);
  const { halfWidth, halfDepth, curveRadius: radius, curvedSides = [], cornerFillets } = spec;
  if (!radius || !cornerFillets) {
    return Object.freeze([{ x: 0, z: 0, width: halfWidth * 2, depth: halfDepth * 2 }]);
  }
  const insetXMin = curvedSides.includes("negativeX") ? radius : 0;
  const insetXMax = curvedSides.includes("positiveX") ? radius : 0;
  const insetZMin = curvedSides.includes("negativeZ") ? radius : 0;
  const insetZMax = curvedSides.includes("positiveZ") ? radius : 0;
  const minX = -halfWidth + insetXMin, maxX = halfWidth - insetXMax;
  const minZ = -halfDepth + insetZMin, maxZ = halfDepth - insetZMax;
  const rectangles = [{ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ }];
  if (insetXMax) rectangles.push({ x: halfWidth - radius / 2, z: (minZ + maxZ) / 2, width: radius, depth: maxZ - minZ });
  if (insetXMin) rectangles.push({ x: -halfWidth + radius / 2, z: (minZ + maxZ) / 2, width: radius, depth: maxZ - minZ });
  if (insetZMax) rectangles.push({ x: (minX + maxX) / 2, z: halfDepth - radius / 2, width: maxX - minX, depth: radius });
  if (insetZMin) rectangles.push({ x: (minX + maxX) / 2, z: -halfDepth + radius / 2, width: maxX - minX, depth: radius });
  return Object.freeze(rectangles.map(rectangle => Object.freeze(rectangle)));
}
