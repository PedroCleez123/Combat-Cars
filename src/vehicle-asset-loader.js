const BROWSER_GLTF_LOADER_URL = "/src/assets/vehicle/GLTFLoader.js";

export const DEFAULT_VEHICLE_ASSET = Object.freeze({
  // The authored game-car skin is the primary presentation. The procedural
  // model remains attached immediately so it can take over on any load or
  // budget failure (or when callers explicitly pass `enabled: false`).
  enabled: true,
  url: "/src/assets/vehicle/model.gltf",
  timeoutMs: 2500,
  maxTriangles: 16_000,
  maxDrawCalls: 24,
  // Presentation callers that already have a stable fallback can ask the
  // loader to reclaim the procedural chassis after the authored asset is
  // ready. The default remains backward compatible for the local client.
  disposeProceduralOnAssetReady: false,
  targetWidth: 3.55,
  targetHeight: 1.68,
  targetDepth: 1.72,
  floorY: .09,
});

const TEAM_COLORS = Object.freeze({ blue: 0x168ed3, orange: 0xf27f19, red: 0xd03d43, neutral: 0xaebcc2 });
const WHEEL_NAMES = Object.freeze([
  ["front-left", "wheel-front-left", true],
  ["front-right", "wheel-front-right", true],
  ["rear-left", "wheel-rear-left", false],
  ["rear-right", "wheel-rear-right", false],
]);
const ASSET_TEAM_TINTS = new WeakMap();

function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }

function countGeometryMetrics(root) {
  const metrics = { triangles: 0, drawCalls: 0, meshes: 0, materials: 0 };
  const materials = new Set();
  root?.traverse?.(child => {
    if (!child.isMesh || !child.geometry) return;
    metrics.meshes += 1;
    const index = child.geometry.index;
    const positions = child.geometry.attributes?.position;
    metrics.triangles += index ? Math.floor(index.count / 3) : positions ? Math.floor(positions.count / 3) : 0;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    metrics.drawCalls += list.filter(Boolean).length || 1;
    list.filter(Boolean).forEach(material => materials.add(material));
  });
  metrics.materials = materials.size;
  return Object.freeze(metrics);
}

function findNamedNode(root, name) {
  let match = null;
  root?.traverse?.(child => { if (!match && child.name === name) match = child; });
  return match;
}

function tintRole(material) {
  const name = String(material?.name || "").toLowerCase();
  if (name.includes("body-shell")) return "color";
  if (name === "lamps") return "emissive";
  return null;
}

function colorHex(color) {
  if (typeof color?.getHex === "function") return color.getHex();
  if (Number.isSafeInteger(color?.value)) return color.value;
  return null;
}

function applyMaterialTeamTint(material, team) {
  const record = ASSET_TEAM_TINTS.get(material);
  if (!record) return false;
  const target = TEAM_COLORS[team] ?? TEAM_COLORS.neutral;
  const color = material[record.role];
  if (!color?.set) return false;
  color.set(target);
  material.needsUpdate = true;
  return true;
}

function applyAssetTeamTint(asset, team) {
  const normalizedTeam = team === "blue" || team === "red" || team === "orange" ? team : null;
  asset?.traverse?.(child => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => applyMaterialTeamTint(material, normalizedTeam));
  });
  if (asset?.userData) asset.userData.team = normalizedTeam;
  return normalizedTeam;
}

/** Update the visual-only tint on a previously attached vehicle asset. */
export function setVehicleAssetTeam(root, team) {
  if (!root?.userData) return false;
  const normalizedTeam = team === "blue" || team === "red" || team === "orange" ? team : null;
  let updated = false;
  root.traverse?.(candidate => {
    if (!candidate?.userData || candidate === root) return;
    if (candidate.userData.assetState || candidate.userData.assetReady || candidate.userData.vehicleSkinAsset) {
      candidate.userData.team = normalizedTeam;
      const asset = candidate.userData.vehicleSkinAsset || findNamedNode(candidate, "vehicle-skin-asset");
      if (asset) { applyAssetTeamTint(asset, normalizedTeam); updated = true; }
      else updated = true; // Keep the pending loader on the latest team.
    }
  });
  root.userData.team = normalizedTeam;
  const asset = root.userData.vehicleSkinAsset || findNamedNode(root, "vehicle-skin-asset");
  if (asset) { applyAssetTeamTint(asset, normalizedTeam); updated = true; }
  return updated;
}

function cloneMaterialsAndTint(root, team) {
  root.traverse?.(child => {
    if (!child.isMesh || !child.material) return;
    const source = Array.isArray(child.material) ? child.material : [child.material];
    const materials = source.map(material => {
      const clone = material?.clone?.() || material;
      const role = tintRole(clone);
      if (role && colorHex(clone[role]) !== null) ASSET_TEAM_TINTS.set(clone, { role, original: colorHex(clone[role]) });
      return clone;
    });
    child.material = Array.isArray(child.material) ? materials : materials[0];
    child.castShadow = true;
    child.receiveShadow = true;
  });
  applyAssetTeamTint(root, team);
}

