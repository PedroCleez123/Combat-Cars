import { COMBAT_ALPHA_MAP, combatAlphaMapLayout } from "./combat-alpha-map.js";
import { getArenaVisualProfile } from "./arena-visual-profile.js";
import { rocketSimArenaForWorldMode, rocketSimArenaProfile } from "./rocketsim-arena-profile.js";

const DEFAULT_ARENA = Object.freeze({ halfWidth: 62, halfDepth: 46, height: 24, curveRadius: 0 });
const COMBAT_MODES = new Set(["combat-alpha", "rocketsim-combat-alpha"]);
// GLTFLoader is vendored with its relative BufferGeometryUtils dependency so
// the packaged portable does not rely on Three's excluded examples directory.
const BROWSER_GLTF_LOADER_URL = "/src/assets/vehicle/GLTFLoader.js";
const DEFAULT_ASSET_PROFILE = Object.freeze({
  enabled: true,
  skybowl: Object.freeze({ url: "/src/assets/arena/skybowl.glb", maxBytes: 900_000, maxTriangles: 12_000, scalePadding: .96 }),
  boostPads: Object.freeze({ url: "/src/assets/arena/boost-pads.glb", maxBytes: 260_000, maxTriangles: 5_000, largeScale: 1.45, smallScale: 1.85 }),
  budget: Object.freeze({ maxBytes: 1_160_000, maxTriangles: 17_000, maxDrawCalls: 80 }),
});

// Positions are presentation-only landmarks. They intentionally derive from
// the current arena bounds instead of being read from gameplay pad state.
const PAD_LAYOUT = Object.freeze([
  { x: -.72, z: -.68, size: "large" }, { x: .72, z: -.68, size: "large" },
  { x: -.72, z: .68, size: "large" }, { x: .72, z: .68, size: "large" },
  { x: 0, z: -.7, size: "small" }, { x: 0, z: .7, size: "small" },
  { x: -.48, z: 0, size: "small" }, { x: .48, z: 0, size: "small" },
  { x: -.16, z: -.28, size: "small" }, { x: .16, z: .28, size: "small" },
]);

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function mergeAssetProfile(profileAssets, overrides) {
  const source = profileAssets || DEFAULT_ASSET_PROFILE;
  const merged = {
    ...DEFAULT_ASSET_PROFILE,
    ...source,
    ...overrides,
    skybowl: { ...DEFAULT_ASSET_PROFILE.skybowl, ...(source.skybowl || {}), ...(overrides?.skybowl || {}) },
    boostPads: { ...DEFAULT_ASSET_PROFILE.boostPads, ...(source.boostPads || {}), ...(overrides?.boostPads || {}) },
    budget: { ...DEFAULT_ASSET_PROFILE.budget, ...(source.budget || {}), ...(overrides?.budget || {}) },
  };
  return merged;
}

function resolveArena(mode, supplied) {
  if (supplied && Number.isFinite(supplied.halfWidth) && Number.isFinite(supplied.halfDepth) && Number.isFinite(supplied.height)) {
    return {
      halfWidth: Number(supplied.halfWidth),
      halfDepth: Number(supplied.halfDepth),
      height: Number(supplied.height),
      curveRadius: finite(supplied.curveRadius, 0),
      cornered: supplied.cornered === true,
      expanded: supplied.expanded === true,
    };
  }
  const arenaName = COMBAT_MODES.has(mode) ? "combat-alpha" : rocketSimArenaForWorldMode(mode) || mode;
  return rocketSimArenaProfile(arenaName) || DEFAULT_ARENA;
}

function isCombatMode(mode) {
  return COMBAT_MODES.has(mode);
}

/**
 * Pure data contract for the presentation skin. Every coordinate is derived
 * from the named R20 arena bounds; no collider, body or gameplay authority is
 * created here. `createArenaDecoration` consumes this data at render time.
 */
