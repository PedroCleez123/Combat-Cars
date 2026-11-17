// P2P-WASM-45: browser-only adapter for the opt-in causal beta. The renderer
// consumes presentation state but never owns transport, authority or input.
import * as THREE from "/vendor/three/three.module.js";
import { createP2PWasmThreePresentationRenderer } from "../tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs";

export function createCausalBetaPresentationRenderer({ canvas, width = 640, height = 360, role = null, targetCarId = null, focusCarId: explicitFocusCarId = null } = {}) {
  const focusCarId = explicitFocusCarId || (role === "pilot" ? "p2p-pilot" : role === "host" ? "p2p-host" : null);
  // P2PFullWasmCombatHost deliberately reuses RocketSimPracticeMatch's
  // Arsenal-world snapshot shape. Do not treat it as a raw RocketSim UU
  // fixture: doing so shrinks both cars and their arena by the conversion
  // factor and breaks visual parity with the local Three.js client.
  // Combat Cars is a 3D game. WebGL2 is therefore a hard presentation
  // requirement; an unavailable context must reach the existing error overlay
  // instead of silently changing the game into a different 2D product.
  return createP2PWasmThreePresentationRenderer({
      THREE,
      canvas,
      width,
      height,
      focusCarId,
      targetCarId,
      coordinateSpace: "arsenal-world",
    });
}
