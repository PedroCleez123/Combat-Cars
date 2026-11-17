import assert from "node:assert/strict";
import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PAGES_BETA_DIRECTORY = "dist-pages-beta";

// This is intentionally a small, explicit public surface.  Do not replace it
// with a recursive project copy: the repository contains bridge executables,
// local server code, tests, documentation and Cloudflare source that must
// never be published as a Pages asset.
export const PAGES_BETA_FILES = Object.freeze([

  // The canonical Pages root must open the playable private game instead of
  // returning a static lobby or a 404. Keep the lobby as a named route too.
  "index.html",

  // P2P-WASM-36: isolated causal beta. These are the reviewed transitive
  // modules for the browser-only host/pilot spike; do not widen this to the
  // complete tools/ tree.
  "p2p-causal-beta.html",
  "p2p-multiplayer.html",
  "src/p2p-causal-beta.js",
  "src/p2p-causal-beta-hud.js",
  "src/p2p-causal-beta-entry.js",
  "src/p2p-offline-practice.js",
  "src/p2p-fps-counter.js",
  "src/p2p-boost-meter.js",
  "src/client-performance.js",
  "src/p2p-multiplayer-presentation-state.js",
  "src/p2p-multiplayer-lobby-presentation-state.js",
  "src/p2p-scoreboard.js",
  "src/p2p-multiplayer-webrtc.js",
  "src/p2p-multiparty-signaling.js",
  "src/p2p-multiparty-signaling-client.js",
  "src/p2p-guest-connection-recovery.js",
  "src/p2p-persistent-room-storage.js",
  "src/p2p-multiplayer-entry.js",
  "src/p2p-multiplayer-lobby.js",
  "src/p2p-causal-beta-renderer.js",
  "src/authoritative-state-source.js",
  "src/p2p-causal-input.js",
  "src/p2p-aim-targeting.js",
  "src/control-mapping.js",
  "src/gamepad-input.js",
  "src/p2p-player-identity.js",
  "src/p2p-wasm-render-state.js",
  "src/online-full-presentation-state.js",
  "src/snapshot-interpolation.js",
  "p2p-room-lobby.html",
  "src/p2p-room-config.js",
  "src/p2p-signaling-client.js",
  "src/p2p-signaling-protocol.js",
  "src/p2p-room-lobby.js",
  "src/p2p-session-protocol.js",
  "src/p2p-webrtc-session.js",
  "src/lan-session-protocol.js",
  "src/combat-alpha-map.js",
  "src/arena-decoration.js",
  "src/arena-visual-profile.js",
  "src/rocketsim-arena-profile.js",
  "src/camera-follow.js",
  "src/rocketsim-combat.js",
  "src/rocketsim-wasm-backend.js",
  "src/rocketsim-practice-match.js",
  "src/rocketsim-protocol.js",
  "tools/wasm-spike/p2p-wasm-causal-combat-channel.mjs",
  "tools/wasm-spike/p2p-wasm-causal-combat-protocol.mjs",
  "tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs",
  "tools/wasm-spike/p2p-wasm-causal-room-session.mjs",
  "tools/wasm-spike/p2p-wasm-metadata-channel.mjs",
  "tools/wasm-spike/p2p-wasm-combat-host.mjs",
  "tools/wasm-spike/p2p-wasm-full-combat-host.mjs",
  "tools/wasm-spike/p2p-wasm-host-match.mjs",
  "tools/wasm-spike/p2p-wasm-host-clock.mjs",
  "tools/wasm-spike/p2p-wasm-multiplayer-host.mjs",
  "tools/wasm-spike/p2p-wasm-multiplayer-protocol.mjs",
  "tools/wasm-spike/p2p-wasm-multiplayer-channel.mjs",
  "tools/wasm-spike/p2p-wasm-multiplayer-lobby-host.mjs",
  "tools/wasm-spike/p2p-wasm-multiplayer-lobby-channel.mjs",
  "tools/wasm-spike/p2p-wasm-multiplayer-lobby-protocol.mjs",
  "tools/wasm-spike/p2p-wasm-presentation-render-state.mjs",
  "tools/wasm-spike/p2p-wasm-arena-presentation.mjs",
  "tools/wasm-spike/p2p-wasm-camera-framing.mjs",
  "tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs",
  "tools/wasm-spike/p2p-wasm-authored-vehicle.mjs",
  "tools/wasm-spike/p2p-wasm-causal-audio.mjs",
  "src/vehicle-visual-model.js",
  "src/vehicle-visual-alignment.js",
  "src/vehicle-asset-loader.js",
  "src/audio-mixer.js",
  "src/audio-sample-bank.js",
  "src/combat-hud.js",
  "src/event-feedback.js",
  "src/arena-scrapyard-material.js",
  "src/assets/vehicle/GLTFLoader.js",
  "src/assets/utils/BufferGeometryUtils.js",
  "src/assets/vehicle/model.gltf",
  "src/assets/vehicle/geometry.bin",
  "src/assets/arena/scrapyard/ground-concrete.webp",
  "src/assets/arena/scrapyard/wall-concrete.webp",
  "src/assets/arena/scrapyard/corrugated-metal.webp",
  "src/assets/arena/scrapyard/hazard-stripes.webp",
  "src/assets/arena/scrapyard/worn-tires-rubber.webp",
  "src/assets/arena/scrapyard/manifest.json",
  "assets/audio/engine/idle.wav",
  "assets/audio/engine/coast-01.wav",
  "assets/audio/engine/loaded-01.wav",
  "assets/audio/boost/start.wav",
  "assets/audio/boost/loop.wav",
  "assets/audio/boost/release.wav",
  "assets/audio/vehicle/jump-01.wav",
  "assets/audio/vehicle/double-jump-01.wav",
  "assets/audio/vehicle/dodge-01.wav",
  "assets/audio/impacts/vehicle-body-01.wav",
  "assets/audio/impacts/arena-01.wav",
  "tools/wasm-spike/build/rocketsim_wasm.mjs",
  "tools/wasm-spike/build/rocketsim_wasm.wasm",
  // These are the exact ESM files used by the isolated beta renderer. The
  // explicit manifest remains the security boundary; do not publish all of
  // node_modules or replace this with a recursive copy.
  "vendor/three/three.module.js",
  "vendor/three/three.core.js",
]);