export function buildArenaDecorationSpec({
  mode = "rocketsim-combat-alpha",
  arena: suppliedArena,
  profile: suppliedProfile,
} = {}) {
  const arena = resolveArena(mode, suppliedArena);
  const profile = suppliedProfile || getArenaVisualProfile(mode);
  const palette = profile.palette || {};
  const decoration = profile.decoration || {};
  const width = arena.halfWidth * 2;
  const depth = arena.halfDepth * 2;
  const panelOpacity = finite(decoration.panelOpacity, .14);
  const panelEdgeOpacity = finite(decoration.panelEdgeOpacity, .62);
  const guideOpacity = finite(decoration.guideOpacity, .44);
  const blue = profile.blueZone ?? palette.blue ?? 0x3db7ff;
  const red = profile.redZone ?? palette.red ?? 0xff8374;
  const objective = profile.landmark ?? palette.objective ?? 0xc5f3ed;
  const panel = palette.panel ?? profile.ceiling ?? 0x163746;
  const panelEdge = palette.panelEdge ?? profile.perimeter ?? 0xb5edf0;
  const hazard = palette.hazard ?? 0xffc35a;
  const assets = mergeAssetProfile(profile.assets);
  const combat = isCombatMode(mode);
  let beacons = [];
  let hazards = [];
  let mapLayout = null;
  if (combat) {
    mapLayout = combatAlphaMapLayout();
    const xScale = arena.halfWidth / mapLayout.arena.halfWidth;
    const zScale = arena.halfDepth / mapLayout.arena.halfDepth;
    beacons = mapLayout.beacons.map(({ team, x, z }) => ({ team, x: x * xScale, y: 0, z: z * zScale }));
    hazards = mapLayout.hazards.map(({ id, x, z }) => ({ id, x: x * xScale, y: .04, z: z * zScale }));
  }
  const lanes = combat && decoration.showLaneGuides !== false ? COMBAT_ALPHA_MAP.landmarks.laneGuideZ.map(z => ({
    id: `lane-${z > 0 ? "south" : "north"}`,
    from: [-arena.halfWidth * .74, .055, z * arena.halfDepth / mapLayout.arena.halfDepth],
    to: [arena.halfWidth * .74, .055, z * arena.halfDepth / mapLayout.arena.halfDepth],
  })) : [];
  const padLayout = mapLayout?.pickups || PAD_LAYOUT;
  const pads = padLayout.map((pad, id) => ({
    id,
    size: pad.size,
    x: mapLayout ? pad.x * arena.halfWidth / mapLayout.arena.halfWidth : pad.x * arena.halfWidth,
    y: .035,
    z: mapLayout ? pad.z * arena.halfDepth / mapLayout.arena.halfDepth : pad.z * arena.halfDepth,
  }));
  // Combat-alpha remains free of crane and scrap-pile cover.  A few suspended
  // light gantries are the only industrial dressing: their parallax makes the
  // large volume readable without placing decals, seams or geometry inside a
  // driving line.
  const industrialConfig = decoration.industrial || {};
  const fixtureHeight = Math.min(arena.height - 2.4, Math.max(arena.height * .55, finite(industrialConfig.fixtureHeight, arena.height * .8)));
  const industrial = industrialConfig.enabled === true ? {
    fixtureHeight,
    fixtureGlow: Math.max(0, finite(industrialConfig.fixtureGlow, .42)),
    fixtures: [
      { id: "northwest", x: -arena.halfWidth * .52, y: fixtureHeight, z: -arena.halfDepth * .58, width: 4.8 },
      { id: "northeast", x: arena.halfWidth * .52, y: fixtureHeight, z: -arena.halfDepth * .58, width: 4.8 },
      { id: "southwest", x: -arena.halfWidth * .52, y: fixtureHeight, z: arena.halfDepth * .58, width: 4.8 },
      { id: "southeast", x: arena.halfWidth * .52, y: fixtureHeight, z: arena.halfDepth * .58, width: 4.8 },
    ],
  } : null;
  const upperShellBand = combat ? {
    minY: arena.height - 16,
    maxY: arena.height - 1,
  } : null;
  const perimeterConfig = decoration.perimeter || {};
  const perimeterY = upperShellBand
    ? Math.min(upperShellBand.maxY, Math.max(upperShellBand.minY, finite(perimeterConfig.y, arena.height - 6)))
    : 0;
  const perimeter = combat && perimeterConfig.enabled === true ? {
    instanced: true,
    sharedGeometry: true,
    upperShellBand,
    moduleSize: [...(perimeterConfig.moduleSize || [4.2, 2.2, .34])],
    lampSize: [...(perimeterConfig.lampSize || [3, .14, .14])],
    frameColor: finite(perimeterConfig.frameColor, 0x3f555c),
    frameEmissive: finite(perimeterConfig.frameEmissive, 0x0d1f22),
    frameEmissiveIntensity: finite(perimeterConfig.frameEmissiveIntensity, .18),
    lampColor: finite(perimeterConfig.lampColor, 0xa8d7d2),
    lampEmissive: finite(perimeterConfig.lampEmissive, 0x6cc8c2),
    lampEmissiveIntensity: finite(perimeterConfig.lampEmissiveIntensity, .9),
    modules: [
      { id: "northwest", x: -arena.halfWidth + finite(perimeterConfig.insetX, 24), y: perimeterY, z: -arena.halfDepth + finite(perimeterConfig.insetZ, 24), yaw: 0, visualOnly: true },
      { id: "northeast", x: arena.halfWidth - finite(perimeterConfig.insetX, 24), y: perimeterY, z: -arena.halfDepth + finite(perimeterConfig.insetZ, 24), yaw: Math.PI, visualOnly: true },
      { id: "southwest", x: -arena.halfWidth + finite(perimeterConfig.insetX, 24), y: perimeterY, z: arena.halfDepth - finite(perimeterConfig.insetZ, 24), yaw: Math.PI, visualOnly: true },
      { id: "southeast", x: arena.halfWidth - finite(perimeterConfig.insetX, 24), y: perimeterY, z: arena.halfDepth - finite(perimeterConfig.insetZ, 24), yaw: 0, visualOnly: true },
    ],
  } : null;
  const panels = decoration.showWallPanels === false ? [] : [
    { id: "blue-wall-panel", team: "blue", color: profile.combatBlueWash ?? blue, opacity: panelOpacity, position: [-arena.halfWidth + .025, arena.height * .28, 0], rotation: [0, Math.PI / 2, 0], size: [depth * .72, arena.height * .48] },
    { id: "red-wall-panel", team: "red", color: profile.combatRedWash ?? red, opacity: panelOpacity, position: [arena.halfWidth - .025, arena.height * .28, 0], rotation: [0, -Math.PI / 2, 0], size: [depth * .72, arena.height * .48] },
    { id: "north-rail-panel", team: "neutral", color: panel, opacity: panelOpacity * .72, position: [0, arena.height * .2, -arena.halfDepth + .025], rotation: [0, 0, 0], size: [width * .5, arena.height * .34] },
    { id: "south-rail-panel", team: "neutral", color: panel, opacity: panelOpacity * .72, position: [0, arena.height * .2, arena.halfDepth - .025], rotation: [0, Math.PI, 0], size: [width * .5, arena.height * .34] },
  ];
  return freeze({
    mode,
    visualProfile: profile.id || (profile === getArenaVisualProfile(mode) ? "scrapyard" : "custom"),
    visualOnly: true,
    arena,
    panels,
    panelEdge: { color: panelEdge, opacity: panelEdgeOpacity, inset: .55, visible: decoration.showPerimeterLine !== false },
    laneGuides: lanes,
    pads,
    padDecorationSource: assets.enabled === false ? "procedural" : "asset-or-procedural",
    assets,
    industrial,
    upperShellBand,
    perimeter,
    beacons,
    hazards,
    objective: { x: COMBAT_ALPHA_MAP.landmarks.centerRing.x, y: .04, z: COMBAT_ALPHA_MAP.landmarks.centerRing.z, color: objective, radius: finite(decoration.objectiveRadius, 2.65) },
    lights: [
      { id: "blue-wash", color: blue, position: [-arena.halfWidth + 5, arena.height * .37, -arena.halfDepth * .63], intensity: finite(profile.lighting?.wash, 38), distance: finite(decoration.teamWashDistance, 20) },
      { id: "red-wash", color: red, position: [arena.halfWidth - 5, arena.height * .37, arena.halfDepth * .63], intensity: finite(profile.lighting?.wash, 38), distance: finite(decoration.teamWashDistance, 20) },
    ],
    beaconStyle: {
      blue,
      red,
      height: finite(decoration.beaconHeight, 3.4),
      radius: finite(decoration.beaconRadius, 1.05),
      lightIntensity: finite(decoration.teamWashIntensity, 3.8),
      lightDistance: finite(decoration.teamWashDistance, 20),
    },
    guideOpacity,
    hazardColor: hazard,
  });
}

