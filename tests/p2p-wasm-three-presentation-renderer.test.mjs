import assert from "node:assert/strict";
import test from "node:test";

import {
  createP2PWasmFlatSurfaceFootprint,
  createP2PWasmPresentationLimits,
  createP2PWasmThreePresentationRenderer,
  createP2PWasmWebGLRenderer,
  P2P_WASM_EVENT_FEEDBACK_CAPACITY,
  P2P_WASM_EXPLOSION_POOL_CAPACITY,
  P2P_WASM_RENDERER_MAX_DPR,
  P2P_WASM_ROCKET_POOL_CAPACITY,
  summarizeP2PWasmEventFeedback,
} from "../tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs";
import { CAMERA_FOLLOW_TUNING } from "../src/camera-follow.js";
import { ROCKETSIM_VISUAL_PIVOT_HEIGHT } from "../src/vehicle-visual-alignment.js";
import { ROCKETSIM_PROTOTYPE_CHASSIS_SCALE } from "../src/vehicle-visual-alignment.js";
import { P2P_WASM_PRESENTATION_COORDINATE_SPACES } from "../tools/wasm-spike/p2p-wasm-arena-presentation.mjs";

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(value) { return this.set(value.x, value.y, value.z); }
  lerp(value, amount) { this.x += (value.x - this.x) * amount; this.y += (value.y - this.y) * amount; this.z += (value.z - this.z) * amount; return this; }
  addScaledVector(value, amount) { this.x += value.x * amount; this.y += value.y * amount; this.z += value.z * amount; return this; }
  multiplyScalar(amount) { this.x *= amount; this.y *= amount; this.z *= amount; return this; }
  normalize() { const length = Math.hypot(this.x, this.y, this.z) || 1; return this.multiplyScalar(1 / length); }
}

class Geometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; return this; }
  setIndex(value) { this.index = value; return this; }
  computeVertexNormals() { this.normalsComputed = true; return this; }
  dispose() { this.disposed = true; }
}
const materialInstances = [];
const meshInstances = [];
class Material {
  constructor(options = {}) { this.options = options; materialInstances.push(this); }
  dispose() { this.disposed = true; }
}
class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.needsUpdate = false; }
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material; this.position = new Vector3();
    this.quaternion = { set() {} }; this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.scale = { z: 1 }; this.userData = {}; this.visible = true;
    meshInstances.push(this);
  }
  lookAt() {}
}
class Line extends Mesh {}
class Group {
  constructor() {
    this.children = []; this.position = new Vector3(); this.quaternion = { set() {} };
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.scale = { x: 1, y: 1, z: 1, setScalar(value) { this.x = this.y = this.z = value; } };
    this.userData = {};
    this.visible = true;
  }
  add(...items) { this.children.push(...items); }
  lookAt() {}
}
class Scene {
  constructor() { this.children = []; }
  add(...items) { this.children.push(...items); }
  remove(item) { this.children = this.children.filter(child => child !== item); }
}
class Camera {
  constructor() { this.position = new Vector3(); this.far = 200; this.fov = 60; }
  updateProjectionMatrix() {}
  lookAt() {}
}
class Renderer {
  constructor({ canvas }) { this.canvas = canvas; this.info = { render: { calls: 0 } }; }
  setPixelRatio() {}
  setSize(width, height) { this.canvas.width = width; this.canvas.height = height; }
  setRenderTarget(target) { this.target = target; }
  clear() {}
  compile() { this.compileCalls = (this.compileCalls || 0) + 1; }
  render() { this.info.render.calls += 1; }
  readRenderTargetPixels(target, x, y, width, height, pixels) { pixels.fill(0); }
  dispose() { this.disposed = true; }
}
class Light {
  constructor() {
    this.position = new Vector3();
    this.color = { setHex(value) { this.value = value; } };
    this.visible = true;
  }
}

const THREE = {
  WebGLRenderer: Renderer,
  Scene,
  PerspectiveCamera: Camera,
  BoxGeometry: class extends Geometry {},
  CylinderGeometry: class extends Geometry {},
  ConeGeometry: class extends Geometry {},
  SphereGeometry: class extends Geometry {},
  TorusGeometry: class extends Geometry {},
  PlaneGeometry: class extends Geometry {},
  MeshStandardMaterial: class extends Material {},
  LineBasicMaterial: class extends Material {},
  Mesh,
  Line,
  Group,
  BufferGeometry: Geometry,
  BufferAttribute,
  GridHelper: class extends Mesh { constructor() { super(new Geometry(), new Material()); } },
  WebGLRenderTarget: class { dispose() { this.disposed = true; } },
  Vector3,
  Color: class { constructor(value) { this.value = value; } },
  Fog: class { constructor(color, near, far) { this.color = color; this.near = near; this.far = far; } },
  HemisphereLight: Light,
  DirectionalLight: Light,
  PointLight: Light,
  SRGBColorSpace: "srgb",
  ACESFilmicToneMapping: "aces",
};

