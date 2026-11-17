import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createP2PWasmCausalCombatPresentationEnvelope,
  decodeP2PWasmCausalCombatPresentationEnvelope,
  P2P_WASM_PRESENTATION_PROTOCOL_VERSION,
} from "../tools/wasm-spike/p2p-wasm-causal-combat-presentation-protocol.mjs";
import { createP2PWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-combat-host.mjs";
import {
  createP2PWasmPresentationRenderState,
  P2PWasmPresentationRenderBuffer,
} from "../tools/wasm-spike/p2p-wasm-presentation-render-state.mjs";
import {
  createP2PWasmCameraFramingState,
  stepP2PWasmCameraFrame,
} from "../tools/wasm-spike/p2p-wasm-camera-framing.mjs";
import {
  createP2PWasmArenaPresentationSpec,
  P2P_WASM_SCENE_UNITS_PER_UU,
  P2P_WASM_PRESENTATION_COORDINATE_SPACES,
  p2pWasmPresentationUnits,
} from "../tools/wasm-spike/p2p-wasm-arena-presentation.mjs";
import {
  createP2PWasmPresentationLimits,
  P2P_WASM_EVENT_FEEDBACK_CAPACITY,
  P2P_WASM_ROCKET_POOL_CAPACITY,
  summarizeP2PWasmEventFeedback,
} from "../tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs";
import { ROCKETSIM_PRACTICE_SCALE } from "../src/rocketsim-practice-match.js";
import { rocketSimArenaProfile } from "../src/rocketsim-arena-profile.js";
import { resolveWasmSmokeResource } from "../tools/wasm-spike/browser-smoke-server.mjs";

const context = Object.freeze({ roomId: "p2p-v2-render-room", sessionId: "p2p-v2-render-session" });
const idle = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const command = (overrides = {}) => ({ controls: { ...idle }, fire: false, restart: false, targetId: null, ...overrides });

async function nextEnvelope(host, commandSequence, wireSequence) {
  const result = host.receivePilotCommand({ sequence: commandSequence, ...command() });
  assert.equal(result.accepted, true);
  const snapshot = host.presentationSnapshot();
  return decodeP2PWasmCausalCombatPresentationEnvelope(
    createP2PWasmCausalCombatPresentationEnvelope({ ...context, sequence: wireSequence, snapshot }),
  );
}

test("P2P-WASM-42 maps real v2 WASM telemetry into a renderer state without defaults", async () => {
  const host = await createP2PWasmCombatHost();
  try {
    assert.equal(host.setHostCommand(command()).accepted, true);
    const envelope = await nextEnvelope(host, 1, 1);
    const before = structuredClone(envelope);
    const state = createP2PWasmPresentationRenderState(envelope, context);
    assert.deepEqual(envelope, before, "the renderer adapter must not mutate decoded network data");
    assert.equal(state.settings.p2pPresentationProtocol, P2P_WASM_PRESENTATION_PROTOCOL_VERSION);
    assert.equal(state.cars.length, 2);
    for (const [index, car] of state.cars.entries()) {
      const telemetry = envelope.presentation[index];
      assert.deepEqual(car.orientation, telemetry.orientation);
      assert.equal(car.boost, telemetry.boost);
      assert.equal(car.jumps, telemetry.jumps);
      assert.equal(car.grounded, telemetry.grounded);
      assert.equal(car.jumpState, telemetry.jumpState);
      assert.deepEqual(car.actionSerials, telemetry.actionSerials);
      assert.equal(car.boosting, telemetry.boosting);
      assert.equal(car.powerslide, telemetry.powerslide);
      assert.deepEqual(car.angularVelocity, telemetry.angularVelocity);
      assert.ok(["air", "ground", "wall", "ceiling"].includes(car.surfaceType));
    }
  } finally {
    host.close();
  }
});

test("P2P-WASM-42 keeps v2 interpolation presentation-only and rejects stale or wrong-context frames", async () => {
  const host = await createP2PWasmCombatHost();
  try {
    assert.equal(host.setHostCommand(command({ controls: { ...idle, throttle: .3 } })).accepted, true);
    const first = await nextEnvelope(host, 1, 1);
    const second = await nextEnvelope(host, 2, 2);
    const buffer = new P2PWasmPresentationRenderBuffer({ ...context, delay: 0, now: () => 0 });
    buffer.push(first, 0);
    const pushed = buffer.push(second, 1 / 60);
    const sampled = buffer.sample(1 / 60);
    assert.equal(pushed.settings.p2pPresentationProtocol, P2P_WASM_PRESENTATION_PROTOCOL_VERSION);
    assert.equal(sampled.settings.p2pPresentationProtocol, P2P_WASM_PRESENTATION_PROTOCOL_VERSION);
    assert.ok(sampled.cars.every(car => car.orientation && Number.isFinite(car.orientation.w)));
    assert.throws(() => buffer.push(second, 2 / 60), /secuencia repetida o atrasada/);
    const replay = structuredClone(second);
    replay.sequence = 1;
    assert.throws(() => buffer.push(replay, 2 / 60), /secuencia repetida o atrasada/);
    assert.throws(() => createP2PWasmPresentationRenderState(first, { ...context, roomId: "other" }), /no coincide/);
    const malformed = structuredClone(first);
    malformed.presentation[0].orientation.w = 0;
    assert.throws(() => createP2PWasmPresentationRenderState(malformed, context), /no cumple/);
    buffer.close();
    assert.equal(buffer.sample(1), null);
  } finally {
    host.close();
  }
});

test("P2P-WASM-42 requires an explicit room and session context for the render buffer", () => {
  assert.throws(() => new P2PWasmPresentationRenderBuffer({ delay: 0 }), /configuración del buffer causal v5/);
});

test("P2P-WASM-49 delegates Car/Enemy framing to the shared stateful camera policy", () => {
  const local = { id: "p2p-host", x: 0, h: 0, z: 0, speed: 0, grounded: true, surfaceType: "ground", wallRide: false, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const rival = { id: "p2p-pilot", x: 12, h: 0, z: 0, alive: true, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const state = createP2PWasmCameraFramingState();
  const carCam = stepP2PWasmCameraFrame(state, { focusCar: local, dt: 1 / 60 });
  assert.ok(carCam.position.x < 0, "identity attitude points the camera behind +X");
  assert.ok(Math.abs(carCam.position.z) < 1e-9);
  assert.ok(carCam.focus.x > 0, "Car Cam leads the local car");
  const firstEnemy = stepP2PWasmCameraFrame(state, { focusCar: local, targetCar: rival, dt: 1 / 60 });
  assert.ok(firstEnemy.enemyBlend > 0 && firstEnemy.enemyBlend < 1, "Enemy Cam acquires through the shared transition");
  assert.equal(firstEnemy.fov, carCam.fov, "Car/Enemy toggle keeps the same projection");
  assert.ok(Math.hypot(firstEnemy.position.x - carCam.position.x, firstEnemy.position.z - carCam.position.z) < 1, "Enemy entry remains continuous around the local car");
  let enemy = firstEnemy;
  for (let frame = 0; frame < 240; frame += 1) enemy = stepP2PWasmCameraFrame(state, { focusCar: local, targetCar: rival, dt: 1 / 60 });
  assert.ok(enemy.enemyBlend > .999);
  assert.equal(enemy.followDistance, carCam.followDistance, "settled Enemy Cam preserves the Car-Cam boom distance");
  const quarterTurn = { ...local, orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } };
  const turned = stepP2PWasmCameraFrame(createP2PWasmCameraFramingState(), { focusCar: quarterTurn, dt: 1 / 60 });
  assert.ok(turned.position.z > 0, "the camera offset rotates with the car yaw");
  assert.ok(Math.abs(turned.position.x) < 1e-9);
});

test("P2P-WASM-49 forwards authoritative support normals into the shared camera policy", () => {
  const state = createP2PWasmCameraFramingState();
  const wall = {
    id: "p2p-host", x: 0, h: 4, z: 0, speed: 12, grounded: true,
    surfaceType: "wall", wallRide: true, surfaceNormal: { x: -1, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  const frame = stepP2PWasmCameraFrame(state, { focusCar: wall, dt: 1 / 60 });
  assert.ok(frame.up.x < -.05, "a wall snapshot changes the view up vector through the adapter");
  assert.ok(frame.up.y > 0 && Number.isFinite(frame.up.z));
});

test("P2P-WASM-50 derives the diagnostic combat-alpha footprint from the shared arena profile", () => {
  const profile = rocketSimArenaProfile("combat-alpha");
  const scene = createP2PWasmArenaPresentationSpec("combat-alpha");
  const toScene = value => value / ROCKETSIM_PRACTICE_SCALE * P2P_WASM_SCENE_UNITS_PER_UU;
  assert.equal(scene.arena, "combat-alpha");
  assert.ok(Math.abs(scene.halfWidth - toScene(profile.halfWidth)) < 1e-12);
  assert.ok(Math.abs(scene.halfDepth - toScene(profile.halfDepth)) < 1e-12);
  assert.ok(Math.abs(scene.height - toScene(profile.height)) < 1e-12);
  assert.ok(Math.abs(scene.width - scene.halfWidth * 2) < 1e-12);
  assert.ok(Math.abs(scene.depth - scene.halfDepth * 2) < 1e-12);
  assert.throws(() => createP2PWasmArenaPresentationSpec("unknown-arena"), /no existe/);
});

test("ONLINE-PARITY-01 keeps full-match Arsenal snapshots in the local client coordinate space", () => {
  const profile = rocketSimArenaProfile("combat-alpha");
  const scene = createP2PWasmArenaPresentationSpec("combat-alpha", {
    coordinateSpace: P2P_WASM_PRESENTATION_COORDINATE_SPACES.ARSENAL_WORLD,
  });
  assert.equal(scene.coordinateSpace, "arsenal-world");
  assert.equal(scene.halfWidth, profile.halfWidth);
  assert.equal(scene.halfDepth, profile.halfDepth);
  assert.equal(scene.height, profile.height);
  assert.equal(p2pWasmPresentationUnits(47.96, { coordinateSpace: "arsenal-world" }), 47.96);
  assert.throws(() => p2pWasmPresentationUnits(1, { coordinateSpace: "unknown" }), /no existe/);
});

test("ONLINE-PLAYABLE-FEEDBACK-01 derives visible presentation limits from the shared combat footprint", () => {
  const spec = createP2PWasmArenaPresentationSpec("combat-alpha");
  const limits = createP2PWasmPresentationLimits(spec);
  assert.equal(limits.minX, -spec.halfWidth);
  assert.equal(limits.maxX, spec.halfWidth);
  assert.equal(limits.minZ, -spec.halfDepth);
  assert.equal(limits.maxZ, spec.halfDepth);
  assert.equal(limits.maxY, spec.height);
  assert.match(limits.readout, /COMBAT-ALPHA/);
  assert.throws(() => createP2PWasmPresentationLimits({ halfWidth: 1, halfDepth: 0, height: 1 }), /límites visuales/);
});

test("ONLINE-PLAYABLE-FEEDBACK-01 bounds immutable visual event feedback without changing combat data", () => {
  const events = Array.from({ length: P2P_WASM_EVENT_FEEDBACK_CAPACITY + 3 }, (_, index) => ({
    kind: index % 2 ? "fire" : "hit", text: `evento-${index}`, at: index,
  }));
  const summary = summarizeP2PWasmEventFeedback(events);
  assert.equal(summary.length, P2P_WASM_EVENT_FEEDBACK_CAPACITY);
  assert.equal(summary[0].text, "evento-3");
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(summary[0]));
  assert.deepEqual(events[0], { kind: "hit", text: "evento-0", at: 0 });
  assert.equal(P2P_WASM_ROCKET_POOL_CAPACITY, 16);
});

test("P2P-WASM-42 browser smoke is opt-in and exposes only exact new renderer resources", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-p2p-causal-presentation-smoke.html", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-42/);
  assert.match(page, /__arsenalWasmBrowserP2PCausalPresentationSmoke/);
  assert.match(page, /P2PWasmPresentationRenderBuffer/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-presentation-smoke.html"), "browser-p2p-causal-presentation-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-presentation-render-state.mjs"), "p2p-wasm-presentation-render-state.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-arena-presentation.mjs"), "p2p-wasm-arena-presentation.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-camera-framing.mjs"), "p2p-wasm-camera-framing.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-causal-combat-presentation-protocol.mjs"), "p2p-wasm-causal-combat-presentation-protocol.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-aim-targeting.js"), "@src/p2p-aim-targeting.js");
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-presentation-smoke.html?cache=1"), null);
  assert.equal(resolveWasmSmokeResource("POST", "/p2p-wasm-presentation-render-state.mjs"), null);
});

test("P2P-WASM-44 keeps the Three.js presentation smoke isolated and allowlisted", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-p2p-causal-presentation-three-smoke.html", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-44/);
  assert.match(renderer, /WebGLRenderer/);
  assert.match(renderer, /createP2PWasmArenaPresentationSpec/);
  assert.match(renderer, /updateRockets\(state\.rockets\)/);
  assert.match(renderer, /updateEvents\(state\.events\)/);
  assert.match(renderer, /P2P_WASM_ROCKET_POOL_CAPACITY/);
  assert.match(page, /focusCarId: "p2p-host"/);
  assert.match(page, /p2p-wasm-three-presentation-renderer/);
  assert.match(page, /__arsenalWasmBrowserP2PCausalPresentationThreeSmoke/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-presentation-three-smoke.html"), "browser-p2p-causal-presentation-three-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/node_modules/three/build/three.module.js"), "@project/node_modules/three/build/three.module.js");
  assert.equal(resolveWasmSmokeResource("GET", "/node_modules/three/build/three.module.js?cache=1"), null);
  assert.equal(resolveWasmSmokeResource("GET", "/node_modules/three/build/three.core.js"), "@project/node_modules/three/build/three.core.js");
  assert.equal(resolveWasmSmokeResource("GET", "/node_modules/three/build/three.tsl.js"), null);
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-three-presentation-renderer.mjs"), "p2p-wasm-three-presentation-renderer.mjs");
});
