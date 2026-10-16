import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "docs", "provenance-baseline-2026-10-17.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const failures = [];

async function inspect(entry) {
  const filePath = path.join(root, ...entry.path.split("/"));
  try {
    const info = await stat(filePath);
    const hash = createHash("sha256");
    const contents = await readFile(filePath);
    hash.update(contents);
    const actualHash = hash.digest("hex");
    if (entry.bytes !== info.size || entry.sha256 !== actualHash) {
      failures.push(`${entry.path}: expected ${entry.bytes} bytes/${entry.sha256}, got ${info.size} bytes/${actualHash}`);
      return;
    }
    console.log(`OK ${entry.path} (${entry.bytes} bytes, sha256 ${entry.sha256})`);
  } catch (error) {
    if (entry.optional && error?.code === "ENOENT") {
      console.log(`SKIP optional ${entry.path} (not present)`);
      return;
    }
    failures.push(`${entry.path}: ${error.message}`);
  }
}

for (const entry of [...manifest.source, ...manifest.bridges, ...manifest.artifacts]) {
  await inspect(entry);
}

if (failures.length > 0) {
  console.error("Provenance check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Provenance baseline ${manifest.baseline} verified.`);
}
