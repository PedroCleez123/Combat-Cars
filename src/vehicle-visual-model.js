import { attachVehicleAsset } from "./vehicle-asset-loader.js";

/**
 * Visual model for the combat rally car.
 *
 * The authored game-car GLTF is the primary visual skin and attaches
 * asynchronously after the procedural surface has provided first paint. The
 * procedural surface remains the immediate fallback when loading, decoding,
 * or the render budget fails; gameplay authority remains outside this module
 * and the returned Group contains render meshes and animation references only.
 * The local chassis envelope matches vehicle-visual-alignment.js
 * (y=.09..1.77); callers apply the returned Group's position/scale and full
 * attitude from the authoritative vehicle snapshot.
 *
 * A single reference view cannot reveal hidden geometry or underside details,
 * so the rear, underside and internal structure are inferred. No proprietary
 * logo or branded decal is reproduced.
 */

const TEAM_DEFAULTS = Object.freeze({
  blue: Object.freeze({ body: 0x168ed3, light: 0x59cfff, glow: 0x168ed3 }),
  orange: Object.freeze({ body: 0xf27f19, light: 0xffc15d, glow: 0xf27f19 }),
  red: Object.freeze({ body: 0xd03d43, light: 0xff6665, glow: 0xd03d43 }),
});

function normaliseTeam(team) {
  const value = String(team || "blue").toLowerCase();
  return value === "orange" || value === "amber" ? "orange" : value === "red" ? "red" : "blue";
}

function colourValue(THREE, value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (value?.isColor) return value;
  return value;
}

function createMaterial(THREE, palette, key, defaults, overrideColor) {
  const source = palette?.[key];
  const hasSource = source !== undefined && source !== null;
  const material = source && typeof source.clone === "function"
    ? source.clone()
    : new THREE.MeshStandardMaterial({
      ...defaults,
      color: colourValue(THREE, source, overrideColor ?? defaults.color),
    });
  if (!hasSource && overrideColor !== undefined && material.color?.set) material.color.set(overrideColor);
  for (const [property, value] of Object.entries(defaults)) {
    if (property === "color" || value === undefined || value === null) continue;
    if (property === "emissive" && material.emissive?.set) {
      material.emissive.set(value);
      continue;
    }
    if (property in material) material[property] = value;
  }
  if (!hasSource && material.color?.set && overrideColor !== undefined) material.color.set(overrideColor);
  return material;
}

function mesh(THREE, geometry, material, name, castShadow = true) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.castShadow = castShadow;
  object.receiveShadow = true;
  return object;
}

function box(THREE, parent, size, position, material, name, rotation = [0, 0, 0], castShadow = true) {
  const object = mesh(THREE, new THREE.BoxGeometry(...size), material, name, castShadow);
  object.position.set(...position);
  object.rotation.set(...rotation);
  parent.add(object);
  return object;
}

function cylinder(THREE, parent, radius, depth, position, material, name, rotation = [0, 0, 0], radialSegments = 16, castShadow = true) {
  const object = mesh(THREE, new THREE.CylinderGeometry(radius, radius, depth, radialSegments), material, name, castShadow);
  object.position.set(...position);
  object.rotation.set(...rotation);
  parent.add(object);
  return object;
}

function torus(THREE, parent, radius, tube, position, material, name, rotation = [0, 0, 0], radialSegments = 8, tubularSegments = 20, arc = Math.PI * 2, castShadow = true) {
  const object = mesh(THREE, new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments, arc), material, name, castShadow);
  object.position.set(...position);
  object.rotation.set(...rotation);
  parent.add(object);
  return object;
}

