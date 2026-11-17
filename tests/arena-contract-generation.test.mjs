import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootPath = fileURLToPath(new URL("../", import.meta.url));
const contractPath = new URL("../data/combat-alpha-geometry.json", import.meta.url);
const generatedJsPath = new URL("../src/generated/combat-alpha-geometry.js", import.meta.url);
const generatedHeaderPath = new URL("../tools/shared/combat_alpha_geometry.generated.hpp", import.meta.url);
const generatorPath = fileURLToPath(new URL("../tools/generate-arena-contract.mjs", import.meta.url));

test("combat-alpha geometry is authored once and pins the accepted arena and obstacle volumes", async () => {
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  assert.deepEqual(contract.arena, { width: 264, depth: 408, height: 108, curveRadius: 30 });
  assert.deepEqual(contract.obstacles, [
    { id: "central-block", kind: "box", x: 0, z: -20, width: 14, depth: 18, height: 3.25 },
    { id: "south-ramp", kind: "closed-convex-wedge", x: 0, z: 20, run: 20, width: 18, height: 3.5 },
  ]);
  assert.equal(contract.covers.length, 6);
  assert.deepEqual(contract.covers.slice(-2).map(({ id, x, z, width, depth, height }) => ({ id, x, z, width, depth, height })), [
    { id: "tire-cover-blue", x: -68, z: -30, width: 8, depth: 8, height: 4.8 },
    { id: "tire-cover-red", x: 68, z: 30, width: 8, depth: 8, height: 4.8 },
  ]);
  const { COMBAT_ALPHA_GEOMETRY } = await import(`${pathToFileURL(fileURLToPath(generatedJsPath)).href}?contract-test`);
  assert.deepEqual(COMBAT_ALPHA_GEOMETRY, {
    arena: contract.arena,
    obstacles: contract.obstacles,
    covers: contract.covers,
  });
});

test("generated JavaScript and C++ contract artifacts are current", () => {
  execFileSync(process.execPath, [generatorPath, "--check"], { cwd: rootPath, stdio: "pipe" });
  const cpp = readFileSync(generatedHeaderPath, "utf8");
  assert.match(cpp, /kCombatAlphaWidth\s*=\s*264(?:\.0)?f/);
  assert.match(cpp, /kCombatAlphaDepth\s*=\s*408(?:\.0)?f/);
  assert.match(cpp, /kCombatAlphaHeight\s*=\s*108(?:\.0)?f/);
  assert.match(cpp, /kCombatAlphaCurveRadius\s*=\s*30(?:\.0)?f/);
  assert.match(cpp, /kCentralBlockHeight\s*=\s*3\.25(?:\.0)?f/);
  assert.match(cpp, /kSouthRampHeight\s*=\s*3\.5(?:\.0)?f/);
  assert.match(cpp, /kCombatAlphaCovers\[\]\s*=\s*\{/);
});

test("check mode rejects a stale generated artifact", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "combat-cars-arena-contract-"));
  try {
    mkdirSync(path.join(temporaryRoot, "data"), { recursive: true });
    copyFileSync(contractPath, path.join(temporaryRoot, "data/combat-alpha-geometry.json"));
    execFileSync(process.execPath, [generatorPath, "--root", temporaryRoot], { cwd: rootPath, stdio: "pipe" });
    appendFileSync(path.join(temporaryRoot, "tools/shared/combat_alpha_geometry.generated.hpp"), "// stale\n");
    assert.throws(
      () => execFileSync(process.execPath, [generatorPath, "--check", "--root", temporaryRoot], { cwd: rootPath, stdio: "pipe" }),
      error => error.status === 1 && error.stderr.toString("utf8").includes("missing or stale"),
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("check mode accepts generated artifacts checked out with CRLF line endings", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "combat-cars-arena-crlf-"));
  try {
    mkdirSync(path.join(temporaryRoot, "data"), { recursive: true });
    copyFileSync(contractPath, path.join(temporaryRoot, "data/combat-alpha-geometry.json"));
    execFileSync(process.execPath, [generatorPath, "--root", temporaryRoot], { cwd: rootPath, stdio: "pipe" });
    for (const relativePath of [
      "src/generated/combat-alpha-geometry.js",
      "tools/shared/combat_alpha_geometry.generated.hpp",
    ]) {
      const artifactPath = path.join(temporaryRoot, relativePath);
      writeFileSync(artifactPath, readFileSync(artifactPath, "utf8").replace(/\r?\n/g, "\r\n"));
    }
    assert.doesNotThrow(() => execFileSync(process.execPath, [generatorPath, "--check", "--root", temporaryRoot], { cwd: rootPath, stdio: "pipe" }));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("generator rejects an incomplete obstacle before emitting a malformed C++ header", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "combat-cars-arena-invalid-"));
  try {
    mkdirSync(path.join(temporaryRoot, "data"), { recursive: true });
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    delete contract.obstacles[0].width;
    writeFileSync(path.join(temporaryRoot, "data/combat-alpha-geometry.json"), JSON.stringify(contract));
    assert.throws(
      () => execFileSync(process.execPath, [generatorPath, "--root", temporaryRoot], { cwd: rootPath, stdio: "pipe" }),
      error => error.status === 1 && error.stderr.toString("utf8").includes("dimensions"),
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
