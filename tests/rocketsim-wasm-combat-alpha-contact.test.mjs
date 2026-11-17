import test from "node:test";
import assert from "node:assert/strict";
import {
  COMBAT_ALPHA_CONTACT_BOUNDS,
  COMBAT_ALPHA_CONTACT_SCALE,
  captureWasmCombatAlphaRampDescentTrace,
  captureWasmCombatAlphaRampJumpTrace,
  captureWasmCombatAlphaWallTrace,
} from "../tools/wasm-spike/combat-alpha-contact-trace.mjs";

const { halfWidthUnits, halfDepthUnits, heightUnits, curveRadiusUnits } = COMBAT_ALPHA_CONTACT_BOUNDS;
const toUnits = value => value * COMBAT_ALPHA_CONTACT_SCALE;
const maxOf = (samples, read) => Math.max(...samples.map(read));
const minOf = (samples, read) => Math.min(...samples.map(read));

function heightAboveRest(sample, restHeight) {
  return toUnits(sample.state.position.y - restHeight);
}

function angleBetween(left, right) {
  const dot = left.x * right.x + left.y * right.y + left.z * right.z;
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

function assertInsideShell(trace, label) {
  const restHeight = trace.samples[0].state.position.y;
  const halfWidth = halfWidthUnits / COMBAT_ALPHA_CONTACT_SCALE;
  const halfDepth = halfDepthUnits / COMBAT_ALPHA_CONTACT_SCALE;
  const ceiling = restHeight + heightUnits / COMBAT_ALPHA_CONTACT_SCALE;
  const maxAbsX = maxOf(trace.samples, sample => Math.abs(sample.state.position.x));
  const maxAbsZ = maxOf(trace.samples, sample => Math.abs(sample.state.position.z));
  const maxHeight = maxOf(trace.samples, sample => sample.state.position.y);
  const minHeight = minOf(trace.samples, sample => sample.state.position.y);
  assert.ok(maxAbsX <= halfWidth + 0.5,
    `${label} crossed the +X/-X shell: max |x| ${maxAbsX.toFixed(2)} > ${halfWidth.toFixed(2)} UU`);
  assert.ok(maxAbsZ <= halfDepth + 0.5,
    `${label} crossed the +Z/-Z shell: max |z| ${maxAbsZ.toFixed(2)} > ${halfDepth.toFixed(2)} UU`);
  assert.ok(maxHeight <= ceiling + 0.5,
    `${label} crossed the ceiling: max height ${maxHeight.toFixed(2)} > ${ceiling.toFixed(2)} UU`);
  assert.ok(minHeight >= restHeight - 2,
    `${label} penetrated the floor: min height ${minHeight.toFixed(2)} < ${(restHeight - 2).toFixed(2)} UU`);
  return { restHeight, halfWidth, halfDepth, ceiling, maxAbsX, maxAbsZ, maxHeight, minHeight };
}

test("combat-alpha fast wall impact stays inside the expanded authoritative shell", async () => {
  const trace = await captureWasmCombatAlphaWallTrace();
  assert.equal(trace.fixture, "combat-alpha-contact-wall-r1");
  assert.equal(trace.samples.length, 900);
  const { restHeight, halfWidth, maxAbsX } = assertInsideShell(trace, "wall trace");

  const maxSpeed = maxOf(trace.samples, sample => Math.hypot(
    sample.state.velocity.x, sample.state.velocity.y, sample.state.velocity.z));
  assert.ok(maxSpeed >= 2100, `wall trace never reached a fast impact (${maxSpeed.toFixed(1)} UU/s)`);
  assert.ok(maxAbsX > halfWidth - curveRadiusUnits / COMBAT_ALPHA_CONTACT_SCALE,
    "wall trace never reached the curved boundary");

  const lowerWallSupport = trace.samples.find(sample => sample.wheelCount > 0
    && sample.support.normal.x < -0.5
    && sample.state.position.x > halfWidth - 2 * curveRadiusUnits / COMBAT_ALPHA_CONTACT_SCALE);
  assert.ok(lowerWallSupport, "wall trace never received inward-facing lower-curve wheel support");
  assert.ok(heightAboveRest(lowerWallSupport, restHeight) > 0.5,
    "lower-curve support was recorded before the car left the floor");
});

test("combat-alpha floor-to-wall transition is continuous through both quarter-pipes", async () => {
  const trace = await captureWasmCombatAlphaWallTrace();
  const restHeight = trace.samples[0].state.position.y;

  const firstInclined = trace.samples.find(sample => sample.wheelCount > 0
    && sample.support.normal.x < -0.05
    && sample.support.normal.y > 0.2
    && sample.support.normal.y < 0.97);
  assert.ok(firstInclined, "wall trace never received lower-curve support");
  assert.ok(heightAboveRest(firstInclined, restHeight) > 0.5,
    "lower-curve support was recorded before the car left the floor");

  const firstUpper = trace.samples.find(sample => sample.wheelCount > 0
    && sample.support.normal.y < -0.2
    && heightAboveRest(sample, restHeight) > 60);
  assert.ok(firstUpper, "wall trace never reached the upper ceil curve (missing upper-pipe support)");
  assert.ok(firstUpper.tick > firstInclined.tick, "upper-curve support was recorded before lower-curve support");

  const between = trace.samples.slice(firstInclined.tick - 1, firstUpper.tick);
  const supportGap = between.find(sample => sample.wheelCount === 0);
  assert.equal(supportGap, undefined,
    `floor-to-wall transition lost wheel support at tick ${supportGap?.tick}`);

  let maximumNormalStep = 0;
  let previousSupport = null;
  for (const sample of between) {
    if (!sample.support.hasContact) continue;
    if (previousSupport) maximumNormalStep = Math.max(maximumNormalStep, angleBetween(previousSupport, sample.support.normal));
    previousSupport = sample.support.normal;
  }
  assert.ok(maximumNormalStep <= 8,
    `floor-to-wall normal jumped ${maximumNormalStep.toFixed(2)} degrees between support samples`);
});

test("combat-alpha ramp approach and descent keep wheel contact without penetration", async () => {
  const trace = await captureWasmCombatAlphaRampDescentTrace();
  assert.equal(trace.fixture, "combat-alpha-contact-ramp-descent-r1");
  const { restHeight } = assertInsideShell(trace, "ramp descent trace");
  const xUnits = sample => toUnits(sample.state.position.x);
  const hUnits = sample => heightAboveRest(sample, restHeight);

  const slopeSupport = trace.samples.filter(sample => sample.wheelCount > 0
    && Math.abs(xUnits(sample)) <= 12
    && hUnits(sample) >= 0.2
    && hUnits(sample) <= 3.5
    && sample.support.normal.y > 0.9
    && Math.abs(sample.support.normal.x) > 0.03);
  assert.ok(slopeSupport.length >= 12, `ramp descent only recorded ${slopeSupport.length} supported slope samples`);

  const rampSamples = trace.samples.filter(sample => Math.abs(xUnits(sample)) <= 10 && hUnits(sample) > 0.1);
  assert.ok(rampSamples.length >= 20, "ramp descent never traversed the ramp surface");
  const lostWheel = rampSamples.find(sample => sample.wheelCount < 2);
  assert.equal(lostWheel, undefined, `ramp descent lost wheel contact at tick ${lostWheel?.tick}`);

  const maximumHeight = maxOf(trace.samples, hUnits);
  assert.ok(maximumHeight >= 3, `ramp descent only reached ${maximumHeight.toFixed(2)} units of height`);
  assert.ok(hUnits(trace.samples.at(-1)) <= 0.25,
    `ramp descent did not return to the floor (${hUnits(trace.samples.at(-1)).toFixed(2)} units)`);
  assert.ok(minOf(trace.samples, hUnits) >= -0.1,
    `ramp descent penetrated the floor (${minOf(trace.samples, hUnits).toFixed(2)} units)`);
  assert.ok(trace.samples.some(sample => sample.input.throttle === -1 && sample.state.velocity.x < -5),
    "ramp descent never reversed back down the slope");
});

test("combat-alpha ramp jump remains contained after the launch", async () => {
  const trace = await captureWasmCombatAlphaRampJumpTrace();
  assert.equal(trace.fixture, "combat-alpha-contact-ramp-jump-r1");
  const { maxAbsX } = assertInsideShell(trace, "ramp jump trace");
  assert.ok(toUnits(maxAbsX) > 40, "ramp jump trace never launched past the ramp");
});
