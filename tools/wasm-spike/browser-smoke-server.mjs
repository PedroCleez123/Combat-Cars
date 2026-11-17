import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const projectRoot = resolve(root, "..", "..");
const sourceRoot = resolve(projectRoot, "src");
const allowed = new Map([
  ["/", "browser-smoke.html"],
  ["/browser-smoke.html", "browser-smoke.html"],
  ["/browser-multicar-smoke.html", "browser-multicar-smoke.html"],
  ["/browser-ground-smoke.html", "browser-ground-smoke.html"],
  ["/browser-wall-smoke.html", "browser-wall-smoke.html"],
  ["/browser-car-contact-smoke.html", "browser-car-contact-smoke.html"],
  ["/browser-p2p-host-smoke.html", "browser-p2p-host-smoke.html"],
  ["/browser-p2p-combat-alpha-host-smoke.html", "browser-p2p-combat-alpha-host-smoke.html"],
  ["/browser-p2p-causal-combat-smoke.html", "browser-p2p-causal-combat-smoke.html"],
  ["/browser-p2p-causal-presentation-smoke.html", "browser-p2p-causal-presentation-smoke.html"],
  ["/browser-p2p-causal-presentation-three-smoke.html", "browser-p2p-causal-presentation-three-smoke.html"],
  ["/browser-p2p-full-combat-smoke.html", "browser-p2p-full-combat-smoke.html"],
  ["/browser-p2p-causal-combat-webrtc-smoke.html", "browser-p2p-causal-combat-webrtc-smoke.html"],
  ["/browser-p2p-causal-combat-webrtc-pair-smoke.html", "browser-p2p-causal-combat-webrtc-pair-smoke.html"],
  ["/browser-online-qa-24-smoke.html", "browser-online-qa-24-smoke.html"],
  ["/browser-online-lifecycle-25-smoke.html", "browser-online-lifecycle-25-smoke.html"],
  ["/browser-combat-alpha-raycast-benchmark.html", "browser-combat-alpha-raycast-benchmark.html"],
  ["/trace-contract.mjs", "trace-contract.mjs"],
  ["/multi-car.mjs", "multi-car.mjs"],
  ["/ground-trace.mjs", "ground-trace.mjs"],
  ["/ground-trace-contract.mjs", "ground-trace-contract.mjs"],
  ["/wall-trace-contract.mjs", "wall-trace-contract.mjs"],
  ["/car-contact-trace.mjs", "car-contact-trace.mjs"],
  ["/car-contact-trace-contract.mjs", "car-contact-trace-contract.mjs"],
  ["/p2p-wasm-host-match.mjs", "p2p-wasm-host-match.mjs"],
  ["/p2p-wasm-combat-host.mjs", "p2p-wasm-combat-host.mjs"],
  ["/p2p-wasm-causal-combat-protocol.mjs", "p2p-wasm-causal-combat-protocol.mjs"],
  ["/p2p-wasm-causal-combat-presentation-protocol.mjs", "p2p-wasm-causal-combat-presentation-protocol.mjs"],
  // Production source adapters keep their relative ../tools/wasm-spike/ URL
  // when loaded inside the privileged smoke protocol. Mirror those exact
  // URLs instead of rewriting source imports at the browser boundary.
  ["/tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs", "p2p-wasm-causal-combat-presentation-protocol.mjs"],
  ["/tools/wasm-spike/p2p-wasm-causal-combat-protocol.mjs", "p2p-wasm-causal-combat-protocol.mjs"],
  ["/p2p-wasm-presentation-render-state.mjs", "p2p-wasm-presentation-render-state.mjs"],
  ["/p2p-wasm-arena-presentation.mjs", "p2p-wasm-arena-presentation.mjs"],
  ["/p2p-wasm-camera-framing.mjs", "p2p-wasm-camera-framing.mjs"],
  ["/p2p-wasm-three-presentation-renderer.mjs", "p2p-wasm-three-presentation-renderer.mjs"],
  ["/p2p-wasm-authored-vehicle.mjs", "p2p-wasm-authored-vehicle.mjs"],
  ["/node_modules/three/build/three.module.js", "@project/node_modules/three/build/three.module.js"],
  ["/node_modules/three/build/three.core.js", "@project/node_modules/three/build/three.core.js"],
  ["/p2p-wasm-causal-combat-channel.mjs", "p2p-wasm-causal-combat-channel.mjs"],
  ["/p2p-wasm-causal-room-session.mjs", "p2p-wasm-causal-room-session.mjs"],
  ["/p2p-wasm-metadata-channel.mjs", "p2p-wasm-metadata-channel.mjs"],
  ["/tools/wasm-spike/p2p-wasm-metadata-channel.mjs", "p2p-wasm-metadata-channel.mjs"],
  ["/p2p-wasm-full-combat-host.mjs", "p2p-wasm-full-combat-host.mjs"],
  ["/p2p-wasm-host-clock.mjs", "p2p-wasm-host-clock.mjs"],
  ["/combat-alpha-static-raycast-contract.mjs", "combat-alpha-static-raycast-contract.mjs"],
  ["/src/rocketsim-combat.js", "@src/rocketsim-combat.js"],
  ["/src/rocketsim-practice-match.js", "@src/rocketsim-practice-match.js"],
  ["/src/rocketsim-wasm-backend.js", "@src/rocketsim-wasm-backend.js"],
  ["/src/rocketsim-arena-profile.js", "@src/rocketsim-arena-profile.js"],
  ["/src/rocketsim-protocol.js", "@src/rocketsim-protocol.js"],
  ["/src/lan-session-protocol.js", "@src/lan-session-protocol.js"],
  ["/src/combat-alpha-map.js", "@src/combat-alpha-map.js"],
  ["/src/arena-decoration.js", "@src/arena-decoration.js"],
  ["/src/arena-visual-profile.js", "@src/arena-visual-profile.js"],
  ["/src/p2p-session-protocol.js", "@src/p2p-session-protocol.js"],
  ["/src/p2p-room-config.js", "@src/p2p-room-config.js"],
  ["/src/p2p-wasm-render-state.js", "@src/p2p-wasm-render-state.js"],
  ["/src/online-full-presentation-state.js", "@src/online-full-presentation-state.js"],
  ["/src/p2p-aim-targeting.js", "@src/p2p-aim-targeting.js"],
  ["/src/gamepad-input.js", "@src/gamepad-input.js"],
  ["/src/camera-follow.js", "@src/camera-follow.js"],
  ["/src/snapshot-interpolation.js", "@src/snapshot-interpolation.js"],
  ["/src/vehicle-visual-model.js", "@src/vehicle-visual-model.js"],
  ["/src/vehicle-asset-loader.js", "@src/vehicle-asset-loader.js"],
  ["/src/assets/vehicle/GLTFLoader.js", "@src/assets/vehicle/GLTFLoader.js"],
  ["/src/assets/utils/BufferGeometryUtils.js", "@src/assets/utils/BufferGeometryUtils.js"],
  ["/src/assets/vehicle/model.gltf", "@src/assets/vehicle/model.gltf"],
  ["/src/assets/vehicle/geometry.bin", "@src/assets/vehicle/geometry.bin"],
  ["/src/p2p-webrtc-session.js", "@src/p2p-webrtc-session.js"],
  ["/src/p2p-player-identity.js", "@src/p2p-player-identity.js"],
  ["/build/rocketsim_wasm.mjs", "build/rocketsim_wasm.mjs"],
  ["/build/rocketsim_wasm.wasm", "build/rocketsim_wasm.wasm"],
  ["/tools/wasm-spike/build/rocketsim_wasm.mjs", "build/rocketsim_wasm.mjs"],
  ["/tools/wasm-spike/build/rocketsim_wasm.wasm", "build/rocketsim_wasm.wasm"],
]);
const types = Object.freeze({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".wasm": "application/wasm", ".gltf": "model/gltf+json", ".bin": "application/octet-stream" });