function tubeBetween(THREE, parent, start, end, radius, material, name, radialSegments = 8) {
  const from = new THREE.Vector3(...start);
  const to = new THREE.Vector3(...end);
  const direction = to.clone().sub(from);
  const length = direction.length();
  const object = mesh(THREE, new THREE.CylinderGeometry(radius, radius, length, radialSegments), material, name);
  object.position.copy(from).add(to).multiplyScalar(.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  parent.add(object);
  return object;
}

function collectVisualMetrics(root) {
  let meshCount = 0;
  let triangleCount = 0;
  let lightCount = 0;
  const materials = new Set();
  root.traverse(object => {
    if (object.isMesh) {
      meshCount += 1;
      const position = object.geometry?.attributes?.position;
      const indexedCount = object.geometry?.index?.count;
      triangleCount += Math.floor((indexedCount ?? position?.count ?? 0) / 3);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) if (material) materials.add(material);
    }
    if (object.isLight) lightCount += 1;
  });
  const metrics = {
    detailRevision: 2,
    meshCount,
    triangleCount,
    materialCount: materials.size,
    lightCount,
    drawCallEstimate: meshCount,
    budget: Object.freeze({ maxTriangles: 7000, maxDrawCalls: 180 }),
  };
  return Object.freeze(metrics);
}

/**
 * Build one reusable car visual.
 *
 * @param {{team?: string, THREE: object, palette?: object}} options
 * @returns {import('three').Group} Group with references in userData.references
 */
