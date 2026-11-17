import assert from "node:assert/strict";
import test from "node:test";

import { composeVehicleInput } from "../src/control-mapping.js";
import { createP2PCausalInput, p2pLobbyControlsFromCommand } from "../src/p2p-causal-input.js";

function target(tagName = "body") { return { tagName, isContentEditable: false }; }

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    fire(type, event) { listeners.get(type)?.(event); },
    listenerCount() { return listeners.size; },
  };
}

test("causal input translates held movement and one-shot fire without leaking text-field input", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef });
  targetRef.fire("keydown", { key: "w", target: target() });
  targetRef.fire("keydown", { key: "d", target: target() });
  targetRef.fire("mousedown", { button: 0, target: target() });
  targetRef.fire("keydown", { key: "f", repeat: false, target: target() });
  const first = input.nextCommand("pilot");
  assert.deepEqual(first, { controls: { throttle: 1, steer: 1, boost: true, jump: false }, fire: true, targetId: null });
  const second = input.nextCommand("pilot");
  assert.equal(second.fire, false);
  assert.equal(second.targetId, null);
  targetRef.fire("keydown", { key: "a", target: target("input") });
  assert.equal(input.nextCommand("pilot").controls.steer, 1);
  targetRef.fire("keyup", { key: "d", target: target() });
  assert.equal(input.nextCommand("pilot").controls.steer, 0);
  input.destroy();
  assert.equal(targetRef.listenerCount(), 0);
});

test("causal input preserves the Arsenal mouse, drift and directional air-roll contract online", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef, fullControls: true });
  targetRef.fire("keydown", { key: "w", code: "KeyW", target: target() });
  targetRef.fire("keydown", { key: "d", code: "KeyD", target: target() });
  targetRef.fire("keydown", { key: "Shift", code: "ShiftLeft", target: target() });
  targetRef.fire("keydown", { key: "Control", code: "ControlLeft", target: target() });
  targetRef.fire("keydown", { key: " ", code: "Space", target: target() });
  targetRef.fire("mousedown", { button: 0, target: target() });
  targetRef.fire("mousedown", { button: 2, target: target() });
  const command = input.nextCommand("pilot");
  assert.deepEqual(command.controls, {
    throttle: 1, steer: 1, boost: true, jump: true,
    pitch: -1, yaw: 0, roll: 1, drift: true, airRoll: true, handbrake: true,
  });
  targetRef.fire("mouseup", { button: 0, target: target() });
  targetRef.fire("mouseup", { button: 2, target: target() });
  assert.equal(input.nextCommand("pilot").controls.boost, false);
  assert.equal(input.nextCommand("pilot").controls.jump, false);
  input.destroy();
});

test("lobby projection unwraps causal controls before sending them to the WASM host", () => {
  const projected = p2pLobbyControlsFromCommand({
    controls: { throttle: 1, steer: -1, pitch: -1, yaw: 0, roll: 1, boost: true, jump: true, drift: false, airRoll: true, handbrake: false },
    fire: true,
    targetId: "p2p-host",
  });
  assert.deepEqual(projected, {
    throttle: 1, steer: -1, pitch: -1, yaw: 0, roll: 1,
    boost: true, jump: true, drift: false, airRoll: true, handbrake: false,
  });
  assert.equal(Object.hasOwn(projected, "fire"), false);
  assert.equal(Object.hasOwn(projected, "targetId"), false);
});

