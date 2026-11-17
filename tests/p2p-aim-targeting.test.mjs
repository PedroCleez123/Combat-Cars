import assert from "node:assert/strict";
import test from "node:test";

import { chooseP2PAimTarget, collectP2PAimCandidates } from "../src/p2p-aim-targeting.js";

const local = Object.freeze({ id: "p2p-host", team: "blue", x: 0, h: 2, z: 0, hp: 100, respawn: 0, alive: true, orientation: { x: 0, y: 0, z: 0, w: 1 } });
const rival = Object.freeze({ id: "p2p-pilot", team: "red", x: 20, h: 2, z: 0, hp: 100, respawn: 0, alive: true, deaths: 2 });

test("P2P aim acquisition matches the local range, forward-cone and viewport gates", () => {
  const candidates = collectP2PAimCandidates({
    cars: [local, rival],
    focusCarId: "p2p-host",
    project: () => ({ x: .15, y: -.1, z: .4 }),
  });
  assert.deepEqual(candidates, [{ id: "p2p-pilot", eligible: true, screenVisible: true, distance: 20, screenDistance: .0325, deaths: 2 }]);
  assert.ok(Object.isFrozen(candidates));
  assert.ok(Object.isFrozen(candidates[0]));
});

test("P2P aim acquisition rejects offscreen, behind and out-of-range opponents without changing their live state", () => {
  const rejected = [
    { ...rival, x: -20 },
    { ...rival, x: 91 },
    rival,
  ];
  const projects = [() => ({ x: 0, y: 0, z: 0 }), () => ({ x: 0, y: 0, z: 0 }), () => ({ x: 1.01, y: 0, z: .2 })];
  for (const [index, target] of rejected.entries()) {
    const candidate = collectP2PAimCandidates({ cars: [local, target], focusCarId: local.id, project: projects[index] })[0];
    assert.equal(candidate.eligible, false);
    assert.equal(target.alive, true);
  }
});

test("P2P aim acquisition chooses the eligible reticle candidate instead of roster order", () => {
  const candidates = [
    { id: "far", eligible: true, screenDistance: .36, distance: 10 },
    { id: "near-reticle", eligible: true, screenDistance: .04, distance: 50 },
    { id: "ally", eligible: true, screenDistance: .01, distance: 2 },
    { id: "dead", eligible: false, screenDistance: 0, distance: 1 },
  ];
  assert.equal(chooseP2PAimTarget(candidates, ["far", "near-reticle", "dead"]), "near-reticle");
  assert.equal(chooseP2PAimTarget(candidates, new Set(["ally"])), "ally");
  assert.equal(chooseP2PAimTarget(candidates, ["dead"]), null);
});

test("P2P aim acquisition treats FFA pilots as enemies", () => {
  const ffaLocal = { ...local, team: null };
  const ffaRival = { ...rival, team: null };
  const candidates = collectP2PAimCandidates({
    cars: [ffaLocal, ffaRival],
    focusCarId: ffaLocal.id,
    project: () => ({ x: 0, y: 0, z: .4 }),
  });
  assert.equal(candidates[0]?.eligible, true);
});