/**
 * Exact render-dimensional contract for the two native combat obstacles. The
 * native map remains authoritative; this only prevents the visual pass from
 * drifting away from its collision-aligned dimensions.
 */
export function combatAlphaObstacleVisualSpec() {
  const block = COMBAT_ALPHA_MAP.obstacles.find(obstacle => obstacle.id === "central-block");
  const ramp = COMBAT_ALPHA_MAP.obstacles.find(obstacle => obstacle.id === "south-ramp");
  if (!block || !ramp) throw new Error("combat-alpha obstacle visual spec requires the native block and ramp");
  return freeze({
    block: {
      x: block.x,
      z: block.z,
      width: block.width,
      height: block.height,
      depth: block.depth,
    },
    // The ramp mesh is authored around half extents; native run/width stay
    // twice these values so the silhouette and collision footprint match.
    ramp: {
      x: ramp.x,
      z: ramp.z,
      run: ramp.run / 2,
      width: ramp.width / 2,
      height: ramp.height,
    },
  });
}

/**
 * Presentation-only companions for the six COV-01 cover colliders. The
 * descriptor is deliberately sourced from the gameplay map, but it never
 * exposes a body, collider, pickup or network field to the renderer.
 */
export function combatAlphaCoverVisualSpec() {
  const covers = COMBAT_ALPHA_MAP.obstacles
    .filter(obstacle => obstacle.role === "cover")
    .map(obstacle => ({
      id: obstacle.id,
      nativeColliderId: obstacle.id,
      visualOnly: true,
      visualKind: obstacle.visualKind,
      x: obstacle.x,
      z: obstacle.z,
      width: obstacle.width,
      depth: obstacle.depth,
      height: obstacle.height,
    }));
  if (covers.length !== 6) throw new Error("combat-alpha visual cover spec requires six cover descriptors");
  return freeze({
    contract: "combat-alpha-cover-visual-v1",
    visualOnly: true,
    covers,
  });
}

const COVER_TIRE_COLUMNS = 4;
const COVER_TIRE_ROWS = 4;
const COVER_TIRE_LEVELS = 8;
const COVER_TIRE_MAJOR_RADIUS = .7;
const COVER_TIRE_TUBE_RADIUS = .3;
const COVER_TIRE_CROSS_SECTION_SEGMENTS = 8;
const COVER_TIRE_RING_SEGMENTS = 12;
const COVER_TIRE_OUTER_RADIUS = COVER_TIRE_MAJOR_RADIUS + COVER_TIRE_TUBE_RADIUS;
// With 12 ring segments and 8 cross-section segments, the sampled extrema are
// exact in each rotated axis. This lets the tangent grid explain the one
// authoritative 8×8×4.8 UU box without overlaps or visual overhang.
const COVER_TIRE_LOCAL_BOUNDS = Object.freeze({
  minX: -COVER_TIRE_OUTER_RADIUS,
  maxX: COVER_TIRE_OUTER_RADIUS,
  minY: -COVER_TIRE_TUBE_RADIUS,
  maxY: COVER_TIRE_TUBE_RADIUS,
  minZ: -COVER_TIRE_OUTER_RADIUS,
  maxZ: COVER_TIRE_OUTER_RADIUS,
});
const COVER_TIRE_INSTANCE_COUNT = COVER_TIRE_COLUMNS * COVER_TIRE_ROWS * COVER_TIRE_LEVELS * 2;

