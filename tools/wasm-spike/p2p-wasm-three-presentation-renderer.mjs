// P2P-WASM-44: renderer opt-in for an already-authoritative presentation
// state. Three.js is injected so the browser boundary controls the exact
// module version; this module never advances WASM, sends input, or owns rooms.
import {
  createP2PWasmCameraFramingState,
  resetP2PWasmCameraFramingState,
  stepP2PWasmCameraFrame,
} from "./p2p-wasm-camera-framing.mjs";
import {
  createP2PWasmArenaPresentationSpec,
  P2P_WASM_PRESENTATION_COORDINATE_SPACES,
  p2pWasmPresentationUnits,
} from "./p2p-wasm-arena-presentation.mjs";
import { aimWeaponMountAt } from "../../src/vehicle-visual-model.js";
import { createScrapyardShellMaterial, createScrapyardTireMaterial } from "../../src/arena-scrapyard-material.js";
import { ROCKETSIM_PRACTICE_SCALE } from "../../src/rocketsim-practice-match.js";
import {
  ROCKETSIM_VISUAL_PIVOT_HEIGHT,
  vehicleVisualAlignment,
} from "../../src/vehicle-visual-alignment.js";
import { createArenaDecoration, createCombatAlphaCoverVisuals } from "../../src/arena-decoration.js";
import { getArenaFogSettings, getArenaVisualProfile } from "../../src/arena-visual-profile.js";
import { CAMERA_FOLLOW_TUNING } from "../../src/camera-follow.js";
import { combatAlphaMapLayout } from "../../src/combat-alpha-map.js";
import { collectP2PAimCandidates } from "../../src/p2p-aim-targeting.js";
import { setVehicleAssetTeam } from "../../src/vehicle-asset-loader.js";

export const P2P_WASM_ROCKET_POOL_CAPACITY = 16;
export const P2P_WASM_EXPLOSION_POOL_CAPACITY = 16;
export const P2P_WASM_EVENT_FEEDBACK_CAPACITY = 8;
export const P2P_WASM_ACTION_SERIAL_KINDS = Object.freeze(["jump", "doubleJump", "dodge", "respawn"]);
// Keep the back buffer bounded on high-density displays.  Two device pixels
// per CSS pixel is enough for this presentation while avoiding a quadratic
// increase in fill cost on phones and retina monitors.
export const P2P_WASM_RENDERER_MAX_DPR = 2;
export const P2P_WASM_RENDERER_QUALITY_MODES = Object.freeze(["high", "balanced", "performance"]);
const RENDER_QUALITY = Object.freeze({
  high: Object.freeze({ maxDpr: 2, maxBackBufferPixels: 4_000_000, shadowMapSize: 2048, shadowType: "PCFSoftShadowMap", shadowsEnabled: true }),
  balanced: Object.freeze({ maxDpr: 1.5, maxBackBufferPixels: 2_500_000, shadowMapSize: 1024, shadowType: "PCFShadowMap", shadowsEnabled: true }),
  performance: Object.freeze({ maxDpr: 1, maxBackBufferPixels: 1_500_000, shadowMapSize: 1024, shadowType: "PCFShadowMap", shadowsEnabled: false }),
});
const QUALITY_WARMUP_FRAMES = 18;
const QUALITY_SAMPLE_FRAMES = 36;
const QUALITY_RECOVERY_FRAMES = 108;
const QUALITY_BALANCED_FRAME_MS = 23;
const QUALITY_PERFORMANCE_FRAME_MS = 30;
const QUALITY_RECOVERY_FRAME_MS = 18;
// The online canvas must enter with the same base projection that the shared
// local camera policy resolves to on its first authoritative frame.
const P2P_WASM_CAMERA_BASE_FOV = CAMERA_FOLLOW_TUNING.carBaseFov;

function isFirefoxCanvas(canvas) {
  const userAgent = canvas?.ownerDocument?.defaultView?.navigator?.userAgent
    || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /Firefox\//i.test(String(userAgent));
}

// Matches the local client's rocket presentation. The values are visual-only;
// team selection and projectile transforms still arrive in the validated host state.
const ROCKET_COLOURS = Object.freeze({ blue: 0x88e6ff, red: 0xff8a6d });

const EVENT_FEEDBACK_COLOURS = Object.freeze({
  fire: 0xffb347,
  hit: 0xffed72,
  miss: 0x8fd7ff,
  elimination: 0xff70c8,
  respawn: 0x79eead,
  winner: 0xffdf72,
  round: 0x8fd7ff,
});

/**
 * Firefox and older laptop drivers can reject an antialiased high-performance
 * context even though a conservative WebGL2 context is available. Keep the
 * normal path first, then retry with settings that avoid the most common GPU
 * selection/MSAA failure. The renderer still requires WebGL2 (Three r180), so
 * the final error is intentionally actionable instead of leaving a black
 * canvas with an opaque Three.js exception.
 */
export function createP2PWasmWebGLRenderer(THREE, canvas) {
  // Do not make the default public path request MSAA or a high-performance
  // GPU. On Firefox/AMD that first allocation can create a very large
  // backbuffer and a driver reset is preferable to neither the player nor the
  // browser. The scene's post-processing-free presentation remains crisp
  // without MSAA at the bounded DPR chosen below.
  const attempts = [
    { canvas, antialias: false, powerPreference: "default", preserveDrawingBuffer: false, stencil: false },
    { canvas, antialias: false, powerPreference: "low-power" },
    { canvas, antialias: false, powerPreference: "high-performance" },
  ];
  let lastError = null;
  for (const options of attempts) {
    try { return new THREE.WebGLRenderer(options); }
    catch (error) { lastError = error; }
  }
  const error = new Error("No se pudo crear un contexto WebGL2. Activa la aceleración por hardware y permite WebGL para este sitio.");
  if (lastError) error.cause = lastError;
  error.code = "WEBGL_UNAVAILABLE";
  throw error;
}

