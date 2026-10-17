const PUBLIC_ASSETS = new Set([
  "index.html",
  "src/client.js",
  "src/style.css",
  "src/calibration-history.js",
  "src/calibration-session.js",
  "src/snapshot-interpolation.js",
  "src/input-ack.js",
  "src/control-mapping.js",
  "src/gamepad-input.js",
  "src/camera-follow.js",
  "src/arena-visual-profile.js",
  "src/mob02-browser-playback.js",
  "src/mob-air-01-browser-playback.js",
  "src/hitbox-01-browser-observation.js",
  "src/vis03-browser-playback.js",
  "src/lan-session-protocol.js",
  "src/lan-client-liveness.js",
  "src/vehicle-visual-alignment.js",
  "src/rocketsim-arena-profile.js",
  "node_modules/three/build/three.module.js",
  "node_modules/three/build/three.core.js",
]);

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
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