test("causal full controls reuse the local roll policy for free and directional air-roll", () => {
  const cases = [
    {
      keys: [{ key: "d", code: "KeyD" }, { key: "Shift", code: "ShiftLeft" }],
      actions: { right: true, drift: true },
    },
    {
      keys: [{ key: "a", code: "KeyA" }, { key: "Control", code: "ControlLeft" }],
      actions: { left: true, rollLeft: true },
    },
    {
      keys: [
        { key: "d", code: "KeyD" }, { key: "Shift", code: "ShiftLeft" },
        { key: "Control", code: "ControlLeft" }, { key: " ", code: "Space" },
      ],
      actions: { right: true, drift: true, rollLeft: true, rollRight: true },
    },
  ];
  for (const { keys, actions } of cases) {
    const targetRef = eventTarget();
    const input = createP2PCausalInput({ eventTarget: targetRef, fullControls: true });
    for (const key of keys) targetRef.fire("keydown", { ...key, target: target() });
    const command = input.nextCommand("pilot");
    const expected = composeVehicleInput(actions);
    assert.equal(command.controls.steer, expected.steer);
    assert.equal(command.controls.drift, expected.drift);
    assert.equal(command.controls.airRoll, expected.airRoll);
    assert.equal(command.controls.roll, expected.roll);
    input.destroy();
  }
});

test("causal input only locks a living rival from the latest session state", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef });
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  targetRef.fire("keydown", { key: "f", repeat: false, target: target() });
  assert.equal(input.nextCommand("host").targetId, null, "Q cannot invent a target before a live snapshot exists");
  assert.equal(input.isTargetLocked(), false);
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  assert.equal(input.nextCommand("host", { candidateTargetId: "p2p-pilot" }).targetId, "p2p-pilot");
  assert.equal(input.getTargetId(), "p2p-pilot");
  assert.equal(input.nextCommand("host", { candidateTargetId: "p2p-pilot" }).targetId, "p2p-pilot", "lock persists while the same rival remains alive");
  assert.equal(input.nextCommand("host", { candidateTargetId: null }).targetId, null, "elimination immediately releases the lock");
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  assert.equal(input.nextCommand("host", { candidateTargetId: "p2p-host" }).targetId, null, "a host cannot select itself as the rival");
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  assert.equal(input.nextCommand("host", { candidateTargetId: "p2p-pilot" }).targetId, "p2p-pilot");
  targetRef.fire("keydown", { key: "w", target: target() });
  targetRef.fire("blur", {});
  assert.deepEqual(input.nextCommand("host"), { controls: { throttle: 0, steer: 0, boost: false, jump: false }, fire: false, targetId: null });
  assert.equal(input.isTargetLocked(), false);
  input.destroy();
});

test("causal input maps a pilot lock only to a live host and Q cancels it", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef });
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  assert.equal(input.nextCommand("pilot", { candidateTargetId: "p2p-host" }).targetId, "p2p-host");
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  assert.equal(input.nextCommand("pilot", { candidateTargetId: "p2p-host" }).targetId, null);
  input.destroy();
});

test("causal input can consume a validated multi-player roster without weakening the 1v1 default", () => {
  const targetRef = eventTarget();
  const roster = new Map([
    ["host", new Set(["p2p-pilot", "p2p-red-2", "p2p-blue-2"])],
    ["pilot", new Set(["p2p-host", "p2p-red-2", "p2p-blue-2"])],
  ]);
  const input = createP2PCausalInput({
    eventTarget: targetRef,
    targetAllowed: (role, id) => roster.get(role)?.has(id) === true,
  });
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  assert.equal(input.nextCommand("host", { candidateTargetId: "p2p-red-2" }).targetId, "p2p-red-2");
  assert.equal(input.nextCommand("host", { candidateTargetId: "p2p-red-2" }).targetId, "p2p-red-2");
  targetRef.fire("keydown", { key: "q", repeat: false, target: target() });
  assert.equal(input.nextCommand("host", { candidateTargetId: "p2p-host" }).targetId, null);
  input.destroy();
});

test("causal input preserves reverse throttle and cancels opposing directions", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef });
  targetRef.fire("keydown", { key: "s", target: target() });
  assert.equal(input.nextCommand("pilot").controls.throttle, -1);
  targetRef.fire("keydown", { key: "w", target: target() });
  assert.equal(input.nextCommand("pilot").controls.throttle, 0);
  targetRef.fire("keyup", { key: "s", target: target() });
  assert.equal(input.nextCommand("pilot").controls.throttle, 1);
  input.destroy();
});