test("renderer retries conservative Firefox WebGL settings and reports an actionable failure", () => {
  const calls = [];
  class RetryRenderer {
    constructor(options) { calls.push(options); if (calls.length < 2) throw new Error("context rejected"); }
  }
  const renderer = createP2PWasmWebGLRenderer({ WebGLRenderer: RetryRenderer }, {});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].antialias, false, "the public renderer must not request MSAA at startup");
  assert.equal(calls[0].powerPreference, "default");
  assert.equal(calls[1].antialias, false);
  assert.equal(calls[1].powerPreference, "low-power");
  class BrokenRenderer { constructor() { throw new Error("no context"); } }
  assert.throws(() => createP2PWasmWebGLRenderer({ WebGLRenderer: BrokenRenderer }, {}), error => error.code === "WEBGL_UNAVAILABLE" && /WebGL2/.test(error.message));
});

function state({ rockets = [], events = [], boosting = false, hostHp = 100, hostX = 10, hostRespawn = 0, hostSupersonic = false, hostSpeed = 0, targetId = undefined, time = null, roundSerial = 1, actionSerials = { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 } } = {}) {
  const orientation = { x: 0, y: 0, z: 0, w: 1 };
  return {
    ...(time === null ? {} : { time }),
    settings: { arena: "combat-alpha", roundSerial },
    cars: [
      { id: "p2p-host", x: hostX, h: 2, z: -4, speed: hostSpeed, hp: hostHp, grounded: true, wallRide: false, orientation, surfaceType: "ground", jumpState: "grounded", actionSerials, respawn: hostRespawn, supersonic: hostSupersonic, boost: boosting ? 50 : 0, boosting, ...(targetId !== undefined ? { targetId } : {}) },
      { id: "p2p-pilot", x: -10, h: 2, z: 4, speed: 0, grounded: true, wallRide: false, orientation, surfaceType: "ground", jumpState: "grounded", actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 }, boost: 0 },
    ],
    rockets,
    events,
  };
}

test("ONLINE-PLAYABLE-FEEDBACK-01 exposes readable scene-space combat-alpha limits", () => {
  const limits = createP2PWasmPresentationLimits({ arena: "combat-alpha", halfWidth: 30, halfDepth: 20, height: 12 });
  assert.deepEqual(limits, { minX: -30, maxX: 30, minY: 0, maxY: 12, minZ: -20, maxZ: 20, readout: "COMBAT-ALPHA · X -30..30 · Y 0..12 · Z -20..20" });
  assert.throws(() => createP2PWasmPresentationLimits({ halfWidth: 0, halfDepth: 1, height: 1 }), /huella/);
});

test("ONLINE-PLAYABLE-FEEDBACK-01 keeps rocket meshes inside a fixed reusable pool", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  const rockets = [1, 2, 3].map((id, index) => ({ id, owner: index % 2 ? "p2p-pilot" : "p2p-host", team: index % 2 ? "red" : "blue", x: index, h: 2, z: 0, vx: 10, vz: 0, vh: 0, life: 1, targetId: null }));
  renderer.update(state({ rockets }));
  assert.equal(renderer.metrics().vehicleCount, 2);
  assert.equal(renderer.metrics().vehicleWheelCount, 8);
  assert.equal(renderer.metrics().vehiclePartCount, 42);
  assert.equal(renderer.metrics().vehicleVisualContract, "combat-rally-lite-v1");
  assert.equal(renderer.metrics().vehicleFallbackVisibleCount, 0, "the recovery paint is hidden while the authored asset loads");
  assert.equal(renderer.metrics().vehicleAuthoredVisibleCount, 0, "no authored root is painted before its asset is ready");
  assert.equal(renderer.metrics().vehiclePaintedModelCount, 0, "there is no intermediate duplicate vehicle paint");
  assert.equal(renderer.metrics().arenaSurfaceContract, "unified-interior-shell-v1");
  assert.equal(renderer.metrics().rocketCount, 3);
  assert.equal(renderer.metrics().rocketVisualContract, "local-body-trail-light-v1");
  assert.equal(renderer.metrics().rocketTrailCount, 3);
  assert.equal(renderer.metrics().rocketLightCount, 3);
  assert.equal(renderer.metrics().rocketPoolCapacity, P2P_WASM_ROCKET_POOL_CAPACITY);
  assert.equal(renderer.metrics().rocketPoolActive, 3);
  renderer.update(state());
  assert.equal(renderer.metrics().rocketCount, 0);
  assert.equal(renderer.metrics().rocketPoolActive, 0);
  assert.equal(renderer.metrics().rocketPoolAvailable, P2P_WASM_ROCKET_POOL_CAPACITY);
  renderer.dispose();
  renderer.dispose();
});

test("ONLINE-RENDER-LIFECYCLE-04 reconciles vehicles by player id across reorder, leave, and replacement", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  const initial = state();
  renderer.update(initial);
  const hostRoot = renderer.getVehicleRoot("p2p-host");
  const pilotRoot = renderer.getVehicleRoot("p2p-pilot");
  renderer.update({ ...initial, time: 1 / 60, cars: [initial.cars[1], initial.cars[0]] });
  assert.strictEqual(renderer.getVehicleRoot("p2p-host"), hostRoot);
  assert.strictEqual(renderer.getVehicleRoot("p2p-pilot"), pilotRoot);
  renderer.update({ ...initial, time: 2 / 60, cars: [initial.cars[0]] });
  assert.strictEqual(renderer.getVehicleRoot("p2p-pilot"), null);
  assert.equal(renderer.metrics().vehicleCount, 1);
  renderer.update({ ...initial, time: 3 / 60, cars: [initial.cars[0], { ...initial.cars[1], id: "p2p-new" }] });
  assert.notStrictEqual(renderer.getVehicleRoot("p2p-new"), pilotRoot);
  assert.deepEqual(renderer.metrics().vehicleIds, ["p2p-host", "p2p-new"]);
  renderer.dispose();
});

