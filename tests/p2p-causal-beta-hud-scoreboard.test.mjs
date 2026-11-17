import test from "node:test";
import assert from "node:assert/strict";
import { renderP2PCausalBetaHud } from "../src/p2p-causal-beta-hud.js";

function element() {
  return {
    hidden: true,
    textContent: "",
    dataset: {},
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
}

function documentFor() {
  const ids = [
    "causal-hud", "causal-hud-score", "causal-hud-scoreboard", "causal-hud-scoreboard-mode",
    "causal-hud-scoreboard-blue", "causal-hud-scoreboard-red",
    ...Array.from({ length: 6 }, (_, index) => `causal-hud-scoreboard-row-${index}`),
    "causal-hud-role", "causal-hud-connection", "causal-hud-own", "causal-hud-rival",
    "causal-hud-event", "causal-hud-pads", "causal-hud-tick", "causal-hud-fps",
  ];
  const values = new Map(ids.map(id => [id, element()]));
  return { values, getElementById: id => values.get(id) };
}

function car(id, team, kills, name) {
  return { id, team, kills, name, alive: true };
}

test("HUD renders a compact 2v2 scoreboard with team totals and player names", () => {
  const documentRef = documentFor();
  renderP2PCausalBetaHud(documentRef, {
    score: { blue: 4, red: 2 },
    settings: { matchMode: "2v2" },
    cars: [
      car("p2p-host", "blue", 3, "Ana"),
      car("p2p-guest-1", "red", 1, "Luis"),
      car("p2p-guest-2", "blue", 1, "Marta"),
      car("p2p-guest-3", "red", 1, "Noa"),
    ],
  }, { role: "host" });
  const values = documentRef.values;
  assert.equal(values.get("causal-hud-scoreboard").hidden, false);
  assert.equal(values.get("causal-hud-scoreboard-mode").textContent, "2V2");
  assert.equal(values.get("causal-hud-scoreboard-blue").textContent, "AZUL 4");
  assert.equal(values.get("causal-hud-scoreboard-red").textContent, "ROJO 2");
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => values.get(`causal-hud-scoreboard-row-${index}`).textContent),
    ["Ana  3", "Marta  1", "Luis  1", "Noa  1"],
  );
  assert.doesNotMatch(values.get("causal-hud-scoreboard-row-0").textContent, /VIDA|NITRO|SUELO|AIRE/);
});

test("HUD renders an FFA scoreboard in authoritative sorted order", () => {
  const documentRef = documentFor();
  renderP2PCausalBetaHud(documentRef, {
    score: { "p2p-host": 2, "p2p-guest-1": 4, "p2p-guest-2": 1 },
    settings: { matchMode: "ffa" },
    rules: { freeForAll: true },
    cars: [
      car("p2p-host", null, 2, "Ana"),
      car("p2p-guest-1", null, 4, "Luis"),
      car("p2p-guest-2", null, 1, "Marta"),
    ],
  }, { role: "host" });
  const values = documentRef.values;
  assert.equal(values.get("causal-hud-scoreboard-mode").textContent, "FFA");
  assert.deepEqual(
    Array.from({ length: 3 }, (_, index) => values.get(`causal-hud-scoreboard-row-${index}`).textContent),
    ["Luis  4", "Ana  2", "Marta  1"],
  );
  assert.equal(values.get("causal-hud-scoreboard-blue").hidden, true);
  assert.equal(values.get("causal-hud-scoreboard-red").hidden, true);
});