export function resolveWasmSmokeResource(method, requestTarget) {
  if (method !== "GET" || typeof requestTarget !== "string"
    || !requestTarget.startsWith("/") || requestTarget.startsWith("//")
    || requestTarget.includes("?") || requestTarget.includes("#") || requestTarget.includes("\\")) return null;
  return allowed.get(requestTarget) ?? null;
}

// The browser page imports exactly five production source modules for the
// causal host. Keep their URL identity separate from the spike root so this
// server never becomes a general-purpose source-file host.
export function resolveWasmSmokeFile(resource) {
  if (typeof resource !== "string") return null;
  if (resource.startsWith("@project/")) {
    const file = resolve(projectRoot, resource.slice("@project/".length));
    return file.startsWith(`${projectRoot}${sep}`) ? file : null;
  }
  if (resource.startsWith("@src/")) {
    const file = resolve(sourceRoot, resource.slice("@src/".length));
    return file.startsWith(`${sourceRoot}${sep}`) ? file : null;
  }
  const file = resolve(root, resource);
  return file.startsWith(`${root}${sep}`) ? file : null;
}

// Keep this MIME contract shared with the Electron runner. Causal browser
// smoke imports production modules with the `.js` extension; serving those as
// octet-stream causes Chromium to reject them before the test can report a
// domain-level failure.
export function wasmSmokeContentType(file) {
  return types[extname(String(file || ""))] || "application/octet-stream";
}

export function createWasmSmokeServer() {
  return createServer((request, response) => {
    const relative = resolveWasmSmokeResource(request.method, request.url || "/");
    if (!relative) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end("not found");
      return;
    }
    const file = resolveWasmSmokeFile(relative);
    if (!file || !existsSync(file)) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end("not built");
      return;
    }
    response.writeHead(200, { "Content-Type": wasmSmokeContentType(file), "Cache-Control": "no-store" });
    createReadStream(file).pipe(response);
  });
}

export function startWasmSmokeServer(port = Number(process.env.WASM_SPIKE_PORT || 5297)) {
  const server = createWasmSmokeServer();
  server.listen(port, "127.0.0.1", () => console.log(`RocketSim WASM spike · http://127.0.0.1:${server.address().port}`));
  return server;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  const server = startWasmSmokeServer();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
}
