import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMBAT_ALPHA_PROFILE } from "../src/arena-visual-profile.js";
import {
  createScrapyardShellMaterial,
  createScrapyardTireMaterial,
  SCRAPYARD_SHELL_MATERIAL_VERSION,
  SCRAPYARD_TIRE_MATERIAL_VERSION,
  SCRAPYARD_TEXTURE_MANIFEST_URL,
} from "../src/arena-scrapyard-material.js";

const SCRAPYARD_TEXTURE_MANIFEST = JSON.parse(await readFile(
  new URL("../src/assets/arena/scrapyard/manifest.json", import.meta.url),
  "utf8",
));

function createFakeTexture(url) {
  return {
    url,
    colorSpace: null,
    wrapS: null,
    wrapT: null,
    minFilter: null,
    magFilter: null,
    generateMipmaps: false,
    anisotropy: 1,
    needsUpdate: false,
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
}

function createFakeThree({ failUrl = null, delayedUrl = null, delayMs = 0 } = {}) {
  const requests = [];
  const created = [];
  class FakeMaterial {
    constructor(options) {
      Object.assign(this, options);
      this.userData = {};
      this.needsUpdate = false;
      this.disposed = false;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class FakeTextureLoader {
    loadAsync(url) {
      requests.push(url);
      if (url === failUrl) return Promise.reject(new Error(`failed to load ${url}`));
      const texture = createFakeTexture(url);
      created.push(texture);
      if (url === delayedUrl) {
        return new Promise((resolve) => setTimeout(() => resolve(texture), delayMs));
      }
      return Promise.resolve(texture);
    }
  }
  return {
    THREE: {
      MeshStandardMaterial: FakeMaterial,
      TextureLoader: FakeTextureLoader,
      SRGBColorSpace: "srgb",
      RepeatWrapping: 1000,
      LinearMipmapLinearFilter: 1008,
      LinearFilter: 1006,
      DoubleSide: 2,
    },
    requests,
    created,
  };
}

function createRenderer({ webgl2 = true, maxTextureSize = 4096 } = {}) {
  return {
    capabilities: {
      isWebGL2: webgl2,
      maxTextureSize,
      getMaxAnisotropy: () => 8,
    },
  };
}

function fakeShader() {
  return {
    uniforms: {},
    vertexShader: "#include <common>\n#include <worldpos_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>",
  };
}

test("combat-alpha starts from the opaque profile fallback and applies four local textures", async () => {
  const { THREE, requests } = createFakeThree();
  const skin = createScrapyardShellMaterial({ THREE, renderer: createRenderer(), quality: "high", manifest: SCRAPYARD_TEXTURE_MANIFEST });
  const material = skin.material;

  assert.equal(material.color, COMBAT_ALPHA_PROFILE.surface.materialColor);
  assert.equal(material.roughness, COMBAT_ALPHA_PROFILE.surface.materialRoughness);
  assert.equal(material.metalness, COMBAT_ALPHA_PROFILE.surface.materialMetalness);
  assert.equal(material.emissive, COMBAT_ALPHA_PROFILE.surface.materialEmissive);
  assert.equal(material.transparent, false);
  assert.equal(material.opacity, 1);
  assert.equal(material.depthWrite, true);
  assert.equal(material.depthTest, true);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.userData.scrapyard.enabled, false);

  assert.equal(await skin.ready, true);
  assert.equal(skin.material, material);
  assert.equal(material.userData.scrapyard.enabled, true);
  assert.equal(material.userData.scrapyard.textureCount, 4);
  assert.equal(requests.length, 4);
  assert.equal(requests.every((url) => url.startsWith("/src/assets/arena/scrapyard/")), true);
  assert.equal(requests.every((url) => !url.includes("..") && !url.includes("://")), true);
  assert.deepEqual(requests, SCRAPYARD_TEXTURE_MANIFEST.textures
    .filter(texture => ["floor", "wall", "metal", "hazard"].includes(texture.role))
    .map((texture) => texture.url));
});

test("COV-03 tire material uses the local approved tire derivative and keeps a fallback", async () => {
  const { THREE, requests, created } = createFakeThree();
  const skin = createScrapyardTireMaterial({
    THREE,
    renderer: createRenderer(),
    quality: "high",
    manifest: SCRAPYARD_TEXTURE_MANIFEST,
  });
  assert.equal(skin.material.userData.scrapyardTire.status, "fallback");
  assert.equal(await skin.ready, true);
  assert.equal(skin.material.userData.scrapyardTire.status, "textured");
  assert.equal(skin.material.userData.scrapyardTire.textureCount, 1);
  assert.deepEqual(requests, ["/src/assets/arena/scrapyard/worn-tires-rubber.webp"]);
  assert.equal(created.length, 1);
  skin.dispose();
  assert.equal(created[0].disposed, true);
  assert.equal(skin.material.userData.scrapyardTire.status, "disposed");
  assert.equal(SCRAPYARD_TIRE_MATERIAL_VERSION, "industrial-scrapyard-tire-v1");
});

test("balanced presentation keeps the industrial skin while low retains the opaque fallback", async () => {
  const balanced = createFakeThree();
  const balancedSkin = createScrapyardShellMaterial({
    THREE: balanced.THREE,
    renderer: createRenderer(),
    quality: "balanced",
    manifest: SCRAPYARD_TEXTURE_MANIFEST,
  });
  assert.equal(await balancedSkin.ready, true);
  assert.equal(balancedSkin.material.userData.scrapyard.status, "textured");
  assert.equal(balanced.requests.length, 4);

  const low = createFakeThree();
  const lowSkin = createScrapyardShellMaterial({
    THREE: low.THREE,
    renderer: createRenderer(),
    quality: "low",
    manifest: SCRAPYARD_TEXTURE_MANIFEST,
  });
  assert.equal(await lowSkin.ready, false);
  assert.equal(lowSkin.material.userData.scrapyard.status, "fallback");
  assert.equal(low.requests.length, 0);
});

test("online renderer maps balanced to the industrial skin and performance to fallback", async () => {
  const rendererSource = await readFile(new URL("../tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs", import.meta.url), "utf8");
  assert.match(rendererSource, /quality:\s*activeQuality\s*===\s*"performance"\s*\?\s*"low"\s*:\s*"high"/);
});

test("the shader samples world position and world normal instead of per-patch UVs", async () => {
  const { THREE } = createFakeThree();
  const skin = createScrapyardShellMaterial({ THREE, renderer: createRenderer(), quality: "high", manifest: SCRAPYARD_TEXTURE_MANIFEST });
  assert.equal(await skin.ready, true);
  const shader = fakeShader();
  skin.material.onBeforeCompile(shader);

  for (const role of ["floor", "wall", "metal", "hazard"]) {
    const uniform = shader.uniforms[`scrapyard${role[0].toUpperCase()}${role.slice(1)}Map`];
    assert.ok(uniform?.value, `missing ${role} texture uniform`);
    assert.equal(uniform.value.colorSpace, "srgb");
    assert.equal(uniform.value.wrapS, THREE.RepeatWrapping);
    assert.equal(uniform.value.wrapT, THREE.RepeatWrapping);
    assert.equal(uniform.value.generateMipmaps, true);
    assert.equal(uniform.value.anisotropy, 8);
    assert.equal(uniform.value.needsUpdate, true);
  }

  assert.match(shader.vertexShader, /vScrapyardWorldPosition/);
  assert.match(shader.vertexShader, /vScrapyardWorldNormal/);
  assert.match(shader.vertexShader, /objectNormal/);
  assert.match(shader.fragmentShader, /scrapyardTriplanar/);
  assert.match(shader.fragmentShader, /vScrapyardWorldPosition/);
  assert.match(shader.fragmentShader, /vScrapyardWorldNormal/);
  assert.match(shader.fragmentShader, /gl_FrontFacing/);
  assert.match(shader.fragmentShader, /smoothstep/);
  assert.match(shader.fragmentShader, /scrapyardFloorWeight/);
  assert.match(shader.fragmentShader, /scrapyardWallWeight/);
  assert.doesNotMatch(shader.fragmentShader, /scrapyardAlbedo = scrapyardFloor \* scrapyardUp/);
  assert.doesNotMatch(shader.fragmentShader, /vUv/);
  assert.equal(skin.material.customProgramCacheKey(), SCRAPYARD_SHELL_MATERIAL_VERSION);
});

test("low quality, unsupported renderers, missing roles, and failed loads retain the fallback", async () => {
  const low = createFakeThree();
  const lowSkin = createScrapyardShellMaterial({ THREE: low.THREE, renderer: createRenderer(), quality: "low", manifest: SCRAPYARD_TEXTURE_MANIFEST });
  assert.equal(await lowSkin.ready, false);
  assert.equal(low.requests.length, 0);
  assert.equal(lowSkin.material.transparent, false);
  assert.equal(lowSkin.material.userData.scrapyard.enabled, false);

  const unsupported = createFakeThree();
  const unsupportedSkin = createScrapyardShellMaterial({
    THREE: unsupported.THREE,
    renderer: createRenderer({ webgl2: false }),
    quality: "high",
    manifest: SCRAPYARD_TEXTURE_MANIFEST,
  });
  assert.equal(await unsupportedSkin.ready, false);
  assert.equal(unsupported.requests.length, 0);

  const missing = createFakeThree();
  const incompleteManifest = {
    ...SCRAPYARD_TEXTURE_MANIFEST,
    textures: SCRAPYARD_TEXTURE_MANIFEST.textures.filter((texture) => texture.role !== "hazard"),
  };
  const missingSkin = createScrapyardShellMaterial({
    THREE: missing.THREE,
    renderer: createRenderer(),
    quality: "high",
    manifest: incompleteManifest,
  });
  assert.equal(await missingSkin.ready, false);
  assert.equal(missing.requests.length, 0);

  const failed = createFakeThree({ failUrl: SCRAPYARD_TEXTURE_MANIFEST.textures[0].url });
  const failedSkin = createScrapyardShellMaterial({ THREE: failed.THREE, renderer: createRenderer(), quality: "high", manifest: SCRAPYARD_TEXTURE_MANIFEST });
  assert.equal(await failedSkin.ready, false);
  assert.equal(failedSkin.material.userData.scrapyard.enabled, false);
  assert.equal(failedSkin.material.transparent, false);
  assert.equal(failed.created.every((texture) => texture.disposed), true);
});

test("a late load failure releases textures that resolve after the first rejection", async () => {
  const [first, second] = SCRAPYARD_TEXTURE_MANIFEST.textures.map((texture) => texture.url);
  const failedLate = createFakeThree({ failUrl: first, delayedUrl: second, delayMs: 5 });
  const skin = createScrapyardShellMaterial({
    THREE: failedLate.THREE,
    renderer: createRenderer(),
    quality: "high",
    manifest: SCRAPYARD_TEXTURE_MANIFEST,
  });
  assert.equal(await skin.ready, false);
  assert.equal(failedLate.created.length, 3);
  assert.equal(failedLate.created.every((texture) => texture.disposed), true);
});

test("dispose releases every loaded texture and material exactly once", async () => {
  const { THREE, created } = createFakeThree();
  const skin = createScrapyardShellMaterial({ THREE, renderer: createRenderer(), quality: "high", manifest: SCRAPYARD_TEXTURE_MANIFEST });
  assert.equal(await skin.ready, true);
  assert.equal(created.length, 4);
  skin.dispose();
  assert.equal(created.every((texture) => texture.disposed), true);
  assert.equal(skin.material.disposed, true);
  assert.equal(skin.material.userData.scrapyard.status, "disposed");
  skin.dispose();
});

test("dispose during an async load aborts the skin and releases late textures", async () => {
  const { THREE, created } = createFakeThree();
  const skin = createScrapyardShellMaterial({ THREE, renderer: createRenderer(), quality: "high", manifest: SCRAPYARD_TEXTURE_MANIFEST });
  skin.dispose();
  assert.equal(await skin.ready, false);
  assert.equal(created.every((texture) => texture.disposed), true);
  assert.equal(skin.material.userData.scrapyard.status, "disposed");
});

test("the default manifest fetch uses the local ART-02 URL and falls back on failure", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let requested = null;
    globalThis.fetch = async (url, options) => {
      requested = url;
      assert.equal(options.cache, "force-cache");
      return { ok: true, json: async () => SCRAPYARD_TEXTURE_MANIFEST };
    };
    const fake = createFakeThree();
    const skin = createScrapyardShellMaterial({ THREE: fake.THREE, renderer: createRenderer(), quality: "high" });
    assert.equal(await skin.ready, true);
    assert.equal(requested, SCRAPYARD_TEXTURE_MANIFEST_URL);
    assert.equal(fake.requests.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const unavailable = createFakeThree();
  globalThis.fetch = async () => ({ ok: false });
  try {
    const skin = createScrapyardShellMaterial({ THREE: unavailable.THREE, renderer: createRenderer(), quality: "high" });
    assert.equal(await skin.ready, false);
    assert.equal(skin.material.userData.scrapyard.reason, "manifest");
    assert.equal(unavailable.requests.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client wiring uses the scrapyard material only for the combat-alpha shell", async () => {
  const clientSource = await readFile(new URL("../src/client.js", import.meta.url), "utf8");
  assert.match(clientSource, /from "\.\/arena-scrapyard-material\.js"/);
  assert.match(clientSource, /visualProfile\.surface\?\.skin === "industrial-scrapyard"/);
  assert.match(clientSource, /createScrapyardShellMaterial\(\{ THREE, renderer, quality: visualQuality \}\)/);
  assert.match(clientSource, /scrapyardSkin\?\.dispose\?\.\(\)/);
});