test("ONLINE-RENDER-LIFECYCLE-05 applies live team changes to the stable root", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  const initial = state();
  initial.cars[0].team = "blue";
  renderer.update(initial);
  const root = renderer.getVehicleRoot("p2p-host");
  renderer.update({ ...initial, time: 1 / 60, cars: initial.cars.map(car => car.id === "p2p-host" ? { ...car, team: "red" } : car) });
  assert.strictEqual(renderer.getVehicleRoot("p2p-host"), root);
  assert.equal(root.userData.team, "red");
  renderer.update({ ...initial, time: 2 / 60, cars: initial.cars.map(car => car.id === "p2p-host" ? { ...car, team: null } : car) });
  assert.equal(root.userData.team, null);
  renderer.dispose();
});

test("ONLINE-RENDER-LIFECYCLE-06 can hand the camera focus from practice host to guest identity", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 }, focusCarId: "p2p-host" });
  renderer.update(state());
  assert.equal(renderer.metrics().cameraFocusId, "p2p-host");
  assert.equal(renderer.setFocusCarId("p2p-pilot"), "p2p-pilot");
  renderer.update({ ...state(), time: 1 / 60 });
  assert.equal(renderer.metrics().cameraFocusId, "p2p-pilot");
  renderer.dispose();
});

test("ONLINE-PARITY-07 replays local rocket disappearance as a bounded presentation explosion", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  const rocket = { id: 7, owner: "p2p-host", team: "blue", x: 3, h: 2, z: 0, vx: 10, vz: 0, vh: 0, life: 1, targetId: null };
  renderer.update(state({ rockets: [rocket] }));
  renderer.update(state());
  const metrics = renderer.metrics();
  assert.equal(metrics.rocketCount, 0);
  assert.equal(metrics.explosionCount, 1);
  assert.equal(metrics.explosionPoolActive, 1);
  assert.equal(metrics.explosionPoolCapacity, P2P_WASM_EXPLOSION_POOL_CAPACITY);
  renderer.dispose();
  assert.equal(renderer.metrics().explosionCount, 0);
});

test("ONLINE-RENDER-LIFECYCLE-03 releases every pooled effect material on dispose", () => {
  const materialStart = materialInstances.length;
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  const rocket = { id: 8, owner: "p2p-pilot", team: "red", x: -3, h: 2, z: 0, vx: -10, vz: 0, vh: 0, life: 1, targetId: null };
  renderer.update(state({ rockets: [rocket] }));
  renderer.update(state());
  renderer.dispose();
  assert.ok(materialInstances.slice(materialStart).every(material => material.disposed === true));
});

test("ONLINE-RENDER-19 keeps costly rocket shader warm-up off the public startup path", async () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  renderer.update(state());
  const metrics = await renderer.ready();
  assert.equal(metrics.effectPrewarmStatus, "deferred");
  assert.equal(metrics.effectPrewarmCompilePasses, 0);
  assert.equal(metrics.rocketCount, 0);
  assert.equal(metrics.rocketPoolActive, 0);
  assert.equal(metrics.explosionCount, 0);
  assert.equal(metrics.explosionPoolActive, 0);
  renderer.dispose();
});

test("ONLINE-PLAYABLE-FEEDBACK-01 keeps the latest validated events visible and bounded", () => {
  const events = Array.from({ length: P2P_WASM_EVENT_FEEDBACK_CAPACITY + 2 }, (_, index) => ({ kind: index % 2 ? "hit" : "fire", text: `E${index}`, at: index }));
  assert.deepEqual(summarizeP2PWasmEventFeedback(events).map(event => event.text), ["E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9"]);
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  renderer.update(state({ events }));
  assert.equal(renderer.metrics().eventCount, P2P_WASM_EVENT_FEEDBACK_CAPACITY);
  assert.equal(renderer.metrics().eventPoolActive, P2P_WASM_EVENT_FEEDBACK_CAPACITY);
  assert.equal(renderer.metrics().eventFeedback.at(-1).text, "E9");
  renderer.update(state());
  assert.equal(renderer.metrics().eventCount, 0);
  assert.equal(renderer.metrics().eventPoolActive, 0);
  renderer.dispose();
});

test("ONLINE-RENDER-14 derives compact booster flames only from authoritative telemetry", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  renderer.update(state({ boosting: true }));
  assert.equal(renderer.metrics().boostFlameCount, 2);
  renderer.update(state({ boosting: false }));
  assert.equal(renderer.metrics().boostFlameCount, 0);
  renderer.dispose();
});

