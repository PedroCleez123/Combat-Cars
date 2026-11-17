import { rocketSimArenaProfile } from "./rocketsim-arena-profile.js";

export const COMBAT_ALPHA_OBSTACLES = Object.freeze([
  Object.freeze({ id: "central-block", kind: "box", x: 0, z: -20, width: 14, depth: 18, height: 3.25 }),
  Object.freeze({ id: "south-ramp", kind: "closed-convex-wedge", x: 0, z: 20, run: 20, width: 18, height: 3.5 }),
  Object.freeze({
    id: "container-cover-northwest", kind: "box", x: -45, z: -58,
    width: 10, depth: 24, height: 6,
    role: "cover", visualKind: "container", symmetryGroup: "container-cover-pair-northwest-southeast",
  }),
  Object.freeze({
    id: "container-cover-southwest", kind: "box", x: -45, z: 58,
    width: 10, depth: 24, height: 6,
    role: "cover", visualKind: "container", symmetryGroup: "container-cover-pair-southwest-northeast",
  }),
  Object.freeze({
    id: "container-cover-northeast", kind: "box", x: 45, z: -58,
    width: 10, depth: 24, height: 6,
    role: "cover", visualKind: "container", symmetryGroup: "container-cover-pair-southwest-northeast",
  }),
  Object.freeze({
    id: "container-cover-southeast", kind: "box", x: 45, z: 58,
    width: 10, depth: 24, height: 6,
    role: "cover", visualKind: "container", symmetryGroup: "container-cover-pair-northwest-southeast",
  }),
  Object.freeze({
    id: "tire-cover-blue", kind: "box", x: -68, z: -30,
    width: 8, depth: 8, height: 4.8,
    role: "cover", visualKind: "tires", symmetryGroup: "tire-cover-pair-blue-red",
  }),
  Object.freeze({
    id: "tire-cover-red", kind: "box", x: 68, z: 30,
    width: 8, depth: 8, height: 4.8,
    role: "cover", visualKind: "tires", symmetryGroup: "tire-cover-pair-blue-red",
  }),
]);