function tirePileAxis(minBound, maxBound, localMin, localMax, count, axis) {
  if (![minBound, maxBound, localMin, localMax].every(Number.isFinite) || maxBound < minBound || localMax < localMin || count < 2) {
    throw new Error(`invalid tire-cover ${axis} envelope`);
  }
  const min = minBound - localMin;
  const max = maxBound - localMax;
  if (max < min) throw new Error(`tire-cover ${axis} is too small for its visual pile`);
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

/**
 * Derives a dense, presentation-only tire pile from its one authoritative
 * static box. The rings are tangent in all three axes; the individual gaps
 * remain non-traversable because:
 * RocketSim still owns one solid block through `nativeColliderId`.
 */
export function combatAlphaTirePileLayout(cover) {
  if (!cover || cover.visualKind !== "tires") throw new Error("tire pile requires a tire cover descriptor");
  const xs = tirePileAxis(cover.x - cover.width / 2, cover.x + cover.width / 2, COVER_TIRE_LOCAL_BOUNDS.minX, COVER_TIRE_LOCAL_BOUNDS.maxX, COVER_TIRE_COLUMNS, "width");
  const ys = tirePileAxis(0, cover.height, COVER_TIRE_LOCAL_BOUNDS.minY, COVER_TIRE_LOCAL_BOUNDS.maxY, COVER_TIRE_LEVELS, "height");
  const zs = tirePileAxis(cover.z - cover.depth / 2, cover.z + cover.depth / 2, COVER_TIRE_LOCAL_BOUNDS.minZ, COVER_TIRE_LOCAL_BOUNDS.maxZ, COVER_TIRE_ROWS, "depth");
  const instances = [];
  for (const y of ys) {
    for (const z of zs) {
      for (const x of xs) instances.push({ x, y, z, rotationX: Math.PI / 2 });
    }
  }
  return freeze({
    contract: "combat-alpha-tire-pile-layout-v1",
    nativeColliderId: cover.nativeColliderId,
    columns: COVER_TIRE_COLUMNS,
    rows: COVER_TIRE_ROWS,
    levels: COVER_TIRE_LEVELS,
    majorRadius: COVER_TIRE_MAJOR_RADIUS,
    tubeRadius: COVER_TIRE_TUBE_RADIUS,
    localBounds: COVER_TIRE_LOCAL_BOUNDS,
    instances,
  });
}

function geometryTriangleCount(geometry) {
  const index = geometry?.index;
  const positions = geometry?.attributes?.position;
  return index ? Math.floor(index.count / 3) : positions ? Math.floor(positions.count / 3) : 0;
}

/**
 * Builds the shared low-cost Three.js cover companions. Containers and hazard
 * bands are one instanced batch each; the two barricades share one instanced
 * torus geometry. The returned disposer owns only geometry and fallback
 * materials it created itself; callers retain ownership of supplied skins.
 */
export function createCombatAlphaCoverVisuals({ THREE, parent = null, materials = {} } = {}) {
  const spec = combatAlphaCoverVisualSpec();
  if (!THREE || typeof THREE.Group !== "function" || typeof THREE.Mesh !== "function") {
    return {
      root: null,
      spec,
      metrics: () => ({ drawCalls: 0, triangles: 0, tireInstanceCount: 0 }),
      dispose() {},
    };
  }
  const root = new THREE.Group();
  root.name = "combat-alpha-cover-visuals";
  root.userData = {
    visualOnly: true,
    role: "combat-alpha-cover-visuals",
    nativeColliderIds: Object.freeze(spec.covers.map(cover => cover.nativeColliderId)),
    nativeColliderCount: spec.covers.length,
    contract: spec.contract,
  };
  const ownedMaterials = new Set();
  const resolveMaterial = (key, options) => {
    if (materials[key]) return materials[key];
    const value = new THREE.MeshStandardMaterial(options);
    ownedMaterials.add(value);
    return value;
  };
  const containerMaterial = resolveMaterial("container", {
    color: 0x54666a, roughness: .82, metalness: .28,
  });
  const hazardMaterial = resolveMaterial("hazard", {
    color: 0xb4872f, emissive: 0x2b1a04, emissiveIntensity: .22,
    roughness: .68, metalness: .38,
  });
  const tireMaterial = resolveMaterial("tire", {
    color: 0x15191a, roughness: .94, metalness: .04,
  });
  const geometries = new Set();
  const containerCovers = spec.covers.filter(cover => cover.visualKind === "container");
  const tireCovers = spec.covers.filter(cover => cover.visualKind === "tires");

  const makeBatch = (geometry, material, count, name, role) => {
    geometries.add(geometry);
    const canInstance = typeof THREE.InstancedMesh === "function"
      && typeof THREE.Object3D === "function";
    if (canInstance) {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = name;
      mesh.userData = { visualOnly: true, role, source: "instanced" };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      return { mesh, canInstance, helper: new THREE.Object3D() };
    }
    const group = new THREE.Group();
    group.name = name;
    group.userData = { visualOnly: true, role, source: "shared-fallback" };
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { visualOnly: true, role };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    root.add(group);
    return { mesh: group, canInstance: false, helper: null };
  };

  const containerGeometry = new THREE.BoxGeometry(1, 1, 1);
  const hazardGeometry = new THREE.BoxGeometry(1, 1, 1);
  const tireGeometry = new THREE.TorusGeometry(
    COVER_TIRE_MAJOR_RADIUS,
    COVER_TIRE_TUBE_RADIUS,
    COVER_TIRE_CROSS_SECTION_SEGMENTS,
    COVER_TIRE_RING_SEGMENTS,
  );
  const containerBatch = makeBatch(containerGeometry, containerMaterial, containerCovers.length, "combat-alpha-container-covers", "container-cover");
  const hazardBatch = makeBatch(hazardGeometry, hazardMaterial, containerCovers.length, "combat-alpha-container-hazard-bands", "container-hazard-band");
  const tireBatch = makeBatch(tireGeometry, tireMaterial, COVER_TIRE_INSTANCE_COUNT, "combat-alpha-tire-covers", "tire-cover");

  const place = (batch, index, position, scale, rotationX = 0) => {
    if (batch.canInstance) {
      batch.helper.position.set(...position);
      batch.helper.rotation.set(rotationX, 0, 0);
      batch.helper.scale.set(...scale);
      batch.helper.updateMatrix();
      batch.mesh.setMatrixAt(index, batch.helper.matrix);
    } else {
      const mesh = batch.mesh.children[index];
      mesh.position.set(...position);
      mesh.rotation.x = rotationX;
      if (typeof mesh.scale?.set === "function") mesh.scale.set(...scale);
      else if (mesh.scale) {
        ["x", "y", "z"].forEach((axis, axisIndex) => { mesh.scale[axis] = scale[axisIndex]; });
      }
    }
  };
  containerCovers.forEach((cover, index) => {
    place(containerBatch, index, [cover.x, cover.height / 2, cover.z], [cover.width, cover.height, cover.depth]);
    place(hazardBatch, index, [cover.x, cover.height * .72, cover.z], [cover.width + .12, .28, cover.depth + .12]);
  });
  let tireIndex = 0;
  for (const cover of tireCovers) {
    for (const tire of combatAlphaTirePileLayout(cover).instances) {
      place(tireBatch, tireIndex++, [tire.x, tire.y, tire.z], [1, 1, 1], tire.rotationX);
    }
  }
  for (const batch of [containerBatch, hazardBatch, tireBatch]) {
    if (batch.canInstance) batch.mesh.instanceMatrix.needsUpdate = true;
  }
  markVisualOnly(root, "combat-alpha-cover-visual");
  parent?.add?.(root);

  const triangleCount = geometryTriangleCount(containerGeometry) * containerCovers.length
    + geometryTriangleCount(hazardGeometry) * containerCovers.length
    + geometryTriangleCount(tireGeometry) * COVER_TIRE_INSTANCE_COUNT;
  const metrics = () => ({
    drawCalls: 3,
    triangles: triangleCount,
    tireInstanceCount: COVER_TIRE_INSTANCE_COUNT,
    containerInstanceCount: containerCovers.length,
    nativeColliderCount: spec.covers.length,
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    parent?.remove?.(root);
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of ownedMaterials) material.dispose?.();
  };
  return { root, spec, metrics, dispose };
}

function setOpacity(material, value) {
  if (material && "opacity" in material) material.opacity = value;
}

function addLine(THREE, parent, points, material, name) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
  const line = new THREE.Line(geometry, material);
  line.name = name;
  line.userData = { visualOnly: true, role: "arena-line" };
  parent.add(line);
  return line;
}

function basicMaterial(THREE, color, opacity = 1, side = THREE.DoubleSide) {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, side });
}

