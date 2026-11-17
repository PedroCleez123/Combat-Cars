import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the supported game launcher starts only the final R20 combat build", async () => {
  const source = await readFile(resolve(root, "tools", "start-game.ps1"), "utf8");
  const packageManifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.match(source, /rocketsim_bridge-r20\.exe/);
  assert.match(source, /\$env:MOVEMENT_BACKEND\s*=\s*\$Backend/);
  assert.match(source, /\$env:ROCKETSIM_MODE\s*=\s*"combat"/);
  assert.match(source, /\$env:ROCKETSIM_ARENA\s*=\s*"combat-alpha"/);
  assert.match(source, /\$env:PORT\s*=\s*"5300"/);
  assert.match(source, /TcpListener/);
  assert.match(source, /ya está en uso/);
  assert.match(source, /node server\.mjs/);
  assert.match(source, /if \(\$Watch\)/);
  assert.match(source, /node --watch server\.mjs/);
  assert.doesNotMatch(source, /practice|calibration|scrapyard/);
  assert.doesNotMatch(packageManifest.scripts.play, /watch/);
  assert.match(packageManifest.scripts["play:watch"], /-Watch/);
});