// Combat no longer uses floor pickups. Boost is an authoritative RocketSim
// resource that regenerates after a short delay; keeping this explicit empty
// contract prevents presentation or legacy map helpers from inventing pads.
export const COMBAT_ALPHA_PICKUPS = Object.freeze([]);
/*
  Object.freeze({ id: 0, size: "large", xRatio: -.70, zRatio: -.70, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 1, size: "large", xRatio: .70, zRatio: -.70, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 2, size: "large", xRatio: -.70, zRatio: .70, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 3, size: "large", xRatio: .70, zRatio: .70, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 4, size: "large", xRatio: -.70, zRatio: -.47, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 5, size: "large", xRatio: .70, zRatio: -.47, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 6, size: "large", xRatio: -.70, zRatio: .47, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 7, size: "large", xRatio: .70, zRatio: .47, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 8, size: "large", xRatio: -.70, zRatio: -.23, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 9, size: "large", xRatio: .70, zRatio: .23, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 10, size: "large", xRatio: -.70, zRatio: .23, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 11, size: "large", xRatio: .70, zRatio: -.23, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 12, size: "small", xRatio: 0, zRatio: -.72, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 13, size: "small", xRatio: 0, zRatio: .72, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 14, size: "small", xRatio: 0, zRatio: -.48, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 15, size: "small", xRatio: 0, zRatio: .48, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 16, size: "small", xRatio: 0, zRatio: -.24, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 17, size: "small", xRatio: 0, zRatio: .24, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 18, size: "small", xRatio: -.52, zRatio: 0, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 19, size: "small", xRatio: .52, zRatio: 0, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 20, size: "small", xRatio: -.52, zRatio: -.26, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 21, size: "small", xRatio: .52, zRatio: -.26, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 22, size: "small", xRatio: -.52, zRatio: .26, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 23, size: "small", xRatio: .52, zRatio: .26, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 24, size: "small", xRatio: -.30, zRatio: -.42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 25, size: "small", xRatio: .30, zRatio: .42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 26, size: "small", xRatio: -.30, zRatio: .42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 27, size: "small", xRatio: .30, zRatio: -.42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 28, size: "small", xRatio: -.30, zRatio: -.65, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 29, size: "small", xRatio: .30, zRatio: .65, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 30, size: "small", xRatio: -.30, zRatio: .65, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 31, size: "small", xRatio: .30, zRatio: -.65, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 32, size: "small", xRatio: -.58, zRatio: -.48, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 33, size: "small", xRatio: .58, zRatio: .48, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 34, size: "small", xRatio: -.58, zRatio: .48, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 35, size: "small", xRatio: .58, zRatio: -.48, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 36, size: "small", xRatio: -.58, zRatio: -.70, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 37, size: "small", xRatio: .58, zRatio: .70, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 38, size: "small", xRatio: -.58, zRatio: .70, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 39, size: "small", xRatio: .58, zRatio: -.70, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 40, size: "small", xRatio: -.12, zRatio: .24, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 41, size: "small", xRatio: .12, zRatio: -.24, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 42, size: "small", xRatio: -.12, zRatio: -.24, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 43, size: "small", xRatio: .12, zRatio: .24, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  // Second interleaved layer: same area coverage, shifted toward the lanes
  // between the first layer, with every point mirrored around both axes.
  Object.freeze({ id: 44, size: "large", xRatio: -.52, zRatio: -.60, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 45, size: "large", xRatio: .52, zRatio: -.60, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 46, size: "large", xRatio: -.52, zRatio: .60, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 47, size: "large", xRatio: .52, zRatio: .60, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 48, size: "large", xRatio: -.52, zRatio: -.35, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 49, size: "large", xRatio: .52, zRatio: -.35, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 50, size: "large", xRatio: -.52, zRatio: .35, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 51, size: "large", xRatio: .52, zRatio: .35, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 52, size: "large", xRatio: -.52, zRatio: -.12, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 53, size: "large", xRatio: .52, zRatio: .12, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 54, size: "large", xRatio: -.52, zRatio: .12, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 55, size: "large", xRatio: .52, zRatio: -.12, amount: 60, cooldownSeconds: 5, radius: 210, height: 180 }),
  Object.freeze({ id: 56, size: "small", xRatio: 0, zRatio: -.60, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 57, size: "small", xRatio: 0, zRatio: .60, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 58, size: "small", xRatio: 0, zRatio: -.40, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 59, size: "small", xRatio: 0, zRatio: .40, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 60, size: "small", xRatio: 0, zRatio: -.20, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 61, size: "small", xRatio: 0, zRatio: .20, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 62, size: "small", xRatio: -.36, zRatio: 0, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 63, size: "small", xRatio: .36, zRatio: 0, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 64, size: "small", xRatio: -.36, zRatio: -.18, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 65, size: "small", xRatio: .36, zRatio: .18, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 66, size: "small", xRatio: -.36, zRatio: .18, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 67, size: "small", xRatio: .36, zRatio: -.18, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 68, size: "small", xRatio: -.36, zRatio: -.42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 69, size: "small", xRatio: .36, zRatio: .42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 70, size: "small", xRatio: -.36, zRatio: .42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 71, size: "small", xRatio: .36, zRatio: -.42, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 72, size: "small", xRatio: -.20, zRatio: -.32, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 73, size: "small", xRatio: .20, zRatio: .32, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 74, size: "small", xRatio: -.20, zRatio: .32, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 75, size: "small", xRatio: .20, zRatio: -.32, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 76, size: "small", xRatio: -.20, zRatio: -.58, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 77, size: "small", xRatio: .20, zRatio: .58, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 78, size: "small", xRatio: -.20, zRatio: .58, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 79, size: "small", xRatio: .20, zRatio: -.58, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 80, size: "small", xRatio: -.46, zRatio: -.35, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 81, size: "small", xRatio: .46, zRatio: .35, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 82, size: "small", xRatio: -.46, zRatio: .35, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 83, size: "small", xRatio: .46, zRatio: -.35, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 84, size: "small", xRatio: -.08, zRatio: -.22, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 85, size: "small", xRatio: .08, zRatio: .22, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 86, size: "small", xRatio: -.08, zRatio: .22, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
  Object.freeze({ id: 87, size: "small", xRatio: .08, zRatio: -.22, amount: 38, cooldownSeconds: 3.5, radius: 165, height: 180 }),
*/

