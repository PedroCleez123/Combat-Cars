// P2P-WASM-50: single presentation conversion from the shared Arsenal arena
// profile to the native RocketSim pose coordinates used by the P2P envelope.
// This is geometry/readability only; RocketSim remains collision authority.
import {
  rocketSimArenaProfile,
  rocketSimArenaSurfaceFootprint,
  rocketSimArenaVisualSpec,
} from "../../src/rocketsim-arena-profile.js";
import { ROCKETSIM_PRACTICE_SCALE } from "../../src/rocketsim-practice-match.js";

// P2P host snapshots use native RocketSim UU. The existing isolated renderer
// maps those poses to a compact Three.js diagnostic scene with this factor.
export const P2P_WASM_SCENE_UNITS_PER_UU = 1 / 120;
export const P2P_WASM_PRESENTATION_COORDINATE_SPACES = Object.freeze({
  ROCKETSIM_UU: "rocketsim-uu",
  ARSENAL_WORLD: "arsenal-world",
});

function finitePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`${label} debe ser positivo y finito.`);
  return value;
}

export function p2pWasmSceneUnitsFromRocketSim(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("La distancia RocketSim debe ser finita.");
  return value * P2P_WASM_SCENE_UNITS_PER_UU;
}

function presentationUnits(value, coordinateSpace) {
  if (coordinateSpace === P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("La distancia Arsenal debe ser finita.");
    return value;
  }
  if (coordinateSpace === P2P_WASM_PRESENTATION_COORDINATE_SPACES.ROCKETSIM_UU) {
    return p2pWasmSceneUnitsFromRocketSim(value);
  }
  throw new TypeError("El espacio de coordenadas de presentación no existe: " + String(coordinateSpace) + ".");
}

/**
 * Convert a pose component from the coordinate system declared by the host.
 *
 * The diagnostic host publishes native RocketSim units, whereas the full
 * Arsenal match deliberately publishes the same Arsenal-world snapshots that
 * src/client.js already consumes. Keeping this boundary explicit prevents a
 * second accidental scale conversion in the public renderer.
 */
export function p2pWasmPresentationUnits(value, {
  coordinateSpace = P2P_WASM_PRESENTATION_COORDINATE_SPACES.ROCKETSIM_UU,
} = {}) {
  return presentationUnits(value, coordinateSpace);
}

/**
 * Convert the reviewed Arsenal profile through the same physical scale used by
 * the native bridge, then through the renderer's native-uu scene scale.
 */
export function createP2PWasmArenaPresentationSpec(arena = "combat-alpha", {
  coordinateSpace = P2P_WASM_PRESENTATION_COORDINATE_SPACES.ROCKETSIM_UU,
} = {}) {
  const profile = rocketSimArenaProfile(arena);
  if (!profile) throw new RangeError(`El perfil de arena P2P no existe: ${String(arena)}.`);
  const topology = rocketSimArenaVisualSpec(profile);
  const toScene = coordinateSpace === P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD
    ? value => presentationUnits(value, coordinateSpace)
    : value => presentationUnits(value / ROCKETSIM_PRACTICE_SCALE, coordinateSpace);
  const halfWidth = toScene(finitePositive(profile.halfWidth, "halfWidth"));
  const halfDepth = toScene(finitePositive(profile.halfDepth, "halfDepth"));
  const height = toScene(finitePositive(profile.height, "height"));
  const curveRadius = Math.max(0, toScene(Number(profile.curveRadius) || 0));
  // Keep the render topology in this shared presentation spec.  The WASM
  // renderer must not reconstruct a rectangular diagnostic room when the
  // native arena exposes curved floor/wall/ceiling transitions.
  const surfaceFootprint = rocketSimArenaSurfaceFootprint(topology).map(rectangle => Object.freeze({
    x: toScene(rectangle.x),
    z: toScene(rectangle.z),
    width: toScene(rectangle.width),
    depth: toScene(rectangle.depth),
  }));
  const wallSegments = topology.wallSegments.map(segment => Object.freeze({
    side: segment.side,
    axis: segment.axis,
    fixed: toScene(segment.fixed),
    min: toScene(segment.min),
    max: toScene(segment.max),
    minY: toScene(segment.minY),
    maxY: toScene(segment.maxY),
  }));
  return Object.freeze({
    arena,
    coordinateSpace,
    halfWidth,
    halfDepth,
    height,
    width: halfWidth * 2,
    depth: halfDepth * 2,
    curveRadius,
    curvedSides: Object.freeze([...topology.curvedSides]),
    clipCurveEnds: topology.clipCurveEnds === true,
    cornerFillets: topology.cornerFillets === true,
    surfaceFootprint: Object.freeze(surfaceFootprint),
    wallSegments: Object.freeze(wallSegments),
  });
}

