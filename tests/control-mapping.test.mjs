import assert from "node:assert/strict";
import test from "node:test";
import { composeVehicleInput } from "../src/control-mapping.js";

test("free air roll maps steering to roll and disables yaw", () => {
  assert.deepEqual(composeVehicleInput({ right: true, drift: true }), {
    throttle: 0, steer: 1, jump: false, boost: false, drift: true, airRoll: true, roll: 1, fire: false
  });
});

test("directional air roll remains independent and can coexist with yaw", () => {
  const input = composeVehicleInput({ right: true, rollRight: true });
  assert.equal(input.steer, 1);
  assert.equal(input.roll, 1);
  assert.equal(input.airRoll, false);
});

test("free and directional roll inputs add and clamp to one axis", () => {
  const input = composeVehicleInput({ left: true, drift: true, rollRight: true });
  assert.equal(input.steer, -1);
  assert.equal(input.roll, 0);
  assert.equal(input.airRoll, true);
});

test("forward and reverse remain opposing throttle actions", () => {
  assert.equal(composeVehicleInput({ forward: true }).throttle, 1);
  assert.equal(composeVehicleInput({ back: true }).throttle, -1);
  assert.equal(composeVehicleInput({ forward: true, back: true }).throttle, 0);
});

test("analogue controller axes preserve partial trigger and steering values", () => {
  const input = composeVehicleInput({ throttle: .65, steer: -.4 });
  assert.equal(input.throttle, .65);
  assert.equal(input.steer, -.4);
});
