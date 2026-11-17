import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PAGES_BETA_FILES } from "../tools/build-pages-beta.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const textureDirectory = resolve(root, "src", "assets", "arena", "scrapyard");
const manifestPath = resolve(textureDirectory, "manifest.json");
const integrationPath = resolve(root, "assets", "integration-manifest.json");
const expectedSources = new Map([
  ["Meshy_AI_ground_concrete_cracked_texture.png", "606d9c4311fafe4225228e8d5c2798c3ba4114102a7c23e0319bb819a07849be"],
  ["Meshy_AI_worn_concrete_graffiti_texture.png", "73a5d861e6cbe487845c9afab75357cd27ba36833ebb1b81229b1ad567470c4f"],
  ["Meshy_AI_rusty_corrugated_metal_texture.png", "bfcae3c6446a578a683329481a0e4bf1bdc80e34b447f939925a61d81562d03b"],
  ["Meshy_AI_hazard_stripes_warning_texture.png", "edcfa0cb7ff90b40853c795efae9bb050cc19069adfbd6170fd70002ce83e4aa"],
  ["Meshy_AI_worn_tires_rubber_texture.png", "7122f27fbeefb6e40c8dd5c3ff806fd2d271e9f202a44e0c1336ac88dd6fe281"],
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function webpDimensions(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === "VP8X") {
      return [bytes.readUIntLE(data + 4, 3) + 1, bytes.readUIntLE(data + 7, 3) + 1];
    }
    if (type === "VP8L") {
      const bits = bytes.readUInt32LE(data + 1);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (type === "VP8 ") {
      assert.equal(bytes[data + 3], 0x9d);
      assert.equal(bytes[data + 4], 0x01);
      assert.equal(bytes[data + 5], 0x2a);
      return [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
    }
    offset = data + size + (size & 1);
  }
  throw new Error("WebP contains no supported image chunk");
}

function webpHasAlpha(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === "ALPH") return true;
    if (type === "VP8X") return (bytes[data] & 0x10) !== 0;
    offset = data + size + (size & 1);
  }
  return false;
}

function texturePath(url) {
  assert.match(url, /^\/src\/assets\/arena\/scrapyard\/[a-z0-9-]+\.webp$/);
  assert.equal(url.includes(".."), false);
  const path = resolve(root, `.${url}`);
  const rel = relative(root, path);
  assert.ok(rel && !rel.startsWith("..") && !rel.startsWith(`..${sep}`), `texture URL escapes root: ${url}`);
  return path;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const integration = JSON.parse(await readFile(integrationPath, "utf8"));

test("the scrapyard manifest keeps exactly the five approved albedo assets", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "industrial-scrapyard");
  assert.equal(manifest.textures.length, 5);
  assert.equal(manifest.limits.approvedTextureCount, 5);
  assert.equal(manifest.limits.targetBytes, 4_194_304);
  assert.equal(manifest.limits.hardStopBytes, 6_291_456);
  assert.deepEqual(
    manifest.textures.map((texture) => texture.role).sort(),
    ["floor", "hazard", "metal", "tires", "wall"],
  );
  assert.deepEqual(
    manifest.textures.map((texture) => texture.id).sort(),
    ["corrugated-metal", "ground-concrete", "hazard-stripes", "wall-concrete", "worn-tires-rubber"],
  );
  assert.equal(manifest.derivation.alpha, false);
  assert.equal(manifest.derivation.normalMaps, false);
  assert.equal(manifest.derivation.powerOfTwo, true);
  assert.equal(manifest.derivation.colorMode, "RGB");
  assert.equal(manifest.derivation.quality, 82);
  assert.equal(manifest.derivation.method, 6);
  assert.deepEqual(manifest.derivation.hazardCropPx, [256, 256, 768, 768]);
  assert.equal(manifest.provenance.status, "user-confirmed");
  assert.equal(manifest.provenance.confirmedAt, "2026-11-15");
  assert.deepEqual(
    manifest.deferred.map((entry) => entry.source).sort(),
    ["Meshy_AI_asphalt_road_stripes_texture.png", "Meshy_AI_chainlink_metal_fence_texture.png"],
  );
  assert.deepEqual(manifest.rejected.map((entry) => entry.source), ["ejemplo textura.png"]);
});

