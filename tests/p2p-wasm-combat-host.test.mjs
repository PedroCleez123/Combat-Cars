import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createP2PWasmCombatHost,
  normalizeP2PWasmCombatCommand,
  P2P_WASM_COMBAT_FIXED_DT,
} from "../tools/wasm-spike/p2p-wasm-combat-host.mjs";
import { createP2PFullWasmCombatHost } from "../tools/wasm-spike/p2p-wasm-full-combat-host.mjs";
import {
  P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  P2P_WASM_HOST_FIXTURES,
} from "../tools/wasm-spike/p2p-wasm-host-match.mjs";
import { ROCKETSIM_PRACTICE_SCALE } from "../src/rocketsim-practice-match.js";
import { resolveWasmSmokeFile, resolveWasmSmokeResource, wasmSmokeContentType } from "../tools/wasm-spike/browser-smoke-server.mjs";

const IDLE = Object.freeze({ throttle: 0, steer: 0, boost: false, jump: false });
const idleCommand = (overrides = {}) => ({ controls: { ...IDLE }, fire: false, targetId: null, ...overrides });

test("P2P-WASM-12 validates exact causal combat commands", () => {
  const valid = idleCommand();
  assert.deepEqual(normalizeP2PWasmCombatCommand(valid), valid);
  assert.equal(normalizeP2PWasmCombatCommand({ ...valid, targetId: "other" }), null);
  assert.equal(normalizeP2PWasmCombatCommand({ ...valid, extra: true }), null);
  assert.equal(normalizeP2PWasmCombatCommand({ ...valid, controls: { ...IDLE, throttle: 2 } }), null);
  assert.deepEqual(normalizeP2PWasmCombatCommand({ ...valid, controls: { ...IDLE, throttle: -1 } }), { ...valid, controls: { ...IDLE, throttle: -1 } });
  assert.equal(normalizeP2PWasmCombatCommand({ ...valid, controls: { ...IDLE, throttle: -1.01 } }), null);
  assert.equal(normalizeP2PWasmCombatCommand({ ...valid, fire: 1 }), null);
});

test("P2P-WASM-12 rejects repeated pilot sequences and closes on invalid physical failure", async () => {
  const host = await createP2PWasmCombatHost();
  try {
    assert.equal(host.setHostCommand(idleCommand()).accepted, true);
    const first = host.receivePilotCommand({ sequence: 1, ...idleCommand() });
    assert.equal(first.accepted, true);
    assert.equal(first.snapshot.tick, 1);
    assert.equal(first.snapshot.lastInputSequence, 1);
    assert.equal(host.receivePilotCommand({ sequence: 1, ...idleCommand() }).accepted, false);
    assert.equal(host.receivePilotCommand({ sequence: 2, ...idleCommand(), extra: true }).accepted, false);
    assert.equal(host.snapshot().combat.events.length, 0);
  } finally {
    host.close();
  }
  assert.throws(() => host.snapshot(), /closed/);
});

test("P2P-WASM warm-up keeps one authoritative car topped up and promotes to active 1v1", async () => {
  const host = await createP2PFullWasmCombatHost({ warmup: true });
  try {
    const initial = await host.advance(1);
    assert.equal(initial.physical.length, 1);
    assert.equal(initial.presentation.length, 1);
    assert.equal(initial.combat.round.state, "waiting");

    assert.equal(host.setHostCommand(idleCommand({
      controls: { throttle: 1, steer: 0, boost: true, jump: false },
    })).accepted, true);
    await host.advance(120);
    assert.ok(host.presentationSnapshot().presentation[0].boost >= 99.9, "warm-up refill must be visible in authoritative snapshots");

    const promoted = await host.promoteToCombat("RIVAL");
    assert.equal(promoted.accepted, true);
    assert.equal(promoted.snapshot.physical.length, 2);
    assert.equal(promoted.snapshot.combat.round.state, "active");
    assert.equal(promoted.snapshot.combat.round.serial, 2);

    await host.advance(120);
    assert.ok(host.presentationSnapshot().presentation.find(car => car.id === "p2p-host").boost < 99.9, "active combat must consume boost again");
  } finally {
    host.close();
  }
});