export function createVehicleVisualModel({
  team = "blue",
  THREE,
  palette = {},
  // The authored GLTF skin is enabled by default. Tests and constrained
  // callers can request the procedural presentation explicitly with
  // `vehicleAsset: { enabled: false }` (and may override URL/budgets).
  vehicleAsset = { enabled: true },
  vehicleAssetLoader,
  vehicleAssetLoaderFactory,
} = {}) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.BoxGeometry) {
    throw new TypeError("createVehicleVisualModel requires a Three.js namespace");
  }

  const teamKey = normaliseTeam(team);
  const teamDefaults = TEAM_DEFAULTS[teamKey];
  const body = createMaterial(THREE, palette, teamKey === "blue" ? "blue" : teamKey === "orange" ? "orange" : "red", {
    color: teamDefaults.body,
    metalness: .55,
    roughness: .32,
    emissive: teamDefaults.glow,
    emissiveIntensity: .28,
  }, teamDefaults.body);
  const teamLight = createMaterial(THREE, palette, teamKey === "blue" ? "blueLight" : teamKey === "orange" ? "orangeLight" : "redLight", {
    color: teamDefaults.light,
    roughness: .2,
    metalness: .2,
    emissive: teamDefaults.glow,
    emissiveIntensity: 1.8,
  }, teamDefaults.light);
  const dark = createMaterial(THREE, palette, "black", { color: 0x111820, roughness: .78, metalness: .12 });
  const glass = createMaterial(THREE, palette, "glass", { color: 0x6aa8bb, roughness: .16, metalness: .1, transparent: true, opacity: .82, emissive: 0x123c48, emissiveIntensity: .35 });
  const steel = createMaterial(THREE, palette, "silver", { color: 0x7d97a1, roughness: .28, metalness: .8 });
  const tire = createMaterial(THREE, palette, "tire", { color: 0x10161b, roughness: .88, metalness: .04 });
  const orange = createMaterial(THREE, palette, "orange", { color: 0xf27f19, roughness: .34, metalness: .45, emissive: 0x3a1300, emissiveIntensity: .2 }, 0xf27f19);
  const headlightMaterial = createMaterial(THREE, palette, teamKey === "blue" ? "blueLight" : teamKey === "orange" ? "orangeLight" : "redLight", { color: teamDefaults.light, roughness: .14, metalness: .06, emissive: teamDefaults.glow, emissiveIntensity: 2.8 }, teamDefaults.light);
  const brakeMaterial = createMaterial(THREE, palette, teamKey === "blue" ? "blueLight" : teamKey === "orange" ? "orangeLight" : "redLight", { color: teamDefaults.light, roughness: .2, metalness: .1, emissive: teamDefaults.glow, emissiveIntensity: 2.5 }, teamDefaults.light);
  const boosterMaterial = createMaterial(THREE, palette, "booster", { color: 0xffa529, roughness: .2, metalness: .3, emissive: 0xc94a00, emissiveIntensity: 1.8 }, 0xffa529);
  const flameMaterial = createMaterial(THREE, palette, "booster", { color: 0xffb347, roughness: .18, metalness: .05, transparent: true, opacity: .82, emissive: 0xff6a00, emissiveIntensity: 3.2 }, 0xffa529);

  const root = new THREE.Group();
  root.name = `vehicle-visual-model-${teamKey}`;
  const attitude = new THREE.Group();
  attitude.name = "vehicle-attitude";
  root.add(attitude);

  // Lower contact plate starts at y=.09, the same local floor used by the
  // alignment contract. The wheel radius and centre also preserve that floor.
  box(THREE, attitude, [3.8, .24, 1.68], [-.05, .21, 0], dark, "underbody-skid");
  box(THREE, attitude, [3.7, .48, 1.76], [-.08, .52, 0], body, "main-chassis");
  box(THREE, attitude, [1.48, .16, 1.48], [1.18, .8, 0], body, "front-hood");
  box(THREE, attitude, [1.36, .14, 1.5], [1.38, .92, 0], dark, "hood-vent");
  box(THREE, attitude, [1.48, .06, .16], [.72, 1.045, 0], orange, "hood-stripe-centre", [0, 0, 0], false);
  box(THREE, attitude, [.72, .045, .1], [.68, 1.07, -.31], orange, "hood-stripe-left", [0, 0, .03], false);
  box(THREE, attitude, [.72, .045, .1], [.68, 1.07, .31], orange, "hood-stripe-right", [0, 0, -.03], false);

  // Low-poly surface breakup gives the shell the folded, faceted look of the
  // Meshy references while keeping every piece inspectable and cheap. These
  // overlays are presentation-only; the chassis and alignment envelope above
  // remain the authority for contact and physics.
  const bodyPanels = new THREE.Group(); bodyPanels.name = "body-panels"; attitude.add(bodyPanels);
  const sidePanels = [];
  const panelLines = [];
  const decals = [];
  for (const side of [-1, 1]) {
    const z = side * .895;
    const panel = [
      box(THREE, bodyPanels, [1.02, .34, .055], [.8, .69, z], body, `side-panel-front-${side < 0 ? "left" : "right"}`, [0, 0, side * -.09]),
      box(THREE, bodyPanels, [.9, .43, .055], [-.18, .77, z], body, `side-panel-door-${side < 0 ? "left" : "right"}`, [0, 0, side * .02]),
      box(THREE, bodyPanels, [.66, .31, .055], [-1.02, .7, z], body, `side-panel-rear-${side < 0 ? "left" : "right"}`, [0, 0, side * .13]),
    ];
    sidePanels.push(...panel);
    panelLines.push(
      box(THREE, bodyPanels, [.045, .36, .064], [.28, .76, z + side * .006], dark, `door-seam-${side < 0 ? "left" : "right"}`, [0, 0, side * -.03], false),
      box(THREE, bodyPanels, [.04, .3, .064], [-.68, .73, z + side * .006], dark, `rear-seam-${side < 0 ? "left" : "right"}`, [0, 0, side * .08], false),
    );
    decals.push(
      box(THREE, bodyPanels, [.7, .055, .035], [.34, .93, z + side * .035], orange, `side-decal-${side < 0 ? "left" : "right"}`, [0, 0, side * -.03], false),
      box(THREE, bodyPanels, [.18, .12, .04], [-.72, .88, z + side * .035], orange, `side-decal-chevron-${side < 0 ? "left" : "right"}`, [0, 0, side * .28], false),
    );
  }
  const hoodFacets = [
    box(THREE, bodyPanels, [.7, .055, .5], [1.12, 1.0, -.42], body, "hood-facet-left", [0, 0, .055]),
    box(THREE, bodyPanels, [.7, .055, .5], [1.12, 1.0, .42], body, "hood-facet-right", [0, 0, -.055]),
    box(THREE, bodyPanels, [.12, .12, 1.52], [1.85, .58, 0], dark, "front-splitter", [0, 0, -.05]),
  ];

  // Recessed side air intakes and orange slats read as depth at the chase
  // camera scale without adding a texture dependency.
  const intakes = [];
  const intakeSlats = [];
  for (const side of [-1, 1]) {
    const z = side * .93;
    intakes.push(box(THREE, bodyPanels, [.48, .2, .045], [-.62, .88, z], dark, `side-intake-${side < 0 ? "left" : "right"}`, [0, 0, side * -.12]));
    for (const x of [-.77, -.61, -.45]) intakeSlats.push(box(THREE, bodyPanels, [.07, .065, .054], [x, .9, z + side * .026], orange, `intake-slat-${side < 0 ? "left" : "right"}-${x}`, [0, 0, side * -.12], false));
  }
  const frontCanards = [
    box(THREE, bodyPanels, [.38, .045, .18], [1.68, .56, -.84], orange, "front-canard-left", [0, 0, -.18], false),
    box(THREE, bodyPanels, [.38, .045, .18], [1.68, .56, .84], orange, "front-canard-right", [0, 0, .18], false),
  ];

  const cabin = box(THREE, attitude, [1.32, .54, 1.34], [-.38, 1.16, 0], glass, "cabin-glass");
  cabin.material.side = THREE.DoubleSide;
  box(THREE, attitude, [1.5, .11, 1.43], [-.38, 1.47, 0], body, "roof-panel");
  box(THREE, attitude, [.7, .04, .12], [-.38, 1.535, 0], orange, "roof-stripe", [0, 0, 0], false);
  // Inferred tubular cage: visible structure is kept separate so it can be
  // highlighted or damaged without changing the painted body mesh.
  const cage = new THREE.Group(); cage.name = "roll-cage"; attitude.add(cage);
  const cageRadius = .045;
  for (const [start, end, name] of [
    [[-.98, .95, -.58], [-.78, 1.58, -.58], "cage-front-left"],
    [[-.98, .95, .58], [-.78, 1.58, .58], "cage-front-right"],
    [[-.78, 1.58, -.58], [.12, 1.58, -.58], "cage-roof-left"],
    [[-.78, 1.58, .58], [.12, 1.58, .58], "cage-roof-right"],
    [[.12, 1.58, -.58], [.52, .98, -.58], "cage-rear-left"],
    [[.12, 1.58, .58], [.52, .98, .58], "cage-rear-right"],
    [[-.78, 1.58, -.58], [-.78, 1.58, .58], "cage-crossbar-front"],
  ]) tubeBetween(THREE, cage, start, end, cageRadius, steel, name, 7);

  // Fenders are faceted upper arches, intentionally separate from the tyres.
  const fenders = [];
  for (const { x, z, label } of [
    { x: 1.15, z: -.91, label: "front-left" }, { x: 1.15, z: .91, label: "front-right" },
    { x: -1.1, z: -.91, label: "rear-left" }, { x: -1.1, z: .91, label: "rear-right" },
  ]) {
    // Lift the inferred arch slightly above the wheel contact envelope. The
    // wheel remains the lowest chassis point at y=.09 for alignment.
    const fender = torus(THREE, attitude, .52, .075, [x, .7, z], body, `fender-${label}`, [0, 0, Math.PI], 6, 18, Math.PI, true);
    fenders.push(fender);
  }

  const wheels = [];
  const steeringWheels = [];
  for (const { x, z, label, front } of [
    { x: 1.16, z: -.92, label: "front-left", front: true }, { x: 1.16, z: .92, label: "front-right", front: true },
    { x: -1.1, z: -.92, label: "rear-left", front: false }, { x: -1.1, z: .92, label: "rear-right", front: false },
  ]) {
    const carrier = new THREE.Group(); carrier.name = `wheel-carrier-${label}`; carrier.position.set(x, .52, z); attitude.add(carrier);
    // CylinderGeometry's native y axis is the axle. Mounting x=PI/2 places
    // that axle along the car-local z direction; rolling therefore advances
    // each mesh's local y Euler component while steering stays on the carrier.
    const wheelMountRotation = [Math.PI / 2, 0, 0];
    const tyre = cylinder(THREE, carrier, .43, .32, [0, 0, 0], tire, `tire-${label}`, wheelMountRotation, 20);
    const rim = cylinder(THREE, carrier, .3, .335, [0, 0, 0], steel, `rim-${label}`, wheelMountRotation, 14);
    const rimRing = torus(THREE, carrier, .34, .035, [0, 0, 0], orange, `rim-ring-${label}`, [Math.PI / 2, 0, 0], 6, 16, Math.PI * 2, false);
    const hub = cylinder(THREE, carrier, .105, .35, [0, 0, 0], dark, `hub-${label}`, [Math.PI / 2, 0, 0], 10);
    const tread = new THREE.Group(); tread.name = `tread-${label}`; carrier.add(tread);
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * Math.PI * 2;
      box(THREE, tread, [.11, .05, .34], [Math.cos(angle) * .36, Math.sin(angle) * .36, 0], dark, `lug-${label}-${index}`, [0, 0, angle], false);
    }
    const spokes = [];
    const spokeSide = z < 0 ? -.18 : .18;
    for (let index = 0; index < 5; index += 1) {
      const angle = index / 5 * Math.PI * 2 + Math.PI / 10;
      spokes.push(box(THREE, carrier, [.065, .22, .045], [Math.cos(angle) * .14, Math.sin(angle) * .14, spokeSide], steel, `spoke-${label}-${index}`, [0, 0, angle], false));
    }
    const brakeCaliper = box(THREE, carrier, [.08, .2, .075], [-.2, .08, spokeSide], orange, `brake-caliper-${label}`, [0, 0, -.2], false);
    const wheel = { label, front, carrier, tyre, tire: tyre, rim, rimRing, hub, tread, spokes, brakeCaliper };
    wheels.push(wheel);
    if (front) steeringWheels.push(carrier);
  }

  // Front/rear light banks are both mesh references and actual PointLights so
  // callers can pulse them without searching the scene graph.
  const headlights = [];
  const brakeLights = [];
  for (const z of [-.57, .57]) {
    const headlight = box(THREE, attitude, [.09, .14, .36], [1.88, .72, z], headlightMaterial, `headlight-${z < 0 ? "left" : "right"}`, [0, 0, 0], false);
    const headlightPoint = new THREE.PointLight(teamDefaults.light, 1.8, 5.5, 2);
    headlightPoint.name = `headlight-point-${z < 0 ? "left" : "right"}`; headlightPoint.position.set(1.91, .72, z); attitude.add(headlightPoint);
    headlights.push({ mesh: headlight, light: headlightPoint });
    const brake = box(THREE, attitude, [.08, .12, .3], [-1.9, .72, z], brakeMaterial, `brake-light-${z < 0 ? "left" : "right"}`, [0, 0, 0], false);
    const brakePoint = new THREE.PointLight(teamDefaults.glow, .4, 3.5, 2);
    brakePoint.name = `brake-point-${z < 0 ? "left" : "right"}`; brakePoint.position.set(-1.93, .72, z); attitude.add(brakePoint);
    brakeLights.push({ mesh: brake, light: brakePoint });
  }
  const lightBars = [
    box(THREE, attitude, [.07, .045, .24], [1.94, .65, -.57], teamLight, "headlight-bar-left", [0, 0, 0], false),
    box(THREE, attitude, [.07, .045, .24], [1.94, .65, .57], teamLight, "headlight-bar-right", [0, 0, 0], false),
    box(THREE, attitude, [.07, .055, 1.18], [-1.94, .82, 0], brakeMaterial, "rear-light-bank", [0, 0, 0], false),
  ];

  // Two longitudinal booster pods echo the concept art while keeping the
  // flame mesh hidden until the boost system asks for it.
  const propulsors = [];
  for (const z of [-.43, .43]) {
    const nozzle = cylinder(THREE, attitude, .24, .78, [-1.56, 1.48, z], boosterMaterial, `booster-nozzle-${z < 0 ? "left" : "right"}`, [0, 0, Math.PI / 2], 14);
    const ring = torus(THREE, attitude, .22, .045, [-1.96, 1.48, z], orange, `booster-ring-${z < 0 ? "left" : "right"}`, [0, Math.PI / 2, 0], 6, 14, Math.PI * 2, false);
    const flame = mesh(THREE, new THREE.ConeGeometry(.16, 1.05, 10), flameMaterial, `booster-flame-${z < 0 ? "left" : "right"}`, false);
    flame.rotation.z = -Math.PI / 2; flame.position.set(-2.5, 1.48, z); flame.visible = false; attitude.add(flame);
    const glow = new THREE.PointLight(0xff7b1a, 0, 5.5, 2); glow.name = `booster-glow-${z < 0 ? "left" : "right"}`; glow.position.set(-2.1, 1.48, z); attitude.add(glow);
    propulsors.push({ nozzle, ring, flame, glow, enabled: false });
  }

  // The weapon is a presentation-only roof assembly. Keep a stable,
  // inspectable contract so the client can aim the turret and start its beam
  // at the actual muzzle after an authored skin takes over the chassis.
  const weaponMountRoot = new THREE.Group();
  weaponMountRoot.name = "weapon-mount";
  weaponMountRoot.position.set(.48, 1.76, 0);
  attitude.add(weaponMountRoot);
  const weaponBase = cylinder(THREE, weaponMountRoot, .34, .12, [0, .05, 0], steel, "weapon-mount-base", [0, 0, 0], 16);
  const weaponTurret = new THREE.Group();
  weaponTurret.name = "weapon-turret";
  weaponTurret.position.set(0, .12, 0);
  weaponMountRoot.add(weaponTurret);
  const weaponHousing = box(THREE, weaponTurret, [.68, .3, .6], [0, .16, 0], dark, "weapon-turret-housing");
  const weaponBarrel = cylinder(THREE, weaponTurret, .105, 1.55, [.82, .16, 0], steel, "weapon-barrel", [0, 0, -Math.PI / 2], 12);
  const weaponMuzzle = new THREE.Object3D();
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

  // Rear wing and orange end plates make the silhouette legible in side and
  // rear views without introducing a brand mark.
  const wing = new THREE.Group(); wing.name = "rear-wing"; attitude.add(wing);
  box(THREE, wing, [1.55, .1, 1.62], [-1.18, 1.68, 0], body, "wing-plane");
  box(THREE, wing, [1.38, .045, 1.4], [-1.18, 1.735, 0], dark, "wing-upper-flap");
  box(THREE, wing, [1.26, .02, 1.18], [-1.18, 1.75, 0], orange, "wing-accent-flap", [0, 0, 0], false);
  box(THREE, wing, [.1, .32, .15], [-1.18, 1.56, -.86], orange, "wing-endplate-left");
  box(THREE, wing, [.1, .32, .15], [-1.18, 1.56, .86], orange, "wing-endplate-right");
  tubeBetween(THREE, wing, [-1.55, 1.12, -.65], [-1.35, 1.62, -.65], .045, steel, "wing-strut-left", 7);
  tubeBetween(THREE, wing, [-1.55, 1.12, .65], [-1.35, 1.62, .65], .045, steel, "wing-strut-right", 7);

  const actionPulseMaterial = createMaterial(THREE, palette, "actionPulse", { color: teamDefaults.light, transparent: true, opacity: 0, depthWrite: false, emissive: teamDefaults.glow, emissiveIntensity: 2.2 }, teamDefaults.light);
  const actionPulse = torus(THREE, attitude, .82, .045, [0, .18, 0], actionPulseMaterial, "action-pulse", [Math.PI / 2, 0, 0], 6, 20, Math.PI * 2, false);
  actionPulse.visible = false;
  const speedTrails = new THREE.Group(); speedTrails.name = "speed-trails"; speedTrails.visible = false; attitude.add(speedTrails);
  for (const z of [-.52, .52]) {
    const trail = mesh(THREE, new THREE.ConeGeometry(.1, 2.9, 8), flameMaterial, `speed-trail-${z < 0 ? "left" : "right"}`, false);
    trail.rotation.z = Math.PI / 2; trail.position.set(-3.05, .58, z); speedTrails.add(trail);
  }

  const health = new THREE.Group(); health.name = "health-bar"; health.position.set(0, 2.28, 0); attitude.add(health);
  const healthBackground = box(THREE, health, [1.66, .12, .12], [0, 0, 0], dark, "health-background", [0, 0, 0], false);
  const healthFill = box(THREE, health, [1.55, .08, .08], [0, 0, 0], teamLight, "health-fill", [0, 0, 0], false);
  healthFill.position.x = -.05;
  const healthBar = { group: health, background: healthBackground, fill: healthFill, fillWidth: 1.55 };

  const references = {
    attitude,
    body,
    // Compatibility aliases for the current client visual contract.
    teamMat: body,
    teamLight,
    wheels,
    wheelSpinners: wheels.map(({ tire, rim }) => ({ tire, rim })),
    steeringWheels,
    fenders,
    propulsors,
    boosters: propulsors,
    boosterFlames: propulsors.map(propulsor => propulsor.flame),
    flame: propulsors[0].flame,
    lights: { headlights, brakeLights },
    headlights,
    brakeLights,
    lightBars,
    bodyPanels,
    sidePanels,
    panelLines,
    hoodFacets,
    intakes,
    intakeSlats,
    frontCanards,
    decals,
    rollCage: cage,
    actionPulse,
    pulse: actionPulse,
    speedTrails,
    healthBar,
    health,
    healthFill,
    wing,
    weaponMount,
  };
  const visualMetrics = collectVisualMetrics(root);
  root.userData = {
    team: teamKey,
    references,
    ...references,
    weaponMount,
    actionSerials: {},
    actionPulseRemaining: 0,
    localChassisBounds: Object.freeze({ minY: .09, maxY: 1.77 }),
    visualMetrics,
    metrics: visualMetrics,
    // Presentation helpers intentionally do not touch physics or authority.
    setHealth(value) {
      const ratio = Math.max(.02, Math.min(1, Number(value) / 100));
      healthFill.scale.x = ratio;
      healthFill.position.x = -.775 * (1 - ratio);
      return ratio;
    },
    setBoostVisible(enabled) {
      const visible = Boolean(enabled);
      for (const propulsor of propulsors) {
        propulsor.enabled = visible;
        propulsor.flame.visible = visible;
        propulsor.glow.intensity = visible ? 5 : 0;
      }
      speedTrails.visible = visible;
      return visible;
    },
  };
  // First paint remains procedural while the authored skin loads; authoritative
  // references stay valid and are redirected only after a successful attach.
  root.userData.assetReady = attachVehicleAsset({
    THREE,
    root,
    attitude,
    references,
    team: teamKey,
    config: vehicleAsset,
    loader: vehicleAssetLoader,
    loaderFactory: vehicleAssetLoaderFactory,
  });
  return root;
}

export { TEAM_DEFAULTS };

/** Aim a presentation-only weapon mount at a world-space point. */
export function aimWeaponMountAt(weaponMount, targetWorld) {
  const turret = weaponMount?.turret;
  const parent = turret?.parent;
  if (!turret || !parent || !targetWorld?.clone) return false;
  const localTarget = targetWorld.clone();
  parent.worldToLocal(localTarget);
  localTarget.sub(turret.position);
  if (localTarget.lengthSq() <= 1e-8) return false;
  localTarget.normalize();
  const forward = targetWorld.clone().set(1, 0, 0);
  turret.quaternion.setFromUnitVectors(forward, localTarget);
  turret.updateMatrixWorld(true);
  return true;
}

export function spinVehicleWheels(wheelSpinners, amount) {
  const delta = Number(amount) || 0;
  for (const wheel of wheelSpinners || []) {
    if (wheel?.tire) wheel.tire.rotation.y += delta;
    if (wheel?.rim && wheel.rim !== wheel.tire) wheel.rim.rotation.y += delta;
  }
  return wheelSpinners;
}