test("causal input keeps Arsenal bindings physical across keyboard layouts", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef });
  targetRef.fire("keydown", { key: "z", code: "KeyW", target: target() });
  targetRef.fire("keydown", { key: "q", code: "KeyD", target: target() });
  assert.deepEqual(input.nextCommand("pilot").controls, { throttle: 1, steer: 1, boost: false, jump: false });
  input.destroy();
});

test("causal input ignores R completely and never treats it as held movement", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef });
  targetRef.fire("keydown", { key: "r", repeat: false, target: target() });
  targetRef.fire("keydown", { key: "r", repeat: true, target: target() });
  const first = input.nextCommand("pilot");
  assert.equal(Object.hasOwn(first, "restart"), false);
  assert.deepEqual(first.controls, { throttle: 0, steer: 0, boost: false, jump: false });
  assert.equal(Object.hasOwn(input.nextCommand("pilot"), "restart"), false);
  input.destroy();
});

test("causal input accepts persisted desktop rebindings without changing the wire shape", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({
    eventTarget: targetRef,
    bindings: { forward: "i", fire: "e", boost: "mouse-right", jump: "mouse-left" },
  });
  targetRef.fire("keydown", { key: "i", target: target() });
  targetRef.fire("keydown", { key: "e", repeat: false, target: target() });
  targetRef.fire("mousedown", { button: 2, target: target() });
  const command = input.nextCommand("pilot");
  assert.deepEqual(command, {
    controls: { throttle: 1, steer: 0, boost: true, jump: false },
    fire: true,
    targetId: null,
  });
  targetRef.fire("mouseup", { button: 2, target: target() });
  targetRef.fire("mousedown", { button: 0, target: target() });
  assert.equal(input.nextCommand("pilot").controls.jump, true);
  input.destroy();
});

test("causal input retains the physical key selected by a desktop rebind", () => {
  const targetRef = eventTarget();
  const input = createP2PCausalInput({ eventTarget: targetRef, bindings: { forward: "KeyI" } });
  // The displayed character varies by keyboard layout; the browser code is
  // the invariant used by the local Arsenal binding menu.
  targetRef.fire("keydown", { key: "ñ", code: "KeyI", target: target() });
  assert.equal(input.nextCommand("pilot").controls.throttle, 1);
  input.destroy();
});

test("causal input merges the standard Rocket League gamepad layout without changing the command contract", () => {
  const targetRef = eventTarget();
  const gamepad = {
    connected: true,
    mapping: "standard",
    axes: [.6],
    buttons: Array.from({ length: 13 }, () => ({ pressed: false, value: 0 })),
  };
  gamepad.buttons[7] = { pressed: true, value: 1 }; // RT
  gamepad.buttons[0] = { pressed: true, value: 1 }; // A
  gamepad.buttons[5] = { pressed: true, value: 1 }; // RB
  gamepad.buttons[4] = { pressed: true, value: 1 }; // LB
  gamepad.buttons[1] = { pressed: true, value: 1 }; // B
  gamepad.buttons[12] = { pressed: true, value: 1 }; // D-pad up
  const input = createP2PCausalInput({ eventTarget: targetRef, fullControls: true, getGamepads: () => [gamepad] });
  const first = input.nextCommand("pilot");
  assert.deepEqual(first, {
    controls: {
      throttle: 1, steer: (.6 - .12) / .88, boost: true, jump: true,
      pitch: -1, yaw: 0, roll: 1, drift: true, airRoll: true, handbrake: true,
    },
    fire: true,
    targetId: null,
  });
  assert.equal(input.nextCommand("pilot").fire, false, "D-pad fire stays an edge while held");
  gamepad.buttons[12] = { pressed: false, value: 0 };
  input.nextCommand("pilot");
  gamepad.buttons[12] = { pressed: true, value: 1 };
  assert.equal(input.nextCommand("pilot").fire, true, "a new D-pad press queues one new fire command");
  input.destroy();
});