function finitePositive(value) { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function rounded(value) { return Number(value.toFixed(2)); }

function createPresentationPool(capacity, createItem) {
  const items = Array.from({ length: capacity }, createItem);
  const available = [...items];
  const active = new Set();
  return {
    acquire() {
      const item = available.pop() || null;
      if (item) active.add(item);
      return item;
    },
    release(item) {
      if (!active.delete(item)) return false;
      available.push(item);
      return true;
    },
    get capacity() { return capacity; },
    get activeCount() { return active.size; },
    get availableCount() { return available.length; },
  };
}

/** Return the scene-space combat-alpha volume used by the presentation. */
export function createP2PWasmPresentationLimits(arenaSpec) {
  if (!arenaSpec || ![arenaSpec.halfWidth, arenaSpec.halfDepth, arenaSpec.height].every(finitePositive)) {
    throw new TypeError("Los límites visuales P2P necesitan una huella de arena positiva.");
  }
  const limits = Object.freeze({
    minX: -arenaSpec.halfWidth,
    maxX: arenaSpec.halfWidth,
    minY: 0,
    maxY: arenaSpec.height,
    minZ: -arenaSpec.halfDepth,
    maxZ: arenaSpec.halfDepth,
  });
  return Object.freeze({
    ...limits,
    readout: `${String(arenaSpec.arena).toUpperCase()} · X ${rounded(limits.minX)}..${rounded(limits.maxX)} · Y ${rounded(limits.minY)}..${rounded(limits.maxY)} · Z ${rounded(limits.minZ)}..${rounded(limits.maxZ)}`,
  });
}

/** Keep the boom/focus camera usable through the enlarged ceiling volume. */
export function p2pWasmCameraVerticalBounds(arenaSpec) {
  if (!arenaSpec || !finitePositive(arenaSpec.height)) {
    return Object.freeze({ minPositionY: 2.8, maxPositionY: 21.2, minFocusY: .8, maxFocusY: 22.2 });
  }
  const extraHeight = Math.max(0, arenaSpec.height - 36);
  return Object.freeze({
    minPositionY: 2.8,
    maxPositionY: 27.2 + extraHeight,
    minFocusY: .8,
    maxFocusY: 28.2 + extraHeight,
  });
}

/** Keep event text as a small, immutable presentation readout. */
export function summarizeP2PWasmEventFeedback(events) {
  if (!Array.isArray(events)) return Object.freeze([]);
  const summary = events.slice(-P2P_WASM_EVENT_FEEDBACK_CAPACITY).map(event => Object.freeze({
    kind: typeof event?.kind === "string" ? event.kind : "system",
    text: typeof event?.text === "string" ? event.text : "",
    at: Number.isFinite(event?.at) ? event.at : null,
  }));
  return Object.freeze(summary);
}

function assertThree(THREE) {
  const required = ["WebGLRenderer", "Scene", "PerspectiveCamera", "BoxGeometry", "CylinderGeometry", "ConeGeometry", "SphereGeometry", "TorusGeometry", "MeshStandardMaterial", "Mesh", "Group", "PointLight", "Line", "LineBasicMaterial", "BufferGeometry", "BufferAttribute"];
  if (!THREE || required.some(name => typeof THREE[name] !== "function")) {
    throw new TypeError("El renderer Three.js causal necesita el namespace completo.");
  }
}

function finite(value) { return typeof value === "number" && Number.isFinite(value); }
const nowSeconds = () => (typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000);

function actionSerial(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function actionPulseColor(team, kind) {
  if (kind === "dodge") return 0xffd06a;
  return team === "red" ? 0xff9c8d : 0x9eeaff;
}

// The flat floor and ceiling end where RocketSim's quarter-pipe begins.
// `surfaceFootprint` also contains side strips for corner coverage; drawing
// those strips as flat planes under the curved shell creates a second surface
// that hides the floor-to-wall transition and catches shadows on a flat plane.
export function createP2PWasmFlatSurfaceFootprint(spec) {
  if (!spec || ![spec.halfWidth, spec.halfDepth].every(finitePositive)) {
    throw new TypeError("La huella plana de arena P2P necesita dimensiones positivas.");
  }
  const radius = Math.max(0, finite(spec.curveRadius) ? spec.curveRadius : 0);
  const sides = radius > 0 ? new Set(spec.curvedSides || []) : new Set();
  const minX = -spec.halfWidth + (sides.has("negativeX") ? radius : 0);
  const maxX = spec.halfWidth - (sides.has("positiveX") ? radius : 0);
  const minZ = -spec.halfDepth + (sides.has("negativeZ") ? radius : 0);
  const maxZ = spec.halfDepth - (sides.has("positiveZ") ? radius : 0);
  if (!(minX < maxX && minZ < maxZ)) throw new RangeError("La huella plana de arena P2P no tiene área.");
  return Object.freeze({
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
    minX,
    maxX,
    minZ,
    maxZ,
  });
}

// Build the same continuous interior used by the local RocketSim client.  It
// is deliberately a presentation-only mesh: all contacts still come from the
// authoritative host.  A single indexed geometry keeps the floor, walls,
// quarter-pipes and corner fillets on one opaque material, so a public client
// cannot expose the old diagnostic BoxGeometry seams at the transitions.
function createP2PWasmUnifiedArenaShell(THREE, spec, profile) {
  const positions = [];
  const indices = [];
  const vertexMap = new Map();
  const keyFor = point => point.map(value => Math.round(value * 1e5) / 1e5).join(",");
  const vertex = point => {
    const key = keyFor(point);
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(point[0], point[1], point[2]);
    vertexMap.set(key, index);
    return index;
  };
  // All patches are one welded shell, so their triangle winding must describe
  // the same interior normal at every shared edge.  The old helper always
  // emitted the same winding even for the four sides; that made two walls
  // face outwards and made the lower arcs oppose the floor normal.  With
  // computeVertexNormals() those opposing faces averaged to a dark stripe at
  // each wall/curve/floor join.  `reverse` changes the winding of both
  // triangles while preserving the existing vertex order and topology.
  const quad = (a, b, c, d, reverse = false) => {
    const base = [vertex(a), vertex(b), vertex(c), vertex(d)];
    if (reverse) indices.push(base[0], base[2], base[1], base[0], base[3], base[2]);
    else indices.push(base[0], base[1], base[2], base[0], base[2], base[3]);
  };
  const { halfWidth, halfDepth, height, curveRadius: radius } = spec;
  let floorWallQuarterPipeMinY = Infinity;
  let floorWallQuarterPipeMaxY = -Infinity;
  const flatFootprint = createP2PWasmFlatSurfaceFootprint(spec);
  const x0 = flatFootprint.minX;
  const x1 = flatFootprint.maxX;
  const z0 = flatFootprint.minZ;
  const z1 = flatFootprint.maxZ;
  // With this coordinate order, the floor's default cross product is -Y
  // and the ceiling's is +Y. Reverse both to face the playable interior.
  quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], true);
  quad([x0, height, z1], [x1, height, z1], [x1, height, z0], [x0, height, z0], true);
  for (const segment of spec.wallSegments || []) {
    // Positive-X and positive-Z walls are traversed with the outward order
    // above; reverse those faces so all four wall normals point into the
    // playable volume.  The named side is authoritative, while the fixed
    // coordinate fallback keeps custom specs backwards-compatible.
    const reverseWall = segment.side
      ? segment.side === "positiveX" || segment.side === "positiveZ"
      : segment.fixed > 0;
    if (segment.axis === "z") {
      quad([segment.fixed, segment.minY, segment.min], [segment.fixed, segment.maxY, segment.min], [segment.fixed, segment.maxY, segment.max], [segment.fixed, segment.minY, segment.max], reverseWall);
    } else {
      quad([segment.min, segment.minY, segment.fixed], [segment.max, segment.minY, segment.fixed], [segment.max, segment.maxY, segment.fixed], [segment.min, segment.maxY, segment.fixed], reverseWall);
    }
  }
  if (radius > 0) {
    const sides = spec.curvedSides || [];
    const sidePoint = (side, theta, extrusion, centerY) => {
      const radial = radius * Math.cos(theta);
      const y = centerY + radius * Math.sin(theta);
      if (side === "positiveX") return [halfWidth - radius + radial, y, extrusion];
      if (side === "negativeX") return [-halfWidth + radius - radial, y, extrusion];
      if (side === "positiveZ") return [extrusion, y, halfDepth - radius + radial];
      return [extrusion, y, -halfDepth + radius - radial];
    };
    for (const side of sides) {
      const xAxis = side === "positiveX" || side === "negativeX";
      const inset = spec.clipCurveEnds ? radius : 0;
      const extrusionMin = -(xAxis ? halfDepth : halfWidth) + inset;
      const extrusionMax = (xAxis ? halfDepth : halfWidth) - inset;
      const segments = 32;
      for (let index = 0; index < segments; index += 1) {
        const t0 = -Math.PI / 2 + Math.PI / 2 * index / segments;
        const t1 = -Math.PI / 2 + Math.PI / 2 * (index + 1) / segments;
        // Center the lower quarter-pipe at y=radius so its arc runs from the
        // floor (theta=-PI/2) up to the wall (theta=0). Centering it at zero
        // puts the entire curve below the floor and leaves a flat strip above.
        const lowerQuarterPipe = [
          sidePoint(side, t0, extrusionMin, radius),
          sidePoint(side, t1, extrusionMin, radius),
          sidePoint(side, t1, extrusionMax, radius),
          sidePoint(side, t0, extrusionMax, radius),
        ];
        for (const point of lowerQuarterPipe) {
          floorWallQuarterPipeMinY = Math.min(floorWallQuarterPipeMinY, point[1]);
          floorWallQuarterPipeMaxY = Math.max(floorWallQuarterPipeMaxY, point[1]);
        }
        // At the floor edge the default order points down on +X/-Z and up
        // on -X/+Z.  Reverse only the former pair so every lower arc blends
        // into the floor's +Y normal.  The upper order is the complementary
        // wall-to-ceiling traversal: -X/+Z need reversing to meet their
        // inward wall normals while +X/-Z already agree.
        const lowerReverse = side === "positiveX" || side === "negativeZ";
        quad(...lowerQuarterPipe, lowerReverse);
        const upperReverse = side === "negativeX" || side === "positiveZ";
        quad(sidePoint(side, t0 + Math.PI / 2, extrusionMax, height - radius), sidePoint(side, t1 + Math.PI / 2, extrusionMax, height - radius), sidePoint(side, t1 + Math.PI / 2, extrusionMin, height - radius), sidePoint(side, t0 + Math.PI / 2, extrusionMin, height - radius), upperReverse);
      }
    }
    if (spec.cornerFillets) {
      const cornerSegments = 16;
      const addCornerPatch = (sx, sz, point) => {
        const centerX = sx * (halfWidth - radius);
        const centerZ = sz * (halfDepth - radius);
        for (let ti = 0; ti < 32; ti += 1) for (let pi = 0; pi < cornerSegments; pi += 1) {
          const t0 = point.t0(ti), t1 = point.t0(ti + 1);
          const p0 = point.value(centerX, centerZ, t0, pi / cornerSegments);
          const p1 = point.value(centerX, centerZ, t1, pi / cornerSegments);
          const p2 = point.value(centerX, centerZ, t1, (pi + 1) / cornerSegments);
          const p3 = point.value(centerX, centerZ, t0, (pi + 1) / cornerSegments);
          // The same-sign corners are traversed with the outward order on
          // both floor and ceiling fillets; flip them to keep the interior
          // normal continuous with the adjoining side arcs.
          quad(p0, p1, p2, p3, sx * sz > 0);
        }
      };
      for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        const centerX = sx * (halfWidth - radius);
        const centerZ = sz * (halfDepth - radius);
        addCornerPatch(sx, sz, {
          t0: index => -Math.PI / 2 + Math.PI / 2 * index / 32,
          value: (cx, cz, theta, fraction) => [cx + sx * radius * Math.cos(theta) * Math.cos(Math.PI / 2 * fraction), radius + radius * Math.sin(theta), cz + sz * radius * Math.cos(theta) * Math.sin(Math.PI / 2 * fraction)],
        });
        for (let vi = 0; vi < 2; vi += 1) for (let pi = 0; pi < cornerSegments; pi += 1) {
          const y0 = radius + (height - radius * 2) * vi / 2;
          const y1 = radius + (height - radius * 2) * (vi + 1) / 2;
          const phi0 = Math.PI / 2 * pi / cornerSegments;
          const phi1 = Math.PI / 2 * (pi + 1) / cornerSegments;
          const point = (phi, y) => [centerX + sx * radius * Math.cos(phi), y, centerZ + sz * radius * Math.sin(phi)];
          quad(point(phi0, y0), point(phi0, y1), point(phi1, y1), point(phi1, y0), sx * sz > 0);
        }
        for (let ti = 0; ti < 32; ti += 1) for (let pi = 0; pi < cornerSegments; pi += 1) {
          const t0 = Math.PI / 2 * ti / 32;
          const t1 = Math.PI / 2 * (ti + 1) / 32;
          const phi0 = Math.PI / 2 * pi / cornerSegments;
          const phi1 = Math.PI / 2 * (pi + 1) / cornerSegments;
          const point = (theta, phi) => [centerX + sx * radius * Math.cos(theta) * Math.cos(phi), height - radius + radius * Math.sin(theta), centerZ + sz * radius * Math.cos(theta) * Math.sin(phi)];
          quad(point(t0, phi0), point(t1, phi0), point(t1, phi1), point(t0, phi1), sx * sz > 0);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals?.();
  // `buildWorld` consumes these profile values for the local RocketSim path.
  // Do not maintain a second, hard-coded online palette: it made the same
  // collision shell look flatter and darker than its local counterpart.
  const surface = profile?.surface || {};
  const surfaceMaterial = Object.freeze({
    color: surface.materialColor ?? profile?.steel ?? 0x496f78,
    emissive: surface.materialEmissive ?? profile?.boundaryGlow ?? 0x16333b,
    emissiveIntensity: surface.materialEmissiveIntensity ?? profile?.boundaryGlowIntensity ?? .16,
    metalness: surface.materialMetalness ?? .2,
    roughness: surface.materialRoughness ?? .74,
  });
  const material = new THREE.MeshStandardMaterial({
    ...surfaceMaterial,
    side: THREE.DoubleSide ?? THREE.BackSide ?? 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "arena-unified-shell";
  mesh.receiveShadow = true;
  // Keep the public contract stable while exposing the stronger topology as
  // a separate metric for smoke tests and release diagnostics.
  mesh.userData.presentationSurface = "unified-interior-shell-v1";
  mesh.userData.presentationTopology = "continuous-floor-wall-ceiling-curves";
  mesh.userData.vertexCount = positions.length / 3;
  mesh.userData.flatSurfaceFootprint = flatFootprint;
  mesh.userData.floorWallQuarterPipeVerticalBounds = radius > 0 && Number.isFinite(floorWallQuarterPipeMinY)
    ? Object.freeze({ minY: floorWallQuarterPipeMinY, maxY: floorWallQuarterPipeMaxY })
    : null;
  mesh.userData.interiorNormalContract = "floor:+Y;ceiling:-Y;walls:inward;curves:floor-to-wall-to-ceiling;corners:inward";
  mesh.userData.surfaceMaterial = surfaceMaterial;
  mesh.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return mesh;
}

function disposeVisualRoot(root, { skipMaterials = null } = {}) {
  root?.traverse?.(child => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(material => {
      if (!skipMaterials?.has(material)) material?.dispose?.();
    });
    else if (!skipMaterials?.has(child.material)) child.material?.dispose?.();
  });
}

// Keep the public arena recognizable as Arsenal: the native block and wedge
// are visual companions of the same combat-alpha colliders, while beacons,
// pads and suspended industrial fixtures come from arena-decoration.js. None
// of this overlay is authoritative or used for collision.
function createCombatObstacleVisuals(THREE, spec, profile, materials = {}) {
  const root = new THREE.Group();
  root.name = "p2p-combat-alpha-obstacles";
  root.userData = {
    visualOnly: true,
    role: "combat-alpha-obstacles",
    materialContract: "art-03-scrapyard-with-opaque-fallback",
    nativeColliderContract: "combat-alpha-map-v1",
  };
  // Obstacles are authored in Arsenal units and remain the same size when the
  // surrounding arena grows; only their shared arena-relative locations move
  // with the world volume. Scaling them would desynchronise visual and native
  // hitboxes.
  const sx = 1;
  const sz = 1;
  const sy = 1;
  const body = materials.body || new THREE.MeshStandardMaterial({
    color: profile.obstacles?.body ?? 0x5b7478,
    emissive: profile.obstacles?.bodyEmissive ?? 0x102a2f,
    emissiveIntensity: profile.obstacles?.bodyEmissiveIntensity ?? .34,
    roughness: .86,
    metalness: .12,
    side: THREE.DoubleSide ?? THREE.BackSide ?? 1,
  });
  const cap = materials.cap || new THREE.MeshStandardMaterial({
    color: profile.obstacles?.cap ?? 0xa47d38,
    emissive: profile.obstacles?.capEmissive ?? 0x3b2409,
    emissiveIntensity: profile.obstacles?.capEmissiveIntensity ?? .22,
    roughness: .78,
    metalness: .52,
    side: THREE.DoubleSide ?? THREE.BackSide ?? 1,
  });
  const block = new THREE.Mesh(new THREE.BoxGeometry(14 * sx, 3.25 * sy, 18 * sz), body);
  block.position.set(0, 1.625 * sy, -20 * sz);
  block.name = "central-block-visual";
  block.userData = {
    visualOnly: true,
    nativeDimensions: Object.freeze({ width: 14, height: 3.25, depth: 18 }),
    nativePosition: Object.freeze({ x: 0, z: -20 }),
  };
  block.castShadow = true;
  block.receiveShadow = true;
  root.add(block);
  const blockCap = new THREE.Mesh(new THREE.BoxGeometry(14.2 * sx, .16 * sy, 18.2 * sz), cap);
  blockCap.position.set(0, 3.33 * sy, -20 * sz);
  blockCap.castShadow = true;
  blockCap.receiveShadow = true;
  root.add(blockCap);
  const vertices = new Float32Array([
    -10 * sx, 0, -9 * sz, 10 * sx, 0, -9 * sz, -10 * sx, 0, 9 * sz,
    10 * sx, 0, 9 * sz, 10 * sx, 3.5 * sy, -9 * sz, 10 * sx, 3.5 * sy, 9 * sz,
  ]);
  const indices = [0, 2, 1, 1, 2, 3, 0, 1, 4, 2, 5, 3, 1, 3, 5, 1, 5, 4, 0, 4, 5, 0, 5, 2];
  const rampGeometry = new THREE.BufferGeometry();
  rampGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  rampGeometry.setIndex(indices);
  rampGeometry.computeVertexNormals?.();
  const ramp = new THREE.Mesh(rampGeometry, body);
  ramp.position.set(0, 0, 20 * sz);
  ramp.name = "south-ramp-visual";
  ramp.userData = {
    visualOnly: true,
    nativeDimensions: Object.freeze({ run: 20, width: 18, height: 3.5 }),
    nativePosition: Object.freeze({ x: 0, z: 20 }),
  };
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  root.add(ramp);
  return root;
}

function makeVehicle(THREE, car, color) {
  // First paint remains a compact, deterministic fallback. In a browser the
  // renderer asynchronously promotes it to the same authored Three.js model
  // used by the local client; physics and network authority stay untouched.
  const root = new THREE.Group();
  root.name = `p2p-combat-car-${car.id}`;
  const fallback = new THREE.Group();
  fallback.name = "p2p-procedural-fallback";
  // The final authored GLTF is the only normal production paint. The compact
  // procedural group is retained as a recovery path, but stays out of the
  // scene while the asset request is pending so the two models never overlap.
  fallback.visible = false;
  root.add(fallback);
  const materials = {
    body: new THREE.MeshStandardMaterial({ color, metalness: .42, roughness: .34 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x101820, metalness: .18, roughness: .72 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xffa32f, emissive: 0x4d1900, emissiveIntensity: .7, metalness: .3, roughness: .28 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x9be9ff, emissive: 0x246d92, emissiveIntensity: 1.45, roughness: .15 }),
    flame: new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff5b00, emissiveIntensity: 2.1, roughness: .18 }),
    trail: new THREE.MeshStandardMaterial({ color: color === 0xf05b66 ? 0xff785a : 0x68ddff, emissive: color === 0xf05b66 ? 0xd03d43 : 0x168ed3, emissiveIntensity: 2.2, transparent: true, opacity: .78, depthWrite: false }),
  };
  const geometries = [];
  const weaponMountGeometries = [];
  const wheels = [];
  const boostFlames = [];
  const add = (geometry, material, position, rotation = null) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    fallback.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(2.85, .58, 1.5), materials.body, [0, .62, 0]);
  add(new THREE.BoxGeometry(1.18, .5, 1.18), materials.dark, [-.25, 1.08, 0]);
  add(new THREE.BoxGeometry(.92, .06, .16), materials.accent, [.55, .93, 0]);
  add(new THREE.BoxGeometry(1.12, .08, 1.56), materials.body, [-1.03, 1.48, 0]);
  add(new THREE.BoxGeometry(.12, .26, 1.72), materials.accent, [-1.03, 1.38, 0]);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(.12, .12, .34), materials.lamp, [1.45, .68, side * .48]);
    add(new THREE.BoxGeometry(.35, .16, .22), materials.accent, [-1.5, .92, side * .37]);
    const flame = add(new THREE.BoxGeometry(.72, .14, .16), materials.flame, [-1.9, .82, side * .37]);
    flame.visible = false;
    boostFlames.push(flame);
  }
  // Preserve the local superspeed silhouette while the authored vehicle
  // asset is loading. The group is driven below only by `car.supersonic` and
  // its authoritative speed, never by local integration or held boost.
  const speedTrails = new THREE.Group();
  speedTrails.name = "speed-trails";
  speedTrails.visible = false;
  for (const side of [-1, 1]) {
    const geometry = new THREE.ConeGeometry(.11, 3.4, 8);
    geometries.push(geometry);
    const trail = new THREE.Mesh(geometry, materials.trail);
    trail.name = `speed-trail-${side < 0 ? "left" : "right"}`;
    trail.rotation.z = Math.PI / 2;
    trail.position.set(-3.5, .84, side * .57);
    speedTrails.add(trail);
  }
  fallback.add(speedTrails);
  const health = new THREE.Group();
  health.name = "health-bar";
  health.position.set(0, 2.65, 0);
  const healthBackGeometry = new THREE.BoxGeometry(1.65, .12, .12);
  const healthFillGeometry = new THREE.BoxGeometry(1.55, .08, .08);
  geometries.push(healthBackGeometry, healthFillGeometry);
  const healthBack = new THREE.Mesh(healthBackGeometry, materials.dark);
  const healthFill = new THREE.Mesh(healthFillGeometry, materials.accent);
  health.add(healthBack, healthFill);
  fallback.add(health);
  add(new THREE.CylinderGeometry(.22, .22, .14, 10), materials.dark, [.25, 1.48, 0]);
  add(new THREE.BoxGeometry(1.05, .12, .16), materials.dark, [.84, 1.54, 0]);
  for (const [x, z] of [[1.02, -.84], [1.02, .84], [-1.02, -.84], [-1.02, .84]]) {
    const tyre = add(new THREE.CylinderGeometry(.39, .28, 12), materials.dark, [x, .42, z], [Math.PI / 2, 0, 0]);
    wheels.push(tyre);
  }
  // Keep the roof launcher addressable before the authored skin is ready. The
  // mount is a presentation-only child of the vehicle root, so hiding the
  // fallback chassis during authored promotion does not move or duplicate it.
  const weaponMountRoot = new THREE.Group();
  weaponMountRoot.name = "weapon-mount";
  weaponMountRoot.position.set(.48, 1.76, 0);
  root.add(weaponMountRoot);
  const weaponBaseGeometry = new THREE.CylinderGeometry(.34, .34, .12, 16);
  weaponMountGeometries.push(weaponBaseGeometry);
  const weaponBase = new THREE.Mesh(weaponBaseGeometry, materials.dark);
  weaponBase.name = "weapon-mount-base";
  weaponBase.position.y = .05;
  weaponMountRoot.add(weaponBase);
  const weaponTurret = new THREE.Group();
  weaponTurret.name = "weapon-turret";
  weaponTurret.position.y = .12;
  weaponMountRoot.add(weaponTurret);
  const weaponHousingGeometry = new THREE.BoxGeometry(.68, .3, .6);
  weaponMountGeometries.push(weaponHousingGeometry);
  const weaponHousing = new THREE.Mesh(weaponHousingGeometry, materials.dark);
  weaponHousing.name = "weapon-turret-housing";
  weaponHousing.position.y = .16;
  weaponTurret.add(weaponHousing);
  const weaponBarrelGeometry = new THREE.CylinderGeometry(.105, .105, 1.55, 12);
  weaponMountGeometries.push(weaponBarrelGeometry);
  const weaponBarrel = new THREE.Mesh(weaponBarrelGeometry, materials.dark);
  weaponBarrel.name = "weapon-barrel";
  weaponBarrel.rotation.z = -Math.PI / 2;
  weaponBarrel.position.set(.82, .16, 0);
  weaponTurret.add(weaponBarrel);
  const weaponMuzzle = new THREE.Group();
  weaponMuzzle.name = "weapon-muzzle";
  weaponMuzzle.position.set(1.62, .16, 0);
  weaponTurret.add(weaponMuzzle);
  const weaponMount = {
    root: weaponMountRoot,
    base: weaponBase,
    turret: weaponTurret,
    housing: weaponHousing,
    barrel: weaponBarrel,
    muzzle: weaponMuzzle,
  };
  // This is the same short movement cue used by the local Three.js client.
  // It is driven exclusively by already-decoded action serials in update(),
  // never by input, velocity thresholds, or a local physics prediction.
  const actionPulseGeometry = new THREE.TorusGeometry(.78, .045, 6, 18);
  const actionPulseMaterial = new THREE.MeshStandardMaterial({
    color: actionPulseColor(car.team, "jump"),
    emissive: actionPulseColor(car.team, "jump"),
    emissiveIntensity: 2.2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const actionPulse = new THREE.Mesh(actionPulseGeometry, actionPulseMaterial);
  actionPulse.name = "action-pulse";
  actionPulse.rotation.x = Math.PI / 2;
  actionPulse.position.y = .18;
  actionPulse.visible = false;
  root.add(actionPulse);
  root.userData = {
    fallback,
    telemetry: { id: car.id, surfaceType: car.surfaceType, boost: car.boost },
    wheels,
    boostFlames,
    speedTrails,
    health,
    healthFill,
    setHealth(value) {
      const ratio = Math.max(.02, Math.min(1, finite(value) ? value / 100 : 0));
      healthFill.scale.x = ratio;
      healthFill.position.x = -.775 * (1 - ratio);
      return ratio;
    },
    weaponMount,
    fallbackWeaponMount: weaponMount,
    weaponMountGeometries,
    actionPulse,
    actionPulseRemaining: 0,
    actionSerials: { ...(car.actionSerials || {}) },
    lastActionKind: null,
    visualContract: "combat-rally-lite-v1",
    partCount: geometries.length,
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      weaponMountGeometries.forEach(geometry => geometry.dispose());
      actionPulseGeometry.dispose();
      actionPulseMaterial.dispose();
      Object.values(materials).forEach(material => material.dispose());
    },
  };
  return root;
}

