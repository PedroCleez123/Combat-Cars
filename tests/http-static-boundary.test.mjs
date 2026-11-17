import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolvePublicAsset } from "../src/http-static-boundary.js";

const root = "C:/project";

test("static boundary maps the application entrypoint", () => {
  const asset = resolvePublicAsset("/", root);

  assert.deepEqual(asset, {
    path: "C:/project/index.html",
    relative: "index.html",
    contentType: "text/html; charset=utf-8",
  });
});

test("static boundary exposes only client assets", () => {
  assert.equal(resolvePublicAsset("/p2p-room-lobby.html", root)?.relative, "p2p-room-lobby.html");
  assert.equal(resolvePublicAsset("/p2p-causal-beta.html", root)?.relative, "p2p-causal-beta.html");
  assert.equal(resolvePublicAsset("/src/p2p-causal-beta.js", root)?.relative, "src/p2p-causal-beta.js");
  assert.equal(resolvePublicAsset("/src/p2p-causal-beta-hud.js", root)?.relative, "src/p2p-causal-beta-hud.js");
  assert.equal(resolvePublicAsset("/src/p2p-causal-beta-entry.js", root)?.relative, "src/p2p-causal-beta-entry.js");
  assert.equal(resolvePublicAsset("/src/p2p-causal-beta-renderer.js", root)?.relative, "src/p2p-causal-beta-renderer.js");
  assert.equal(resolvePublicAsset("/src/p2p-canvas-fallback-renderer.js", root), null);
  assert.equal(resolvePublicAsset("/src/p2p-aim-targeting.js", root)?.relative, "src/p2p-aim-targeting.js");
  assert.equal(resolvePublicAsset("/src/p2p-wasm-render-state.js", root)?.relative, "src/p2p-wasm-render-state.js");
  assert.equal(resolvePublicAsset("/src/p2p-room-config.js", root)?.relative, "src/p2p-room-config.js");
  assert.equal(resolvePublicAsset("/src/p2p-signaling-client.js", root)?.relative, "src/p2p-signaling-client.js");
  assert.equal(resolvePublicAsset("/src/p2p-room-lobby.js", root)?.relative, "src/p2p-room-lobby.js");
  assert.equal(resolvePublicAsset("/src/p2p-webrtc-session.js", root)?.relative, "src/p2p-webrtc-session.js");
  assert.equal(resolvePublicAsset("/p2p-loopback.html", root)?.contentType, "text/html; charset=utf-8");
  assert.equal(resolvePublicAsset("/p2p-host-loopback.html", root)?.contentType, "text/html; charset=utf-8");
  assert.equal(resolvePublicAsset("/p2p-session-loopback.html", root)?.contentType, "text/html; charset=utf-8");
  assert.equal(resolvePublicAsset("/src/p2p-loopback.js", root)?.relative, "src/p2p-loopback.js");
  assert.equal(resolvePublicAsset("/src/p2p-session-protocol.js", root)?.relative, "src/p2p-session-protocol.js");
  assert.equal(resolvePublicAsset("/src/p2p-host-match.js", root)?.relative, "src/p2p-host-match.js");
  assert.equal(resolvePublicAsset("/src/p2p-host-loopback.js", root)?.relative, "src/p2p-host-loopback.js");
  assert.equal(resolvePublicAsset("/src/p2p-match-channel.js", root)?.relative, "src/p2p-match-channel.js");
  assert.equal(resolvePublicAsset("/src/p2p-session-loopback.js", root)?.relative, "src/p2p-session-loopback.js");
  assert.equal(resolvePublicAsset("/src/simulation.js", root)?.relative, "src/simulation.js");
  assert.equal(
    resolvePublicAsset("/src/client.js?cache=1", root)?.relative,
    "src/client.js",
  );
  assert.equal(
    resolvePublicAsset("/vendor/three/three.module.js", root)?.contentType,
    "text/javascript; charset=utf-8",
  );
  assert.equal(
    resolvePublicAsset("/vendor/three/three.core.js", root)?.contentType,
    "text/javascript; charset=utf-8",
  );
  assert.equal(resolvePublicAsset("/src/assets/vehicle/GLTFLoader.js", root)?.relative, "src/assets/vehicle/GLTFLoader.js");
  assert.equal(resolvePublicAsset("/src/assets/utils/BufferGeometryUtils.js", root)?.relative, "src/assets/utils/BufferGeometryUtils.js");
  assert.equal(resolvePublicAsset("/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js", root), null);
  assert.equal(
    resolvePublicAsset("/src/rocketsim-arena-profile.js", root)?.relative,
    "src/rocketsim-arena-profile.js",
  );
  assert.equal(
    resolvePublicAsset("/src/visual-smoke-playback.js", root)?.relative,
    "src/visual-smoke-playback.js",
  );
  for (const relative of ["src/vehicle-visual-model.js", "src/arena-decoration.js", "src/arena-scrapyard-material.js", "src/audio-mixer.js", "src/audio-sample-bank.js", "src/aim-lock.js"]) {
    assert.equal(resolvePublicAsset(`/${relative}`, root)?.relative, relative);
  }
  assert.equal(resolvePublicAsset("/src/vehicle-asset-loader.js", root)?.relative, "src/vehicle-asset-loader.js");
  assert.equal(resolvePublicAsset("/src/assets/vehicle/model.gltf", root)?.contentType, "model/gltf+json; charset=utf-8");
  assert.equal(resolvePublicAsset("/src/assets/vehicle/geometry.bin", root)?.contentType, "application/octet-stream");
  assert.equal(resolvePublicAsset("/assets/audio/boost/loop.wav", root)?.contentType, "audio/wav");
  assert.equal(resolvePublicAsset("/src/assets/arena/skybowl.glb", root)?.contentType, "model/gltf-binary");
  assert.equal(resolvePublicAsset("/src/assets/arena/scrapyard/manifest.json", root)?.contentType, "application/json; charset=utf-8");
  for (const texture of [
    "ground-concrete.webp",
    "wall-concrete.webp",
    "corrugated-metal.webp",
    "hazard-stripes.webp",
  ]) {
    const asset = resolvePublicAsset(`/src/assets/arena/scrapyard/${texture}`, root);
    assert.equal(asset?.relative, `src/assets/arena/scrapyard/${texture}`);
    assert.equal(asset?.contentType, "image/webp");
  }
  assert.equal(resolvePublicAsset("/tools/wasm-spike/p2p-wasm-causal-room-session.mjs", root)?.contentType, "text/javascript; charset=utf-8");
  assert.equal(resolvePublicAsset("/tools/wasm-spike/build/rocketsim_wasm.wasm", root)?.contentType, "application/wasm");
  assert.equal(resolvePublicAsset("/src/server.mjs", root), null);
  assert.equal(resolvePublicAsset("/src/rocketsim-backend.js", root), null);
  assert.equal(resolvePublicAsset("/cloudflare/arsenal-signal-worker.mjs", root), null);
});