function prepareAsset(THREE, source, config, team) {
  const asset = source?.scene?.clone?.(true) || source?.clone?.(true);
  if (!asset) return null;
  asset.name = "vehicle-skin-asset";
  cloneMaterialsAndTint(asset, team);
  asset.updateMatrixWorld?.(true);
  const bounds = new THREE.Box3().setFromObject(asset);
  const size = bounds.getSize(new THREE.Vector3());
  if (!size.x || !size.y || !size.z) return null;
  // The source is authored in metres but has a low profile. Non-uniform fit
  // preserves the existing chassis envelope without touching physics.
  asset.scale.set(
    finite(config.targetWidth, DEFAULT_VEHICLE_ASSET.targetWidth) / size.x,
    finite(config.targetHeight, DEFAULT_VEHICLE_ASSET.targetHeight) / size.y,
    finite(config.targetDepth, DEFAULT_VEHICLE_ASSET.targetDepth) / size.z,
  );
  asset.updateMatrixWorld?.(true);
  const fitted = new THREE.Box3().setFromObject(asset);
  const center = fitted.getCenter(new THREE.Vector3());
  asset.position.x -= center.x;
  asset.position.z -= center.z;
  asset.position.y += finite(config.floorY, DEFAULT_VEHICLE_ASSET.floorY) - fitted.min.y;
  asset.updateMatrixWorld?.(true);
  asset.userData = { ...(asset.userData || {}), visualOnly: true, role: "vehicle-skin", source: config.url };
  return asset;
}

