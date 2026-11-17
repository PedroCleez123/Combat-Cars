import { COMBAT_ALPHA_PROFILE } from "./arena-visual-profile.js";

export const SCRAPYARD_TEXTURE_MANIFEST_URL = COMBAT_ALPHA_PROFILE.surface.textureManifest;
export const SCRAPYARD_SHELL_MATERIAL_VERSION = "industrial-scrapyard-shell-v1";
export const SCRAPYARD_TIRE_MATERIAL_VERSION = "industrial-scrapyard-tire-v1";

const REQUIRED_ROLES = Object.freeze(["floor", "wall", "metal", "hazard"]);
const LOCAL_TEXTURE_URL = /^\/src\/assets\/arena\/scrapyard\/[a-z0-9-]+\.webp$/;
const SHELL_TEXTURE_SCALE = Object.freeze({
  floor: 0.03125,
  wall: 0.035,
  metal: 0.045,
  hazard: 0.12,
});

const SHADER_VERTEX_COMMON = `
varying vec3 vScrapyardWorldPosition;
varying vec3 vScrapyardWorldNormal;
`;

const SHADER_FRAGMENT_COMMON = `
uniform sampler2D scrapyardFloorMap;
uniform sampler2D scrapyardWallMap;
uniform sampler2D scrapyardMetalMap;
uniform sampler2D scrapyardHazardMap;
uniform float scrapyardFloorScale;
uniform float scrapyardWallScale;
uniform float scrapyardMetalScale;
uniform float scrapyardHazardScale;
varying vec3 vScrapyardWorldPosition;
varying vec3 vScrapyardWorldNormal;

vec3 scrapyardTriplanar(sampler2D map, vec3 position, vec3 normal, float scale) {
  vec3 blend = pow(abs(normal), vec3(4.0));
  float total = blend.x + blend.y + blend.z;
  blend = total > 0.0001 ? blend / total : vec3(0.0, 1.0, 0.0);
  vec3 x = texture2D(map, position.zy * scale).rgb;
  vec3 y = texture2D(map, position.xz * scale).rgb;
  vec3 z = texture2D(map, position.xy * scale).rgb;
  return x * blend.x + y * blend.y + z * blend.z;
}
`;

const SHADER_VERTEX = `
vScrapyardWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vScrapyardWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

// The welded shell has no UVs. Triplanar world-space sampling plus a
// front-face normal keeps floor, curves, walls, fillets and ceiling continuous.
const SHADER_MAP = `
vec3 scrapyardNormal = normalize(vScrapyardWorldNormal);
if (!gl_FrontFacing) scrapyardNormal = -scrapyardNormal;
vec3 scrapyardPosition = vScrapyardWorldPosition;
float scrapyardUp = clamp(scrapyardNormal.y, 0.0, 1.0);
float scrapyardDown = clamp(-scrapyardNormal.y, 0.0, 1.0);
// A curve normal is neither floor nor wall. Blend the two materials by the
// actual support direction so the floor texture cannot paint the lower wall
// while the wall texture fades in continuously through the quarter-pipe.
// Keep the blend deliberately narrow: once a quarter-pipe starts climbing it
// should read as a wall, rather than as the floor texture dragged up it.
float scrapyardFloorWeight = smoothstep(0.55, 0.78, scrapyardNormal.y);
float scrapyardCeilingWeight = 1.0 - smoothstep(-0.78, -0.55, scrapyardNormal.y);
float scrapyardWallWeight = max(0.0, 1.0 - scrapyardFloorWeight - scrapyardCeilingWeight);
float scrapyardUpper = smoothstep(72.0, 84.0, scrapyardPosition.y);
float scrapyardHazard = scrapyardWallWeight * (1.0 - scrapyardUpper) * (1.0 - smoothstep(0.8, 3.2, scrapyardPosition.y));
vec3 scrapyardFloor = scrapyardTriplanar(scrapyardFloorMap, scrapyardPosition, scrapyardNormal, scrapyardFloorScale);
vec3 scrapyardWall = scrapyardTriplanar(scrapyardWallMap, scrapyardPosition, scrapyardNormal, scrapyardWallScale);
vec3 scrapyardMetal = scrapyardTriplanar(scrapyardMetalMap, scrapyardPosition, scrapyardNormal, scrapyardMetalScale);
vec3 scrapyardHazardColor = scrapyardTriplanar(scrapyardHazardMap, scrapyardPosition, scrapyardNormal, scrapyardHazardScale);
vec3 scrapyardAlbedo = scrapyardFloor * scrapyardFloorWeight
  + scrapyardWall * (scrapyardWallWeight * (1.0 - scrapyardUpper) * (1.0 - scrapyardHazard))
  + scrapyardMetal * (scrapyardCeilingWeight + scrapyardWallWeight * scrapyardUpper)
  + scrapyardHazardColor * scrapyardHazard;
