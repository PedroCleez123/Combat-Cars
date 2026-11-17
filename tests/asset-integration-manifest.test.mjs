import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { verifyAssetIntegration } from "../tools/verify-asset-integration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("integrated visual and audio assets match their manifest", async () => {
  const result = await verifyAssetIntegration({ root });
  assert.equal(result.status, "ok");
  assert.equal(result.assetCount, 20);
  assert.ok(result.totalBytes > 4_000_000);
});