test("ONLINE-PARITY-05 applies authoritative health to the vehicle presentation", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  renderer.update(state({ hostHp: 42 }));
  assert.deepEqual(renderer.metrics().vehicleHealthRatios, [.42, .02]);
  renderer.update(state({ time: 1 / 60, hostHp: 0 }));
  assert.deepEqual(renderer.metrics().vehicleHealthRatios, [.02, .02]);
  renderer.dispose();
});

test("ONLINE-PARITY-04 shows speed trails only for authoritative supersonic telemetry", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  renderer.update(state({ boosting: true, hostSpeed: 65, hostSupersonic: false }));
  assert.equal(renderer.metrics().speedTrailCount, 0, "held boost alone cannot invent superspeed feedback");
  renderer.update(state({ time: 1 / 60, hostSpeed: 65, hostSupersonic: true }));
  assert.equal(renderer.metrics().speedTrailCount, 2);
  renderer.update(state({ time: 2 / 60, hostSpeed: 30, hostSupersonic: false }));
  assert.equal(renderer.metrics().speedTrailCount, 0);
  renderer.dispose();
});

test("ONLINE-PARITY-03 hides only authoritative respawning combatants", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  renderer.update(state({ boosting: true, hostRespawn: 2 }));
  assert.equal(renderer.metrics().vehicleVisibleCount, 1);
  assert.equal(renderer.metrics().boostFlameCount, 0);
  renderer.update(state({
    time: 1 / 60,
    hostRespawn: 0,
    actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 },
  }));
  assert.equal(renderer.metrics().vehicleVisibleCount, 2);
  assert.equal(renderer.metrics().actionPulseKinds[0], "respawn");
  renderer.dispose();
});

test("ONLINE-RENDER-18 replays local movement pulses from serial edges and keeps round resets fail-closed", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  renderer.update(state());
  renderer.update(state({
    time: 1 / 60,
    actionSerials: { jump: 1, doubleJump: 0, dodge: 0, respawn: 0 },
  }));
  assert.equal(renderer.metrics().actionPulseCount, 1);
  assert.deepEqual(renderer.metrics().actionPulseKinds, ["jump", null]);

  renderer.update(state({
    time: 2 / 60,
    roundSerial: 2,
    actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 },
  }));
  assert.equal(renderer.metrics().actionPulseCount, 1);
  assert.deepEqual(renderer.metrics().actionPulseKinds, ["respawn", null]);
  renderer.dispose();
});

test("ONLINE-PARITY-01 renders full-match Arsenal coordinates without the diagnostic UU scale", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: "arsenal-world",
  });
  renderer.update(state());
  const metrics = renderer.metrics();
  assert.equal(metrics.coordinateSpace, "arsenal-world");
  assert.equal(metrics.arenaWidth, 264);
  assert.equal(metrics.arenaDepth, 408);
  assert.equal(metrics.arenaHeight, 108);
  assert.equal(metrics.arenaTopology, "continuous-floor-wall-ceiling-curves");
  assert.equal(metrics.arenaInteriorNormalContract, "floor:+Y;ceiling:-Y;walls:inward;curves:floor-to-wall-to-ceiling;corners:inward",
    "all welded arena patches must face the playable interior to avoid averaged-normal seams");
  assert.equal(metrics.arenaTransitionGuideCount, undefined, "the clean shell has no overlay guide lines");
  assert.equal(metrics.arenaFloorWallGuideCount, undefined, "the clean shell has no floor-wall guide lines");
  assert.equal(metrics.arenaTransitionGuideMaxOffsetY, undefined, "the clean shell has no guide offsets");
  assert.deepEqual(metrics.arenaFlatSurfaceFootprint, {
    x: 0, z: 0, width: 204, depth: 348, minX: -102, maxX: 102, minZ: -174, maxZ: 174,
  }, "the flat planes stop at every curved side");
  assert.deepEqual(metrics.arenaFloorWallQuarterPipeVerticalBounds, { minY: 0, maxY: 30 },
    "the lower quarter-pipe spans from the floor to one curve radius above it");
  assert.equal(metrics.arenaObstacleCount, 3, "combat-alpha presents the block, cap and ramp companions");
  assert.ok(metrics.arenaShellVertexCount > 0);
  assert.equal(metrics.arenaVisualProfileId, "combat-alpha-clean");
  assert.deepEqual(metrics.arenaSurfaceMaterial, {
    color: 0x496f78,
    emissive: 0x16333b,
    emissiveIntensity: .16,
    metalness: .2,
    roughness: .74,
  });
  assert.equal(metrics.arenaFog, null, "combat-alpha must not hide the far arena behind fog");
  renderer.dispose();
});

test("ART-04 online keeps native obstacle dimensions while using the ART-03 fallback contract", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD,
  });
  renderer.update(state());
  const metrics = renderer.metrics();
  assert.equal(metrics.arenaObstacleCount, 3, "block body, metallic cap and ramp remain visible");
  assert.equal(metrics.arenaObstacleVisualContract, "combat-alpha-map-v1");
  assert.equal(metrics.arenaObstacleMaterialContract, "art-03-scrapyard-with-opaque-fallback");
  assert.equal(metrics.arenaObstacleHazardBandHeight, .38);
  assert.equal(metrics.arenaCoverCount, 6, "all authoritative cover colliders have visual companions");
  assert.equal(metrics.arenaCoverVisualContract, "combat-alpha-cover-visual-v1");
  assert.equal(metrics.arenaCoverMetrics.tireInstanceCount, 256);
  assert.equal(metrics.arenaCoverMetrics.drawCalls, 3);
  renderer.dispose();
});