export const COMBAT_ALPHA_PICKUP_CAPACITY = COMBAT_ALPHA_PICKUPS.length;

// The map keeps intentional free space around the native obstacle colliders
// and the six declarative cover records. The cover pair bridges their outer
// lanes instead of sitting on top of either hazard or below a wall/floor curve.

// Presentation landmarks only. Their locations are deliberately derived from
// the named R20 arena bounds; collision remains authoritative in RocketSim.
export const COMBAT_ALPHA_MAP = Object.freeze({
  arena: "combat-alpha",
  teamAxis: "x",
  route: Object.freeze({
    start: "team-edge",
    approach: "lane-guides",
    objective: "center-ring",
    risk: Object.freeze(["central-block", "south-ramp", "wall-ceiling"]),
    recovery: "authoritative-respawn",
  }),
  landmarks: Object.freeze({
    teamBeacons: Object.freeze([
      Object.freeze({ team: "blue", xRatio: -5 / 6, z: -120 }),
      Object.freeze({ team: "blue", xRatio: -5 / 6, z: 0 }),
      Object.freeze({ team: "blue", xRatio: -5 / 6, z: 120 }),
      Object.freeze({ team: "red", xRatio: 5 / 6, z: -120 }),
      Object.freeze({ team: "red", xRatio: 5 / 6, z: 0 }),
      Object.freeze({ team: "red", xRatio: 5 / 6, z: 120 }),
    ]),
    laneGuideZ: Object.freeze([-45, 45]),
    centerRing: Object.freeze({ x: 0, z: 0 }),
    hazards: Object.freeze([
      Object.freeze({ id: "central-block", x: 0, z: -20 }),
      Object.freeze({ id: "south-ramp", x: 0, z: 20 }),
    ]),
  }),
  obstacles: COMBAT_ALPHA_OBSTACLES,
  pickups: COMBAT_ALPHA_PICKUPS,
  // Documentation/reading contract only. RocketSim still owns these native
  // transforms; the client never writes a car position from this table.
  spawnSlots: Object.freeze([
    Object.freeze({ slot: 0, team: "blue", xRatio: -2 / 3, z: -90, yaw: 0 }),
    Object.freeze({ slot: 1, team: "red", xRatio: 2 / 3, z: 90, yaw: Math.PI }),
    Object.freeze({ slot: 2, team: "blue", xRatio: -2 / 3, z: 90, yaw: 0 }),
    Object.freeze({ slot: 3, team: "red", xRatio: 2 / 3, z: -90, yaw: Math.PI }),
    Object.freeze({ slot: 4, team: "blue", xRatio: -2 / 3, z: 0, yaw: 0 }),
    Object.freeze({ slot: 5, team: "red", xRatio: 2 / 3, z: 0, yaw: Math.PI }),
  ]),
});

export const COMBAT_ALPHA_SAFE_CLEARANCE = Object.freeze({
  vehicleRadius: 2.5,
  pickupExtra: .6,
});

// Read-only gameplay probes, not collision geometry. The central probe remains
// clear because the tire banks are offset diagonally; the outer probes keep the
// spawn lanes open for a vehicle-sized footprint.
const COMBAT_ALPHA_PROBE_CORRIDORS = Object.freeze([
  Object.freeze({ id: "central", x: 0, z: 0, width: 120, depth: 10 }),
  Object.freeze({ id: "outer-north", x: 0, z: -90, width: 198, depth: 10 }),
  Object.freeze({ id: "outer-south", x: 0, z: 90, width: 198, depth: 10 }),
]);

/**
 * Axis-aligned obstacle footprint in Arsenal world units. The existing ramp
 * uses `run` on X and `width` on Z, exactly as the native safe-floor contract.
 */