function makePanel(THREE, parent, descriptor) {
  const material = basicMaterial(THREE, descriptor.color, descriptor.opacity);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...descriptor.size), material);
  mesh.name = descriptor.id;
  mesh.position.set(...descriptor.position);
  mesh.rotation.set(...descriptor.rotation);
  mesh.userData = { visualOnly: true, role: "arena-panel", team: descriptor.team };
  parent.add(mesh);
  return mesh;
}

function makeBeacon(THREE, parent, descriptor, style) {
  const group = new THREE.Group();
  group.name = `${descriptor.team}-beacon`;
  group.position.set(descriptor.x, descriptor.y, descriptor.z);
  group.userData = { visualOnly: true, role: "team-beacon", team: descriptor.team };
  const color = descriptor.team === "blue" ? style.blue : style.red;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(style.radius, .09, 8, 24), basicMaterial(THREE, color, .95));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .11;
  group.add(ring);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.075, .11, style.height, 10), basicMaterial(THREE, color, .95));
  mast.position.y = style.height / 2;
  group.add(mast);
  const light = new THREE.PointLight(color, style.lightIntensity, style.lightDistance, 2);
  light.position.y = style.height * .8;
  group.add(light);
  group.userData.ring = ring;
  group.userData.light = light;
  markVisualOnly(group, "team-beacon");
  parent.add(group);
  return group;
}

function makeHazard(THREE, parent, descriptor, color) {
  const marker = new THREE.Mesh(new THREE.RingGeometry(1.65, 1.8, 20), basicMaterial(THREE, color, .34));
  marker.name = `hazard-${descriptor.id}`;
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(descriptor.x, descriptor.y, descriptor.z);
  marker.userData = { visualOnly: true, role: "hazard-landmark", hazardId: descriptor.id };
  parent.add(marker);
  return marker;
}

function makeIndustrialFixture(THREE, parent, descriptor, glow) {
  const group = new THREE.Group();
  group.name = `industrial-fixture-${descriptor.id}`;
  group.position.set(descriptor.x, descriptor.y, descriptor.z);
  group.userData = { visualOnly: true, role: "industrial-fixture" };
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(descriptor.width, .3, .82),
    new THREE.MeshStandardMaterial({ color: 0x18292e, roughness: .72, metalness: .54 }),
  );
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(descriptor.width * .78, .08, .2),
    new THREE.MeshStandardMaterial({ color: 0x8bc4c2, emissive: 0x5ea9a6, emissiveIntensity: glow, roughness: .38, metalness: .15 }),
  );
  lamp.position.y = -.18;
  const leftCable = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 3.1, 6), new THREE.MeshStandardMaterial({ color: 0x172328, roughness: .86, metalness: .28 }));
  const rightCable = leftCable.clone();
  leftCable.position.set(-descriptor.width * .36, 1.55, 0);
  rightCable.position.set(descriptor.width * .36, 1.55, 0);
  group.add(housing, lamp, leftCable, rightCable);
  markVisualOnly(group, "industrial-fixture");
  parent.add(group);
  return group;
}

function createPerimeterModules(THREE, parent, perimeter) {
  const modules = perimeter?.modules || [];
  if (!modules.length) return null;
  const frameGeometry = new THREE.BoxGeometry(...perimeter.moduleSize);
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: perimeter.frameColor,
    emissive: perimeter.frameEmissive,
    emissiveIntensity: perimeter.frameEmissiveIntensity,
    roughness: .68,
    metalness: .55,
  });
  const lampGeometry = new THREE.BoxGeometry(...perimeter.lampSize);
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: perimeter.lampColor,
    emissive: perimeter.lampEmissive,
    emissiveIntensity: perimeter.lampEmissiveIntensity,
    roughness: .32,
    metalness: .18,
  });
  const canInstance = typeof THREE.InstancedMesh === "function" && typeof THREE.Object3D === "function";
  const makeBatch = (geometry, material, name, role) => {
    if (canInstance) {
      const mesh = new THREE.InstancedMesh(geometry, material, modules.length);
      mesh.name = name;
      mesh.userData = { visualOnly: true, role, source: "instanced" };
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    const group = new THREE.Group();
    group.name = name;
    group.userData = { visualOnly: true, role, source: "shared" };
    for (let index = 0; index < modules.length; index += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { visualOnly: true, role };
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    parent.add(group);
    return group;
  };
  const frames = makeBatch(frameGeometry, frameMaterial, "industrial-perimeter-frames", "perimeter-frame");
  const lamps = makeBatch(lampGeometry, lampMaterial, "industrial-perimeter-lamps", "perimeter-lamp");
  const place = (module, index) => {
    const yaw = finite(module.yaw, 0);
    const lampZ = module.z < 0 ? .24 : -.24;
    if (canInstance) {
      const helper = new THREE.Object3D();
      helper.position.set(module.x, module.y, module.z);
      helper.rotation.set(0, yaw, 0);
      helper.updateMatrix();
      frames.setMatrixAt(index, helper.matrix);
      helper.position.set(module.x, module.y - .55, module.z + lampZ);
      helper.updateMatrix();
      lamps.setMatrixAt(index, helper.matrix);
      return;
    }
    frames.children[index].position.set(module.x, module.y, module.z);
    frames.children[index].rotation.y = yaw;
    lamps.children[index].position.set(module.x, module.y - .55, module.z + lampZ);
    lamps.children[index].rotation.y = yaw;
  };
  modules.forEach(place);
  if (canInstance) {
    frames.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    frames.computeBoundingSphere?.();
    lamps.computeBoundingSphere?.();
  }
  return { frames, lamps, frameGeometry, frameMaterial, lampGeometry, lampMaterial, instanced: canInstance };
}

function makeFallbackPad(THREE, parent, descriptor, palette = {}) {
  const root = new THREE.Group();
  root.name = `boost-pad-fallback-${descriptor.id}`;
  root.position.set(descriptor.x, descriptor.y, descriptor.z);
  root.userData = { visualOnly: true, role: "boost-pad-decoration", padId: descriptor.id, source: "procedural" };
  const radius = descriptor.size === "large" ? 1.6 : 1.08;
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(radius * .84, radius * .84, .12, 20), basicMaterial(THREE, palette.energy ?? 0xffa529, .9));
  disk.position.y = .06;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .06, 8, 20), basicMaterial(THREE, palette.ring ?? 0xffc35a, .95));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .13;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius * .34, radius * .62, descriptor.size === "large" ? 2.2 : 1.55, 12, 1, true), basicMaterial(THREE, palette.energy ?? 0xffa529, .2));
  beam.position.y = descriptor.size === "large" ? 1.1 : .78;
  root.add(disk, ring, beam);
  const light = new THREE.PointLight(palette.energy ?? 0xffa529, descriptor.size === "large" ? 2.3 : 1.4, descriptor.size === "large" ? 8 : 5);
  light.position.y = beam.position.y;
  root.add(light);
  root.userData.disk = disk;
  root.userData.ring = ring;
  root.userData.beam = beam;
  root.userData.light = light;
  markVisualOnly(root, "boost-pad-decoration");
  parent.add(root);
  return root;
}

