import assert from "node:assert/strict";
import test from "node:test";

import { createP2PBoostMeter } from "../src/p2p-boost-meter.js";

function classList() {
  const values = new Set();
  return {
    toggle(name, active) { if (active) values.add(name); else values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function meterRoot() {
  const root = {
    attributes: new Map(),
    classList: classList(),
    querySelector(selector) {
      if (selector === "[data-p2p-boost-meter]") return meter;
      if (selector === "[data-p2p-boost-fill]") return fill;
      if (selector === "[data-p2p-boost-value]") return value;
      return null;
    },
  };
  const meter = { attributes: new Map(), classList: classList(), setAttribute(name, value) { this.attributes.set(name, String(value)); }, removeAttribute(name) { this.attributes.delete(name); } };
  const fill = { style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); } } };
  const value = { textContent: "" };
  return { root, meter, fill, value };
}

test("boost meter exposes Rocket Arena-style value, unlimited and spending states", () => {
  const { root, meter, fill, value } = meterRoot();
  const hud = createP2PBoostMeter(root);
  assert.ok(hud);

  hud.update(42.4, true, false);
  assert.equal(value.textContent, "42");
  assert.equal(meter.attributes.get("aria-valuenow"), "42");
  assert.equal(fill.style.values.get("--boost-level"), "42%");
  assert.equal(fill.style.values.get("--boost-sweep"), "94.5deg");
  assert.equal(meter.classList.contains("is-firing"), true);
  assert.equal(meter.classList.contains("is-unlimited"), false);

  hud.update(-5, true, false);
  assert.equal(value.textContent, "0");
  assert.equal(meter.classList.contains("is-empty"), true);
  assert.equal(meter.classList.contains("is-firing"), false, "empty nitro cannot show a spending effect");

  hud.update(10, true, true);
  assert.equal(value.textContent, "∞");
  assert.equal(meter.attributes.get("aria-valuenow"), "100");
  assert.equal(meter.attributes.get("aria-valuetext"), "Nitro infinito");
  assert.equal(meter.classList.contains("is-unlimited"), true);
  assert.equal(meter.classList.contains("is-firing"), false, "infinite practice has no depletion pulse");
});

test("boost meter avoids rewriting the dial when its authoritative value is unchanged", () => {
  const { root, fill } = meterRoot();
  const hud = createP2PBoostMeter(root);
  hud.update(25, false, false);
  const firstWrites = fill.style.values.size;
  hud.update(25.1, false, false);
  assert.equal(fill.style.values.size, firstWrites);
});
