import assert from "node:assert/strict";
import test from "node:test";
import { mergeVehicleActions, readGamepadActions } from "../src/gamepad-input.js";

const pad = ({ connected = true, mapping = "standard", axes = [0, 0], buttons = [] } = {}) => ({ connected, mapping, axes, buttons });
const button = (pressed = true, value = pressed ? 1 : 0) => ({ pressed, value });

test("standard gamepad maps the Rocket League controller layout to vehicle actions", () => {
  const buttons = [];
  buttons[0] = button(); // A jump
  buttons[1] = button(); // B roll right
  buttons[2] = button(); // X roll left
  buttons[4] = button(); // LB drift/free roll
  buttons[5] = button(); // RB boost
  buttons[6] = button(false, .25); // LT brake
  buttons[7] = button(true, .9); // RT accelerate
  buttons[12] = button(); // D-pad up fire
  const result = readGamepadActions([pad({ axes: [.8, 0], buttons })]);
  assert.equal(result.connected, true);
  assert.deepEqual(result.actions, {
    forward: false, back: false, left: false, right: false,
    drift: true, rollLeft: true, rollRight: true,
    jump: true, boost: true, fire: true,
    throttle: .65, steer: (0.8 - .12) / .88
  });
});

test("the adapter ignores stick noise, disconnected devices, and non-standard layouts", () => {
  assert.deepEqual(readGamepadActions([pad({ axes: [.08, -.08] })]).actions, {
    forward: false, back: false, left: false, right: false,
    drift: false, rollLeft: false, rollRight: false,
    jump: false, boost: false, fire: false,
    throttle: 0, steer: 0
  });
  assert.equal(readGamepadActions([pad({ connected: false })]).connected, false);
  assert.equal(readGamepadActions([pad({ mapping: "" })]).connected, false);
});

test("the adapter uses a scaled Rocket Arena-style dead zone instead of a hard steering cutoff", () => {
  const result = readGamepadActions([pad({ axes: [.24, 0] })]);
  assert.ok(result.actions.steer > 0, "intent above the dead zone is retained");
  assert.ok(result.actions.steer < .24, "the dead-zone portion is removed before rescaling");
});

test("controller actions merge with keyboard actions without cancelling either source", () => {
  assert.deepEqual(mergeVehicleActions(
    { forward: true, left: true, jump: true },
    { right: true, boost: true, rollRight: true }
  ), {
    forward: true, back: false, left: true, right: true,
    drift: false, rollLeft: false, rollRight: true,
    jump: true, boost: true, fire: false,
    throttle: 0, steer: 0
  });
});