test("every texture derivative is local, opaque sRGB, power-of-two, and hash-verified", async () => {
  const seenUrls = new Set();
  const seenHashes = new Set();
  const seenSources = new Set();
  for (const texture of manifest.textures) {
    assert.equal(seenUrls.has(texture.url), false, `duplicate URL: ${texture.url}`);
    assert.equal(seenHashes.has(texture.sha256), false, `duplicate derivative hash: ${texture.sha256}`);
    assert.equal(seenSources.has(texture.source), false, `duplicate source: ${texture.source}`);
    seenUrls.add(texture.url);
    seenHashes.add(texture.sha256);
    seenSources.add(texture.source);

    assert.equal(texture.colorSpace, "srgb");
    assert.equal(texture.alpha, false);
    assert.equal(texture.width, texture.height);
    assert.ok(isPowerOfTwo(texture.width), `${texture.id} width is not power-of-two`);
    assert.ok(isPowerOfTwo(texture.height), `${texture.id} height is not power-of-two`);
    assert.equal(texture.maxBytes <= manifest.limits.maxBaseAlbedoBytes, true);
    if (texture.role === "hazard") {
      assert.ok(texture.maxBytes <= manifest.limits.maxHazardBytes);
      assert.deepEqual(texture.cropPx, manifest.derivation.hazardCropPx);
      assert.equal(texture.width, 512);
    } else if (texture.role === "tires") {
      assert.equal(texture.width, 512);
      assert.ok(texture.maxBytes <= manifest.limits.maxCoverBytes);
    } else {
      assert.equal(texture.cropPx, undefined);
      assert.equal(texture.width, 1024);
    }

    const path = texturePath(texture.url);
    const bytes = await readFile(path);
    const info = await stat(path);
    assert.equal(info.isFile(), true);
    assert.equal(texture.bytes, info.size);
    assert.equal(texture.bytes, bytes.length);
    assert.equal(texture.sha256, sha256(bytes));
    assert.deepEqual(webpDimensions(bytes), [texture.width, texture.height]);
    assert.equal(webpHasAlpha(bytes), false);
    assert.ok(texture.bytes <= texture.maxBytes, `${texture.id} exceeds its per-asset cap`);
    assert.equal(texture.sourceSha256, expectedSources.get(texture.source));
  }
});

test("the package stays inside the ART-02 byte budget and excludes deferred sources", async () => {
  const totalBytes = manifest.textures.reduce((sum, texture) => sum + texture.bytes, 0);
  assert.equal(manifest.totalBytes, totalBytes);
  assert.ok(totalBytes <= manifest.limits.targetBytes);
  assert.ok(totalBytes <= manifest.limits.hardStopBytes);
  assert.ok(manifest.textures.filter((texture) => texture.role === "hazard")[0].bytes <= manifest.limits.maxHazardBytes);
  assert.ok(manifest.textures.filter((texture) => !["hazard", "tires"].includes(texture.role)).every((texture) => texture.bytes <= manifest.limits.maxBaseAlbedoBytes));
  assert.ok(manifest.textures.filter((texture) => texture.role === "tires")[0].bytes <= manifest.limits.maxCoverBytes);

  const entries = await readdir(textureDirectory, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  assert.deepEqual(names, [
    "corrugated-metal.webp",
    "ground-concrete.webp",
    "hazard-stripes.webp",
    "manifest.json",
    "wall-concrete.webp",
    "worn-tires-rubber.webp",
  ]);
  assert.equal(names.some((name) => /\.(png|jpe?g)$/i.test(name)), false);
  assert.equal(names.some((name) => /chainlink|asphalt/i.test(name)), false);
});

test("the integration manifest and Pages allowlist reference each texture exactly once", () => {
  const integrationByPath = new Map(integration.assets.map((asset) => [asset.path, asset]));
  for (const texture of manifest.textures) {
    const assetPath = texture.url.replace(/^\//, "");
    const matches = integration.assets.filter((asset) => asset.path === assetPath);
    assert.equal(matches.length, 1, `integration manifest must include ${assetPath} once`);
    const entry = integrationByPath.get(assetPath);
    assert.equal(entry.sha256.toLowerCase(), texture.sha256);
    assert.equal(entry.bytes, texture.bytes);
    assert.equal(entry.width, texture.width);
    assert.equal(entry.height, texture.height);
    assert.equal(entry.colorSpace, texture.colorSpace);
    assert.equal(entry.alpha, texture.alpha);
    assert.equal(entry.maxBytes, texture.maxBytes);
    assert.equal(PAGES_BETA_FILES.filter((route) => route === assetPath).length, 1, `Pages allowlist must include ${assetPath} once`);
  }
  assert.equal(PAGES_BETA_FILES.filter((route) => route === "src/assets/arena/scrapyard/manifest.json").length, 1);
  assert.equal(PAGES_BETA_FILES.some((route) => /chainlink|asphalt|\.png$|\.jpg$/i.test(route)), false);
  assert.equal(new Set(PAGES_BETA_FILES).size, PAGES_BETA_FILES.length);
  assert.equal(PAGES_BETA_FILES.every((route) => !route.startsWith("/") && !route.split("/").includes("..")), true);
});

