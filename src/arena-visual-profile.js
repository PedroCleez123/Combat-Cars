const SCRAPYARD_PROFILE = Object.freeze({
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
  lighting: Object.freeze({ hemisphere: 2.1, sun: 3.45, wash: 28, exposure: 1.1 }),
});

const CLEAN_PRACTICE_PROFILE = Object.freeze({
  // This remains an original Arsenal presentation. It deliberately uses no
  // Rocket League or Soccar assets, measurements, or arena texture data.
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
  lighting: Object.freeze({ hemisphere: 2.55, sun: 4.1, wash: 38, exposure: 1.2 }),
});

const CLEAN_PRACTICE_MODES = new Set([
  "calibration",
  "rocketsim-curved-practice",
  "rocketsim-expanded-curved-practice",
  "rocketsim-expanded-cornered-practice",
  "rocketsim-expanded-block-practice",
  "rocketsim-expanded-ramp-practice",
  "rocketsim-combat-alpha",
]);

export function getArenaVisualProfile(mode = "scrapyard") {
  return CLEAN_PRACTICE_MODES.has(mode) ? CLEAN_PRACTICE_PROFILE : SCRAPYARD_PROFILE;
}

export { CLEAN_PRACTICE_PROFILE, SCRAPYARD_PROFILE };