test("P0-D preserves the local jump and dodge edge sequence through the full WASM host", async () => {
  const host = await createP2PFullWasmCombatHost({ warmup: true });
  const idle = {
    throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0,
    boost: false, jump: false, drift: false, airRoll: false, handbrake: false,
  };
  const command = controls => idleCommand({ controls });
  try {
    assert.equal(host.setHostCommand(command(idle)).accepted, true);
    await host.advance(1);

    const firstJump = { ...idle, jump: true };
    assert.equal(host.setHostCommand(command(firstJump)).accepted, true);
    const jumped = await host.advance(1);
    const jumpedCar = jumped.presentation.find(car => car.id === "p2p-host");
    assert.equal(jumpedCar.actionSerials.jump, 1);
    assert.equal(jumpedCar.jumps, 1);

    let airborne = jumped;
    for (let tick = 0; tick < 8 && airborne.presentation.find(car => car.id === "p2p-host")?.grounded; tick += 1) {
      host.setHostCommand(command(idle));
      airborne = await host.advance(1);
    }
    assert.equal(airborne.presentation.find(car => car.id === "p2p-host")?.grounded, false);

    const dodge = {
      ...idle,
      throttle: 1, steer: 1, pitch: -1, yaw: 0, roll: 1,
      jump: true, drift: true, airRoll: true, handbrake: true,
    };
    assert.equal(host.setHostCommand(command(dodge)).accepted, true);
    const dodged = await host.advance(1);
    const dodgedCar = dodged.presentation.find(car => car.id === "p2p-host");
    assert.equal(dodgedCar.actionSerials.dodge, 1);
    assert.equal(dodgedCar.jumpState, "dodge");
  } finally {
    host.close();
  }
});

test("P2P-WASM-18 allows the causal diagnostic host to opt into the validated combat-alpha pair", async () => {
  const host = await createP2PWasmCombatHost({ fixture: P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR });
  try {
    assert.equal(host.setHostCommand(idleCommand()).accepted, true);
    const result = host.receivePilotCommand({ sequence: 1, ...idleCommand() });
    assert.equal(result.accepted, true);
    assert.equal(result.snapshot.tick, 1);
    assert.equal(result.snapshot.physical.length, 2);
    const physicalHost = result.snapshot.physical.find(car => car.id === "p2p-host");
    const physicalPilot = result.snapshot.physical.find(car => car.id === "p2p-pilot");
    assert.ok(physicalHost.x < -1400 && physicalHost.z < -1200);
    assert.ok(physicalPilot.x > 1900 && physicalPilot.z > 1200);
    assert.equal(result.snapshot.combat.rockets.length, 0, "fixture selection must not synthesize combat events");
  } finally {
    host.close();
  }
});

test("P2P-WASM-40 keeps extended presentation telemetry separate from the compact combat snapshot", async () => {
  const host = await createP2PWasmCombatHost({ fixture: P2P_WASM_HOST_FIXTURES.COMBAT_ALPHA_PAIR });
  try {
    assert.equal(host.setHostCommand(idleCommand()).accepted, true);
    const first = host.receivePilotCommand({ sequence: 1, ...idleCommand() });
    assert.equal(first.accepted, true);
    assert.equal(Object.hasOwn(first.snapshot, "presentation"), false);
    const presentation = host.presentationSnapshot();
    assert.equal(presentation.tick, first.snapshot.tick);
    assert.equal(presentation.lastInputSequence, first.snapshot.lastInputSequence);
    assert.equal(presentation.presentation.length, 2);
    assert.deepEqual(presentation.combat, first.snapshot.combat);
    assert.deepEqual(presentation.physical, first.snapshot.physical);
    assert.ok(presentation.presentation.every(car => car.orientation && Number.isFinite(car.boost)));
  } finally {
    host.close();
  }
});