export function combatAlphaObstacleFootprint(obstacle, clearance = 0) {
  if (!obstacle || !Number.isFinite(clearance) || clearance < 0) return null;
  if (![obstacle.x, obstacle.z].every(Number.isFinite)) return null;
  const width = obstacle.kind === "box" ? obstacle.width
    : obstacle.kind === "closed-convex-wedge" ? obstacle.run : null;
  const depth = obstacle.kind === "box" ? obstacle.depth
    : obstacle.kind === "closed-convex-wedge" ? obstacle.width : null;
  if (![width, depth].every(value => Number.isFinite(value) && value > 0)) return null;
  return Object.freeze({
    minX: obstacle.x - width / 2 - clearance,
    maxX: obstacle.x + width / 2 + clearance,
    minZ: obstacle.z - depth / 2 - clearance,
    maxZ: obstacle.z + depth / 2 + clearance,
  });
}

function footprintFromRect(rect) {
  return Object.freeze({
    minX: rect.x - rect.width / 2,
    maxX: rect.x + rect.width / 2,
    minZ: rect.z - rect.depth / 2,
    maxZ: rect.z + rect.depth / 2,
  });
}

function footprintsOverlap(left, right) {
  return left.minX < right.maxX && left.maxX > right.minX
    && left.minZ < right.maxZ && left.maxZ > right.minZ;
}

/**
 * Combat-alpha's flat floor ends before the floor-to-wall quarter-pipe.
 * Keep a vehicle/pickup's full footprint inside that planar area and outside
 * every obstacle footprint. Coordinates are Arsenal world units (X/Z).
 */
export function isCombatAlphaSafeFloorPoint(point, { clearance = 0, arena = rocketSimArenaProfile(COMBAT_ALPHA_MAP.arena), obstacles = COMBAT_ALPHA_OBSTACLES } = {}) {
  if (!point || !arena || ![point.x, point.z, clearance].every(Number.isFinite) || clearance < 0) return false;
  const inset = Math.max(0, Number(arena.curveRadius) || 0) + clearance;
  if (Math.abs(point.x) >= arena.halfWidth - inset || Math.abs(point.z) >= arena.halfDepth - inset) return false;
  for (const obstacle of obstacles) {
    const footprint = combatAlphaObstacleFootprint(obstacle, clearance);
    if (!footprint || (point.x > footprint.minX && point.x < footprint.maxX
        && point.z > footprint.minZ && point.z < footprint.maxZ)) return false;
  }
  return true;
}

