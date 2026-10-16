import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, normalize } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const portablePath = resolve(
  process.env.DESKTOP_PACKAGE || join(projectRoot, "dist", `Car Soccer Arsenal ${version}.exe`),
);
const appAsarPath = resolve(
  process.env.DESKTOP_ASAR || join(projectRoot, "dist", "win-unpacked", "resources", "app.asar"),
);

const fail = (message) => {
  console.error(`desktop-package: ${message}`);
  process.exitCode = 1;
};

if (!existsSync(portablePath)) {
  fail(`no se encontró el portable: ${portablePath}`);
}
if (!existsSync(appAsarPath)) {
  fail(`no se encontró el app.asar desempaquetado: ${appAsarPath}`);
}
if (process.exitCode) process.exit();

const portableBytes = readFileSync(portablePath).byteLength;
const portableSha256 = createHash("sha256").update(readFileSync(portablePath)).digest("hex");
const asarCli = join(projectRoot, "node_modules", "@electron", "asar", "bin", "asar.js");
if (!existsSync(asarCli)) {
  fail(`falta la CLI local de asar: ${asarCli}`);
}
if (process.exitCode) process.exit();

const asarResult = spawnSync(process.execPath, [asarCli, "list", appAsarPath], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (asarResult.status !== 0) {
  fail(`asar no pudo inspeccionarse: ${(asarResult.stderr || asarResult.stdout).trim()}`);
}
if (process.exitCode) process.exit();

const entries = new Set(
  asarResult.stdout
    .split(/\r?\n/)
    .map((entry) => `/${normalize(entry).replaceAll("\\", "/").replace(/^\/+/, "")}`)
    .filter((entry) => entry !== "/"),
);
const requiredEntries = [
  "/server.mjs",
  "/src/client.js",
  "/src/http-static-boundary.js",
  "/node_modules/three/build/three.core.js",
];
const missingEntries = requiredEntries.filter((entry) => !entries.has(entry));
if (missingEntries.length > 0) {
  fail(`faltan archivos críticos dentro de app.asar: ${missingEntries.join(", ")}`);
}

const sevenZipCandidates = [
  process.env.SEVEN_ZIP_EXE,
  process.env.LOCALAPPDATA && join(
    process.env.LOCALAPPDATA,
    "electron-builder",
    "Cache",
    "7zip@1.0.0",
    "7zip-win-x64-a34pt",
    "bin",
    "7za.exe",
  ),
  process.env.USERPROFILE && join(
    process.env.USERPROFILE,
    "AppData",
    "Local",
    "electron-builder",
    "Cache",
    "7zip@1.0.0",
    "7zip-win-x64-a34pt",
    "bin",
    "7za.exe",
  ),
].filter(Boolean);
let sevenZipPath = sevenZipCandidates.find((candidate) => existsSync(candidate));
if (!sevenZipPath && process.platform === "win32") {
  const where = spawnSync("where.exe", ["7za.exe"], { encoding: "utf8" });
  sevenZipPath = where.status === 0 ? where.stdout.trim().split(/\r?\n/)[0] : undefined;
}
if (!sevenZipPath) {
  fail("no se encontró 7za.exe; define SEVEN_ZIP_EXE para validar la integridad NSIS");
}
if (sevenZipPath) {
  const archiveTest = spawnSync(sevenZipPath, ["t", portablePath], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (archiveTest.status !== 0 || !/Everything is Ok/i.test(archiveTest.stdout)) {
    fail(`la prueba de 7-Zip falló para el portable: ${(archiveTest.stderr || archiveTest.stdout).trim()}`);
  }
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    status: "ok",
    portable: { path: portablePath, bytes: portableBytes, sha256: portableSha256 },
    appAsar: { path: appAsarPath, requiredEntries },
    nsisArchive: "7za-test-ok",
  }, null, 2));
}