test("P2P-WASM-12 drives causal fire, hit, elimination and respawn from real WASM positions", async () => {
  const host = await createP2PWasmCombatHost({
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
  });
  const events = [];
  let sequence = 0;
  let fired = false;
  let firstHit = false;
  let eliminated = false;
  let respawned = false;
  let releaseFire = false;
  const capturedTargetIds = [];
  let eliminatedPhysical = null;
  let respawnPhysical = null;
  let latest = null;
  try {
    assert.equal(host.setHostCommand(idleCommand()).accepted, true);
    for (let tick = 0; tick < 520 && !respawned; tick += 1) {
      const physical = latest?.physical;
      const hostX = physical?.find(car => car.id === "p2p-host")?.x ?? 0;
      const pilotX = physical?.find(car => car.id === "p2p-pilot")?.x ?? -600;
      const distance = Math.abs(pilotX - hostX) * ROCKETSIM_PRACTICE_SCALE;
      const targetVisible = hostX > pilotX && distance <= 90;
      const pilotState = latest?.combat.cars.find(car => car.id === "p2p-pilot");
      const cooldownReady = !pilotState || pilotState.rocketCooldown <= 0;
      const shouldFire = targetVisible && !releaseFire && (!fired || (firstHit && !eliminated && cooldownReady));
      const pilotThrottle = targetVisible ? 0 : 1;
      const command = idleCommand({
        controls: { ...IDLE, throttle: pilotThrottle },
        fire: shouldFire,
        targetId: "p2p-host",
      });
      latest = host.receivePilotCommand({ sequence: ++sequence, ...command }).snapshot;
      for (const rocket of latest.combat.rockets) if (rocket.targetId) capturedTargetIds.push(rocket.targetId);
      for (const event of latest.combat.events) events.push(event.kind);
      const firedThisTick = latest.combat.events.some(event => event.kind === "fire");
      if (firedThisTick) fired = true;
      if (latest.combat.events.some(event => event.kind === "hit")) firstHit = true;
      if (latest.combat.events.some(event => event.kind === "elimination")) {
        eliminated = true;
        eliminatedPhysical = latest.physical.find(car => car.id === "p2p-host");
      }
      if (latest.combat.events.some(event => event.kind === "respawn")) {
        respawned = true;
        respawnPhysical = latest.physical.find(car => car.id === "p2p-host");
      }
      releaseFire = firedThisTick;
    }
    assert.ok(latest, "the WASM host should produce a physical snapshot");
    assert.equal(latest.combat.events.every(event => typeof event.kind === "string"), true);
    assert.ok(events.includes("fire"), `expected a causal fire event, got ${events.join(",")}`);
    assert.ok(events.includes("hit"), `expected a causal hit event, got ${events.join(",")}`);
    assert.ok(events.includes("elimination"), `expected a causal elimination event, got ${events.join(",")}`);
    assert.ok(events.includes("respawn"), `expected a causal respawn event, got ${events.join(",")}`);
    assert.ok(events.indexOf("fire") < events.indexOf("hit"));
    assert.ok(events.indexOf("hit") < events.indexOf("elimination"));
    assert.ok(events.indexOf("elimination") < events.indexOf("respawn"));
    assert.ok(capturedTargetIds.length > 0, "a causal guided rocket should remain observable before impact");
    assert.ok(capturedTargetIds.every(targetId => targetId === "p2p-host"), "a captured rocket target must never retarget");
    assert.ok(eliminatedPhysical, "the eliminated combat car should have a physical snapshot");
    assert.ok(eliminatedPhysical.h <= -9_999, "an eliminated car must be physically deactivated");
    assert.ok(respawnPhysical, "the respawned combat car should have a physical snapshot");
    assert.ok(Math.abs(respawnPhysical.x) < 1, "a respawned host car must return to its spawn x");
    assert.ok(respawnPhysical.h > -1_000, "a respawned host car must leave the inactive sentinel position");
    assert.equal(latest.combat.cars.find(car => car.id === "p2p-host").hp, 100);
    assert.equal(latest.combat.cars.find(car => car.id === "p2p-pilot").hp, 100);
  } finally {
    host.close();
  }
  assert.equal(P2P_WASM_COMBAT_FIXED_DT, 1 / 60);
});

