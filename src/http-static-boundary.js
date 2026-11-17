const PUBLIC_ASSETS = new Set([
  "index.html",
  "p2p-loopback.html",
  "p2p-host-loopback.html",
  "p2p-session-loopback.html",
  "p2p-room-lobby.html",
  "p2p-causal-beta.html",
  "src/p2p-causal-beta.js",
  "src/p2p-causal-beta-hud.js",
  "src/p2p-causal-beta-entry.js",
  "src/p2p-causal-beta-renderer.js",
  "src/p2p-causal-input.js",
  "src/p2p-boost-meter.js",
  "src/p2p-aim-targeting.js",
  "src/p2p-wasm-render-state.js",
  "src/snapshot-interpolation.js",
  "src/client.js",
  "src/client-performance.js",
  "src/aim-lock.js",
  "src/style.css",
  "src/snapshot-interpolation.js",
  "src/input-ack.js",
  "src/control-mapping.js",
  "src/gamepad-input.js",
  "src/camera-follow.js",
  "src/arena-visual-profile.js",
  "src/arena-decoration.js",
  "src/arena-scrapyard-material.js",
  "src/lan-session-protocol.js",
  "src/p2p-session-protocol.js",
  "src/p2p-signaling-protocol.js",
  "src/p2p-room-config.js",
  "src/p2p-signaling-client.js",
  "src/p2p-room-lobby.js",
  "src/p2p-webrtc-session.js",
  "src/lan-session-protocol.js",
  "src/rocketsim-arena-profile.js",
  "src/rocketsim-combat.js",
  "src/rocketsim-practice-match.js",
  "src/rocketsim-protocol.js",
  "tools/wasm-spike/p2p-wasm-causal-combat-channel.mjs",
  "tools/wasm-spike/p2p-wasm-causal-combat-protocol.mjs",
  "tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs",
  "tools/wasm-spike/p2p-wasm-causal-room-session.mjs",
  "tools/wasm-spike/p2p-wasm-combat-host.mjs",
  "tools/wasm-spike/p2p-wasm-host-match.mjs",
  "tools/wasm-spike/p2p-wasm-host-clock.mjs",
  "tools/wasm-spike/p2p-wasm-presentation-render-state.mjs",
  "tools/wasm-spike/p2p-wasm-arena-presentation.mjs",
  "tools/wasm-spike/p2p-wasm-camera-framing.mjs",
  "tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs",
  "tools/wasm-spike/build/rocketsim_wasm.mjs",
  "tools/wasm-spike/build/rocketsim_wasm.wasm",
  "src/p2p-loopback.js",
  "src/p2p-host-match.js",
  "src/p2p-host-loopback.js",
  "src/p2p-match-channel.js",
  "src/p2p-session-loopback.js",
  // This one existing simulation module is exposed for the opt-in P2P
  // authority diagnostic; the allow-list remains explicit, not directory-wide.
  "src/simulation.js",
  "src/online-access-token.js",
  "src/lan-session-ui.js",
  "src/lan-client-liveness.js",
  "src/vehicle-visual-alignment.js",
  "src/vehicle-visual-model.js",
  "src/vehicle-asset-loader.js",
  "src/assets/vehicle/model.gltf",
  "src/assets/vehicle/geometry.bin",
  "src/assets/vehicle/GLTFLoader.js",
  "src/assets/utils/BufferGeometryUtils.js",
  "src/audio-mixer.js",
  "src/audio-sample-bank.js",
  "src/rocketsim-arena-profile.js",
  "src/combat-hud.js",
  "src/combat-alpha-map.js",
  "src/player-experience-state.js",
  "src/event-feedback.js",
  "src/visual-smoke-playback.js",
  "vendor/three/three.module.js",
  "vendor/three/three.core.js",
  // The production LAN client still serves Three from the installed package;
  // the Pages beta uses the vendor aliases above because Pages omits the
  // node_modules path during deployment.
  "node_modules/three/build/three.module.js",
  "node_modules/three/build/three.core.js",
  // Deliberately enumerated offline presentation assets.  Do not turn this
  // into a directory allow-list: server internals must remain private.
  "src/assets/arena/skybowl.glb",
  "src/assets/arena/boost-pads.glb",
  "src/assets/arena/scrapyard/manifest.json",
  "src/assets/arena/scrapyard/ground-concrete.webp",
  "src/assets/arena/scrapyard/wall-concrete.webp",
  "src/assets/arena/scrapyard/corrugated-metal.webp",
  "src/assets/arena/scrapyard/hazard-stripes.webp",
  "src/assets/arena/scrapyard/worn-tires-rubber.webp",
  "assets/audio/manifest.json",
  "assets/audio/boost/start.wav",
  "assets/audio/boost/loop.wav",
  "assets/audio/boost/release.wav",
  "assets/audio/engine/idle.wav",
  "assets/audio/engine/coast-01.wav",
  "assets/audio/engine/loaded-01.wav",
  "assets/audio/impacts/arena-01.wav",
  "assets/audio/impacts/vehicle-body-01.wav",
  "assets/audio/vehicle/jump-01.wav",
  "assets/audio/vehicle/double-jump-01.wav",
  "assets/audio/vehicle/dodge-01.wav",
]);

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".wav", "audio/wav"],
  [".gltf", "model/gltf+json; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".webp", "image/webp"],
  [".bin", "application/octet-stream"],
]);

export function resolvePublicAsset(requestUrl, root) {
  let pathname;

  try {
    pathname = new URL(requestUrl || "/", "http://localhost").pathname;
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (pathname === "/") pathname = "/index.html";

  const relative = pathname.replace(/^\/+/, "").replaceAll("\\", "/");
  if (!PUBLIC_ASSETS.has(relative)) return null;

  const extension = relative.includes(".")
    ? `.${relative.split(".").pop()}`
    : "";

  return {
    path: joinRoot(root, relative),
    relative,
    contentType: CONTENT_TYPES.get(extension) || "application/octet-stream",
  };
}

function joinRoot(root, relative) {
  return `${root.replace(/[\\/]$/, "")}/${relative}`;
}

export { PUBLIC_ASSETS };
