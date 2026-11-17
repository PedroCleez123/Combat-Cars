import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.LAN_HTTP_TEST_PORT || 5346);
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

function startServer() {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, MOVEMENT_BACKEND: "js", PORT: String(port), VEHICLE_LIMIT: "1", ARENA_PROFILE: "calibration" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  return { child, output };
}

async function waitFor(check, label, timeout = 5000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = check();
    if (value) return value;
    await wait(20);
  }
  throw new Error(`Timeout: ${label}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolveStop => {
    const force = setTimeout(() => { child.kill(); resolveStop(); }, 1500);
    child.once("exit", () => { clearTimeout(force); resolveStop(); });
    child.kill("SIGTERM");
  });
}

async function request(pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    nosniff: response.headers.get("x-content-type-options"),
    body: await response.text(),
  };
}

async function run() {
  const { child, output } = startServer();
  try {
    await waitFor(() => output.join("").includes(`http://localhost:${port}`), "servidor HTTP");

    const entrypoint = await request("/");
    assert.equal(entrypoint.status, 200);
    assert.match(entrypoint.contentType || "", /^text\/html/);
    assert.equal(entrypoint.nosniff, "nosniff");

    const client = await request("/src/client.js");
    assert.equal(client.status, 200);
    assert.match(client.contentType || "", /^text\/javascript/);

    const threeCore = await request("/node_modules/three/build/three.core.js");
    assert.equal(threeCore.status, 200);
    assert.match(threeCore.contentType || "", /^text\/javascript/);

    const forbiddenPaths = [
      "/server.mjs",
      "/.git/config",
      "/docs/README.md",
      "/_bmad-output/current-roadmap.md",
      "/tools/rocketsim-bridge/main.cpp",
      "/%2e%2e/server.mjs",
      "/src/%2e%2e/server.mjs",
    ];
    const forbidden = await Promise.all(forbiddenPaths.map(async pathname => ({ pathname, ...(await request(pathname)) })));
    for (const result of forbidden) assert.equal(result.status, 404, result.pathname);

    console.log(JSON.stringify({
      schemaVersion: 1,
      story: "LAN-HARDEN-01",
      port,
      assertions: {
        servesEntrypoint: entrypoint.status === 200,
        servesClientModule: client.status === 200,
        servesThreeCore: threeCore.status === 200,
        setsNosniff: entrypoint.nosniff === "nosniff",
        rejectsInternalsAndTraversal: forbidden.every(result => result.status === 404),
      },
    }, null, 2));
  } finally {
    await stopServer(child);
  }
}

run().catch(error => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
