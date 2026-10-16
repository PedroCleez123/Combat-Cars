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
  assert.equal(
    resolvePublicAsset("/src/client.js?cache=1", root)?.relative,
    "src/client.js",
  );
  assert.equal(
    resolvePublicAsset("/node_modules/three/build/three.module.js", root)?.contentType,
    "text/javascript; charset=utf-8",
  );
  assert.equal(
    resolvePublicAsset("/node_modules/three/build/three.core.js", root)?.contentType,
    "text/javascript; charset=utf-8",
  );
  assert.equal(
    resolvePublicAsset("/src/rocketsim-arena-profile.js", root)?.relative,
    "src/rocketsim-arena-profile.js",
  );
  assert.equal(resolvePublicAsset("/src/simulation.js", root), null);
});

test("static boundary exposes every direct browser dependency of the client entry", async () => {
  const entries = [
    { route: "/src/client.js", source: new URL("../src/client.js", import.meta.url) },
    { route: "/node_modules/three/build/three.module.js", source: new URL("../node_modules/three/build/three.module.js", import.meta.url) },
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

test("static boundary rejects project internals and traversal", () => {
  for (const requestUrl of [
    "/server.mjs",
    "/.git/config",
    "/docs/README.md",
    "/_bmad-output/implementation-artifacts/roadmap-current-2026-10-14.md",
    "/tools/rocketsim-bridge/main.cpp",
    "/.codex/config.toml",
    "/../server.mjs",
    "/%2e%2e/server.mjs",
    "/src/%2e%2e/server.mjs",
  ]) {
    assert.equal(resolvePublicAsset(requestUrl, root), null, requestUrl);
  }
});