test("ART-04 online ignores legacy nitro-pad metadata in combat-alpha", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD,
  });
  renderer.update(state());
  assert.equal(renderer.setMetadata({
    sequence: 1,
    pads: [{ id: "pad-0", x: 0, h: 0, z: 0, active: true, amount: 100 }],
  }), true);
  assert.equal(renderer.metrics().pickupCount, 0);
  assert.equal(renderer.metrics().pickupActiveCount, 0);
  renderer.dispose();
});

test("ONLINE-ARENA-SURFACE-01 retracts flat floor and ceiling from quarter-pipe sides", () => {
  const footprint = createP2PWasmFlatSurfaceFootprint({
    halfWidth: 132,
    halfDepth: 204,
    curveRadius: 30,
    curvedSides: ["positiveX", "negativeX", "positiveZ", "negativeZ"],
  });
  assert.deepEqual(footprint, {
    x: 0, z: 0, width: 204, depth: 348, minX: -102, maxX: 102, minZ: -174, maxZ: 174,
  });
});

test("ONLINE-ARENA-SURFACE-02 winds the welded shell toward its playable interior", () => {
  const meshStart = meshInstances.length;
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: "arsenal-world",
  });
  renderer.update(state());
  const shell = meshInstances.slice(meshStart).find(mesh => mesh.name === "arena-unified-shell");
  assert.ok(shell, "the online arena is rendered as one welded shell");
  const positions = shell.geometry.attributes.position.array;
  const indices = shell.geometry.index;
  const faces = [];
  for (let index = 0; index < indices.length; index += 3) {
    const ids = [indices[index], indices[index + 1], indices[index + 2]];
    const points = ids.map(id => [positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]]);
    const a = points[1].map((value, axis) => value - points[0][axis]);
    const b = points[2].map((value, axis) => value - points[0][axis]);
    const normal = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const centroid = [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / 3);
    faces.push({ normal, centroid });
  }
  const assertNormal = (label, select, agrees) => {
    const matching = faces.filter(face => select(face.centroid));
    assert.ok(matching.length > 0, `${label} faces are present in the shell`);
    assert.ok(matching.every(face => agrees(face.normal, face.centroid)), `${label} faces point into the playable interior`);
  };
  assertNormal("floor", ([x, y, z]) => y === 0 && Math.abs(x) < 103 && Math.abs(z) < 175, normal => normal[1] > 0);
  assertNormal("ceiling", ([x, y, z]) => y === 108 && Math.abs(x) < 103 && Math.abs(z) < 175, normal => normal[1] < 0);
  assertNormal("positive-X wall", ([x, y, z]) => x > 131.9 && y > 31 && y < 77 && Math.abs(z) < 60, normal => normal[0] < 0);
  assertNormal("negative-X wall", ([x, y, z]) => x < -131.9 && y > 31 && y < 77 && Math.abs(z) < 60, normal => normal[0] > 0);
  assertNormal("positive-Z wall", ([x, y, z]) => z > 203.9 && y > 31 && y < 77 && Math.abs(x) < 50, normal => normal[2] < 0);
  assertNormal("negative-Z wall", ([x, y, z]) => z < -203.9 && y > 31 && y < 77 && Math.abs(x) < 50, normal => normal[2] > 0);
  assertNormal("floor-side quarter-pipe edges", ([x, y, z]) => y > 1e-5 && y < .08 && ((Math.abs(x) > 101 && Math.abs(z) < 170) || (Math.abs(z) > 173 && Math.abs(x) < 98)), normal => normal[1] > 0);
  assertNormal("wall-side quarter-pipe edges", ([x, y, z]) => y > 78.5 && y < 80.5 && (Math.abs(x) > 131.9 || Math.abs(z) > 203.9), (normal, [x, y, z]) => Math.abs(x) > Math.abs(z) ? normal[0] * -Math.sign(x) > 0 : normal[2] * -Math.sign(z) > 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    assertNormal(`lower corner (${sx}, ${sz})`, ([x, y, z]) => x * sx > 101.1 && z * sz > 173.1 && y > 1 && y < 29,
      normal => normal[0] * sx < 0 && normal[1] > 0 && normal[2] * sz < 0);
    assertNormal(`upper corner (${sx}, ${sz})`, ([x, y, z]) => x * sx > 101.1 && z * sz > 173.1 && y > 79 && y < 107,
      normal => normal[0] * sx < 0 && normal[1] < 0 && normal[2] * sz < 0);
  }
  renderer.dispose();
});

