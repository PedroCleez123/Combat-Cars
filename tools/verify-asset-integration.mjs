import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const toolPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(toolPath), "..");

function safeAssetPath(root, assetPath) {
  if (typeof assetPath !== "string" || !assetPath.trim() || isAbsolute(assetPath)) {
    throw new Error(`asset path must be a relative path: ${String(assetPath)}`);
  }
  const fullPath = resolve(root, assetPath.replaceAll("/", sep));
  const outside = relative(root, fullPath);
  if (outside === ".." || outside.startsWith(`..${sep}`) || isAbsolute(outside)) {
    throw new Error(`asset path escapes project root: ${assetPath}`);
  }
  return fullPath;
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

export async function verifyAssetIntegration({ root = projectRoot, manifestPath = resolve(root, "assets", "integration-manifest.json") } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error("assets/integration-manifest.json has an unsupported schema");
  }
  const seen = new Set();
  const verified = [];
  let totalBytes = 0;
  for (const asset of manifest.assets) {
    const relativePath = asset?.path;
    if (seen.has(relativePath)) throw new Error(`duplicate asset path: ${relativePath}`);
    seen.add(relativePath);
    if (!/^[A-F0-9]{64}$/i.test(String(asset?.sha256 || ""))) {
      throw new Error(`asset is missing a 64-character SHA-256: ${relativePath}`);
    }
    if (!Number.isInteger(asset?.bytes) || asset.bytes < 0) {
      throw new Error(`asset has invalid byte count: ${relativePath}`);
    }
    const fullPath = safeAssetPath(root, relativePath);
    const info = await stat(fullPath);
    if (!info.isFile()) throw new Error(`asset is not a file: ${relativePath}`);
    if (info.size !== asset.bytes) {
      throw new Error(`${relativePath}: expected ${asset.bytes} bytes, got ${info.size}`);
    }
    const actualHash = await sha256(fullPath);
    if (actualHash !== String(asset.sha256).toUpperCase()) {
      throw new Error(`${relativePath}: expected SHA-256 ${asset.sha256}, got ${actualHash}`);
    }
    totalBytes += info.size;
    verified.push({ path: relativePath, bytes: info.size, sha256: actualHash });
  }
  return { schemaVersion: 1, status: "ok", assetCount: verified.length, totalBytes, assets: verified };
}

if (resolve(process.argv[1] || "") === resolve(fileURLToPath(pathToFileURL(toolPath)))) {
  try {
    console.log(JSON.stringify(await verifyAssetIntegration(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ schemaVersion: 1, status: "failed", detail: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}