diffuseColor.rgb = scrapyardAlbedo;
`;

async function fetchManifest() {
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch(SCRAPYARD_TEXTURE_MANIFEST_URL, { cache: "force-cache" });
    if (!response || response.ok !== true) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function status(material, state, reason) {
  if (!material.userData || typeof material.userData !== "object") material.userData = {};
  material.userData.scrapyard = Object.freeze({
    enabled: state === "textured",
    status: state,
    reason,
    textureCount: state === "textured" ? 4 : 0,
    version: SCRAPYARD_SHELL_MATERIAL_VERSION,
  });
}

function supportsTexturedShell(renderer) {
  const capabilities = renderer?.capabilities;
  return Boolean(
    capabilities &&
    capabilities.isWebGL2 === true &&
    Number(capabilities.maxTextureSize) >= 1024
  );
}

function textureDefinitions(source) {
  if (!source || !Array.isArray(source.textures) || source.textures.length < REQUIRED_ROLES.length) return null;
  if (!Number.isInteger(source.limits?.approvedTextureCount)
    || source.limits.approvedTextureCount < REQUIRED_ROLES.length
    || source.textures.length > source.limits.approvedTextureCount) return null;
  const budget = COMBAT_ALPHA_PROFILE.surface.textureBudgetBytes;
  if (!Number.isFinite(source.totalBytes) || source.totalBytes > budget || source.totalBytes > source.limits.targetBytes) return null;
  const byRole = new Map();
  const allowedRoles = new Set([...REQUIRED_ROLES, "tires"]);
  for (const texture of source.textures) {
    if (!texture || !allowedRoles.has(texture.role) || byRole.has(texture.role)) return null;
    if (typeof texture.url !== "string" || !LOCAL_TEXTURE_URL.test(texture.url)) return null;
    if (texture.colorSpace !== "srgb" || texture.alpha !== false) return null;
    if (!isPowerOfTwo(texture.width) || !isPowerOfTwo(texture.height)) return null;
    byRole.set(texture.role, texture);
  }
  if (REQUIRED_ROLES.some(role => !byRole.has(role))) return null;
  return REQUIRED_ROLES.map((role) => byRole.get(role));
}

function tireTextureDefinition(source) {
  if (!source || !Array.isArray(source.textures) || !Number.isInteger(source.limits?.approvedTextureCount)
    || source.limits.approvedTextureCount < REQUIRED_ROLES.length) return null;
  const texture = source.textures.find(candidate => candidate?.role === "tires");
  if (!texture || typeof texture.url !== "string" || !LOCAL_TEXTURE_URL.test(texture.url)
    || texture.colorSpace !== "srgb" || texture.alpha !== false
    || !isPowerOfTwo(texture.width) || !isPowerOfTwo(texture.height)) return null;
  return texture;
}

function applyTextureSettings(texture, THREE, maxAnisotropy) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
}

function applyShader({ THREE, material, textures }) {
  const uniforms = Object.freeze({
    scrapyardFloorMap: { value: textures.floor },
    scrapyardWallMap: { value: textures.wall },
    scrapyardMetalMap: { value: textures.metal },
    scrapyardHazardMap: { value: textures.hazard },
    scrapyardFloorScale: { value: SHELL_TEXTURE_SCALE.floor },
    scrapyardWallScale: { value: SHELL_TEXTURE_SCALE.wall },
    scrapyardMetalScale: { value: SHELL_TEXTURE_SCALE.metal },
    scrapyardHazardScale: { value: SHELL_TEXTURE_SCALE.hazard },
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${SHADER_VERTEX_COMMON}`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${SHADER_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SHADER_FRAGMENT_COMMON}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${SHADER_MAP}`);
  };
  material.customProgramCacheKey = () => SCRAPYARD_SHELL_MATERIAL_VERSION;
  material.needsUpdate = true;
  status(material, "textured", "ready");
}

/**
 * Builds the combat-alpha shell material. The returned material is immediately
 * usable as the opaque profile fallback; the world-space skin is applied only
 * after all four local textures have loaded successfully.
 */
export function createScrapyardShellMaterial({
  THREE,
  renderer,
  quality = "high",
  manifest: source = null,
} = {}) {
  if (!THREE || typeof THREE.MeshStandardMaterial !== "function") {
    throw new TypeError("createScrapyardShellMaterial needs a THREE namespace with MeshStandardMaterial");
  }
  const surface = COMBAT_ALPHA_PROFILE.surface;
  const material = new THREE.MeshStandardMaterial({
    color: surface.materialColor,
    roughness: surface.materialRoughness,
    metalness: surface.materialMetalness,
    emissive: surface.materialEmissive,
    emissiveIntensity: surface.materialEmissiveIntensity,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.name = "arena-scrapyard-shell";
  status(material, "fallback", "pending");

  let disposed = false;
  const loadedTextures = new Set();
  const maxAnisotropy = typeof renderer?.capabilities?.getMaxAnisotropy === "function"
    ? Math.max(1, Math.min(8, Number(renderer.capabilities.getMaxAnisotropy()) || 1))
    : 1;

  const ready = (async () => {
    // The public P2P renderer calls its safe default "balanced". It still
    // needs the approved industrial skin; only the explicit low/performance
    // tiers are allowed to remove texture sampling.
    if (quality === "low" || quality === "performance") {
      status(material, "fallback", "quality");
      return false;
    }
    if (!supportsTexturedShell(renderer)) {
      status(material, "fallback", "renderer");
      return false;
    }
    const manifestSource = source || await fetchManifest();
    if (disposed) return false;
    const definitions = textureDefinitions(manifestSource);
    if (!definitions) {
      status(material, "fallback", "manifest");
      return false;
    }
    if (typeof THREE.TextureLoader !== "function") {
      status(material, "fallback", "loader");
      return false;
    }
    let loader;
    try {
      loader = new THREE.TextureLoader();
    } catch {
      status(material, "fallback", "loader");
      return false;
    }
    if (!loader || typeof loader.loadAsync !== "function") {
      status(material, "fallback", "loader");
      return false;
    }

    const textures = {};
    try {
      const results = await Promise.allSettled(definitions.map(async (definition) => {
        const texture = await loader.loadAsync(definition.url);
        if (disposed) {
          texture?.dispose?.();
          return;
        }
        if (!texture) throw new Error(`Missing texture: ${definition.url}`);
        applyTextureSettings(texture, THREE, maxAnisotropy);
        loadedTextures.add(texture);
        textures[definition.role] = texture;
      }));
      if (disposed) {
        for (const texture of loadedTextures) texture.dispose?.();
        loadedTextures.clear();
        return false;
      }
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      if (REQUIRED_ROLES.some((role) => !textures[role])) throw new Error("Texture set is incomplete");
      applyShader({ THREE, material, textures });
      return true;
    } catch {
      for (const texture of loadedTextures) texture.dispose?.();
      loadedTextures.clear();
      material.onBeforeCompile = undefined;
      material.customProgramCacheKey = undefined;
      material.needsUpdate = true;
      if (!disposed) status(material, "fallback", "load");
      return false;
    }
  })();

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const texture of loadedTextures) texture.dispose?.();
    loadedTextures.clear();
    material.dispose?.();
    status(material, "disposed", "disposed");
  }

  return { material, ready, dispose };
}

function tireStatus(material, state, reason) {
  if (!material.userData || typeof material.userData !== "object") material.userData = {};
  material.userData.scrapyardTire = Object.freeze({
    enabled: state === "textured",
    status: state,
    reason,
    textureCount: state === "textured" ? 1 : 0,
    version: SCRAPYARD_TIRE_MATERIAL_VERSION,
  });
}

/** Builds a textured tire-pile material with the same local-only/fallback policy as ART-03. */
export function createScrapyardTireMaterial({
  THREE,
  renderer,
  quality = "high",
  manifest: source = null,
} = {}) {
  if (!THREE || typeof THREE.MeshStandardMaterial !== "function") {
    throw new TypeError("createScrapyardTireMaterial needs a THREE namespace with MeshStandardMaterial");
  }
  const material = new THREE.MeshStandardMaterial({
    color: 0x15191a,
    roughness: .94,
    metalness: .04,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  material.name = "arena-scrapyard-tires";
  tireStatus(material, "fallback", "pending");
  let disposed = false;
  let texture = null;
  const maxAnisotropy = typeof renderer?.capabilities?.getMaxAnisotropy === "function"
    ? Math.max(1, Math.min(8, Number(renderer.capabilities.getMaxAnisotropy()) || 1))
    : 1;
  const ready = (async () => {
    if (quality === "low" || quality === "performance") {
      tireStatus(material, "fallback", "quality");
      return false;
    }
    if (!supportsTexturedShell(renderer)) {
      tireStatus(material, "fallback", "renderer");
      return false;
    }
    const definition = tireTextureDefinition(source || await fetchManifest());
    if (disposed) return false;
    if (!definition || typeof THREE.TextureLoader !== "function") {
      tireStatus(material, "fallback", definition ? "loader" : "manifest");
      return false;
    }
    let loader;
    try { loader = new THREE.TextureLoader(); } catch {
      tireStatus(material, "fallback", "loader");
      return false;
    }
    if (!loader || typeof loader.loadAsync !== "function") {
      tireStatus(material, "fallback", "loader");
      return false;
    }
    try {
      texture = await loader.loadAsync(definition.url);
      if (disposed) {
        texture?.dispose?.();
        texture = null;
        return false;
      }
      if (!texture) throw new Error("Missing tire texture");
      applyTextureSettings(texture, THREE, maxAnisotropy);
      texture.repeat?.set?.(1.15, 1.15);
      material.map = texture;
      material.color?.setHex?.(0xffffff);
      material.needsUpdate = true;
      tireStatus(material, "textured", "ready");
      return true;
    } catch {
      texture?.dispose?.();
      texture = null;
      if (!disposed) tireStatus(material, "fallback", "load");
      return false;
    }
  })();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    texture?.dispose?.();
    texture = null;
    material.dispose?.();
    tireStatus(material, "disposed", "disposed");
  };
  return { material, ready, dispose };
}

