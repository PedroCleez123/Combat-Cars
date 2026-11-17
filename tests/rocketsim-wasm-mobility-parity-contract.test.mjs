import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILITY_PARITY_FIXTURE,
  MOBILITY_PARITY_FRAME_COUNT,
  WALL_HORIZON_FIXTURE,
  WALL_HORIZON_FRAME_COUNT,
  compareMobilityParityTraces,
  compareWallHorizonTraces,
} from "../tools/wasm-spike/mobility-parity-trace.mjs";

const vector = (x = 0, y = 0, z = 0) => ({ x, y, z });

function mobilityTrace() {
  const samples = Array.from({ length: MOBILITY_PARITY_FRAME_COUNT }, (_, index) => {
    const tick = index + 1;
    const airborne = tick >= 31 && tick < 100;
    const flipped = tick >= 35 && tick <= 42;
    const grounded = !airborne;
    return {
      tick,
      input: {
        throttle: tick >= 30 ? 1 : 0,
        steer: tick >= 181 ? 0.7 : 0,
        pitch: tick >= 30 ? -1 : 0,
        yaw: tick >= 181 ? 0.7 : 0,
        roll: 0,
        jump: tick === 6 || tick === 30,
        boost: tick >= 45,
        drift: false,
        airRoll: false,
      },
      state: {
        position: vector(tick, grounded ? 0 : 10, 0),
        velocity: vector(1, airborne ? 1 : 0, 0),
        orientation: { x: 0, y: 0, z: 0, w: 1 },
        boost: 100,
        grounded,
        wheelCount: grounded ? 4 : 0,
        jumps: airborne ? 1 : 0,
        localAngularVelocity: { pitch: 0, yaw: 0, roll: 0 },
        wheelContact: { hasContact: grounded, normal: vector(0, 1, 0) },
        worldContact: { hasContact: false, normal: vector() },
        actionFlags: { hasJumped: tick >= 6, hasDoubleJumped: false, hasFlipped: flipped },
        secondJumpWindow: 0,
        dodgeTime: flipped ? 0.01 : 0,
        dodgeDirection: { forward: flipped ? 1 : 0, side: 0 },
      },
      bodyContact: { hasContact: false, normal: vector() },
    };
  });
  return { fixture: MOBILITY_PARITY_FIXTURE, fixedStepHz: 120, samples };
}

function wallTrace() {
  const samples = Array.from({ length: WALL_HORIZON_FRAME_COUNT }, (_, index) => {
    const tick = index + 1;
    const hasContact = tick >= 40;
    return {
      tick,
      input: { throttle: 1, steer: 0, pitch: -1, yaw: 0, roll: 0, jump: false, boost: true, drift: false, airRoll: false },
      state: {
        position: vector(tick * 2, 0, 0),
        velocity: vector(100, 0, 0),
        grounded: !hasContact,
      },
      bodyContact: { hasContact, normal: hasContact ? vector(-1, 0, 0) : vector() },
    };
  });
  return { fixture: WALL_HORIZON_FIXTURE, fixedStepHz: 120, samples };
}

test("R20/WASM mobility contract accepts the shared dodge and landing tape", () => {
  const wasm = mobilityTrace();
  const native = structuredClone(wasm);
  const report = compareMobilityParityTraces(wasm, native);

  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.dodgeTick, 35);
  assert.equal(report.landingTick, 100);
  assert.equal(report.frames, MOBILITY_PARITY_FRAME_COUNT);
});

test("R20/WASM mobility contract rejects physical drift and a missing landing", () => {
  const wasm = mobilityTrace();
  const drifted = structuredClone(wasm);
  drifted.samples[120].state.position.x += 0.101;
  const driftReport = compareMobilityParityTraces(wasm, drifted);
  assert.equal(driftReport.ok, false);
  assert.ok(driftReport.maximum.position > 0.1);

  const noLanding = structuredClone(wasm);
  for (const sample of noLanding.samples) sample.state.grounded = true;
  const landingReport = compareMobilityParityTraces(noLanding, noLanding);
  assert.equal(landingReport.ok, false);
  assert.ok(landingReport.mismatches.includes("landing edge was not observed"));
});

test("R20/WASM wall contract requires contact and enforces contact-normal tolerance", () => {
  const wasm = wallTrace();
  const native = structuredClone(wasm);
  const report = compareWallHorizonTraces(wasm, native);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.firstContactTick, 40);

  const wrongNormal = structuredClone(native);
  wrongNormal.samples[39].bodyContact.normal.y = 0.051;
  const normalReport = compareWallHorizonTraces(wasm, wrongNormal);
  assert.equal(normalReport.ok, false);
  assert.ok(normalReport.maximum.contactNormal > 0.05);

  const noContact = structuredClone(wasm);
  for (const sample of noContact.samples) sample.bodyContact.hasContact = false;
  const contactReport = compareWallHorizonTraces(noContact, noContact);
  assert.equal(contactReport.ok, false);
  assert.ok(contactReport.mismatches.includes("wall contact was not observed"));
});