test("ONLINE-PARITY-01 keeps Car/Enemy camera framing continuous around the local car", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: "arsenal-world",
    focusCarId: "p2p-host",
  });
  for (let frame = 0; frame < 120; frame += 1) renderer.update(state());
  const carCam = renderer.metrics();
  renderer.update(state({ targetId: "p2p-pilot" }));
  const enemyEntry = renderer.metrics();
  assert.ok(enemyEntry.cameraEnemyBlend > 0 && enemyEntry.cameraEnemyBlend < 1);
  assert.equal(enemyEntry.cameraFov, carCam.cameraFov, "target acquisition does not change the camera projection");
  assert.ok(Math.abs(enemyEntry.cameraFollowDistance - carCam.cameraFollowDistance) < 1e-9, "Enemy Cam preserves the Car-Cam boom distance");
  assert.ok(Math.hypot(enemyEntry.cameraPosition.x - carCam.cameraPosition.x, enemyEntry.cameraPosition.z - carCam.cameraPosition.z) < 1);
  renderer.dispose();
  const disposed = renderer.metrics();
  assert.equal(disposed.cameraInitialized, false);
  assert.equal(disposed.cameraEnemyBlend, 0);
  assert.equal(disposed.cameraTargetId, null);
  assert.deepEqual(disposed.cameraPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(disposed.cameraAim, { x: 0, y: 0, z: 0 });
  assert.equal(disposed.cameraFov, CAMERA_FOLLOW_TUNING.carBaseFov);
});

test("ONLINE-PARITY-06 resets camera framing at an authoritative respawn edge", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: "arsenal-world",
    focusCarId: "p2p-host",
  });
  for (let frame = 0; frame < 30; frame += 1) renderer.update(state({ time: frame / 60 }));
  assert.equal(renderer.metrics().cameraResetCount, 0);
  renderer.update(state({
    time: 30 / 60,
    hostX: 36,
    actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 },
  }));
  assert.equal(renderer.metrics().cameraRespawnSerial, 1);
  assert.equal(renderer.metrics().cameraResetCount, 1);
  renderer.dispose();
});

test("ONLINE-PARITY-08 follows the RocketSim vehicle pivot and raises the camera on respawn", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: "arsenal-world",
    focusCarId: "p2p-host",
  });
  const pivotState = state();
  pivotState.settings = { ...pivotState.settings, movementBackend: "rocketsim" };
  renderer.update(pivotState);
  const pivotAim = renderer.metrics().cameraAim;
  assert.ok(Math.abs(pivotAim.y - (2 + ROCKETSIM_VISUAL_PIVOT_HEIGHT + CAMERA_FOLLOW_TUNING.lookHeight)) < 1e-9);

  renderer.update(state({
    hostRespawn: 1,
    actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 },
  }));
  assert.ok(renderer.metrics().cameraPosition.y >= 13, "respawn framing keeps the camera above the arena");
  renderer.dispose();
});

test("ONLINE-PARITY-09 places the authored vehicle at the local RocketSim pivot and keeps boost authoritative", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD,
  });
  const first = state({ boosting: true });
  first.settings = { ...first.settings, movementBackend: "rocketsim" };
  first.cars[0].boost = 0;
  renderer.update(first);
  const metrics = renderer.metrics();
  assert.ok(Math.abs(metrics.vehicleRootHeights[0] - (2 + ROCKETSIM_VISUAL_PIVOT_HEIGHT)) < 1e-9);
  assert.equal(metrics.vehicleVisualScales[0], ROCKETSIM_PROTOTYPE_CHASSIS_SCALE);
  assert.equal(metrics.boostFlameCount, 2, "the final authoritative boosting frame remains visible at depletion");
  renderer.dispose();
});

test("ONLINE-PARITY-02 keeps the local roof laser only while its authoritative lock is valid", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: "arsenal-world",
    focusCarId: "p2p-host",
  });
  renderer.update(state({ targetId: "p2p-pilot" }));
  const locked = renderer.metrics();
  assert.equal(locked.targetLaserVisible, true);
  assert.equal(locked.targetLaserSource, "weapon-muzzle");
  assert.deepEqual(locked.targetLaserEnd, { x: -10, y: 3.2, z: 4 });
  assert.ok(Math.hypot(locked.targetLaserDirection.x, locked.targetLaserDirection.y, locked.targetLaserDirection.z) > .99);

  renderer.update(state({ targetId: null }));
  const released = renderer.metrics();
  assert.equal(released.targetLaserVisible, false);
  assert.deepEqual(released.targetLaserDirection, { x: 0, y: 0, z: 0 });
  renderer.dispose();
});

test("ONLINE-METADATA-01 renders only active pickup markers and rejects stale envelopes", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
    coordinateSpace: "arsenal-world",
  });
  assert.equal(renderer.setMetadata({
    sequence: 1,
    pads: [
      { id: "pad-01", x: 2, h: 0, z: -3, amount: 100, cooldown: 0, active: true },
      { id: "pad-02", x: -2, h: 0, z: 3, amount: 100, cooldown: 5, active: false },
    ],
  }), true);
  assert.equal(renderer.metrics().metadataSequence, 1);
  assert.equal(renderer.metrics().pickupCount, 2);
  assert.equal(renderer.metrics().pickupActiveCount, 1);
  assert.equal(renderer.setMetadata({ sequence: 1, pads: [] }), false);
  assert.equal(renderer.metrics().pickupActiveCount, 1);
  renderer.setMetadata({ sequence: 2, pads: [{ id: "pad-01", x: 2, h: 0, z: -3, amount: 100, cooldown: 0, active: false }] });
  assert.equal(renderer.metrics().pickupCount, 1);
  assert.equal(renderer.metrics().pickupActiveCount, 0);
  renderer.dispose();
});

