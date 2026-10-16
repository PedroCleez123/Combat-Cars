import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { RocketSimBridge } from "../src/rocketsim-backend.js";
import { attitudeFromRocketSimOrientation, rocketsimPositionToArsenal, rocketsimVelocityToArsenal } from "../src/rocketsim-practice-match.js";
import { CAMERA_FOLLOW_TUNING, createCameraFollowState, stepCameraFollow } from "../src/camera-follow.js";

const executable = process.env.ROCKETSIM_BRIDGE_EXE;
if (!executable || !existsSync(executable)) throw new Error("ROCKETSIM_BRIDGE_EXE no apunta a un ejecutable existente");
const bridge = new RocketSimBridge({ executable });
const bounds = { minPositionY: 2.8, maxPositionY: 27.2, minFocusY: .8, maxFocusY: 28.2 };
const carConfig = [{ id: 1, team: "blue" }];
const input = { throttle: 1, steer: 0, jump: false, boost: true, drift: false, airRoll: false, roll: 0 };
const cameraState = createCameraFollowState();
const trace = { profile: "arsenal-expanded-cornered-practice", samples: 0, maxHeadingStep: 0, modes: [], minCameraY: Infinity, maxCameraY: -Infinity, minFocusY: Infinity, maxFocusY: -Infinity };
let previousHeading = null;
try {
  await bridge.start({ arena: trace.profile, cars: carConfig });
  for (let tick = 1; tick <= 360; tick += 1) {
    const frame = await bridge.tick(tick, [{ ...carConfig[0], input }]);
    if (tick % 2) continue;
    const native = frame.cars[0];
    const position = rocketsimPositionToArsenal(native.position);
    const velocity = rocketsimVelocityToArsenal(native.velocity);
    const attitude = attitudeFromRocketSimOrientation(native.orientation);
    const normal = native.wheelContact.normal;
    const wall = Math.abs(normal.y) < .35;
    const surfaceType = wall ? "wall" : native.grounded ? "ground" : "air";
    const follow = stepCameraFollow(cameraState, {
      x: position.x, h: position.h, z: position.z, speed: Math.hypot(velocity.x, velocity.y, velocity.z),
      forward: attitude.forward, grounded: native.grounded, surfaceType, wallRide: wall, cameraVerticalBounds: bounds,
    }, 1 / 60);
    if (previousHeading !== null) trace.maxHeadingStep = Math.max(trace.maxHeadingStep, Math.abs(follow.heading - previousHeading));
    previousHeading = follow.heading;
    trace.samples += 1;
    if (!trace.modes.includes(follow.mode)) trace.modes.push(follow.mode);
    trace.minCameraY = Math.min(trace.minCameraY, follow.position.y); trace.maxCameraY = Math.max(trace.maxCameraY, follow.position.y);
    trace.minFocusY = Math.min(trace.minFocusY, follow.focus.y); trace.maxFocusY = Math.max(trace.maxFocusY, follow.focus.y);
  }
} finally { await bridge.shutdown(); }
assert.ok(trace.samples > 100);
assert.ok(trace.modes.includes("ground"));
assert.ok(trace.maxHeadingStep <= CAMERA_FOLLOW_TUNING.headingRate / 60 + 1e-12);
assert.ok(trace.minCameraY >= bounds.minPositionY && trace.maxCameraY <= bounds.maxPositionY);
assert.ok(trace.minFocusY >= bounds.minFocusY && trace.maxFocusY <= bounds.maxFocusY);
console.log(JSON.stringify(trace, null, 2));