export function combatAlphaMapLayout(map = COMBAT_ALPHA_MAP) {
  const arena = rocketSimArenaProfile(map.arena);
  if (!arena) throw new Error("combat-alpha requires a shared arena profile");
  if (!Array.isArray(map.obstacles) || !Array.isArray(map.spawnSlots) || !Array.isArray(map.pickups)
      || !map.landmarks || !Array.isArray(map.landmarks.teamBeacons) || !Array.isArray(map.landmarks.hazards)) {
    throw new Error("combat-alpha map declaration is invalid");
  }
  const withinBounds = ({ x, z }) => Math.abs(x) < arena.halfWidth && Math.abs(z) < arena.halfDepth;
  const beacons = map.landmarks.teamBeacons.map(beacon => ({
    ...beacon,
    x: arena.halfWidth * beacon.xRatio,
  }));
  const spawnSlots = map.spawnSlots.map(spawn => ({
    ...spawn,
    x: arena.halfWidth * spawn.xRatio,
  }));
  const hazards = map.landmarks.hazards.map(hazard => ({ ...hazard }));
  const obstacles = map.obstacles.map(obstacle => ({ ...obstacle }));
  const pickups = map.pickups.map(pickup => ({
    ...pickup,
    x: arena.halfWidth * pickup.xRatio,
    z: arena.halfDepth * pickup.zRatio,
  }));
  const pickupClearance = pickup => pickup.radius * (56 / 2300) + COMBAT_ALPHA_SAFE_CLEARANCE.pickupExtra;
  const safeSpawn = spawn => isCombatAlphaSafeFloorPoint(spawn, { clearance: COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius, arena, obstacles });
  const safePickup = pickup => isCombatAlphaSafeFloorPoint(pickup, { clearance: pickupClearance(pickup), arena, obstacles });
  const obstacleFootprints = obstacles.map(obstacle => combatAlphaObstacleFootprint(obstacle));
  const flatFloorFootprints = obstacles.map(obstacle => combatAlphaObstacleFootprint(obstacle, COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius));
  const corridors = COMBAT_ALPHA_PROBE_CORRIDORS.map(corridor => Object.freeze({ ...corridor }));
  const corridorFootprints = corridors.map(footprintFromRect);

  if (![...beacons, ...spawnSlots, ...hazards, map.landmarks.centerRing].every(withinBounds)
      || !pickups.every(withinBounds)) {
    throw new Error("combat-alpha map landmark is outside the native arena profile");
  }
  if (new Set(obstacles.map(obstacle => obstacle.id)).size !== obstacles.length
      || obstacles.some((obstacle, index) => {
        const role = obstacle.role ?? "hazard";
        const validRole = role === "hazard" || role === "cover";
        const validCover = role !== "cover" || (["container", "tires"].includes(obstacle.visualKind)
          && typeof obstacle.symmetryGroup === "string" && obstacle.symmetryGroup.length > 0);
        return !validRole || !validCover || !obstacleFootprints[index]
          || !Number.isFinite(obstacle.height) || obstacle.height <= 0;
      })) {
    throw new Error("combat-alpha map obstacle descriptor is invalid");
  }
  if (flatFloorFootprints.some(footprint => !footprint
      || footprint.minX < -arena.halfWidth + arena.curveRadius + COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius
      || footprint.maxX > arena.halfWidth - arena.curveRadius - COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius
      || footprint.minZ < -arena.halfDepth + arena.curveRadius + COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius
      || footprint.maxZ > arena.halfDepth - arena.curveRadius - COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius)) {
    throw new Error("combat-alpha map obstacle is outside the flat floor envelope");
  }
  for (let left = 0; left < obstacleFootprints.length; left += 1) {
    for (let right = left + 1; right < obstacleFootprints.length; right += 1) {
      if (footprintsOverlap(obstacleFootprints[left], obstacleFootprints[right])) {
        throw new Error("combat-alpha map obstacles overlap");
      }
    }
  }
  if (!spawnSlots.every(safeSpawn) || !pickups.every(safePickup)) {
    throw new Error("combat-alpha map obstacle blocks a spawn or pickup");
  }
  const coverGroups = new Map();
  for (const cover of obstacles.filter(obstacle => obstacle.role === "cover")) {
    const group = coverGroups.get(cover.symmetryGroup) || [];
    group.push(cover);
    coverGroups.set(cover.symmetryGroup, group);
  }
  if ([...coverGroups.values()].some(group => group.length !== 2
      || group[0].x !== -group[1].x || group[0].z !== -group[1].z
      || group[0].visualKind !== group[1].visualKind
      || group[0].width !== group[1].width || group[0].depth !== group[1].depth
      || group[0].height !== group[1].height)) {
    throw new Error("combat-alpha cover symmetry is invalid");
  }
  if (corridorFootprints.some(corridor => corridor.minX < -arena.halfWidth + arena.curveRadius
      || corridor.maxX > arena.halfWidth - arena.curveRadius
      || corridor.minZ < -arena.halfDepth + arena.curveRadius
      || corridor.maxZ > arena.halfDepth - arena.curveRadius)
    || corridorFootprints.some(corridor => obstacles.some(obstacle => {
      const expanded = combatAlphaObstacleFootprint(obstacle, COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius);
      return expanded && footprintsOverlap(corridor, expanded);
    }))) {
    throw new Error("combat-alpha cover blocks a required probe corridor");
  }
  return Object.freeze({
    arena,
    beacons: Object.freeze(beacons),
    spawnSlots: Object.freeze(spawnSlots),
    hazards: Object.freeze(hazards),
    obstacles: Object.freeze(obstacles),
    corridors: Object.freeze(corridors),
    pickups: Object.freeze(pickups),
    safeFloor: Object.freeze({
      minX: -arena.halfWidth + arena.curveRadius + COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius,
      maxX: arena.halfWidth - arena.curveRadius - COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius,
      minZ: -arena.halfDepth + arena.curveRadius + COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius,
      maxZ: arena.halfDepth - arena.curveRadius - COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius,
      vehicleRadius: COMBAT_ALPHA_SAFE_CLEARANCE.vehicleRadius,
    }),
  });
}