test("ONLINE-COMBAT-20 closes the authoritative round and ignores later combat intents", async () => {
  const host = await createP2PWasmCombatHost({
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
    combatOptions: { scoreToWin: 1 },
  });
  let sequence = 0;
  let latest = null;
  let releaseFire = false;
  const events = [];
  try {
    assert.equal(host.setHostCommand(idleCommand()).accepted, true);
    for (let tick = 0; tick < 520 && latest?.combat.round.state !== "complete"; tick += 1) {
      const physical = latest?.physical;
      const hostX = physical?.find(car => car.id === "p2p-host")?.x ?? 0;
      const pilotX = physical?.find(car => car.id === "p2p-pilot")?.x ?? -600;
      const distance = Math.abs(pilotX - hostX) * ROCKETSIM_PRACTICE_SCALE;
      const targetVisible = hostX > pilotX && distance <= 90;
      const pilotState = latest?.combat.cars.find(car => car.id === "p2p-pilot");
      const cooldownReady = !pilotState || pilotState.rocketCooldown <= 0;
      const shouldFire = targetVisible && !releaseFire && (!events.includes("fire") || events.includes("hit") && cooldownReady);
      latest = host.receivePilotCommand({
        sequence: ++sequence,
        ...idleCommand({
          controls: { ...IDLE, throttle: targetVisible ? 0 : 1 },
          fire: shouldFire,
          targetId: "p2p-host",
        }),
      }).snapshot;
      const tickEvents = latest.combat.events.map(event => event.kind);
      events.push(...tickEvents);
      releaseFire = tickEvents.includes("fire");
    }
    assert.ok(latest, "the host should publish a terminal snapshot");
    assert.equal(latest.combat.round.state, "complete");
    assert.equal(latest.combat.round.scoreToWin, 1);
    assert.equal(latest.combat.round.winner, "red");
    assert.ok(events.includes("elimination"), `expected an elimination, got ${events.join(",")}`);
    assert.ok(events.includes("winner"), `expected a winner event, got ${events.join(",")}`);
    assert.equal(latest.combat.rockets.length, 0);
    const scoreAtFinish = { ...latest.combat.score };
    const after = host.receivePilotCommand({
      sequence: ++sequence,
      ...idleCommand({ controls: { ...IDLE, throttle: 1 }, fire: true, targetId: "p2p-host" }),
    }).snapshot;
    assert.equal(after.combat.round.state, "complete");
    assert.deepEqual(after.combat.score, scoreAtFinish);
    assert.deepEqual(after.combat.events, []);
    assert.deepEqual(after.combat.rockets, []);
  } finally {
    host.close();
  }
});

test("ONLINE-ROUND-21 ignores legacy restart commands after a completed round", async () => {
  const host = await createP2PWasmCombatHost({
    maxVelocityComponent: P2P_WASM_HOST_DIAGNOSTIC_VELOCITY_COMPONENT,
    combatOptions: { scoreToWin: 1 },
  });
  let sequence = 0;
  let latest = null;
  let releaseFire = false;
  const events = [];
  try {
    assert.equal(host.setHostCommand(idleCommand()).accepted, true);
    for (let tick = 0; tick < 520 && latest?.combat.round.state !== "complete"; tick += 1) {
      const physical = latest?.physical;
      const hostX = physical?.find(car => car.id === "p2p-host")?.x ?? 0;
      const pilotX = physical?.find(car => car.id === "p2p-pilot")?.x ?? -600;
      const distance = Math.abs(pilotX - hostX) * ROCKETSIM_PRACTICE_SCALE;
      const targetVisible = hostX > pilotX && distance <= 90;
      const pilotState = latest?.combat.cars.find(car => car.id === "p2p-pilot");
      const cooldownReady = !pilotState || pilotState.rocketCooldown <= 0;
      const shouldFire = targetVisible && !releaseFire && (!events.includes("fire") || events.includes("hit") && cooldownReady);
      latest = host.receivePilotCommand({
        sequence: ++sequence,
        ...idleCommand({ controls: { ...IDLE, throttle: targetVisible ? 0 : 1 }, fire: shouldFire, targetId: "p2p-host" }),
      }).snapshot;
      const tickEvents = latest.combat.events.map(event => event.kind);
      events.push(...tickEvents);
      releaseFire = tickEvents.includes("fire");
    }
    assert.equal(latest?.combat.round.state, "complete");
    const previousSerial = latest.combat.round.serial;
    const ignored = host.receivePilotCommand({
      sequence: ++sequence,
      ...idleCommand({ restart: true }),
    }).snapshot;
    assert.equal(ignored.combat.round.state, "complete");
    assert.equal(ignored.combat.round.serial, previousSerial);
    assert.deepEqual(ignored.combat.score, latest.combat.score);
    assert.deepEqual(ignored.combat.events, []);
    assert.deepEqual(ignored.combat.rockets, []);
  } finally {
    host.close();
  }
});

test("P2P-WASM-14 consumes a causal host rocket on the real static wall before an out-of-bounds miss", async () => {
  const host = await createP2PWasmCombatHost();
  let sequence = 0;
  let intercepted = false;
  try {
    assert.equal(host.setHostCommand(idleCommand({ fire: true, targetId: null })).accepted, true);
    host.receivePilotCommand({ sequence: ++sequence, ...idleCommand() });
    assert.equal(host.setHostCommand(idleCommand()).accepted, true);
    for (let tick = 0; tick < 90 && !intercepted; tick += 1) {
      const result = host.receivePilotCommand({ sequence: ++sequence, ...idleCommand() });
      intercepted = result.snapshot.combat.events.some(event => event.kind === "miss" && event.text === "COHETE INTERCEPTADO");
    }
    assert.equal(intercepted, true, "the forward rocket should be consumed by the +X static wall");
    assert.equal(host.snapshot().combat.rockets.length, 0, "a static interception must remove the rocket");
  } finally {
    host.close();
  }
});