function createBatchedFallbackPads(THREE, parent, descriptors, palette = {}) {
  if (typeof THREE.InstancedMesh !== "function" || typeof THREE.Matrix4 !== "function"
      || typeof THREE.Object3D !== "function") return null;
  const batches = [];
  const handles = new Map();
  const helper = new THREE.Object3D();
  const bySize = new Map();
  for (const size of ["large", "small"]) {
    const entries = descriptors.filter(descriptor => descriptor.size === size);
    if (!entries.length) continue;
    const radius = size === "large" ? 1.6 : 1.08;
    const energy = basicMaterial(THREE, palette.energy ?? 0xffa529, .9);
    const ringMaterial = basicMaterial(THREE, palette.ring ?? 0xffc35a, .95);
    const beamMaterial = basicMaterial(THREE, palette.energy ?? 0xffa529, .2);
    const batch = {
      size,
      entries,
      disk: new THREE.InstancedMesh(new THREE.CylinderGeometry(radius * .84, radius * .84, .12, 20), energy, entries.length),
      ring: new THREE.InstancedMesh(new THREE.TorusGeometry(radius, .06, 8, 20), ringMaterial, entries.length),
      beam: new THREE.InstancedMesh(new THREE.CylinderGeometry(radius * .34, radius * .62, size === "large" ? 2.2 : 1.55, 12, 1, true), beamMaterial, entries.length),
    };
    batch.disk.name = `boost-pad-fallback-${size}-disks`;
    batch.ring.name = `boost-pad-fallback-${size}-rings`;
    batch.beam.name = `boost-pad-fallback-${size}-beams`;
    for (const mesh of [batch.disk, batch.ring, batch.beam]) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData = { visualOnly: true, role: "boost-pad-decoration", source: "procedural-instanced", padSize: size };
      parent.add(mesh);
      batches.push(mesh);
    }
    for (const [index, descriptor] of entries.entries()) {
      const handle = { descriptor, index, batch };
      handles.set(descriptor.id, handle);
      const updateMatrix = (mesh, y, rotationX, scaleY) => {
        helper.position.set(descriptor.x, descriptor.y + y, descriptor.z);
        helper.rotation.set(rotationX, 0, 0);
        helper.scale.set(1, scaleY, 1);
        helper.updateMatrix();
        mesh.setMatrixAt(index, helper.matrix);
      };
      updateMatrix(batch.disk, .06, 0, 1);
      updateMatrix(batch.ring, .13, Math.PI / 2, 1);
      updateMatrix(batch.beam, size === "large" ? 1.1 : .78, 0, 1);
    }
    for (const mesh of [batch.disk, batch.ring, batch.beam]) mesh.instanceMatrix.needsUpdate = true;
    bySize.set(size, batch);
  }
  return { batches, handles, bySize };
}

function markVisualOnly(root, role) {
  const visit = child => {
    child.userData = { ...child.userData, visualOnly: true, role: child.userData?.role || role };
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = true;
    }
    for (const nested of child.children || []) visit(nested);
  };
  if (typeof root?.traverse === "function") root.traverse(visit);
  else if (root) visit(root);
  return root;
}

function countGeometryMetrics(root) {
  const metrics = { triangles: 0, drawCalls: 0 };
  root?.traverse?.(child => {
    if (!child.isMesh || !child.geometry) return;
    metrics.drawCalls += 1;
    const index = child.geometry.index;
    const positions = child.geometry.attributes?.position;
    metrics.triangles += index ? Math.floor(index.count / 3) : positions ? Math.floor(positions.count / 3) : 0;
  });
  return metrics;
}

function findNamedNode(root, name) {
  let match = null;
  root?.traverse?.(child => { if (!match && child.name === name) match = child; });
  return match;
}

function loadWithLoader(loader, url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`asset timeout: ${url}`)), Math.max(100, timeoutMs));
    try {
      loader.load(url, value => finish(resolve, value), undefined, error => finish(reject, error instanceof Error ? error : new Error(`asset load failed: ${url}`)));
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function resolveGLTFLoader({ loader, loaderFactory } = {}) {
  if (loader?.load) return loader;
  if (typeof loaderFactory === "function") return loaderFactory();
  // Node tests and server-side callers retain a pure procedural path unless a
  // test explicitly injects a loader. The browser import is intentionally
  // deferred so first paint is never held by addon module evaluation.
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const module = await import(BROWSER_GLTF_LOADER_URL);
    return module.GLTFLoader ? new module.GLTFLoader() : null;
  } catch {
    try {
      const module = await import("three/addons/loaders/GLTFLoader.js");
      return module.GLTFLoader ? new module.GLTFLoader() : null;
    } catch {
      return null;
    }
  }
}

