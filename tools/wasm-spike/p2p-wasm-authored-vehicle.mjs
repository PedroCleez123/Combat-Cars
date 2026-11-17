// ONLINE-RENDER-18: bridge the causal browser presentation to the same
// authored vehicle visual used by the local Three.js client. This module is
// presentation-only: it never reads or mutates physics and keeps the local
// procedural model as the immediate fallback while GLTF loads.
import { createVehicleVisualModel } from "../../src/vehicle-visual-model.js";

export function createP2PWasmAuthoredVehicle({ THREE, car } = {}) {
  if (!THREE || !car || typeof car.team !== "string") {
    throw new TypeError("El vehículo visual causal necesita Three.js y equipo.");
  }
  const vehicle = createVehicleVisualModel({
    THREE,
    team: car.team,
    vehicleAsset: {
      enabled: true,
      url: "/src/assets/vehicle/model.gltf",
      timeoutMs: 2500,
      maxTriangles: 16_000,
      maxDrawCalls: 24,
      // The P2P renderer already owns a recovery vehicle. Keep this authored
      // root hidden until the GLTF is ready and reclaim its procedural chassis
      // once the final asset has been attached.
      disposeProceduralOnAssetReady: true,
    },
  });
  vehicle.userData.onlineVisualContract = "authored-game-car-v1";
  return vehicle;
}
