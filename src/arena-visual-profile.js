// Arsenal's presentation palette is intentionally small and high contrast. It
// is a visual contract for panels, beacons and the center objective; it does
// not describe materials used by the simulation or a collision surface.
const ARSENAL_PALETTE = Object.freeze({
  ink: 0x071018,
  floor: 0x345b65,
  panel: 0x163746,
  panelEdge: 0xb5edf0,
  steel: 0x557984,
  blue: 0x3db7ff,
  blueGlow: 0x72d5ff,
  red: 0xff8374,
  redGlow: 0xffb09f,
  objective: 0xc5f3ed,
  hazard: 0xffc35a,
});

// The arena kit is kept local so the browser never waits on a remote host.
// Values here are an explicit presentation budget; they do not participate in
// RocketSim geometry or in pad availability/state.
const ARENA_ASSET_PROFILE = Object.freeze({
  enabled: true,
  skybowl: Object.freeze({
    url: "/src/assets/arena/skybowl.glb",
    maxBytes: 900_000,
    maxTriangles: 12_000,
    scalePadding: .96,
  }),
  boostPads: Object.freeze({
    url: "/src/assets/arena/boost-pads.glb",
    maxBytes: 260_000,
    maxTriangles: 5_000,
    largeScale: 1.45,
    smallScale: 1.85,
  }),
  budget: Object.freeze({
    maxBytes: 1_160_000,
    maxTriangles: 17_000,
    maxDrawCalls: 80,
  }),
});

const SCRAPYARD_PROFILE = Object.freeze({
  id: "scrapyard",
  background: 0x071018,
  fog: 0x071018,
  fogNear: 58,
  fogFar: 175,
  floor: 0x15262e,
  steel: 0x3a515d,
  ceiling: 0x1b303b,
  ceilingOpacity: .26,
  wallOpacity: .34,
  curveOpacity: .42,
  boundaryGlow: 0x244653,
  boundaryGlowIntensity: .22,
  gridMajor: 0x41606b,
  gridMinor: 0x20363e,
  curve: 0x3d6571,
  curveStripe: 0x79d5d7,
  lighting: Object.freeze({ hemisphere: 2.1, hemisphereSky: 0xb8d8eb, hemisphereGround: 0x102018, sun: 3.45, wash: 28, exposure: 1.1 }),
});

const ARENA_VISUAL_QUALITIES = Object.freeze(["high", "low"]);