test("static boundary exposes the lobby's exact browser dependencies only", async () => {
  const routes = ["p2p-room-lobby.html", "src/p2p-room-config.js", "src/p2p-signaling-client.js", "src/p2p-room-lobby.js", "src/p2p-webrtc-session.js", "src/p2p-session-protocol.js", "src/p2p-signaling-protocol.js"];
  for (const route of routes) {
    assert.equal(resolvePublicAsset(`/${route}`, root)?.relative, route);
    await readFile(new URL(`../${route}`, import.meta.url), "utf8");
  }
  for (const route of ["src/server.mjs", "cloudflare/arsenal-signal-worker.mjs", "src/p2p-secret-store.js"]) {
    assert.equal(resolvePublicAsset(`/${route}`, root), null);
  }
});

test("static boundary exposes the causal beta's exact browser dependencies only", async () => {
  const routes = [
    "p2p-causal-beta.html",
    "src/p2p-causal-beta.js",
    "src/p2p-causal-beta-hud.js",
    "src/p2p-causal-beta-entry.js",
    "src/p2p-causal-beta-renderer.js",
    "src/p2p-aim-targeting.js",
    "src/gamepad-input.js",
    "tools/wasm-spike/p2p-wasm-causal-room-session.mjs",
    "tools/wasm-spike/p2p-wasm-causal-combat-channel.mjs",
    "tools/wasm-spike/p2p-wasm-causal-combat-protocol.mjs",
    "tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs",
    "tools/wasm-spike/p2p-wasm-combat-host.mjs",
    "tools/wasm-spike/p2p-wasm-host-match.mjs",
    "tools/wasm-spike/p2p-wasm-host-clock.mjs",
    "tools/wasm-spike/p2p-wasm-presentation-render-state.mjs",
    "tools/wasm-spike/p2p-wasm-arena-presentation.mjs",
    "tools/wasm-spike/p2p-wasm-camera-framing.mjs",
    "tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs",
    "src/arena-decoration.js",
    "src/arena-visual-profile.js",
    "tools/wasm-spike/build/rocketsim_wasm.mjs",
    "tools/wasm-spike/build/rocketsim_wasm.wasm",
  ];
  for (const route of routes) {
    assert.ok(resolvePublicAsset(`/${route}`, root), route);
  }
  for (const route of ["tools/wasm-spike/CMakeLists.txt", "tools/wasm-spike/emsdk/emsdk.py"]) {
    assert.equal(resolvePublicAsset(`/${route}`, root), null);
  }
});