test("ONLINE-PERF-BASELINE-01 exposes render and decoration metrics without GPU readback", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 }, coordinateSpace: "arsenal-world" });
  const metrics = renderer.metrics();
  assert.deepEqual(metrics.rendererInfo, {
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
  });
  assert.equal(metrics.arenaDecorationMetrics.source, "unavailable");
  assert.equal(metrics.diagnosticsReadback, false);
  renderer.dispose();
});

test("ONLINE-RENDER-ADAPTIVE-01 fits the real viewport, caps DPR, and avoids resize thrashing", () => {
  let rect = { width: 1200, height: 800 };
  const listeners = new Map();
  class ResizeObserverDouble {
    static instance = null;
    constructor(callback) { this.callback = callback; this.observed = null; this.disconnected = false; ResizeObserverDouble.instance = this; }
    observe(target) { this.observed = target; }
    disconnect() { this.disconnected = true; }
    trigger(width, height) { this.callback([{ target: this.observed, contentRect: { width, height } }]); }
  }
  const view = {
    devicePixelRatio: 3,
    innerWidth: 1200,
    innerHeight: 800,
    ResizeObserver: ResizeObserverDouble,
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
  };
  const canvas = {
    width: 0,
    height: 0,
    ownerDocument: { defaultView: view },
    getBoundingClientRect() { return rect; },
  };
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas });
  assert.equal(renderer.metrics().pixelRatio, 1.5, "auto quality begins at the safe balanced budget");
  assert.equal(renderer.metrics().viewportWidth, 1200);
  assert.equal(renderer.metrics().viewportHeight, 800, "drawing buffer follows the displayed viewport without stretching it");
  assert.equal(renderer.metrics().resizeApplyCount, 1);

  const sameSizeApplyCount = renderer.metrics().resizeApplyCount;
  ResizeObserverDouble.instance.trigger(1200, 800);
  assert.equal(renderer.metrics().resizeApplyCount, sameSizeApplyCount, "same dimensions do not call setSize again");

  ResizeObserverDouble.instance.trigger(700, 700);
  assert.equal(renderer.metrics().viewportWidth, 700);
  assert.equal(renderer.metrics().viewportHeight, 700);

  rect = { width: 700, height: 700 };
  view.devicePixelRatio = 1.5;
  listeners.get("resize")();
  assert.equal(renderer.metrics().pixelRatio, 1.5);
  assert.equal(renderer.metrics().viewportWidth, 700);

  const beforeDispose = renderer.metrics();
  renderer.dispose();
  assert.equal(ResizeObserverDouble.instance.disconnected, true);
  assert.equal(listeners.has("resize"), false);
  ResizeObserverDouble.instance.trigger(1600, 900);
  assert.equal(renderer.metrics().viewportWidth, beforeDispose.viewportWidth, "disposed observers cannot resize the renderer");
  renderer.dispose();
});

test("ONLINE-RENDER-PREVENTION-01 bounds the physical backbuffer instead of trusting raw device DPR", () => {
  const canvas = {
    width: 0,
    height: 0,
    ownerDocument: { defaultView: { devicePixelRatio: 2, innerWidth: 3840, innerHeight: 2160, addEventListener() {}, removeEventListener() {} } },
    getBoundingClientRect: () => ({ width: 3840, height: 2160 }),
  };
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas });
  const metrics = renderer.metrics();
  assert.equal(metrics.qualityMode, "balanced");
  assert.ok(metrics.pixelRatio < 1, "a 4K canvas cannot allocate a multi-million-pixel retina buffer by default");
  assert.ok(metrics.pixelRatio ** 2 * metrics.viewportWidth * metrics.viewportHeight <= metrics.qualityBackBufferPixelCap + 1);
  renderer.dispose();
});

test("ONLINE-RENDER-PREVENTION-02 uses the no-shadow compatibility tier for Firefox", () => {
  const canvas = {
    width: 0,
    height: 0,
    ownerDocument: { defaultView: {
      devicePixelRatio: 2,
      navigator: { userAgent: "Mozilla/5.0 Firefox/145.0" },
      addEventListener() {},
      removeEventListener() {},
    } },
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
  };
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas });
  assert.equal(renderer.metrics().qualityMode, "performance");
  assert.equal(renderer.metrics().shadowsEnabled, false);
  assert.equal(renderer.metrics().pixelRatio, 1);
  renderer.dispose();
});

test("ONLINE-RENDER-PREVENTION-03 removes dynamic projectile lights in the Firefox compatibility tier", () => {
  const canvas = {
    width: 0,
    height: 0,
    ownerDocument: { defaultView: {
      devicePixelRatio: 1,
      navigator: { userAgent: "Mozilla/5.0 Firefox/145.0" },
      addEventListener() {},
      removeEventListener() {},
    } },
    getBoundingClientRect: () => ({ width: 960, height: 540 }),
  };
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas });
  renderer.update(state({ rockets: [{ id: 1, owner: "p2p-host", team: "blue", x: 0, h: 2, z: 0, vx: 8, vh: 0, vz: 0, life: 1 }] }));
  assert.equal(renderer.metrics().rocketLightActiveCount, 0);
  renderer.dispose();
});