function loadWithLoader(loader, url, timeoutMs) {
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

async function resolveLoader({ loader, loaderFactory } = {}) {
  if (loader?.load) return loader;
  if (typeof loaderFactory === "function") return await loaderFactory();
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  try {
    const module = await import(BROWSER_GLTF_LOADER_URL);
    return module.GLTFLoader ? new module.GLTFLoader() : null;
  } catch {
    return null;
  }
}

function collectDescendants(root, target, set) {
  target?.traverse?.(child => set.add(child));
  return set;
}

function presentationKeepSet(root, references) {
  const keep = new Set();
  collectDescendants(root, references?.actionPulse, keep);
  collectDescendants(root, references?.speedTrails, keep);
  collectDescendants(root, references?.healthBar?.group, keep);
  for (const propulsor of references?.propulsors || []) {
    for (const part of [propulsor.nozzle, propulsor.ring, propulsor.flame, propulsor.glow]) {
      collectDescendants(root, part, keep);
      if (part) keep.add(part);
    }
  }
  for (const bank of [references?.headlights, references?.brakeLights]) {
    for (const light of bank || []) {
      collectDescendants(root, light?.mesh, keep);
      if (light?.mesh) keep.add(light.mesh);
      if (light?.light) keep.add(light.light);
    }
  }
  return keep;
}

function disposeMeshResources(mesh) {
  mesh?.geometry?.dispose?.();
  const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
  materials.filter(Boolean).forEach(material => material.dispose?.());
}

function discardProceduralMeshes(attitude, keep) {
  const meshes = [];
  attitude?.traverse?.(child => {
    if (child?.isMesh && !keep.has(child)) meshes.push(child);
  });
  meshes.forEach(mesh => {
    mesh.parent?.remove?.(mesh);
    disposeMeshResources(mesh);
  });
  return meshes.length;
}

function siblingAssetUrl(url, fileName) {
  try {
    // A synthetic origin keeps this helper usable in Node tests while still
    // producing the same path a browser GLTFLoader would request.
    return new URL(fileName, new URL(String(url), "http://vehicle.local")).pathname;
  } catch {
    const value = String(url || "");
    return `${value.slice(0, value.lastIndexOf("/") + 1)}${fileName}`;
  }
}

function splitWheelTransform(THREE, node, name) {
  const parent = node?.parent;
  if (!parent) throw new Error(`asset wheel has no parent: ${name}`);
  const carrier = new THREE.Group();
  carrier.name = name;
  carrier.position.copy(node.position);
  carrier.scale.copy(node.scale);
  parent.remove(node);
  parent.add(carrier);
  // Keep the carrier's frame free to steer around vertical y. The authored
  // wheel orientation stays on the spinner so its local y axis remains the
  // axle used for rolling spin.
  node.name = `${name}-mesh`;
  node.position.set(0, 0, 0);
  node.scale.set(1, 1, 1);
  carrier.add(node);
  return { carrier, spinner: node };
}

function activateAsset({ THREE, root, attitude, references, state, asset, metrics, config = {} }) {
  const wheelNodes = WHEEL_NAMES.map(([label, name, front]) => {
    const node = findNamedNode(asset, name);
    if (!node) return null;
    const { carrier, spinner } = splitWheelTransform(THREE, node, name);
    return { label, front, carrier, tire: spinner, tyre: spinner, rim: spinner, spokes: [], brakeCaliper: null };
  }).filter(Boolean);
  if (wheelNodes.length !== 4) throw new Error("asset missing four named wheel nodes");

  // Keep health/action/boost presentation helpers alive while replacing only
  // the procedural chassis skin. Client aliases are redirected to the named
  // asset wheel nodes, so existing animation code remains safe.
  const keep = presentationKeepSet(root, references);
  attitude.traverse(child => {
    if (child.isMesh && !keep.has(child)) child.visible = false;
  });

  if (config.disposeProceduralOnAssetReady === true) {
    state.proceduralMeshesDisposed = discardProceduralMeshes(attitude, keep);
  }

  asset.visible = true;
  attitude.add(asset);
  root.userData.vehicleSkinAsset = asset;
  const currentTeam = Object.hasOwn(root.userData, "team") ? root.userData.team : state.team;
  asset.userData.team = currentTeam ?? null;
  applyAssetTeamTint(asset, currentTeam);
  const spinners = wheelNodes.map(({ tire, rim }) => ({ tire, rim }));
  const steering = wheelNodes.filter(wheel => wheel.front).map(wheel => wheel.carrier);
  references.wheels.splice(0, references.wheels.length, ...wheelNodes);
  references.wheelSpinners.splice(0, references.wheelSpinners.length, ...spinners);
  references.steeringWheels.splice(0, references.steeringWheels.length, ...steering);
  root.userData.assetMetrics = metrics;
  state.assetFiles = [state.assetUrl, siblingAssetUrl(state.assetUrl, "geometry.bin")];
  // Keep the historical labels for consumers that only display provenance.
  state.loaded = ["game-car/model.gltf", "game-car/geometry.bin"];
  state.metrics = metrics;
  state.triangles = metrics.triangles;
  state.drawCalls = metrics.drawCalls;
  state.status = "ready";
  state.source = "asset-plus-procedural-effects";
}

/** Start the authored visual skin without delaying procedural first paint. */
export function attachVehicleAsset({ THREE, root, attitude, references, team = "blue", config = {}, loader, loaderFactory } = {}) {
  const explicitConfig = config && typeof config === "object" ? config : {};
  // The authored skin is enabled by default. Callers can still disable it
  // unambiguously with `vehicleAsset: { enabled: false }`.
  const enabled = explicitConfig.enabled === undefined
    ? DEFAULT_VEHICLE_ASSET.enabled
    : explicitConfig.enabled;
  const options = { ...DEFAULT_VEHICLE_ASSET, ...explicitConfig, enabled };
  const state = root.userData.assetState = {
    status: options.enabled === false ? "disabled" : "loading",
    source: "procedural",
    loaded: [],
    failures: [],
    metrics: null,
    triangles: 0,
    drawCalls: 0,
    assetUrl: options.url,
    assetFiles: [],
    team: root.userData.team ?? (team === "blue" || team === "red" || team === "orange" ? team : null),
    budget: { maxTriangles: options.maxTriangles, maxDrawCalls: options.maxDrawCalls },
  };
  if (options.enabled === false) {
    const ready = Promise.resolve(state);
    root.userData.assetReady = ready;
    return ready;
  }
  const ready = Promise.resolve().then(async () => {
    const resolved = await resolveLoader({ loader, loaderFactory });
    if (!resolved) throw new Error("GLTFLoader unavailable");
    const loaded = await loadWithLoader(resolved, options.url, finite(options.timeoutMs, 2500));
    const currentTeam = Object.hasOwn(root.userData, "team") ? root.userData.team : state.team;
    const asset = prepareAsset(THREE, loaded, options, currentTeam);
    if (!asset) throw new Error("asset has no usable scene");
    const metrics = countGeometryMetrics(asset);
    if (metrics.triangles > finite(options.maxTriangles, Infinity)) throw new Error(`asset triangle budget exceeded: ${metrics.triangles}`);
    if (metrics.drawCalls > finite(options.maxDrawCalls, Infinity)) throw new Error(`asset draw-call budget exceeded: ${metrics.drawCalls}`);
    if (root.userData.disposed === true) {
      disposeAssetResources(asset);
      state.status = "disposed";
      state.source = "disposed";
      return state;
    }
    state.team = currentTeam;
    activateAsset({ THREE, root, attitude, references, state, asset, metrics, config: options });
    return state;
  }).catch(error => {
    state.status = "fallback";
    state.source = "procedural";
    state.failures.push({ asset: options.url, reason: error?.message || String(error) });
    return state;
  });
  root.userData.assetReady = ready;
  return ready;
}

function disposeAssetResources(root) {
  root?.traverse?.(child => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach(material => material.dispose?.());
  });
}

export { countGeometryMetrics, prepareAsset };