const SOURCE_OVERRIDES = Object.freeze({
  // Open the active arena-first multiplayer entry at the public root. The
  // causal beta remains available at its explicit route for compatibility.
  "index.html": "p2p-multiplayer.html",
  "vendor/three/three.module.js": "node_modules/three/build/three.module.js",
  "vendor/three/three.core.js": "node_modules/three/build/three.core.js",
});

const PUBLIC_ENTRY = "p2p-room-lobby.html";
const FORBIDDEN_PATH_PARTS = Object.freeze(["cloudflare", "docs", "server.mjs", "tests"]);

function within(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes("../"));
}

function assertSafeOutput(root, output) {
  assert.equal(basename(output), PAGES_BETA_DIRECTORY, "Pages output must use the canonical isolated directory.");
  assert.ok(within(root, output), "Pages output must remain inside the repository.");
}

async function allFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...await allFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
  }
  return files.sort();
}

function localModuleRequests(source) {
  const routes = [];
  for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    const request = match[1];
    if (request.startsWith(".") || request.startsWith("/")) routes.push(request);
  }
  return routes;
}

async function readText(path) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

export async function verifyPagesBeta({ root = ROOT, output = resolve(root, PAGES_BETA_DIRECTORY) } = {}) {
  const normalizedRoot = resolve(root);
  const normalizedOutput = resolve(output);
  assertSafeOutput(normalizedRoot, normalizedOutput);

  const expected = [...PAGES_BETA_FILES].sort();
  const actual = await allFiles(normalizedOutput);
  assert.deepEqual(actual, expected, "The Pages package must contain only the reviewed public files.");

  for (const route of actual) {
    assert.equal(FORBIDDEN_PATH_PARTS.some(part => route === part || route.startsWith(`${part}/`)), false, `Forbidden public route: ${route}`);
  }

  const entry = await readText(resolve(normalizedOutput, PUBLIC_ENTRY));
  assert.match(entry, /window\.location\.replace\(arena\.href\)/, "The legacy room URL must hand private invites to the playable WASM arena.");
  assert.match(entry, /p2p-causal-beta/, "The legacy room URL must target the causal WASM arena.");
  assert.doesNotMatch(entry, /client\.js|server\.mjs|rocketsim-bridge/i, "The Pages beta entry must not load the LAN game or native bridge.");

  const rootEntry = await readText(resolve(normalizedOutput, "index.html"));
  assert.match(rootEntry, /<canvas id="scene"/, "The Pages root must open the live arena directly.");
  assert.match(rootEntry, /src="\/src\/p2p-multiplayer-entry\.js"/, "The Pages root must use the current shared lobby entry.");
  assert.match(rootEntry, /id="name"[^>]*required/, "The shared lobby must require a player name.");
  assert.match(rootEntry, /id="mode"/, "The shared lobby must expose the selected match mode.");
  assert.match(rootEntry, /id="join-code"/, "The shared lobby must expose short-code joining.");

  for (const route of actual.filter(route => route.endsWith(".js") || route.endsWith(".mjs"))) {
    const source = await readText(resolve(normalizedOutput, route));
    for (const request of localModuleRequests(source)) {
      const target = request.startsWith("/")
        ? resolve(normalizedOutput, `.${request}`)
        : resolve(dirname(resolve(normalizedOutput, route)), request);
      assert.ok(within(normalizedOutput, target), `${route} must not import outside the Pages package.`);
      await access(target);
    }
  }

  return Object.freeze({
    output: normalizedOutput,
    entry: PUBLIC_ENTRY,
    fileCount: actual.length,
    files: Object.freeze(actual),
  });
}

export async function buildPagesBeta({ root = ROOT, output = resolve(root, PAGES_BETA_DIRECTORY) } = {}) {
  const normalizedRoot = resolve(root);
  const normalizedOutput = resolve(output);
  assertSafeOutput(normalizedRoot, normalizedOutput);

  await rm(normalizedOutput, { recursive: true, force: true });
  for (const route of PAGES_BETA_FILES) {
    const source = resolve(normalizedRoot, SOURCE_OVERRIDES[route] || route);
    const target = resolve(normalizedOutput, route);
    assert.ok(within(normalizedRoot, source), `Source route escaped the repository: ${route}`);
    assert.ok(within(normalizedOutput, target), `Target route escaped the Pages package: ${route}`);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  return verifyPagesBeta({ root: normalizedRoot, output: normalizedOutput });
}

async function main() {
  const verifyOnly = process.argv.slice(2).includes("--verify");
  const result = verifyOnly ? await verifyPagesBeta() : await buildPagesBeta();
  process.stdout.write(`${JSON.stringify({ story: "ONLINE-RENDER-04", mode: verifyOnly ? "verify" : "build", ...result }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Pages beta package failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