const COMBAT_ALPHA_PROFILE = Object.freeze({
  ...SCRAPYARD_PROFILE,
  id: "combat-alpha-clean",
  quality: "high",
  // Combat uses a clean industrial palette while keeping all gameplay
  // geometry and arena bounds in the RocketSim profile.
  background: 0x0b1b25,
  fog: 0x0b1b25,
  // Keep the same visual density while the combat arena doubles its long
  // axis and vertical clearance (264 × 408 × 108).
  fogNear: 288,
  fogFar: 780,
  // The industrial shell must remain readable to the far wall. Depth comes
  // from the continuous geometry, material scale and lighting, not distance
  // fog that desaturates the arena and hides its silhouette.
  fogEnabled: false,
  floor: 0x294b55,
  steel: 0x78939c,
  ceiling: 0x203d49,
  ceilingOpacity: 1,
  wallOpacity: 1,
  curveOpacity: 1,
  // Stable presentation contract consumed by buildWorld and its tests.
  // Practice and scrapyard profiles intentionally omit these fields so their
  // diagnostic grids and curve overlays remain enabled by default.
  showGrid: false,
  showCurveOverlay: false,
  opacity: 1,
  // combat-alpha treats the boundary as one solid gameplay volume. Keep
  // diagnostic and decorative line geometry off its visible surfaces.
  surface: Object.freeze({
    // One opaque material is shared by the floor, quarter-pipes, corner
    // fillets, vertical walls and ceiling.  The RocketSim collision mesh stays
    // authoritative; this is only the interior render skin.
    opaque: true,
    unified: true,
    materialModel: "shared-group-world-space-standard",
    skin: "industrial-scrapyard",
    textureManifest: "/src/assets/arena/scrapyard/manifest.json",
    textureBudgetBytes: 4_194_304,
    materialColor: 0x496f78,
    materialRoughness: .74,
    materialMetalness: .2,
    materialEmissive: 0x16333b,
    materialEmissiveIntensity: .16,
    showGrid: false,
    showCurveOverlay: false,
    showFloorGrid: false,
    showCeilingGrid: false,
    showCurveLines: false,
    showBoundaryDebugLines: false,
  }),
  boundaryGlow: 0x67aeb8,
  boundaryGlowIntensity: .3,
  gridMajor: 0x709ba4,
  gridMinor: 0x315761,
  curve: 0x6f9ca5,
  curveStripe: 0xc0eef0,
  palette: ARSENAL_PALETTE,
  combatBlueWash: 0x236078,
  combatRedWash: 0x754345,
  landmark: 0xd9e4bd,
  blueZone: 0x70a5b6,
  redZone: 0xb87665,
  perimeter: 0x60746e,
  perimeterOpacity: .58,
  // Native combat obstacles are collision-aligned visual companions, not
  // scraps. Give their shaded faces a restrained self-light so the central
  // block and ramp remain legible instead of turning into black silhouettes.
  obstacles: Object.freeze({
    body: 0x5b7478,
    bodyEmissive: 0x102a2f,
    bodyEmissiveIntensity: .34,
    bodyRoughness: .86,
    bodyMetalness: .12,
    cap: 0x697e82,
    capEmissive: 0x14282c,
    capEmissiveIntensity: .18,
    capRoughness: .58,
    capMetalness: .52,
    // The shell's hazard texture is sampled only in this narrow world-space
    // base band on the native block/ramp, never across the whole obstacle.
    hazardBandHeight: .38,
  }),
  assets: Object.freeze({
    enabled: false,
    skybowl: Object.freeze({ url: null }),
    boostPads: Object.freeze({ url: null }),
    budget: Object.freeze({ maxBytes: 0, maxTriangles: 0, maxDrawCalls: 0 }),
  }),
  decoration: Object.freeze({
    // Depth must come from the volume, lighting and readable landmarks. Flat
    // wall panels and perimeter strokes look like broken surface seams.
    showWallPanels: false,
    showPerimeterLine: false,
    panelOpacity: 0,
    panelEdgeOpacity: 0,
    guideOpacity: .4,
    showLaneGuides: false,
    // Broad, low-energy washes preserve depth without painting rectangular
    // light islands onto the wall/curve boundary.
    teamWashIntensity: 1.15,
    teamWashDistance: 72,
    beaconHeight: 3,
    beaconRadius: .95,
    objectiveRadius: 2.65,
    // These are sparse suspended fixtures, not wall decals or scrap props.
    // They give long-distance parallax and a restrained industrial identity
    // while leaving the playable shell visually continuous.
    industrial: Object.freeze({ enabled: true, fixtureHeight: 29, fixtureGlow: 0.42 }),
    // Sparse maintenance frames near the upper perimeter. They are above
    // every driving lane and use one shared instanced batch per part.
    perimeter: Object.freeze({
      enabled: true,
      y: 102,
      insetX: 24,
      insetZ: 24,
      moduleSize: Object.freeze([4.2, 2.2, .34]),
      lampSize: Object.freeze([3, .14, .14]),
      frameColor: 0x3f555c,
      frameEmissive: 0x0d1f22,
      frameEmissiveIntensity: .18,
      lampColor: 0xa8d7d2,
      lampEmissive: 0x6cc8c2,
      lampEmissiveIntensity: .9,
    }),
  }),
  // The ground colour is deliberately lifted for the interior shell. Three.js
  // uses it to light downward-facing normals, so the ceiling and upper curve
  // stay readable without reintroducing distance fog or flattening the floor.
  lighting: Object.freeze({ hemisphere: 3.05, hemisphereSky: 0xb8d8eb, hemisphereGround: 0x38545d, sun: 4.15, wash: 8, exposure: 1.12 }),
});

