import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runPublicCausalKeyboardSmoke, sanitizeDiagnostic } from "../tools/p2p-causal-beta-public-smoke.mjs";

test("public causal smoke redacts invite credentials and peer addresses", () => {
  const value = sanitizeDiagnostic(new Error("Timeout at https://127.0.0.1:5300/p2p#p2p=SECRET candidate:1 192.168.0.4:3478"));
  assert.doesNotMatch(value, /SECRET|192\.168\.0\.4|127\.0\.0\.1/);
  assert.match(value, /redacted/);
});

test("public causal smoke skips deterministically without network", async () => {
  const report = await runPublicCausalKeyboardSmoke({
    url: "https://combat-cars.pages.dev/p2p-causal-beta.html",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(report.status, "skipped");
  assert.equal(report.publicRoute, "not-verified");
  assert.equal(report.externalNat, "not-verified");
  assert.equal(report.invite, null);
});

test("public Electron endurance smoke follows the compact HUD contract", async () => {
  const source = await readFile(new URL("../tools/p2p-causal-beta-public-electron-smoke.cjs", import.meta.url), "utf8");
  assert.match(source, /function active\(observation\)/);
  assert.match(source, /observation\.hudVisible/);
  assert.match(source, /observation\.canvas\?\.width > 0/);
  assert.match(source, /observation\.canvas\?\.height > 0/);
  assert.match(source, /observation\.connection\)/);
  assert.match(source, /getElementById\("unified-create"\)/);
  assert.match(source, /getElementById\("unified-join"\)/);
  assert.doesNotMatch(source, /getElementById\("join-room-code"\)/);
  assert.doesNotMatch(source, /&& observation\.rivalVisible/);
  assert.match(source, /visibility is a human two-browser check, not a DOM contract/);
});