/** Create a disposable, presentation-only Three.js surface. */
export function createP2PWasmThreePresentationRenderer({
  THREE,
  canvas,
  width = 640,
  height = 360,
  focusCarId: initialFocusCarId = null,
  targetCarId = null,
  coordinateSpace = P2P_WASM_PRESENTATION_COORDINATE_SPACES.ROCKETSIM_UU,
  diagnosticsReadback = false,
  qualityMode = "auto",
  effectPrewarmMode = "deferred",
  nowFn = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  onContextStateChange = null,
} = {}) {
  assertThree(THREE);
  if (!canvas || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 64 || height < 36) {
    throw new TypeError("La superficie Three.js causal necesita canvas y dimensiones válidas.");
  }
  // The full public host publishes Arsenal-world snapshots, while the
  // isolated legacy fixture publishes raw RocketSim UU. Keep the conversion
  // explicit so both renderers cannot silently mix coordinate systems.
  p2pWasmPresentationUnits(0, { coordinateSpace });
  const toScene = value => p2pWasmPresentationUnits(value, { coordinateSpace });
  // The playable route gets one normal back-buffer render. Diagnostics are
  // strictly opt-in: the tiny target/readback below is never allocated for
  // the public game path because synchronous GPU readback can stall a shot.
  const renderer = createP2PWasmWebGLRenderer(THREE, canvas);
  if (qualityMode !== "auto" && !P2P_WASM_RENDERER_QUALITY_MODES.includes(qualityMode)) {
    throw new TypeError("El modo de calidad Three.js causal no es válido.");
  }
  if (!["deferred", "eager"].includes(effectPrewarmMode)) {
    throw new TypeError("El modo de precalentamiento visual no es válido.");
  }
  if (typeof nowFn !== "function") throw new TypeError("El reloj del renderer causal no es válido.");
  // `auto` means a safe, bounded baseline rather than speculative visual
  // escalation. This removes the high-DPR + 2048-shadow startup spike that
  // can make Firefox/AMD reset its driver. `high` remains available only as an
  // explicit opt-in for controlled environments.
  let activeQuality = qualityMode === "auto" ? (isFirefoxCanvas(canvas) ? "performance" : "balanced") : qualityMode;
  let qualityFrameCount = 0;
  let qualitySampleTotalMs = 0;
  let qualityDowngrades = 0;
  let qualityUpgrades = 0;
  let qualityLastFrameMs = null;
  let qualityAverageFrameMs = null;
  let qualityPreviousFrameAt = null;
  let qualityHealthyFrames = 0;
  let qualityDprCap = RENDER_QUALITY[activeQuality].maxDpr;
  const diagnosticsRequested = diagnosticsReadback === true
    && typeof THREE.WebGLRenderTarget === "function"
    && typeof renderer.readRenderTargetPixels === "function";
  const diagnosticsTarget = diagnosticsRequested ? new THREE.WebGLRenderTarget(8, 8) : null;
  let diagnosticsPixelDiversity = 0;
  const view = canvas.ownerDocument?.defaultView
    || (typeof window !== "undefined" ? window : null);
  let viewportWidth = 0;
  let viewportHeight = 0;
  let pixelRatio = 0;
  let resizeApplyCount = 0;
  let resizeObserver = null;
  let windowResizeAttached = false;
  let resizeFrame = null;
  let pendingResizeEntry = null;
  let camera = null;
  let closed = false;
  let focusCarId = typeof initialFocusCarId === "string" && initialFocusCarId.length > 0 ? initialFocusCarId : null;
  let contextState = "ready";
  let contextLossCount = 0;
  let contextRestoreCount = 0;
  let renderErrorCount = 0;
  let lastRenderError = null;

  const readDevicePixelRatio = (cssWidth = viewportWidth || width, cssHeight = viewportHeight || height) => {
    const candidate = Number(view?.devicePixelRatio);
    if (!Number.isFinite(candidate) || candidate <= 0) return 1;
    const requested = Math.min(P2P_WASM_RENDERER_MAX_DPR, qualityDprCap, Math.max(1, candidate));
    const pixels = Math.max(1, Number(cssWidth) || 1) * Math.max(1, Number(cssHeight) || 1);
    const pixelCap = RENDER_QUALITY[activeQuality].maxBackBufferPixels;
    const bounded = Math.sqrt(pixelCap / pixels);
    return Math.max(.25, Math.min(requested, bounded));
  };

  // The CSS canvas fills the game shell, including portrait viewports. The
  // drawing buffer must follow its actual displayed rectangle; forcing a
  // 16:9 buffer here would stretch the rendered world on a narrow screen.
  const normalizeViewport = (rawWidth, rawHeight) => {
    let nextWidth = Number(rawWidth);
    let nextHeight = Number(rawHeight);
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) nextWidth = viewportWidth || width;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) nextHeight = viewportHeight || height;
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) nextWidth = width;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) nextHeight = height;
    return {
      width: Math.max(1, Math.round(nextWidth)),
      height: Math.max(1, Math.round(nextHeight)),
    };
  };

  const readViewport = (hintWidth, hintHeight) => {
    let nextWidth = Number(hintWidth);
    let nextHeight = Number(hintHeight);
    if (!(nextWidth > 0 && nextHeight > 0)) {
      const rect = canvas.getBoundingClientRect?.();
      if (!(nextWidth > 0)) nextWidth = Number(rect?.width);
      if (!(nextHeight > 0)) nextHeight = Number(rect?.height);
    }
    if (!(nextWidth > 0)) nextWidth = Number(canvas.clientWidth);
    if (!(nextHeight > 0)) nextHeight = Number(canvas.clientHeight);
    if (!(nextWidth > 0)) nextWidth = Number(view?.innerWidth);
    if (!(nextHeight > 0)) nextHeight = Number(view?.innerHeight);
    return normalizeViewport(nextWidth, nextHeight);
  };

  const applyViewportSize = (hintWidth, hintHeight) => {
    if (closed) return false;
    const next = readViewport(hintWidth, hintHeight);
    const nextPixelRatio = readDevicePixelRatio(next.width, next.height);
    const sizeChanged = next.width !== viewportWidth || next.height !== viewportHeight;
    const dprChanged = nextPixelRatio !== pixelRatio;
    if (!sizeChanged && !dprChanged) return false;
    if (dprChanged) {
      renderer.setPixelRatio(nextPixelRatio);
      pixelRatio = nextPixelRatio;
    }
    if (sizeChanged) {
      renderer.setSize(next.width, next.height, false);
      viewportWidth = next.width;
      viewportHeight = next.height;
      if (camera) {
        camera.aspect = viewportWidth / viewportHeight;
        camera.updateProjectionMatrix();
      }
    }
    resizeApplyCount += 1;
    return true;
  };

  const applyShadowQuality = () => {
    const quality = RENDER_QUALITY[activeQuality];
    if (!renderer.shadowMap) return;
    renderer.shadowMap.enabled = quality.shadowsEnabled;
    if (typeof renderer.shadowMap.mapSize?.set === "function") {
      renderer.shadowMap.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    }
    const shadowType = THREE[quality.shadowType];
    if (shadowType !== undefined) renderer.shadowMap.type = shadowType;
    renderer.shadowMap.needsUpdate = true;
  };

  const applyLightingQuality = () => {
    // Point lights are a disproportionate fragment cost on Firefox's WebGL
    // path. Keep the authored world readable with the hemisphere/key light,
    // but remove decorative point-light volume from the safest tier.
    const disablePointLights = activeQuality === "performance";
    scene?.traverse?.(object => {
      if (!object?.isLight || object === key) return;
      if (object.type === "PointLight" || object.userData?.role === "team-wash" || object.userData?.role === "team-beacon") {
        object.visible = !disablePointLights;
      }
    });
  };

  const setQuality = (nextQuality, { force = false } = {}) => {
    if ((!force && qualityMode !== "auto") || activeQuality === nextQuality) return false;
    activeQuality = nextQuality;
    qualityDprCap = RENDER_QUALITY[activeQuality].maxDpr;
    applyViewportSize();
    applyShadowQuality();
    applyLightingQuality();
    key.castShadow = RENDER_QUALITY[activeQuality].shadowsEnabled;
    return true;
  };

  const recordFrame = timestamp => {
    if (closed || qualityMode !== "auto" || diagnosticsTarget || !Number.isFinite(timestamp)) return false;
    if (qualityPreviousFrameAt !== null) {
      const elapsedMs = timestamp - qualityPreviousFrameAt;
      if (!(elapsedMs > 0) || elapsedMs > 250) {
        qualityFrameCount = 0;
        qualitySampleTotalMs = 0;
        qualityHealthyFrames = 0;
        qualityPreviousFrameAt = timestamp;
        return false;
      }
      qualityLastFrameMs = elapsedMs;
      qualityFrameCount += 1;
      if (qualityFrameCount > QUALITY_WARMUP_FRAMES) {
        qualitySampleTotalMs += elapsedMs;
        const sampleFrames = qualityFrameCount - QUALITY_WARMUP_FRAMES;
        if (sampleFrames >= QUALITY_SAMPLE_FRAMES) {
          qualityAverageFrameMs = qualitySampleTotalMs / sampleFrames;
          qualityFrameCount = QUALITY_WARMUP_FRAMES;
          qualitySampleTotalMs = 0;
          if (activeQuality === "high" && qualityAverageFrameMs >= QUALITY_BALANCED_FRAME_MS) {
            if (setQuality("balanced")) qualityDowngrades += 1;
            qualityHealthyFrames = 0;
          } else if (activeQuality === "balanced" && qualityAverageFrameMs >= QUALITY_PERFORMANCE_FRAME_MS) {
            if (setQuality("performance")) qualityDowngrades += 1;
            qualityHealthyFrames = 0;
          } else if (qualityAverageFrameMs <= QUALITY_RECOVERY_FRAME_MS) {
            qualityHealthyFrames += sampleFrames;
            if (qualityHealthyFrames >= QUALITY_RECOVERY_FRAMES) {
              // A short healthy rAF cadence cannot prove that a GPU is safe at
              // a higher load. Auto-quality may recover performance ->
              // balanced, but never escalates the public match to high.
              const nextQuality = activeQuality === "performance" ? "balanced" : activeQuality;
              if (nextQuality !== activeQuality && setQuality(nextQuality)) qualityUpgrades += 1;
              qualityHealthyFrames = 0;
            }
          } else {
            qualityHealthyFrames = 0;
          }
        }
      }
    }
    qualityPreviousFrameAt = timestamp;
    return true;
  };

  // Apply the initial size through the same guarded path as later resizes so
  // hidden canvases and deterministic test doubles get one consistent setup.
  applyViewportSize();
  const combatVisualProfile = getArenaVisualProfile("combat-alpha");
  if (renderer.shadowMap) {
    applyShadowQuality();
  }
  if ("SRGBColorSpace" in THREE) renderer.outputColorSpace = THREE.SRGBColorSpace;
  if ("ACESFilmicToneMapping" in THREE) renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = combatVisualProfile.lighting?.exposure ?? 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(combatVisualProfile.background);
  const initialFog = getArenaFogSettings(combatVisualProfile);
  scene.fog = initialFog ? new THREE.Fog(initialFog.color, initialFog.near, initialFog.far) : null;
  scene.add(new THREE.HemisphereLight(
    combatVisualProfile.lighting?.hemisphereSky ?? 0xb8d8eb,
    combatVisualProfile.lighting?.hemisphereGround ?? 0x102018,
    combatVisualProfile.lighting?.hemisphere ?? 2.1,
  ));
  const key = new THREE.DirectionalLight(0xffe2b0, combatVisualProfile.lighting?.sun ?? 3.45);
  key.position.set(-35, 55, 32);
  key.castShadow = RENDER_QUALITY[activeQuality].shadowsEnabled;
  key.shadow?.mapSize?.set?.(2048, 2048);
  if (key.shadow?.camera) {
    key.shadow.camera.left = -80;
    key.shadow.camera.right = 80;
    key.shadow.camera.top = 65;
    key.shadow.camera.bottom = -65;
  }
  scene.add(key);

  let arenaBounds = null;
  let arenaObstacles = null;
  let arenaObstacleSkin = null;
  let arenaObstacleMaterial = null;
  let arenaObstacleHazardBand = null;
  let arenaCoverSkin = null;
  let arenaCovers = null;
  let arenaDecoration = null;
  let arenaSpec = null;
  let arenaLimits = null;
  // Vehicle roots follow stable player identity. Snapshot order may change as
  // guests join or leave, but it never changes which GLTF belongs to a pilot.
  const cars = new Map();
  const rocketBodyGeometry = new THREE.SphereGeometry(.4, 12, 8);
  const rocketTrailGeometry = new THREE.ConeGeometry(.22, 1.35, 10);
  const explosionCoreGeometry = new THREE.SphereGeometry(.34, 14, 10);
  const explosionSparkGeometry = new THREE.SphereGeometry(1, 7, 6);
  const rocketMaterials = Object.freeze(Object.fromEntries(Object.entries(ROCKET_COLOURS).map(([team, colour]) => [team, Object.freeze({
    body: new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 1.4, metalness: .65, roughness: .22 }),
    trail: new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 2, transparent: true, opacity: .72, depthWrite: false, metalness: .15, roughness: .25 }),
  })])));
  const explosionMaterials = Object.freeze(Object.fromEntries(Object.entries(ROCKET_COLOURS).map(([team, colour]) => [team,
    new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 2 }),
  ])));
  const explosionCoreMaterials = [];
  const eventGeometry = new THREE.BoxGeometry(.46, .18, .46);
  const eventMaterials = Object.freeze(Object.fromEntries(
    Object.entries(EVENT_FEEDBACK_COLOURS).map(([kind, color]) => [kind,
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.25, metalness: .05, roughness: .3 }),
    ]),
  ));
  // Metadata markers are visual-only. Their position and active state come
  // from the validated host envelope; they never alter the simulation.
  const pickupGeometry = new THREE.CylinderGeometry(.55, .55, .10, 12);
  const pickupMaterials = Object.freeze({
    active: new THREE.MeshStandardMaterial({ color: 0xffc45c, emissive: 0x8a4a0c, emissiveIntensity: 1.35, metalness: .1, roughness: .35 }),
    inactive: new THREE.MeshStandardMaterial({ color: 0x42545b, emissive: 0x101a1e, emissiveIntensity: .2, metalness: .1, roughness: .8 }),
  });
  const rocketPool = createPresentationPool(P2P_WASM_ROCKET_POOL_CAPACITY, () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(rocketBodyGeometry, rocketMaterials.blue.body);
    const trail = new THREE.Mesh(rocketTrailGeometry, rocketMaterials.blue.trail);
    const light = new THREE.PointLight(ROCKET_COLOURS.blue, 4.5, 10);
    trail.rotation.x = Math.PI / 2;
    trail.position.z = .78;
    root.add(body, trail, light);
    root.visible = false;
    root.name = "p2p-rocket";
    root.userData = { feedback: "rocket", body, trail, light, colour: ROCKET_COLOURS.blue };
    return root;
  });
  const explosionPool = createPresentationPool(P2P_WASM_EXPLOSION_POOL_CAPACITY, () => {
    const root = new THREE.Group();
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0xffd889, transparent: true, emissive: 0xff6d21, emissiveIntensity: 3 });
    explosionCoreMaterials.push(coreMaterial);
    const core = new THREE.Mesh(explosionCoreGeometry, coreMaterial);
    const light = new THREE.PointLight(0xff8b44, 9, 15);
    const sparks = Array.from({ length: 10 }, () => {
      const spark = new THREE.Mesh(explosionSparkGeometry, explosionMaterials.blue);
      root.add(spark);
      return { spark, direction: new THREE.Vector3() };
    });
    root.add(core, light);
    root.visible = false;
    root.name = "p2p-rocket-explosion";
    root.userData = { feedback: "rocket-explosion", core, coreMaterial, sparks, light, age: 0 };
    return root;
  });
  const eventPool = createPresentationPool(P2P_WASM_EVENT_FEEDBACK_CAPACITY, () => {
    const mesh = new THREE.Mesh(eventGeometry, eventMaterials.fire);
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.userData.feedback = "event";
    return mesh;
  });
  const rocketMeshes = new Map();
  const explosions = [];
  const eventMeshes = [];
  const pickupMeshes = new Map();
  const authoredUpgradePromises = [];
  camera = new THREE.PerspectiveCamera(P2P_WASM_CAMERA_BASE_FOV, viewportWidth / viewportHeight, .1, 200);
  const cameraPosition = new THREE.Vector3();
  const cameraAim = new THREE.Vector3();
  let cameraFrame = null;
  let cameraInitialized = false;
  const cameraFollowState = createP2PWasmCameraFramingState();
  let cameraTime = null;
  let lockedTargetId = typeof targetCarId === "string" ? targetCarId : null;
  let rendered = false;
  let metadataSequence = 0;
  let pickupMetadataCount = 0;
  let pickupMetadataActiveCount = 0;
  let lastRoundSerial = null;
  let lastPresentationUpdateAt = null;
  let cameraRespawnSerial = null;
  let cameraResetCount = 0;
  let effectPrewarmPromise = null;
  let effectPrewarmStatus = "idle";
  let effectPrewarmCompilePasses = 0;
  let lastPresentationState = null;
  let contextListenersAttached = false;

  const notifyContextState = () => {
    if (typeof onContextStateChange !== "function") return;
    try {
      onContextStateChange(Object.freeze({
        state: contextState,
        contextLossCount,
        contextRestoreCount,
        renderErrorCount,
        lastRenderError,
      }));
    } catch {
      // A status observer must never affect the simulation or render loop.
    }
  };

  const setContextState = (next, error = null) => {
    contextState = next;
    lastRenderError = error ? String(error?.message || error) : lastRenderError;
    notifyContextState();
  };

  const isRuntimeContextLost = () => {
    try {
      return renderer.getContext?.()?.isContextLost?.() === true;
    } catch {
      return false;
    }
  };

  const onWebGLContextLost = event => {
    if (closed) return;
    // The default browser action is to discard the context permanently. A
    // preventDefault here is required for the restore event to be delivered.
    event?.preventDefault?.();
    contextLossCount += 1;
    setContextState("lost", new Error("WebGL context lost"));
    // Reduce the next allocation/draw budget before restoration. This is a
    // prevention measure for repeated TDRs, not merely a black-canvas fallback.
    setQuality("performance", { force: true });
  };

  const onWebGLContextRestored = () => {
    if (closed) return;
    contextRestoreCount += 1;
    setContextState("restoring");
    try {
      renderer.resetState?.();
      applyViewportSize();
      applyShadowQuality();
      // Three.js re-uploads retained CPU-side resources on the next draw. The
      // latest authoritative snapshot remains in `lastPresentationState` and
      // therefore no gameplay state is lost while the GPU recovers.
      setContextState("restored");
    } catch (error) {
      renderErrorCount += 1;
      setContextState("error", error);
    }
  };

  if (typeof canvas.addEventListener === "function") {
    canvas.addEventListener("webglcontextlost", onWebGLContextLost, false);
    canvas.addEventListener("webglcontextrestored", onWebGLContextRestored, false);
    contextListenersAttached = true;
  }

  const onResize = entry => {
    if (closed) return;
    pendingResizeEntry = entry;
    if (resizeFrame !== null) return;
    const raf = view?.requestAnimationFrame
      || (typeof requestAnimationFrame === "function" ? requestAnimationFrame : null);
    if (typeof raf !== "function") {
      const rect = pendingResizeEntry?.contentRect;
      pendingResizeEntry = null;
      applyViewportSize(rect?.width, rect?.height);
      return;
    }
    resizeFrame = raf(() => {
      resizeFrame = null;
      const rect = pendingResizeEntry?.contentRect;
      pendingResizeEntry = null;
      if (!closed) applyViewportSize(rect?.width, rect?.height);
    });
  };
  const resizeObserverConstructor = view?.ResizeObserver
    || (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
  if (typeof resizeObserverConstructor === "function") {
    try {
      resizeObserver = new resizeObserverConstructor(entries => onResize(entries?.[0]));
      resizeObserver.observe?.(canvas);
    } catch {
      resizeObserver = null;
    }
  }
  if (typeof view?.addEventListener === "function") {
    view.addEventListener("resize", onResize);
    windowResizeAttached = true;
  }

  const laserPositions = new Float32Array(6);
  const laserGeometry = new THREE.BufferGeometry();
  laserGeometry.setAttribute("position", new THREE.BufferAttribute(laserPositions, 3));
  const laser = new THREE.Line(laserGeometry, new THREE.LineBasicMaterial({
    color: 0x8ee8ff,
    transparent: true,
    opacity: .92,
    depthTest: false,
    depthWrite: false,
  }));
  laser.visible = false;
  laser.renderOrder = 20;
  laser.userData.presentationSource = "weapon-muzzle";
  scene.add(laser);
  const laserStart = new THREE.Vector3();
  const laserEnd = new THREE.Vector3();
  const laserDirection = new THREE.Vector3();
  const aimProjectionPoint = new THREE.Vector3();

  function disposeArena() {
    arenaDecoration?.dispose?.();
    arenaDecoration = null;
    const coverSkin = arenaCoverSkin;
    arenaCoverSkin = null;
    if (arenaCovers) {
      scene.remove(arenaCovers.root || arenaCovers);
      arenaCovers.dispose?.();
      arenaCovers = null;
    }
    coverSkin?.dispose?.();
    const obstacleSkin = arenaObstacleSkin;
    arenaObstacleSkin = null;
    arenaObstacleMaterial = null;
    arenaObstacleHazardBand = null;
    if (arenaObstacles) {
      scene.remove(arenaObstacles);
      disposeVisualRoot(arenaObstacles, {
        skipMaterials: obstacleSkin?.material ? new Set([obstacleSkin.material]) : null,
      });
      arenaObstacles = null;
    }
    obstacleSkin?.dispose?.();
    if (arenaBounds) {
      scene.remove(arenaBounds);
      arenaBounds.userData?.dispose?.();
      arenaBounds = null;
    }
  }

  function ensureArena(nextArena) {
    const nextSpec = createP2PWasmArenaPresentationSpec(nextArena, { coordinateSpace });
    if (arenaSpec?.arena === nextSpec.arena) return;
    disposeArena();
    arenaSpec = nextSpec;
    arenaLimits = createP2PWasmPresentationLimits(nextSpec);
    const profile = combatVisualProfile;
    scene.background = new THREE.Color(profile.background);
    const fog = getArenaFogSettings(profile);
    if (!fog) scene.fog = null;
    else if (scene.fog) {
      scene.fog.color = new THREE.Color(fog.color);
      scene.fog.near = fog.near;
      scene.fog.far = fog.far;
    } else scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    const extent = Math.max(nextSpec.width, nextSpec.depth);
    // Match the local RocketSim shell: floor, walls, curves and corners are
    // one opaque parametric surface. No diagnostic box or independent panels
    // are used in the public renderer.
    arenaBounds = createP2PWasmUnifiedArenaShell(THREE, nextSpec, profile);
    arenaBounds.userData.presentationLimits = arenaLimits;
    scene.add(arenaBounds);
    if (nextSpec.arena === "combat-alpha" && coordinateSpace === P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD) {
      const obstacleFinish = profile.obstacles || {};
      const hazardBandHeight = Math.max(.08, Math.min(.6, Number(obstacleFinish.hazardBandHeight) || .38));
      arenaObstacleHazardBand = hazardBandHeight;
      let obstacleMaterials;
      try {
        arenaObstacleSkin = createScrapyardShellMaterial({
          THREE,
          renderer,
          // balanced is the public default and retains ART-03 textures;
          // performance is the only presentation tier that must fall back.
          quality: activeQuality === "performance" ? "low" : "high",
        });
        arenaObstacleMaterial = arenaObstacleSkin.material;
        arenaObstacleMaterial.color?.setHex?.(obstacleFinish.body ?? 0x5b7478);
        arenaObstacleMaterial.emissive?.setHex?.(obstacleFinish.bodyEmissive ?? 0x102a2f);
        arenaObstacleMaterial.emissiveIntensity = obstacleFinish.bodyEmissiveIntensity ?? .34;
        arenaObstacleMaterial.roughness = obstacleFinish.bodyRoughness ?? .86;
        arenaObstacleMaterial.metalness = obstacleFinish.bodyMetalness ?? .12;
        const activeSkin = arenaObstacleSkin;
        activeSkin.ready.then(ready => {
          if (!ready || arenaObstacleSkin !== activeSkin) return;
          const baseCompile = arenaObstacleMaterial?.onBeforeCompile;
          if (typeof baseCompile !== "function") return;
          arenaObstacleMaterial.onBeforeCompile = shader => {
            baseCompile(shader);
            const token = "smoothstep(0.8, 3.2, scrapyardPosition.y)";
            if (shader.fragmentShader.includes(token)) {
              shader.fragmentShader = shader.fragmentShader.replace(
                token,
                `smoothstep(0.04, ${hazardBandHeight.toFixed(2)}, scrapyardPosition.y)`,
              );
            }
          };
          arenaObstacleMaterial.customProgramCacheKey = () => `arena-obstacle-scrapyard-${hazardBandHeight}`;
          arenaObstacleMaterial.needsUpdate = true;
        }).catch(() => {});
        obstacleMaterials = {
          body: arenaObstacleMaterial,
          cap: new THREE.MeshStandardMaterial({
            color: obstacleFinish.cap ?? 0xa47d38,
            emissive: obstacleFinish.capEmissive ?? 0x3b2409,
            emissiveIntensity: obstacleFinish.capEmissiveIntensity ?? .22,
            roughness: obstacleFinish.capRoughness ?? .58,
            metalness: obstacleFinish.capMetalness ?? .52,
            side: THREE.DoubleSide ?? THREE.BackSide ?? 1,
          }),
        };
      } catch {
        arenaObstacleSkin = null;
        arenaObstacleMaterial = null;
        obstacleMaterials = {
          body: new THREE.MeshStandardMaterial({
            color: obstacleFinish.body ?? 0x5b7478,
            emissive: obstacleFinish.bodyEmissive ?? 0x102a2f,
            emissiveIntensity: obstacleFinish.bodyEmissiveIntensity ?? .34,
            roughness: obstacleFinish.bodyRoughness ?? .86,
            metalness: obstacleFinish.bodyMetalness ?? .12,
            side: THREE.DoubleSide ?? THREE.BackSide ?? 1,
          }),
          cap: new THREE.MeshStandardMaterial({
            color: obstacleFinish.cap ?? 0xa47d38,
            emissive: obstacleFinish.capEmissive ?? 0x3b2409,
            emissiveIntensity: obstacleFinish.capEmissiveIntensity ?? .22,
            roughness: obstacleFinish.capRoughness ?? .58,
            metalness: obstacleFinish.capMetalness ?? .52,
            side: THREE.DoubleSide ?? THREE.BackSide ?? 1,
          }),
        };
      }
      arenaObstacles = createCombatObstacleVisuals(THREE, nextSpec, profile, obstacleMaterials);
      scene.add(arenaObstacles);
      try {
        arenaCoverSkin = createScrapyardTireMaterial({
          THREE,
          renderer,
          quality: activeQuality === "performance" ? "low" : "high",
        });
      } catch {
        arenaCoverSkin = null;
      }
      arenaCovers = createCombatAlphaCoverVisuals({
        THREE,
        parent: scene,
        materials: {
          container: obstacleMaterials.body,
          hazard: obstacleMaterials.cap,
          tire: arenaCoverSkin?.material,
        },
      });
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        arenaDecoration = createArenaDecoration({
          THREE,
          parent: scene,
          mode: "rocketsim-combat-alpha",
          arena: { halfWidth: nextSpec.halfWidth, halfDepth: nextSpec.halfDepth, height: nextSpec.height, curveRadius: nextSpec.curveRadius },
          profile,
        });
      }
      applyLightingQuality();
    }
    if (key.shadow?.camera) {
      // Keep the larger combat-alpha volume inside the shadow frustum. The
      // previous 160×130 box clipped shadows in the new outer lanes.
      const shadowHalfExtent = Math.max(65, nextSpec.halfWidth, nextSpec.halfDepth);
      key.shadow.camera.left = -shadowHalfExtent;
      key.shadow.camera.right = shadowHalfExtent;
      key.shadow.camera.top = shadowHalfExtent;
      key.shadow.camera.bottom = -shadowHalfExtent;
      key.shadow.camera.updateProjectionMatrix?.();
    }
    camera.far = Math.max(120, extent * 4);
    camera.updateProjectionMatrix();
  }

  function triggerActionPulse(vehicle, car, kind) {
    const pulse = vehicle.userData.actionPulse;
    if (!pulse) return;
    vehicle.userData.actionPulseRemaining = kind === "respawn" ? .34 : .2;
    vehicle.userData.lastActionKind = kind;
    const color = actionPulseColor(car.team, kind);
    if (pulse.material?.color?.set) pulse.material.color.set(color);
    else if (pulse.material) pulse.material.color = color;
    if (pulse.material?.emissive?.set) pulse.material.emissive.set(color);
    else if (pulse.material) pulse.material.emissive = color;
  }

  function consumeActionSerials(vehicle, car, roundChanged) {
    const serials = car?.actionSerials;
    if (!serials || typeof serials !== "object") return;
    const previous = vehicle.userData.actionSerials || (vehicle.userData.actionSerials = {});
    for (const kind of P2P_WASM_ACTION_SERIAL_KINDS) {
      const next = actionSerial(serials[kind]);
      if (next === null) continue;
      const before = actionSerial(previous[kind]);
      // RocketSim restarts reset movement-edge counters but increases the
      // respawn serial. Do not make the numeric reset look like a new jump;
      // retain the respawn cue that the authoritative state explicitly marks.
      if (roundChanged && kind !== "respawn") {
        previous[kind] = next;
        continue;
      }
      if (before !== null && next > before) triggerActionPulse(vehicle, car, kind);
      previous[kind] = next;
    }
  }

  function updateActionPulse(vehicle, dt) {
    const pulse = vehicle.userData.actionPulse;
    if (!pulse) return;
    const remaining = Math.max(0, (Number(vehicle.userData.actionPulseRemaining) || 0) - dt);
    vehicle.userData.actionPulseRemaining = remaining;
    pulse.visible = remaining > 0;
    if (remaining <= 0) return;
    const amount = remaining / .34;
    const scale = 1.1 + (1 - amount) * 1.4;
    if (typeof pulse.scale?.setScalar === "function") pulse.scale.setScalar(scale);
    else if (pulse.scale) pulse.scale.x = pulse.scale.y = pulse.scale.z = scale;
    if (pulse.material) pulse.material.opacity = Math.min(.88, amount * 1.35);
  }

  function update(state) {
    if (closed) return false;
    // The online 1v1 path supplies two cars; the offline-first practice path
    // intentionally supplies one. Keep the renderer roster-bounded so the
    // same presentation can grow to the validated six-player contract
    // without inventing a missing rival or rendering a blank arena.
    if (!state || !Array.isArray(state.cars) || state.cars.length < 1 || state.cars.length > 6
      || state.cars.some(car => typeof car?.id !== "string" || !car.id.trim())
      || new Set(state.cars.map(car => car.id)).size !== state.cars.length) throw new TypeError("El estado causal necesita entre uno y seis coches con identidades únicas.");
    lastPresentationState = state;
    const updateAt = nowSeconds();
    const presentationDt = lastPresentationUpdateAt === null
      ? 1 / 60
      : Math.max(0, Math.min(.12, updateAt - lastPresentationUpdateAt));
    lastPresentationUpdateAt = updateAt;
    const roundSerial = Number.isSafeInteger(state.settings?.roundSerial) ? state.settings.roundSerial : null;
    const roundChanged = lastRoundSerial !== null && roundSerial !== null && lastRoundSerial !== roundSerial;
    if (roundSerial !== null) lastRoundSerial = roundSerial;
    ensureArena(state.settings?.arena || "combat-alpha");
    arenaDecoration?.update?.({ time: Number(state.time) || 0 });
    const incomingIds = new Set(state.cars.map(car => car.id));
    for (const [id, vehicle] of cars) {
      if (incomingIds.has(id)) continue;
      scene.remove(vehicle);
      vehicle.userData.disposed = true;
      vehicle.userData.dispose?.();
      cars.delete(id);
    }
    const positions = [];
    state.cars.forEach((car, index) => {
      if (![car.x, car.h, car.z, car.orientation?.x, car.orientation?.y, car.orientation?.z, car.orientation?.w].every(finite)) {
        throw new TypeError("La pose causal no contiene números finitos.");
      }
      let vehicle = cars.get(car.id);
      if (!vehicle) {
        const colour = car.team === "red" ? 0xf05b66 : 0x36a8ff;
        vehicle = makeVehicle(THREE, car, colour);
        vehicle.userData.playerId = car.id;
        vehicle.userData.team = car.team ?? null;
        scene.add(vehicle);
        cars.set(car.id, vehicle);
        if (typeof window !== "undefined" && typeof document !== "undefined") {
          authoredUpgradePromises.push(promoteToAuthoredVehicle(vehicle, car));
        }
      }
      vehicle.userData.team = car.team ?? null;
      setVehicleAssetTeam(vehicle, car.team ?? null);
      const movementBackend = state.settings?.movementBackend || "js";
      const alignment = vehicleVisualAlignment({ height: car.h, movementBackend });
      // Local Three.js roots are placed at RocketSim's native vehicle pivot.
      // The public snapshot stores a floor-relative height, so convert the
      // pivot delta into the selected presentation space instead of using the
      // old fixed .55 fallback lift.
      const pivotDelta = alignment.rootHeight - car.h;
      const pivotScene = movementBackend === "rocketsim"
        ? (coordinateSpace === P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD
          ? pivotDelta
          : toScene(pivotDelta / ROCKETSIM_PRACTICE_SCALE))
        : .55;
      const position = new THREE.Vector3(
        toScene(car.x),
        toScene(car.h) + pivotScene,
        toScene(car.z),
      );
      vehicle.position.copy(position);
      vehicle.quaternion.set(car.orientation.x, car.orientation.y, car.orientation.z, car.orientation.w);
      vehicle.userData.visualAlignment = alignment;
      // Mirror the local client: a combatant with an authoritative respawn
      // timer is absent from the arena until the host publishes it active
      // again. This only gates a mesh; it never changes combat state.
      const respawning = finite(car.respawn) && car.respawn > 0;
      vehicle.visible = !respawning;
      vehicle.userData.telemetry = {
        id: car.id,
        surfaceType: car.surfaceType,
        boost: car.boost,
        jumpState: car.jumpState,
        targetId: car.targetId ?? null,
      };
      consumeActionSerials(vehicle, car, roundChanged);
      updateActionPulse(vehicle, presentationDt);
      if (respawning && vehicle.userData.actionPulse) vehicle.userData.actionPulse.visible = false;
      const visual = vehicle.userData.authoredVehicle || vehicle;
      const boosting = !respawning && car.boosting === true;
      const visualAttitude = visual.userData?.references?.attitude || visual.userData?.attitude;
      if (visualAttitude && movementBackend === "rocketsim") {
        visualAttitude.position.y = alignment.modelOffsetY;
        visualAttitude.scale.setScalar?.(alignment.modelScale);
      }
      visual.userData?.setHealth?.(car.hp);
      const flames = visual.userData?.boosterFlames || visual.userData?.boostFlames || vehicle.userData.boostFlames;
      flames?.forEach(flame => { flame.visible = boosting; });
      visual.userData?.setBoostVisible?.(boosting);
      // The authored model's generic boost helper also exposes these trails;
      // restore the local-client rule afterwards so superspeed, not a held
      // boost button, determines this distinct visual feedback.
      const speedTrails = visual.userData?.speedTrails || vehicle.userData.speedTrails;
      if (speedTrails) {
        speedTrails.visible = !respawning && car.supersonic === true;
        const speed = Math.max(0, finite(car.speed) ? car.speed : Math.hypot(finite(car.vx) ? car.vx : 0, finite(car.vz) ? car.vz : 0, finite(car.vh) ? car.vh : 0));
        const scale = .72 + Math.min(speed, 65) / 65 * .52;
        if (typeof speedTrails.scale?.setScalar === "function") speedTrails.scale.setScalar(scale);
        else if (speedTrails.scale) speedTrails.scale.x = speedTrails.scale.y = speedTrails.scale.z = scale;
      }
      const weaponMount = visual.userData?.weaponMount
        || visual.userData?.references?.weaponMount
        || vehicle.userData.weaponMount;
      vehicle.userData.activeWeaponMount = weaponMount || null;
      // Wheel motion is only a visual derivative of an authoritative pose.
      // The render path never integrates position or writes it back to WASM.
      const speed = Math.hypot(finite(car.vx) ? car.vx : 0, finite(car.vz) ? car.vz : 0);
      const previousTime = vehicle.userData.lastSnapshotTime;
      const elapsed = finite(state.time) && finite(previousTime)
        ? Math.max(0, Math.min(.12, state.time - previousTime))
        : 1 / 60;
      vehicle.userData.lastSnapshotTime = finite(state.time) ? state.time : previousTime;
      const spin = toScene(speed) * elapsed / .39;
      const wheels = visual.userData?.wheels || vehicle.userData.wheels;
      wheels?.forEach(wheel => {
        const spinner = wheel?.tire || wheel;
        if (spinner?.rotation) spinner.rotation.y += spin;
      });
      positions.push(position);
    });
    updateRockets(state.rockets);
    updateExplosions(presentationDt);
    updateEvents(state.events);
    const focusedIndex = typeof focusCarId === "string"
      ? state.cars.findIndex(car => car.id === focusCarId)
      : -1;
    const focus = positions[focusedIndex >= 0 ? focusedIndex : 0];
    const rival = positions[focusedIndex >= 0 ? (focusedIndex === 0 ? 1 : 0) : 1];
    // The shared Car Cam/Enemy Cam policy owns heading, boom dimensions and
    // FOV. P2P only adapts its authoritative telemetry and smooths the
    // resulting frame at the policy-provided rates.
    const focusCar = state.cars[focusedIndex >= 0 ? focusedIndex : 0];
    // The local RocketSim client follows the rendered vehicle pivot, not the
    // floor-relative snapshot height. Keep the camera's vertical anchor on
    // that same pivot while leaving target cars at their authoritative
    // snapshot height, matching the local Enemy-Cam contract.
    const focusCarForCamera = state.settings?.movementBackend === "rocketsim"
      ? {
        ...focusCar,
        h: focusCar.h + (coordinateSpace === P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD
          ? ROCKETSIM_VISUAL_PIVOT_HEIGHT
          : ROCKETSIM_VISUAL_PIVOT_HEIGHT / ROCKETSIM_PRACTICE_SCALE),
      }
      : focusCar;
    const nextRespawnSerial = Number.isSafeInteger(focusCar?.actionSerials?.respawn)
      ? focusCar.actionSerials.respawn
      : null;
    // Match src/client.js: a host-authoritative respawn is a camera
    // discontinuity, not a pose to smooth through from the previous life.
    if (nextRespawnSerial !== null && cameraRespawnSerial !== null && nextRespawnSerial !== cameraRespawnSerial) {
      resetP2PWasmCameraFramingState(cameraFollowState);
      cameraInitialized = false;
      cameraResetCount += 1;
    }
    if (nextRespawnSerial !== null) cameraRespawnSerial = nextRespawnSerial;
    // A persistent targetId is part of the authoritative presentation car;
    // the setter remains a compatibility fallback for callers that manage the
    // local lock outside the snapshot adapter.
    const effectiveTargetId = Object.prototype.hasOwnProperty.call(focusCar, "targetId")
      ? (typeof focusCar.targetId === "string" && focusCar.targetId.length > 0 ? focusCar.targetId : null)
      : lockedTargetId;
    const targetIndex = effectiveTargetId ? state.cars.findIndex(car => car.id === effectiveTargetId) : -1;
    const targetCar = targetIndex >= 0 ? state.cars[targetIndex] : null;
    const targetLocked = targetIndex >= 0
      && targetIndex !== (focusedIndex >= 0 ? focusedIndex : 0)
      && targetCar?.alive !== false
      && !(finite(targetCar?.hp) && targetCar.hp <= 0)
      && !(finite(targetCar?.respawn) && targetCar.respawn > 0);
    const frameTime = finite(state.time) ? state.time : null;
    const dt = frameTime !== null && cameraTime !== null ? Math.max(0, Math.min(.05, frameTime - cameraTime)) : 1 / 60;
    cameraTime = frameTime;
    const cameraInset = Math.max(1.35, Math.min(2.4, (Number(arenaSpec?.curveRadius) || 0) * .22));
    const frame = stepP2PWasmCameraFrame(cameraFollowState, {
      focusCar: focusCarForCamera,
      targetCar: targetLocked ? state.cars[targetIndex] : null,
      dt,
      toScene,
      cameraVerticalBounds: p2pWasmCameraVerticalBounds(arenaSpec),
      cameraHorizontalBounds: arenaSpec ? {
        minX: -arenaSpec.halfWidth + cameraInset,
        maxX: arenaSpec.halfWidth - cameraInset,
        minZ: -arenaSpec.halfDepth + cameraInset,
        maxZ: arenaSpec.halfDepth - cameraInset,
      } : null,
      // The online shell is rendered as an opaque surface. Keep a forward
      // look-ahead aimed inside its visual volume when a car faces a nearby
      // wall, so the local vehicle stays readable at the boundary.
      keepFocusInsideBounds: true,
    });
    // Keep diagnostics useful even when no Enemy-Cam lock is active: the
    // rival distance is a read-only measurement, while the follow policy must
    // still receive a null target and remain in Car-Cam mode.
    cameraFrame = Number.isFinite(frame.rivalDistance) || !rival
      ? frame
      : Object.freeze({
        ...frame,
        rivalDistance: Math.hypot(rival.x - focus.x, rival.y - focus.y, rival.z - focus.z),
      });
    const desiredAim = new THREE.Vector3(frame.focus.x, frame.focus.y, frame.focus.z);
    const desiredPosition = new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z);
    // Match the local respawn presentation: a dead/respawning car gets a
    // short elevated camera reset instead of easing through the arena floor.
    if (finite(focusCar.respawn) && focusCar.respawn > 0) desiredPosition.y = Math.max(desiredPosition.y, 13);
    if (!cameraInitialized) {
      cameraPosition.copy(desiredPosition);
      cameraAim.copy(desiredAim);
      cameraInitialized = true;
    } else {
      const smooth = (rate) => 1 - Math.exp(-rate * Math.max(0, Math.min(.05, dt)));
      cameraPosition.lerp(desiredPosition, smooth(frame.positionSmoothing));
      cameraAim.lerp(desiredAim, smooth(frame.focusSmoothing));
    }
    camera.position.copy(cameraPosition);
    if (Math.abs(camera.fov - frame.fov) > .02) {
      camera.fov += (frame.fov - camera.fov) * (1 - Math.exp(-5.2 * Math.max(0, Math.min(.05, dt))));
      camera.updateProjectionMatrix();
    }
    camera.lookAt(cameraAim);
    if (targetLocked) {
      const target = positions[targetIndex];
      const localVehicle = cars.get(focusCar.id);
      const mount = localVehicle?.userData?.activeWeaponMount
        || localVehicle?.userData?.weaponMount;
      const targetPoint = new THREE.Vector3(
        toScene(targetCar.x),
        toScene(targetCar.h + 1.2),
        toScene(targetCar.z),
      );
      let aimed = false;
      if (mount?.turret && mount?.muzzle) {
        // Match src/client.js: aim in the turret parent frame, then read the
        // muzzle in world space so flips and chassis orientation are included.
        aimed = aimWeaponMountAt(mount, targetPoint);
        mount.turret.updateMatrixWorld?.(true);
        if (typeof mount.muzzle.getWorldPosition === "function") mount.muzzle.getWorldPosition(laserStart);
      }
      if (!aimed || !Number.isFinite(laserStart.x) || !Number.isFinite(laserStart.y) || !Number.isFinite(laserStart.z)) {
        // Lightweight test doubles may not implement Three.js matrix helpers;
        // retain the roof-muzzle contract with the known local mount offset.
        laserStart.set(focus.x + 2.1, focus.y + 2.04, focus.z);
      }
      laserEnd.copy(targetPoint);
      const deltaX = laserEnd.x - laserStart.x;
      const deltaY = laserEnd.y - laserStart.y;
      const deltaZ = laserEnd.z - laserStart.z;
      const beamLength = Math.hypot(deltaX, deltaY, deltaZ);
      if (beamLength <= 1e-6) {
        laser.visible = false;
        mount?.turret?.quaternion?.identity?.();
        return true;
      }
      laserDirection.set(deltaX / beamLength, deltaY / beamLength, deltaZ / beamLength);
      laserPositions[0] = laserStart.x; laserPositions[1] = laserStart.y; laserPositions[2] = laserStart.z;
      laserPositions[3] = laserEnd.x; laserPositions[4] = laserEnd.y; laserPositions[5] = laserEnd.z;
      laserGeometry.attributes.position.needsUpdate = true;
      laser.visible = true;
    } else {
      laser.visible = false;
      const localVehicle = cars.get(focusCar.id);
      const mount = localVehicle?.userData?.activeWeaponMount || localVehicle?.userData?.weaponMount;
      mount?.turret?.quaternion?.identity?.();
      laserStart.set(0, 0, 0);
      laserEnd.set(0, 0, 0);
      laserDirection.set(0, 0, 0);
    }
    return true;
  }

  async function promoteToAuthoredVehicle(vehicle, car) {
    if (vehicle.userData.authoredUpgradeStarted) return null;
    vehicle.userData.authoredUpgradeStarted = true;
    try {
      const module = await import("./p2p-wasm-authored-vehicle.mjs");
      if (closed) return null;
      if (vehicle.userData.disposed) return null;
      // FFA carries a nullable team on the wire. The authored constructor
      // still needs a valid base palette; the explicit neutral re-tint below
      // is applied as soon as its asset root exists.
      const authored = module.createP2PWasmAuthoredVehicle({ THREE, car: { ...car, team: car.team || "blue" } });
      authored.name = `p2p-authored-car-${car.id}`;
      authored.visible = false;
      vehicle.userData.authoredVehicle = authored;
      authored.userData.team = vehicle.userData.team ?? car.team ?? null;
      const authoredAssetReady = authored.userData?.assetReady || Promise.resolve(null);
      vehicle.userData.fallbackWeaponMount?.root && (vehicle.userData.fallbackWeaponMount.root.visible = false);
      vehicle.add(authored);
      setVehicleAssetTeam(vehicle, vehicle.userData.team ?? car.team ?? null);
      const fallbackDispose = vehicle.userData.dispose;
      vehicle.userData.dispose = () => {
        authored.userData.disposed = true;
        authored.userData?.dispose?.();
        fallbackDispose?.();
      };
      vehicle.userData.authoredAssetReady = Promise.resolve(authoredAssetReady).then(state => {
        if (state?.status === "ready") {
          authored.visible = true;
          vehicle.userData.fallback?.parent?.remove?.(vehicle.userData.fallback);
          fallbackDispose?.();
          vehicle.userData.visualContract = authored.userData?.onlineVisualContract || "authored-game-car-v1";
          vehicle.userData.wheels = authored.userData?.wheels || authored.userData?.references?.wheels || vehicle.userData.wheels;
          vehicle.userData.boostFlames = authored.userData?.boosterFlames || authored.userData?.references?.boosterFlames || vehicle.userData.boostFlames;
          vehicle.userData.speedTrails = authored.userData?.speedTrails || authored.userData?.references?.speedTrails || vehicle.userData.speedTrails;
          vehicle.userData.partCount = authored.userData?.visualMetrics?.meshCount || vehicle.userData.partCount;
          vehicle.userData.activeWeaponMount = authored.userData?.weaponMount
            || authored.userData?.references?.weaponMount
            || vehicle.userData.weaponMount;
          vehicle.userData.activeWeaponMount?.root?.traverse?.(child => { child.visible = true; });
          return state;
        }
        // The online route deliberately has no alternate procedural car. A
        // failed authored load stays visually empty instead of showing the
        // obsolete placeholder model that used to leak into multiplayer.
        authored.userData?.dispose?.();
        authored.parent?.remove?.(authored);
        vehicle.userData.authoredVehicle = null;
        if (vehicle.userData.fallback) vehicle.userData.fallback.visible = false;
        vehicle.userData.fallbackWeaponMount?.root && (vehicle.userData.fallbackWeaponMount.root.visible = false);
        vehicle.userData.assetLoadFailed = true;
        return state;
      });
      return vehicle.userData.authoredAssetReady;
    } catch (error) {
      vehicle.userData.authoredUpgradeError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  function updateRockets(rockets) {
    const next = Array.isArray(rockets) ? rockets : [];
    const activeIds = new Set();
    for (const rocket of next) {
      if (!rocket || !Number.isSafeInteger(rocket.id)) continue;
      activeIds.add(rocket.id);
      let mesh = rocketMeshes.get(rocket.id);
      if (!mesh) {
        mesh = rocketPool.acquire();
        if (!mesh) continue;
        rocketMeshes.set(rocket.id, mesh);
        scene.add(mesh);
      }
      mesh.visible = true;
      mesh.userData.light.visible = activeQuality !== "performance";
      const team = rocket.team === "red" ? "red" : "blue";
      const colour = ROCKET_COLOURS[team];
      mesh.userData.body.material = rocketMaterials[team].body;
      mesh.userData.trail.material = rocketMaterials[team].trail;
      mesh.userData.light.color.setHex(colour);
      mesh.userData.colour = colour;
      mesh.position.set(
        toScene(rocket.x),
        toScene(rocket.h),
        toScene(rocket.z),
      );
      if (finite(rocket.vx) && finite(rocket.vh) && finite(rocket.vz)
        && Math.hypot(rocket.vx, rocket.vh, rocket.vz) > 1e-6) {
        mesh.lookAt(
          mesh.position.x + toScene(rocket.vx),
          mesh.position.y + toScene(rocket.vh),
          mesh.position.z + toScene(rocket.vz),
        );
      }
      mesh.userData.rocket = { id: rocket.id, owner: rocket.owner, targetId: rocket.targetId, team };
    }
    for (const [id, mesh] of rocketMeshes) {
      if (activeIds.has(id)) continue;
      createRocketExplosion(mesh.position, mesh.userData.colour);
      scene.remove(mesh);
      mesh.visible = false;
      rocketMeshes.delete(id);
      rocketPool.release(mesh);
    }
  }

  function setUniformScale(object, value) {
    if (typeof object?.scale?.setScalar === "function") object.scale.setScalar(value);
    else if (object?.scale) object.scale.x = object.scale.y = object.scale.z = value;
  }

  function createRocketExplosion(position, colour) {
    const explosion = explosionPool.acquire();
    if (!explosion) return;
    const data = explosion.userData;
    const team = colour === ROCKET_COLOURS.blue ? "blue" : "red";
    explosion.position.copy(position);
    explosion.quaternion.set(0, 0, 0, 1);
    setUniformScale(explosion, 1);
    data.core.position.set(0, 0, 0);
    setUniformScale(data.core, 1);
    data.coreMaterial.opacity = 1;
    data.light.intensity = 9;
      data.light.visible = activeQuality !== "performance";
    data.age = 0;
    for (const { spark, direction } of data.sparks) {
      spark.position.set(0, 0, 0);
      const radius = .07 + Math.random() * .07;
      setUniformScale(spark, radius);
      spark.material = explosionMaterials[team];
      direction.set(Math.random() - .5, Math.random() * .8, Math.random() - .5).normalize().multiplyScalar(5 + Math.random() * 6);
    }
    explosion.visible = true;
    scene.add(explosion);
    explosions.push(explosion);
  }

  function updateExplosions(dt) {
    for (let index = explosions.length - 1; index >= 0; index -= 1) {
      const explosion = explosions[index];
      const data = explosion.userData;
      data.age += dt;
      const fade = Math.max(0, 1 - data.age / .55);
      setUniformScale(data.core, 1 + data.age * 6);
      data.coreMaterial.opacity = fade;
      data.light.intensity = fade * 9;
      data.light.visible = activeQuality !== "performance" && fade > 0;
      for (const { spark, direction } of data.sparks) {
        spark.position.addScaledVector(direction, dt);
        setUniformScale(spark, fade);
      }
      if (fade <= 0) {
        scene.remove(explosion);
        explosion.visible = false;
        explosions.splice(index, 1);
        explosionPool.release(explosion);
      }
    }
  }

  function updateEvents(events) {
    const summary = summarizeP2PWasmEventFeedback(events);
    while (eventMeshes.length > summary.length) {
      const mesh = eventMeshes.pop();
      scene.remove(mesh);
      mesh.visible = false;
      mesh.userData.event = null;
      eventPool.release(mesh);
    }
    while (eventMeshes.length < summary.length) {
      const mesh = eventPool.acquire();
      if (!mesh) break;
      eventMeshes.push(mesh);
      scene.add(mesh);
    }
    const markerCount = Math.min(summary.length, eventMeshes.length);
    for (let index = 0; index < markerCount; index += 1) {
      const feedback = summary[index];
      const mesh = eventMeshes[index];
      mesh.visible = true;
      mesh.material = eventMaterials[feedback.kind] || eventMaterials.fire;
      mesh.position.set((index - (markerCount - 1) / 2) * .72, Math.max(.75, (arenaSpec?.height || 4) * .12), 0);
      mesh.userData.event = feedback;
    }
  }

  function clearPickupMeshes() {
    for (const mesh of pickupMeshes.values()) {
      scene.remove(mesh);
    }
    pickupMeshes.clear();
  }

  function updatePickups(metadata) {
    // Combat-alpha has moved to regenerating nitro. Ignore stale pad metadata
    // from older hosts instead of allocating hidden meshes in the P2P scene.
    if (arenaSpec?.arena === "combat-alpha") {
      pickupMetadataCount = 0;
      pickupMetadataActiveCount = 0;
      clearPickupMeshes();
      arenaDecoration?.update?.({ time: 0, pads: [] });
      return;
    }
    const pads = Array.isArray(metadata?.pads) ? metadata.pads : [];
    pickupMetadataCount = pads.length;
    pickupMetadataActiveCount = pads.filter(pad => pad?.active === true).length;
    arenaDecoration?.update?.({
      time: 0,
      pads: pads.map(pad => ({
        ...pad,
        id: typeof pad?.id === "string" && /^pad-\d+$/.test(pad.id) ? Number(pad.id.slice(4)) : pad?.id,
      })),
    });
    const activeIds = new Set();
    for (const pad of pads.slice(0, 96)) {
      if (!pad || typeof pad.id !== "string" || ![pad.x, pad.h, pad.z].every(finite)) continue;
      activeIds.add(pad.id);
      let mesh = pickupMeshes.get(pad.id);
      if (!mesh) {
        mesh = new THREE.Mesh(pickupGeometry, pickupMaterials.active);
        mesh.name = `p2p-pickup-${pad.id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        pickupMeshes.set(pad.id, mesh);
        scene.add(mesh);
      }
      mesh.visible = !arenaDecoration && pad.active === true;
      mesh.material = pad.active === true ? pickupMaterials.active : pickupMaterials.inactive;
      mesh.position.set(toScene(pad.x), toScene(pad.h) + .08, toScene(pad.z));
      mesh.userData.pickup = Object.freeze({
        id: pad.id,
        amount: Number.isFinite(pad.amount) ? pad.amount : 0,
        cooldown: Number.isFinite(pad.cooldown) ? pad.cooldown : 0,
        active: pad.active === true,
      });
    }
    for (const [id, mesh] of pickupMeshes) {
      if (activeIds.has(id)) continue;
      scene.remove(mesh);
      pickupMeshes.delete(id);
    }
  }

  function render() {
    if (closed) return false;
    if (contextState === "lost" || contextState === "restoring" || isRuntimeContextLost()) {
      const contextError = new Error("El contexto WebGL2 se perdió y el renderizado 3D no puede continuar.");
      contextError.code = "WEBGL_CONTEXT_LOST";
      setContextState("error", contextError);
      throw contextError;
    }
    try {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      if (diagnosticsTarget) {
        const pixels = new Uint8Array(8 * 8 * 4);
        try {
          renderer.setRenderTarget(diagnosticsTarget);
          renderer.render(scene, camera);
          renderer.readRenderTargetPixels(diagnosticsTarget, 0, 0, 8, 8, pixels);
          const colours = new Set();
          for (let index = 0; index < pixels.length; index += 4) {
            colours.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${pixels[index + 3]}`);
          }
          diagnosticsPixelDiversity = colours.size;
        } catch {
          diagnosticsPixelDiversity = 0;
        } finally {
          renderer.setRenderTarget(null);
        }
      }
      rendered = true;
      if (contextState === "error") setContextState("ready");
      return true;
    } catch (error) {
      renderErrorCount += 1;
      setQuality("performance", { force: true });
      setContextState("error", error);
      const presentationError = new Error(`El renderizado 3D falló: ${String(error?.message || error)}`);
      presentationError.code = "WEBGL_RENDER_FAILED";
      presentationError.cause = error;
      throw presentationError;
    }
  }

  function metrics() {
    const vehicleList = [...cars.values()];
    return Object.freeze({
      canvasVisible: !closed && viewportWidth > 0 && viewportHeight > 0,
      viewportWidth,
      viewportHeight,
      pixelRatio,
      qualityMode: activeQuality,
      qualityAuto: qualityMode === "auto",
      qualityDowngrades,
      qualityUpgrades,
      qualityLastFrameMs,
      qualityAverageFrameMs,
      qualityFrameSource: "raf",
      qualityBackBufferPixelCap: RENDER_QUALITY[activeQuality].maxBackBufferPixels,
      contextState,
      contextLossCount,
      contextRestoreCount,
      renderErrorCount,
      lastRenderError,
      shadowsEnabled: Boolean(renderer.shadowMap?.enabled),
      resizeApplyCount,
      resizeObserverAttached: Boolean(resizeObserver),
      windowResizeAttached,
      coordinateSpace,
      diagnosticsReadback: Boolean(diagnosticsTarget),
      renderCalls: renderer.info?.render?.calls || 0,
      pixelDiversity: diagnosticsPixelDiversity,
      rendered,
      cameraFocusId: focusCarId,
      cameraInitialized,
      cameraRivalDistance: cameraFrame?.rivalDistance ?? null,
      cameraFollowDistance: cameraFrame?.followDistance ?? null,
      cameraForward: cameraFrame?.forward ?? null,
      cameraTargetId: cameraFrame?.targetId ?? null,
      cameraTargetLocked: (cameraFrame?.enemyBlend || 0) > 0,
      cameraRespawnSerial,
      cameraResetCount,
      cameraMode: cameraFrame?.mode ?? null,
      cameraEnemyBlend: cameraFrame?.enemyBlend ?? 0,
      cameraFov: camera.fov,
      cameraPosition: cameraPosition ? Object.freeze({ x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z }) : null,
      cameraAim: cameraAim ? Object.freeze({ x: cameraAim.x, y: cameraAim.y, z: cameraAim.z }) : null,
      targetLaserVisible: laser.visible,
      targetLaserStart: Object.freeze({ x: laserStart.x, y: laserStart.y, z: laserStart.z }),
      targetLaserEnd: Object.freeze({ x: laserEnd.x, y: laserEnd.y, z: laserEnd.z }),
      targetLaserDirection: Object.freeze({ x: laserDirection.x, y: laserDirection.y, z: laserDirection.z }),
      targetLaserSource: laser.userData.presentationSource,
      arena: arenaSpec?.arena ?? null,
      arenaWidth: arenaSpec?.width ?? null,
      arenaDepth: arenaSpec?.depth ?? null,
      arenaHeight: arenaSpec?.height ?? null,
      arenaSurfaceContract: arenaBounds?.userData.presentationSurface || null,
      arenaTopology: arenaBounds?.userData.presentationTopology || null,
      arenaInteriorNormalContract: arenaBounds?.userData.interiorNormalContract || null,
      arenaObstacleCount: arenaObstacles?.children?.length || 0,
      arenaObstacleVisualContract: arenaObstacles?.userData?.nativeColliderContract || null,
      arenaObstacleMaterialContract: arenaObstacles?.userData?.materialContract || null,
      arenaObstacleMaterialStatus: arenaObstacleMaterial?.userData?.scrapyard?.status || (arenaObstacles ? "opaque-fallback" : null),
      arenaObstacleHazardBandHeight: arenaObstacleHazardBand,
      arenaCoverCount: arenaCovers?.spec?.covers?.length || 0,
      arenaCoverVisualContract: arenaCovers?.root?.userData?.contract || null,
      arenaCoverMetrics: Object.freeze(arenaCovers?.metrics?.() || {
        drawCalls: 0,
        triangles: 0,
        tireInstanceCount: 0,
      }),
      arenaShellVertexCount: arenaBounds?.userData.vertexCount || 0,
      arenaFlatSurfaceFootprint: arenaBounds?.userData.flatSurfaceFootprint || null,
      arenaFloorWallQuarterPipeVerticalBounds: arenaBounds?.userData.floorWallQuarterPipeVerticalBounds || null,
      arenaSurfaceMaterial: arenaBounds?.userData.surfaceMaterial || null,
      arenaVisualProfileId: combatVisualProfile.id,
      rendererInfo: Object.freeze({
        calls: Number(renderer.info?.render?.calls) || 0,
        triangles: Number(renderer.info?.render?.triangles) || 0,
        points: Number(renderer.info?.render?.points) || 0,
        lines: Number(renderer.info?.render?.lines) || 0,
        geometries: Number(renderer.info?.memory?.geometries) || 0,
        textures: Number(renderer.info?.memory?.textures) || 0,
        programs: Number(renderer.info?.programs?.length) || 0,
      }),
      arenaDecorationMetrics: Object.freeze(arenaDecoration?.metrics?.() || {
        drawCalls: 0,
        triangles: 0,
        lightCount: 0,
        padCount: 0,
        padActiveCount: 0,
        padBatchCount: 0,
        padDrawCalls: 0,
        padLightCount: 0,
        source: "unavailable",
      }),
      arenaFog: scene.fog ? Object.freeze({ near: scene.fog.near, far: scene.fog.far }) : null,
      arenaLimits: arenaLimits ? Object.freeze({ ...arenaLimits }) : null,
      arenaLimitReadout: arenaLimits?.readout ?? null,
      rocketCount: rocketMeshes.size,
      rocketVisualContract: "local-body-trail-light-v1",
      rocketTrailCount: rocketMeshes.size,
      rocketLightCount: rocketMeshes.size,
      rocketLightActiveCount: [...rocketMeshes.values()].filter(mesh => mesh.userData.light?.visible).length,
      rocketPoolCapacity: rocketPool.capacity,
      rocketPoolActive: rocketPool.activeCount,
      rocketPoolAvailable: rocketPool.availableCount,
      explosionCount: explosions.length,
      explosionPoolCapacity: explosionPool.capacity,
      explosionPoolActive: explosionPool.activeCount,
      explosionPoolAvailable: explosionPool.availableCount,
      effectPrewarmStatus,
      effectPrewarmCompilePasses,
      eventCount: eventMeshes.filter(mesh => mesh.visible).length,
      eventPoolActive: eventPool.activeCount,
      eventPoolAvailable: eventPool.availableCount,
      eventFeedback: Object.freeze(eventMeshes.filter(mesh => mesh.visible).map(mesh => mesh.userData.event).filter(Boolean)),
      metadataSequence,
      pickupCount: arenaDecoration ? pickupMetadataCount : pickupMeshes.size,
      pickupActiveCount: arenaDecoration ? pickupMetadataActiveCount : [...pickupMeshes.values()].filter(mesh => mesh.visible).length,
      vehicleCount: vehicleList.length,
      vehicleIds: Object.freeze(vehicleList.map(vehicle => vehicle.userData.playerId || null)),
      vehicleRootHeights: Object.freeze(vehicleList.map(vehicle => Number(vehicle.position?.y) || 0)),
      vehicleVisualScales: Object.freeze(vehicleList.map(vehicle => Number(vehicle.userData.visualAlignment?.modelScale) || 1)),
      vehiclePartCount: vehicleList.reduce((total, vehicle) => total + (vehicle.userData.partCount || 0), 0),
      vehicleWheelCount: vehicleList.reduce((total, vehicle) => total + (vehicle.userData.wheels?.length || 0), 0),
      vehicleVisualContract: vehicleList[0]?.userData.visualContract || null,
      vehicleVisibleCount: vehicleList.filter(vehicle => vehicle.visible).length,
      // A vehicle has one paint owner at a time. During the browser asset
      // request both authored and recovery roots remain allocated, but neither
      // is painted; once ready exactly the authored root is visible. These
      // counters make accidental overlap observable without exposing debug UI.
      vehicleFallbackVisibleCount: vehicleList.filter(vehicle => vehicle.userData.fallback?.visible).length,
      vehicleAuthoredVisibleCount: vehicleList.filter(vehicle => vehicle.userData.authoredVehicle?.visible).length,
      vehiclePaintedModelCount: vehicleList.reduce((total, vehicle) => total
        + (vehicle.userData.fallback?.visible ? 1 : 0)
        + (vehicle.userData.authoredVehicle?.visible ? 1 : 0), 0),
      vehicleHealthRatios: Object.freeze(vehicleList.map(vehicle => {
        const visual = vehicle.userData.authoredVehicle || vehicle;
        return Number(visual.userData?.healthFill?.scale?.x ?? vehicle.userData.healthFill?.scale?.x ?? 0);
      })),
      authoredVehicleCount: vehicleList.filter(vehicle => vehicle.userData.authoredVehicle).length,
      authoredAssetReadyCount: vehicleList.filter(vehicle => vehicle.userData.authoredVehicle
        && vehicle.userData.authoredVehicle.userData?.assetState?.status === "ready").length,
      boostFlameCount: vehicleList.reduce((total, vehicle) => total + (vehicle.userData.boostFlames?.filter(flame => flame.visible).length || 0), 0),
      speedTrailCount: vehicleList.reduce((total, vehicle) => {
        const visual = vehicle.userData.authoredVehicle || vehicle;
        const trails = visual.userData?.speedTrails || vehicle.userData.speedTrails;
        return total + (trails?.visible ? (trails.children?.length || 0) : 0);
      }, 0),
      actionPulseCount: vehicleList.filter(vehicle => vehicle.userData.actionPulse?.visible).length,
      actionPulseKinds: Object.freeze(vehicleList.map(vehicle => vehicle.userData.lastActionKind)),
    });
  }

  async function prewarmRocketEffects() {
    if (effectPrewarmPromise) return effectPrewarmPromise;
    effectPrewarmPromise = (async () => {
      if (closed) {
        effectPrewarmStatus = "skipped";
        return false;
      }
      if (effectPrewarmMode === "deferred") {
        // Three real scene renders with extra lights/effects at startup create
        // an avoidable GPU spike. The public path lets normal, individually
        // bounded gameplay frames compile variants lazily instead.
        effectPrewarmStatus = "deferred";
        return false;
      }
      if (typeof renderer.render !== "function") {
        effectPrewarmStatus = "unsupported";
        return false;
      }
      const rockets = [rocketPool.acquire(), rocketPool.acquire()];
      const prewarmExplosions = [explosionPool.acquire(), explosionPool.acquire()];
      const temporaryRoots = [];
      try {
        if (rockets.some(rocket => !rocket) || prewarmExplosions.some(explosion => !explosion)) {
          effectPrewarmStatus = "unavailable";
          return false;
        }
        effectPrewarmStatus = "warming";
        const forwardX = cameraAim.x - cameraPosition.x;
        const forwardY = cameraAim.y - cameraPosition.y;
        const forwardZ = cameraAim.z - cameraPosition.z;
        const magnitude = Math.hypot(forwardX, forwardY, forwardZ) || 1;
        const centerX = cameraPosition.x + forwardX / magnitude * 8;
        const centerY = cameraPosition.y + forwardY / magnitude * 8;
        const centerZ = cameraPosition.z + forwardZ / magnitude * 8;
        for (const [index, team] of ["blue", "red"].entries()) {
          const offset = index === 0 ? -2.2 : 2.2;
          const rocket = rockets[index];
          rocket.position.set(centerX + offset, centerY, centerZ);
          rocket.visible = true;
          rocket.userData.body.material = rocketMaterials[team].body;
          rocket.userData.trail.material = rocketMaterials[team].trail;
          rocket.userData.light.color.setHex(ROCKET_COLOURS[team]);
          rocket.userData.light.visible = false;
          scene.add(rocket);
          temporaryRoots.push(rocket);

          const explosion = prewarmExplosions[index];
          const effect = explosion.userData;
          explosion.position.set(centerX + offset, centerY - .5, centerZ);
          setUniformScale(explosion, 1);
          effect.core.position.set(0, 0, 0);
          setUniformScale(effect.core, 1);
          effect.coreMaterial.opacity = 1;
          effect.light.visible = false;
          effect.sparks.forEach(({ spark }) => { spark.material = explosionMaterials[team]; });
          explosion.visible = true;
          scene.add(explosion);
          temporaryRoots.push(explosion);
        }
        const compileVariant = async () => {
          if (closed) return false;
          // A real draw is the portable shader warm-up path. Avoid both
          // compileAsync (some drivers expose an undefined program while
          // checking isReady) and synchronous compile (software WebGL can
          // block the browser thread for an unbounded time). The renderer
          // compiles the exact visible variant as part of this draw.
          renderer.setRenderTarget?.(null);
          renderer.render(scene, camera);
          effectPrewarmCompilePasses += 1;
          return true;
        };
        rockets[0].userData.light.visible = true;
        if (!await compileVariant()) return false;
        rockets[0].userData.light.visible = false;
        prewarmExplosions[0].userData.light.visible = true;
        if (!await compileVariant()) return false;
        rockets[0].userData.light.visible = true;
        if (!await compileVariant()) return false;
        effectPrewarmStatus = "ready";
        return true;
      } catch {
        // Shader warm-up is opportunistic. A context/compiler failure must
        // never make an otherwise-authoritative match unplayable.
        effectPrewarmStatus = "failed";
        return false;
      } finally {
        temporaryRoots.forEach(root => {
          scene.remove(root);
          root.visible = false;
        });
        rockets.forEach(rocket => { if (rocket) rocketPool.release(rocket); });
        prewarmExplosions.forEach(explosion => { if (explosion) explosionPool.release(explosion); });
      }
    })();
    return effectPrewarmPromise;
  }

  async function ready() {
    // The beta constructs the renderer immediately before applying its first
    // snapshot. Yield once so that snapshot can register vehicles/assets, then
    // retain the local client's "ready before first projectile" guarantee.
    await Promise.resolve();
    await Promise.allSettled(authoredUpgradePromises);
    await Promise.allSettled([...cars.values()].map(vehicle => vehicle.userData.authoredAssetReady).filter(Boolean));
    await prewarmRocketEffects();
    return metrics();
  }

  function dispose() {
    if (closed) return;
    closed = true;
    if (resizeFrame !== null) {
      const cancel = view?.cancelAnimationFrame
        || (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null);
      cancel?.(resizeFrame);
      resizeFrame = null;
    }
    pendingResizeEntry = null;
    resetP2PWasmCameraFramingState(cameraFollowState);
    cameraTime = null;
    cameraInitialized = false;
    cameraFrame = null;
    lastRoundSerial = null;
    lastPresentationUpdateAt = null;
    cameraRespawnSerial = null;
    cameraResetCount = 0;
    lockedTargetId = null;
    cameraPosition.set(0, 0, 0);
    cameraAim.set(0, 0, 0);
    camera.fov = P2P_WASM_CAMERA_BASE_FOV;
    camera.updateProjectionMatrix();
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    if (windowResizeAttached) {
      view?.removeEventListener?.("resize", onResize);
      windowResizeAttached = false;
    }
    for (const [id, vehicle] of cars) {
      vehicle.userData.disposed = true;
      vehicle.userData.dispose?.();
      scene.remove(vehicle);
      cars.delete(id);
    }
    for (const [id, mesh] of rocketMeshes) {
      scene.remove(mesh);
      mesh.visible = false;
      rocketPool.release(mesh);
      rocketMeshes.delete(id);
    }
    eventMeshes.forEach(mesh => {
      scene.remove(mesh);
      mesh.visible = false;
      eventPool.release(mesh);
    });
    eventMeshes.length = 0;
    explosions.forEach(explosion => {
      scene.remove(explosion);
      explosion.visible = false;
      explosionPool.release(explosion);
    });
    explosions.length = 0;
    rocketBodyGeometry.dispose();
    rocketTrailGeometry.dispose();
    explosionCoreGeometry.dispose();
    explosionSparkGeometry.dispose();
    Object.values(rocketMaterials).forEach(materials => Object.values(materials).forEach(material => material.dispose()));
    Object.values(explosionMaterials).forEach(material => material.dispose());
    explosionCoreMaterials.forEach(material => material.dispose());
    eventGeometry.dispose();
    Object.values(eventMaterials).forEach(material => material.dispose());
    pickupGeometry.dispose();
    Object.values(pickupMaterials).forEach(material => material.dispose());
    pickupMeshes.clear();
    laserGeometry.dispose();
    laser.material.dispose();
    disposeArena();
    diagnosticsTarget?.dispose?.();
    renderer.dispose();
    if (contextListenersAttached) {
      canvas.removeEventListener?.("webglcontextlost", onWebGLContextLost, false);
      canvas.removeEventListener?.("webglcontextrestored", onWebGLContextRestored, false);
      contextListenersAttached = false;
    }
  }

  const setTargetId = targetId => {
    lockedTargetId = typeof targetId === "string" && targetId.length > 0 ? targetId : null;
    return lockedTargetId;
  };

  const setFocusCarId = id => {
    focusCarId = typeof id === "string" && id.length > 0 ? id : null;
    return focusCarId;
  };

  // Test and diagnostics hook: the caller can verify that a stable player id
  // keeps the same presentation root while snapshots reorder the roster.
  const getVehicleRoot = id => (typeof id === "string" ? cars.get(id) || null : null);

  const getAimCandidates = () => {
    if (closed || !lastPresentationState || !camera || typeof aimProjectionPoint.project !== "function") return Object.freeze([]);
    const localId = typeof focusCarId === "string" ? focusCarId : lastPresentationState.cars?.[0]?.id;
    camera.updateMatrixWorld?.();
    return collectP2PAimCandidates({
      cars: lastPresentationState.cars,
      focusCarId: localId,
      project: point => {
        aimProjectionPoint.set(toScene(point.x), toScene(point.h), toScene(point.z)).project(camera);
        return { x: aimProjectionPoint.x, y: aimProjectionPoint.y, z: aimProjectionPoint.z };
      },
    });
  };

  const setMetadata = metadata => {
    if (closed) return false;
    if (metadata === null || metadata === undefined) {
      metadataSequence = 0;
      pickupMetadataCount = 0;
      pickupMetadataActiveCount = 0;
      updatePickups(null);
      return true;
    }
    if (!Number.isSafeInteger(metadata.sequence) || metadata.sequence < 1 || metadata.sequence <= metadataSequence) return false;
    metadataSequence = metadata.sequence;
    updatePickups(metadata);
    return true;
  };

  return Object.freeze({ update, render, recordFrame, ready, metrics, setTargetId, setFocusCarId, getVehicleRoot, getAimCandidates, setMetadata, dispose });
}