// The low tier keeps the same arena, palette, team markers, lighting and
// decoration contract. Only the expensive shell skin is replaced by the
// opaque profile fallback; no geometry or simulation field changes.
const COMBAT_ALPHA_LOW_PROFILE = Object.freeze({
  ...COMBAT_ALPHA_PROFILE,
  quality: "low",
  surface: Object.freeze({
    ...COMBAT_ALPHA_PROFILE.surface,
    skin: "solid-fallback",
    materialModel: "shared-group-standard-solid",
    textureManifest: null,
    textureBudgetBytes: 0,
  }),
});

const CLEAN_PRACTICE_PROFILE = Object.freeze({
  id: "arsenal-practice",
  // Gameplay remains an original Arsenal presentation. Optional visual assets
  // are loaded only as a presentation skin and never define colliders,
  // measurements, or RocketSim authority.
  background: 0x183b52,
  fog: 0x183b52,
  fogNear: 112,
  fogFar: 268,
  floor: 0x345b65,
  steel: 0x557984,
  ceiling: 0x456b7a,
  ceilingOpacity: .42,
  wallOpacity: .28,
  curveOpacity: .38,
  boundaryGlow: 0x2f7181,
  boundaryGlowIntensity: .34,
  gridMajor: 0x8cc5cf,
  gridMinor: 0x416f7b,
  curve: 0x4d8996,
  curveStripe: 0xb5edf0,
  landmark: 0xc5f3ed,
  blueZone: 0x3db7ff,
  redZone: 0xff8374,
  guide: 0x91e8dd,
  combatBlueWash: 0x2d9fe8,
  combatRedWash: 0xe45c65,
  combatWashOpacity: .085,
  perimeter: 0xb5edf0,
  perimeterOpacity: .62,
  // These fields are consumed by the optional arena-decoration module. They
  // keep combat-alpha's identity in one profile while preserving the existing
  // floor/wall values used by client.js.
  palette: ARSENAL_PALETTE,
  assets: ARENA_ASSET_PROFILE,
  decoration: Object.freeze({
    panelOpacity: .14,
    panelEdgeOpacity: .62,
    guideOpacity: .44,
    beaconHeight: 3.4,
    beaconRadius: 1.05,
    objectiveRadius: 2.65,
    teamWashIntensity: 3.8,
    teamWashDistance: 20,
  }),
  lighting: Object.freeze({ hemisphere: 2.55, sun: 4.1, wash: 38, exposure: 1.2 }),
});

const CLEAN_PRACTICE_MODES = new Set([
  "calibration",
  "rocketsim-curved-practice",
  "rocketsim-expanded-curved-practice",
  "rocketsim-expanded-cornered-practice",
  "rocketsim-expanded-block-practice",
  "rocketsim-expanded-ramp-practice",
]);

export function normalizeArenaVisualQuality(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "low" ? "low" : "high";
}

export function getArenaFogSettings(profile) {
  if (!profile || profile.fogEnabled === false) return null;
  return Object.freeze({
    color: profile.fog,
    near: profile.fogNear,
    far: profile.fogFar,
  });
}

export function getArenaVisualProfile(mode = "scrapyard", { quality = "high" } = {}) {
  const combatAlpha = mode === "combat-alpha" || mode === "rocketsim-combat-alpha";
  if (combatAlpha) {
    return normalizeArenaVisualQuality(quality) === "low" ? COMBAT_ALPHA_LOW_PROFILE : COMBAT_ALPHA_PROFILE;
  }
  return CLEAN_PRACTICE_MODES.has(mode) ? CLEAN_PRACTICE_PROFILE : SCRAPYARD_PROFILE;
}

export { ARENA_VISUAL_QUALITIES, ARSENAL_PALETTE, ARENA_ASSET_PROFILE, CLEAN_PRACTICE_PROFILE, COMBAT_ALPHA_LOW_PROFILE, COMBAT_ALPHA_PROFILE, SCRAPYARD_PROFILE };