test("P2P-WASM-20 browser causal smoke remains opt-in and exposes only its exact source-module allowlist", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-p2p-causal-combat-smoke.html", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-20/);
  assert.match(page, /__arsenalWasmBrowserP2PCausalCombatSmoke/);
  assert.match(page, /COHETE INTERCEPTADO/);
  assert.match(page, /p2p-wasm-causal-combat-protocol\.mjs/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-combat-smoke.html"), "browser-p2p-causal-combat-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-combat-host.mjs"), "p2p-wasm-combat-host.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-causal-combat-protocol.mjs"), "p2p-wasm-causal-combat-protocol.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-host-clock.mjs"), "p2p-wasm-host-clock.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/src/rocketsim-combat.js"), "@src/rocketsim-combat.js");
  assert.match(resolveWasmSmokeFile("@src/rocketsim-combat.js"), /[\\/]src[\\/]rocketsim-combat\.js$/);
  assert.equal(wasmSmokeContentType("rocketsim-combat.js"), "text/javascript; charset=utf-8");
  assert.equal(wasmSmokeContentType("rocketsim_wasm.mjs"), "text/javascript; charset=utf-8");
  assert.equal(wasmSmokeContentType("unexpected.bin"), "application/octet-stream");
  assert.equal(resolveWasmSmokeResource("GET", "/src/client.js"), null);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-combat-smoke.html?cache=1"), null);
  assert.equal(resolveWasmSmokeResource("POST", "/src/rocketsim-combat.js"), null);
});

test("P2P-WASM-23 keeps its causal DataChannel browser gate opt-in and narrowly allowlisted", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-p2p-causal-combat-webrtc-smoke.html", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-23/);
  assert.match(page, /__arsenalWasmBrowserP2PCausalCombatWebRTCSmoke/);
  assert.match(page, /P2PWebRTCSession/);
  assert.match(page, /P2PWasmCausalCombatHostChannelSession/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-combat-webrtc-smoke.html"), "browser-p2p-causal-combat-webrtc-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-causal-combat-channel.mjs"), "p2p-wasm-causal-combat-channel.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-webrtc-session.js"), "@src/p2p-webrtc-session.js");
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-room-config.js"), "@src/p2p-room-config.js");
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-session-protocol.js"), "@src/p2p-session-protocol.js");
  assert.match(resolveWasmSmokeFile("@src/p2p-webrtc-session.js"), /[\\/]src[\\/]p2p-webrtc-session\.js$/);
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-match-channel.js"), null);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-combat-webrtc-smoke.html?cache=1"), null);
  assert.equal(resolveWasmSmokeResource("POST", "/p2p-wasm-causal-combat-channel.mjs"), null);
});

test("P2P-WASM-24 uses two opt-in Chromium contexts with a private local signaling boundary", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-p2p-causal-combat-webrtc-pair-smoke.html", import.meta.url), "utf8");
  assert.match(page, /P2P-WASM-24/);
  assert.match(page, /P2P-WASM-27/);
  assert.match(page, /P2P-WASM-30/);
  assert.match(page, /P2P-WASM-31/);
  assert.match(page, /P2PWasmCausalRoomSession/);
  assert.match(page, /P2PWasmRenderBuffer/);
  assert.match(page, /createP2PWasmCombatHost/);
  assert.doesNotMatch(page, /new P2PWebRTCSession/);
  assert.doesNotMatch(page, /P2PWasmCausalCombatHostChannelSession/);
  assert.match(page, /BroadcastChannel/);
  assert.match(page, /#host/);
  assert.match(page, /#pilot/);
  assert.match(page, /__arsenalWasmBrowserP2PCausalCombatWebRTCPairSmoke/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-combat-webrtc-pair-smoke.html"), "browser-p2p-causal-combat-webrtc-pair-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/p2p-wasm-causal-room-session.mjs"), "p2p-wasm-causal-room-session.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-wasm-render-state.js"), "@src/p2p-wasm-render-state.js");
  assert.equal(resolveWasmSmokeResource("GET", "/src/snapshot-interpolation.js"), "@src/snapshot-interpolation.js");
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-webrtc-session.js"), "@src/p2p-webrtc-session.js");
  assert.equal(resolveWasmSmokeResource("GET", "/src/p2p-signaling-client.js"), null);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-p2p-causal-combat-webrtc-pair-smoke.html?role=host"), null);
});

