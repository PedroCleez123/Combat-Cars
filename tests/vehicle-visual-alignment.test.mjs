import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOTYPE_CHASSIS_MAX_Y,
  PROTOTYPE_CHASSIS_MIN_Y,
  ROCKETSIM_OCTANE_HITBOX_TOP,
  ROCKETSIM_PROTOTYPE_CHASSIS_SCALE,
  ROCKETSIM_VISUAL_PIVOT_HEIGHT,
  modelPointHeight,
  vehicleVisualAlignment,
} from "../src/vehicle-visual-alignment.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} must be near ${expected}`);

test("RocketSim visual geometry places the provisional wheel envelope on the level floor", () => {
  const alignment = vehicleVisualAlignment({ height: 0, movementBackend: "rocketsim" });
  assert.equal(alignment.rootHeight, ROCKETSIM_VISUAL_PIVOT_HEIGHT);
  assert.ok(alignment.modelScale > 0 && alignment.modelScale < 1);
  near(modelPointHeight({ height: 0, localHeight: PROTOTYPE_CHASSIS_MIN_Y, orientationUpY: 1, movementBackend: "rocketsim" }), 0);
});

test("RocketSim visual geometry brings the provisional roof to the native inverted contact plane", () => {
  const invertedSnapshotHeight = ROCKETSIM_OCTANE_HITBOX_TOP - ROCKETSIM_VISUAL_PIVOT_HEIGHT;
  near(
    modelPointHeight({
      height: invertedSnapshotHeight,
      localHeight: PROTOTYPE_CHASSIS_MAX_Y,
      orientationUpY: -1,
      movementBackend: "rocketsim",
    }),
    0,
  );
  near(
    ROCKETSIM_PROTOTYPE_CHASSIS_SCALE * (PROTOTYPE_CHASSIS_MAX_Y - PROTOTYPE_CHASSIS_MIN_Y),
    ROCKETSIM_VISUAL_PIVOT_HEIGHT + ROCKETSIM_OCTANE_HITBOX_TOP,
  );
});

test("the JavaScript fallback retains its existing visual origin", () => {
  const alignment = vehicleVisualAlignment({ height: 2.5, movementBackend: "js" });
  assert.deepEqual(alignment, { rootHeight: 2.5, modelOffsetY: 0, modelScale: 1 });
  assert.equal(modelPointHeight({ height: 2.5, localHeight: .8, orientationUpY: 1, movementBackend: "js" }), 3.3);
});