test("P2P diagnostic page is opt-in and does not load the production game client", async () => {
  const source = await readFile(new URL("../p2p-loopback.html", import.meta.url), "utf8");
  assert.match(source, /id="run"/);
  assert.match(source, /addEventListener\("click"/);
  assert.match(source, /loopback local/i);
  assert.doesNotMatch(source, /client\.js|from\s+["'][^"']*rocketsim/i);
  assert.match(source, /textContent/);
});

test("P2P session diagnostic is isolated from production gameplay and describes its boundary", async () => {
  const source = await readFile(new URL("../p2p-session-loopback.html", import.meta.url), "utf8");
  assert.match(source, /id="run"/);
  assert.match(source, /oferta diferida/i);
  assert.match(source, /No es una partida/i);
  assert.doesNotMatch(source, /client\.js|rocketsim-bridge/i);
});

test("static boundary exposes every direct browser dependency of the client entry", async () => {
  const entries = [
    { route: "/src/client.js", source: new URL("../src/client.js", import.meta.url) },
    { route: "/node_modules/three/build/three.module.js", source: new URL("../node_modules/three/build/three.module.js", import.meta.url) },
    { route: "/src/audio-mixer.js", source: new URL("../src/audio-mixer.js", import.meta.url) },
  ];

  for (const entry of entries) {
    const source = await readFile(entry.source, "utf8");
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      const importedRoute = new URL(match[1], `http://localhost${entry.route}`).pathname;
      assert.ok(
        resolvePublicAsset(importedRoute, root),
        `${entry.route} imports ${importedRoute}, which must be available to the browser`,
      );
    }
  }
});

test("client entry uses vendored browser helpers that survive the portable package", async () => {
  const source = await readFile(new URL("../src/client.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\/node_modules\/three\/examples\/jsm\//);
  assert.match(source, /\/src\/assets\/utils\/BufferGeometryUtils\.js/);
});

test("static boundary rejects project internals and traversal", () => {
  for (const requestUrl of [
    "/server.mjs",
    "/.git/config",
    "/docs/README.md",
    "/_bmad-output/current-roadmap.md",
    "/tools/rocketsim-bridge/main.cpp",
    "/.codex/config.toml",
    "/../server.mjs",
    "/%2e%2e/server.mjs",
    "/src/%2e%2e/server.mjs",
  ]) {
    assert.equal(resolvePublicAsset(requestUrl, root), null, requestUrl);
  }
});