function prepareSkybowl(THREE, source, arena, assetConfig) {
  const root = source?.scene?.clone?.(true) || source?.clone?.(true);
  if (!root) return null;
  root.name = "arena-skybowl-asset";
  root.traverse(child => {
    // Cloud cards and the blimp are authored around a much larger world scale;
    // keeping the bowl, goals, floodlights and plaza props preserves legibility
    // without letting decorative sky geometry cover the playable volume.
    if (/^cloud-|^blimp$|^waterfalls$/.test(child.name || "")) child.visible = false;
  });
  root.updateMatrixWorld?.(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const fit = Math.min((arena.halfWidth * 2) / Math.max(size.x, 1), (arena.halfDepth * 2) / Math.max(size.z, 1));
  const scale = Math.max(.01, fit * finite(assetConfig.scalePadding, .96));
  root.scale.setScalar(scale);
  root.updateMatrixWorld?.(true);
  const scaledBounds = new THREE.Box3().setFromObject(root);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= scaledBounds.min.y;
  return markVisualOnly(root, "arena-skybowl");
}

function prepareBoostPads(THREE, source, spec, assetConfig) {
  const sourceRoot = source?.scene || source;
  if (!sourceRoot) return null;
  const large = findNamedNode(sourceRoot, "large-active");
  const small = findNamedNode(sourceRoot, "small-active");
  if (!large && !small) return null;
  const root = new THREE.Group();
  root.name = "arena-boost-pads-asset";
  root.userData = { visualOnly: true, role: "boost-pad-decoration", source: "boost-pads.glb" };
  for (const descriptor of spec.pads) {
    const template = descriptor.size === "large" ? large : small;
    if (!template) continue;
    const instance = template.clone(true);
    instance.name = `boost-pad-asset-${descriptor.id}`;
    instance.position.set(descriptor.x, descriptor.y, descriptor.z);
    instance.scale.setScalar(descriptor.size === "large" ? finite(assetConfig.largeScale, 1.45) : finite(assetConfig.smallScale, 1.85));
    markVisualOnly(instance, "boost-pad-decoration");
    instance.userData.padId = descriptor.id;
    root.add(instance);
  }
  return root.children.length ? root : null;
}

async function loadArenaAssets({ THREE, root, spec, options, state, fallbackPads, padRefs }) {
  const loader = await resolveGLTFLoader(options);
  if (!loader) {
    state.status = "fallback";
    state.failures.push({ asset: "loader", reason: "GLTFLoader unavailable" });
    return;
  }
  const requests = [
    ["skybowl", spec.assets.skybowl, source => prepareSkybowl(THREE, source, spec.arena, spec.assets.skybowl)],
    ["boostPads", spec.assets.boostPads, source => prepareBoostPads(THREE, source, spec, spec.assets.boostPads)],
  ];
  const loadedRoots = [];
  for (const [asset, config, prepare] of requests) {
    if (!config?.url) continue;
    try {
      const source = await loadWithLoader(loader, config.url, spec.assets.timeoutMs);
      const imported = prepare(source);
      if (!imported) throw new Error(`asset has no usable scene: ${asset}`);
      const metrics = countGeometryMetrics(imported);
      const budget = spec.assets.budget;
      const maxTriangles = finite(config.maxTriangles, Infinity);
      if (metrics.triangles > maxTriangles || state.triangles + metrics.triangles > finite(budget.maxTriangles, Infinity)) {
        throw new Error(`asset triangle budget exceeded: ${asset}`);
      }
      imported.userData.assetKey = asset;
      imported.userData.metrics = metrics;
      if (asset === "boostPads") {
        imported.children.forEach(instance => {
          const id = instance.userData?.padId;
          if (Number.isInteger(id)) padRefs?.set(id, instance);
        });
      }
      root.add(imported);
      loadedRoots.push(imported);
      state.loaded.push(asset);
      state.triangles += metrics.triangles;
      state.drawCalls += metrics.drawCalls;
      if (asset === "boostPads") fallbackPads.forEach(pad => { pad.visible = false; });
    } catch (error) {
      state.failures.push({ asset, reason: error?.message || String(error) });
    }
  }
  state.status = loadedRoots.length ? (state.failures.length ? "partial" : "ready") : "fallback";
  state.source = loadedRoots.length ? "asset-plus-procedural" : "procedural";
}

function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    if (Array.isArray(child.material)) for (const material of child.material) materials.add(material);
    else if (child.material) materials.add(child.material);
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

/**
 * Build the optional Three.js skin. Pass the host's THREE namespace so this
 * module stays testable in Node and does not impose a second renderer loop.
 */
export function createArenaDecoration({
  THREE,
  parent = null,
  mode = "rocketsim-combat-alpha",
  arena,
  profile,
  loader,
  loaderFactory,
} = {}) {
  const spec = buildArenaDecorationSpec({ mode, arena, profile });
  if (!THREE?.Group) {
    return { root: null, spec, update() { return this; }, dispose() {} };
  }
  const root = new THREE.Group();
  root.name = `arena-decoration:${mode}`;
  root.userData = { visualOnly: true, owner: "arena-decoration", spec };
  const refs = { beacons: [], lights: [], lines: [], materials: [], fixtures: [], fallbackPads: [], pads: new Map(), padBatches: null, perimeter: null, padMatrixHelper: typeof THREE.Object3D === "function" ? new THREE.Object3D() : null };
  for (const panel of spec.panels) refs.materials.push(makePanel(THREE, root, panel).material);
  if (spec.panelEdge.visible) {
    const edgeMaterial = new THREE.LineBasicMaterial({ color: spec.panelEdge.color, transparent: true, opacity: spec.panelEdge.opacity });
    const inset = spec.panelEdge.inset;
    const edgePoints = [
      [-spec.arena.halfWidth + inset, .03, -spec.arena.halfDepth + inset],
      [spec.arena.halfWidth - inset, .03, -spec.arena.halfDepth + inset],
      [spec.arena.halfWidth - inset, .03, spec.arena.halfDepth - inset],
      [-spec.arena.halfWidth + inset, .03, spec.arena.halfDepth - inset],
      [-spec.arena.halfWidth + inset, .03, -spec.arena.halfDepth + inset],
    ];
    refs.lines.push(addLine(THREE, root, edgePoints, edgeMaterial, "arena-perimeter"));
  }
  const guideMaterial = new THREE.LineBasicMaterial({ color: spec.panelEdge.color, transparent: true, opacity: spec.guideOpacity });
  for (const guide of spec.laneGuides) refs.lines.push(addLine(THREE, root, [guide.from, guide.to], guideMaterial, guide.id));
  const objective = new THREE.Mesh(new THREE.RingGeometry(spec.objective.radius - .25, spec.objective.radius, 36), basicMaterial(THREE, spec.objective.color, .52));
  objective.name = "center-objective";
  objective.rotation.x = -Math.PI / 2;
  objective.position.set(spec.objective.x, spec.objective.y, spec.objective.z);
  objective.userData = { visualOnly: true, role: "objective-landmark" };
  root.add(objective);
  for (const beacon of spec.beacons) refs.beacons.push(makeBeacon(THREE, root, beacon, spec.beaconStyle));
  for (const hazard of spec.hazards) makeHazard(THREE, root, hazard, spec.hazardColor);
  for (const fixture of spec.industrial?.fixtures || []) {
    refs.fixtures.push(makeIndustrialFixture(THREE, root, fixture, spec.industrial.fixtureGlow));
  }
  refs.perimeter = createPerimeterModules(THREE, root, spec.perimeter);
  for (const lightSpec of spec.lights) {
    const light = new THREE.PointLight(lightSpec.color, lightSpec.intensity, lightSpec.distance, 2);
    light.name = lightSpec.id;
    light.position.set(...lightSpec.position);
    light.userData = { visualOnly: true, role: "team-wash" };
    root.add(light);
    refs.lights.push(light);
  }
  refs.padBatches = createBatchedFallbackPads(THREE, root, spec.pads, spec.palette);
  if (refs.padBatches) {
    refs.fallbackPads.push(...refs.padBatches.batches);
    for (const [id, handle] of refs.padBatches.handles) refs.pads.set(id, handle);
  } else {
    for (const pad of spec.pads) {
      const fallback = makeFallbackPad(THREE, root, pad, spec.palette);
      refs.fallbackPads.push(fallback);
      refs.pads.set(pad.id, fallback);
    }
  }
  const assetState = { status: spec.assets.enabled === false ? "disabled" : "loading", source: "procedural", loaded: [], failures: [], triangles: 0, drawCalls: 0 };
  root.userData.assetState = assetState;
  let assetPromise = Promise.resolve();
  if (spec.assets.enabled !== false) {
    assetPromise = loadArenaAssets({ THREE, root, spec, options: { loader, loaderFactory }, state: assetState, fallbackPads: refs.fallbackPads, padRefs: refs.pads })
      .catch(error => { assetState.status = "fallback"; assetState.failures.push({ asset: "loader", reason: error?.message || String(error) }); });
  }
  if (parent?.add) parent.add(root);

  const getDecorationMetrics = () => {
    const geometry = countGeometryMetrics(root);
    let lightCount = 0;
    let padLightCount = 0;
    root.traverse?.(child => {
      if (!child.isLight) return;
      lightCount += 1;
      if (child.userData?.role === "boost-pad-light") padLightCount += 1;
    });
    return Object.freeze({
      drawCalls: geometry.drawCalls,
      triangles: geometry.triangles,
      lightCount,
      padCount: spec.pads.length,
      padActiveCount: [...refs.pads.values()].filter(handle => handle.available !== false).length,
      padBatchCount: refs.padBatches ? refs.padBatches.bySize.size * 3 : 0,
      padDrawCalls: refs.padBatches ? refs.padBatches.batches.length : refs.fallbackPads.length * 3,
      padLightCount,
      perimeterModuleCount: spec.perimeter?.modules.length || 0,
      perimeterDrawCalls: spec.perimeter?.modules.length ? (refs.perimeter?.instanced ? 2 : spec.perimeter.modules.length * 2) : 0,
      perimeterInstanced: Boolean(refs.perimeter?.instanced),
      perimeterLightCount: 0,
      source: refs.padBatches ? "procedural-instanced" : "procedural",
    });
  };

  let disposed = false;
  return {
    root,
    spec,
    assetState,
    ready: assetPromise,
    metrics: getDecorationMetrics,
    update({ time = 0, pads = null } = {}) {
      if (disposed) return this;
      const pulse = .86 + .14 * (.5 + .5 * Math.sin(finite(time, 0) * 4));
      for (const beacon of refs.beacons) {
        const light = beacon.userData.light;
        if (light) light.intensity = spec.beaconStyle.lightIntensity * pulse;
        setOpacity(beacon.userData.ring?.material, .82 + .14 * pulse);
      }
      for (const light of refs.lights) light.intensity = spec.lights.find(item => item.id === light.name)?.intensity * pulse;
      if (Array.isArray(pads) && pads.length) {
        const byId = new Map(pads.map(pad => [pad.id, pad]));
        for (const [id, padRoot] of refs.pads) {
          const state = byId.get(id);
          if (!state) continue;
          const available = state.active !== false && Number(state.timer ?? state.cooldown ?? 0) <= 0;
          padRoot.available = available;
          if (refs.padBatches && padRoot.batch && padRoot.descriptor) {
            const { descriptor, index, batch } = padRoot;
            const helper = refs.padMatrixHelper;
            if (!helper) continue;
            const setMatrix = (mesh, y, rotationX, scaleY, scaleXZ = 1) => {
              helper.position.set(descriptor.x, descriptor.y + y, descriptor.z);
              helper.rotation.set(rotationX, 0, 0);
              helper.scale.set(scaleXZ, scaleY, scaleXZ);
              helper.updateMatrix();
              mesh.setMatrixAt(index, helper.matrix);
              mesh.instanceMatrix.needsUpdate = true;
            };
            setMatrix(batch.disk, .06, 0, available ? 1 : .22);
            setMatrix(batch.ring, .13, Math.PI / 2, available ? 1 : .22);
            setMatrix(batch.beam, descriptor.size === "large" ? 1.1 : .78, 0, available ? 1 : .001, available ? 1 : .001);
          } else {
            padRoot.scale.y = available ? 1 : .22;
            if (padRoot.userData?.beam) padRoot.userData.beam.visible = available;
            if (padRoot.userData?.light) padRoot.userData.light.intensity = available ? 2.3 : .12;
          }
        }
      }
      return this;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      assetState.status = "disposed";
      disposeObject(root);
      root.removeFromParent?.();
    },
  };
}

// Plural aliases keep the handoff readable at call sites that compose several
// visual passes while preserving one implementation and one disposal owner.
const getArenaDecorationSpec = buildArenaDecorationSpec;
const createArenaDecorations = createArenaDecoration;

export { DEFAULT_ARENA, createArenaDecorations, getArenaDecorationSpec };