test("ONLINE-RENDER-ADAPTIVE-01 keeps diagnostic GPU readback disabled by default", () => {
  class NoReadbackRenderer extends Renderer {
    readRenderTargetPixels() { throw new Error("diagnostic readback is forbidden"); }
  }
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE: { ...THREE, WebGLRenderer: NoReadbackRenderer },
    canvas: { width: 0, height: 0 },
    diagnosticsReadback: false,
  });
  assert.equal(renderer.render(), true);
  assert.equal(renderer.metrics().diagnosticsReadback, false);
  assert.equal(renderer.metrics().renderCalls, 1);
  renderer.dispose();
});

test("ONLINE-RENDER-RECOVERY-01 surfaces a runtime WebGL context loss to the 3D error UI", () => {
  const listeners = new Map();
  const canvas = {
    width: 0,
    height: 0,
    ownerDocument: { defaultView: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } },
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas });
  renderer.update(state());
  let prevented = false;
  listeners.get("webglcontextlost")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "the browser must be allowed to restore the context");
  assert.throws(() => renderer.render(), error => error.code === "WEBGL_CONTEXT_LOST" && /perdió/.test(error.message));
  assert.equal(renderer.metrics().contextState, "error");
  assert.equal(renderer.metrics().contextLossCount, 1);

  listeners.get("webglcontextrestored")({});
  assert.equal(renderer.metrics().contextState, "restored");
  assert.equal(renderer.metrics().contextRestoreCount, 1);
  assert.equal(renderer.render(), true, "the render loop must resume after restoration");
  renderer.dispose();
  assert.equal(listeners.has("webglcontextlost"), false);
  assert.equal(listeners.has("webglcontextrestored"), false);
});

test("ONLINE-RENDER-RECOVERY-02 surfaces an unrecoverable render exception to the 3D error surface", () => {
  class FailingRenderer extends Renderer {
    render() { throw new Error("GPU context reset"); }
  }
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE: { ...THREE, WebGLRenderer: FailingRenderer },
    canvas: { width: 0, height: 0, getBoundingClientRect: () => ({ width: 640, height: 360 }) },
  });
  assert.throws(() => renderer.render(), error => error.code === "WEBGL_RENDER_FAILED" && /GPU context reset/.test(error.message));
  assert.equal(renderer.metrics().contextState, "error");
  assert.equal(renderer.metrics().renderErrorCount, 1);
  renderer.dispose();
});

test("ONLINE-RENDER-ADAPTIVE-02 lowers only presentation quality after sustained slow frames", () => {
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE,
    canvas: { width: 0, height: 0 },
  });
  let timestamp = 0;
  for (let index = 0; index < 100; index += 1) {
    timestamp += 30;
    renderer.render();
    renderer.recordFrame(timestamp);
  }
  const metrics = renderer.metrics();
  assert.equal(metrics.qualityAuto, true);
  assert.equal(metrics.qualityMode, "performance");
  assert.equal(metrics.qualityDowngrades, 1);
  assert.ok(metrics.qualityAverageFrameMs >= 23);
  assert.equal(metrics.qualityFrameSource, "raf");
  renderer.dispose();
});

test("ONLINE-RENDER-ADAPTIVE-03 recovers only to the safe baseline after a sustained healthy rAF cadence", () => {
  const renderer = createP2PWasmThreePresentationRenderer({ THREE, canvas: { width: 0, height: 0 } });
  let timestamp = 0;
  for (let index = 0; index < 100; index += 1) {
    timestamp += 30;
    renderer.render();
    renderer.recordFrame(timestamp);
  }
  assert.equal(renderer.metrics().qualityMode, "performance");
  for (let index = 0; index < 280; index += 1) {
    timestamp += 16;
    renderer.render();
    renderer.recordFrame(timestamp);
  }
  const metrics = renderer.metrics();
  assert.equal(metrics.qualityMode, "balanced");
  assert.equal(metrics.qualityUpgrades, 1);
  renderer.dispose();
});

test("ONLINE-RENDER-ADAPTIVE-01 enables only the requested tiny diagnostic readback", () => {
  class DiversityRenderer extends Renderer {
    readRenderTargetPixels(target, x, y, width, height, pixels) {
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = (index / 4) % 8;
        pixels[index + 1] = 32;
        pixels[index + 2] = 64;
        pixels[index + 3] = 255;
      }
    }
  }
  const renderer = createP2PWasmThreePresentationRenderer({
    THREE: { ...THREE, WebGLRenderer: DiversityRenderer },
    canvas: { width: 0, height: 0 },
    diagnosticsReadback: true,
  });
  renderer.update(state());
  assert.equal(renderer.render(), true);
  assert.equal(renderer.metrics().diagnosticsReadback, true);
  assert.ok(renderer.metrics().pixelDiversity >= 4);
  renderer.dispose();
});
