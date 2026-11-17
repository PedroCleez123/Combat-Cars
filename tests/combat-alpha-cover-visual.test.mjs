import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import {
  combatAlphaCoverVisualSpec,
  combatAlphaTirePileLayout,
  createCombatAlphaCoverVisuals,
} from "../src/arena-decoration.js";

test("COV-03 cover visual spec mirrors all six authoritative colliders", () => {
  const spec = combatAlphaCoverVisualSpec();
  assert.equal(spec.contract, "combat-alpha-cover-visual-v1");
  assert.equal(spec.visualOnly, true);
  assert.equal(spec.covers.length, 6);
  assert.deepEqual(spec.covers.map(cover => cover.id), [
    "container-cover-northwest",
    "container-cover-southwest",
    "container-cover-northeast",
    "container-cover-southeast",
    "tire-cover-blue",
    "tire-cover-red",
  ]);
  for (const cover of spec.covers) {
    assert.equal(cover.nativeColliderId, cover.id);
    assert.equal(cover.visualOnly, true);
    assert.equal("body" in cover, false);
    assert.equal("collider" in cover, false);
    assert.equal("pickup" in cover, false);
    assert.equal("p2p" in cover, false);
  }
  assert.deepEqual(spec.covers.find(cover => cover.id === "container-cover-northwest"), {
    id: "container-cover-northwest",
    nativeColliderId: "container-cover-northwest",
    visualOnly: true,
    visualKind: "container",
    x: -45,
    z: -58,
    width: 10,
    depth: 24,
    height: 6,
  });
  assert.deepEqual(spec.covers.find(cover => cover.id === "tire-cover-red"), {
    id: "tire-cover-red",
    nativeColliderId: "tire-cover-red",
    visualOnly: true,
    visualKind: "tires",
    x: 68,
    z: 30,
    width: 8,
    depth: 8,
    height: 4.8,
  });
  assert.ok(Object.isFrozen(spec));
  assert.ok(Object.isFrozen(spec.covers));
});

test("COV-06 derives a compact eight-level tire pile that fills each authoritative box", () => {
  const tireCovers = combatAlphaCoverVisualSpec().covers.filter(cover => cover.visualKind === "tires");
  assert.equal(tireCovers.length, 2);

  for (const cover of tireCovers) {
    const pile = combatAlphaTirePileLayout(cover);
    assert.equal(pile.columns, 4);
    assert.equal(pile.rows, 4);
    assert.equal(pile.levels, 8);
    assert.equal(pile.instances.length, 128);
    assert.equal(pile.tubeRadius, .3);
    assert.equal(pile.majorRadius, .7);
    const axisSteps = axis => {
      const values = [...new Set(pile.instances.map(instance => instance[axis]))].sort((a, b) => a - b);
      return values.slice(1).map((value, index) => value - values[index]);
    };
    assert.deepEqual(axisSteps("x").map(value => Number(value.toFixed(6))), [2, 2, 2]);
    assert.deepEqual(axisSteps("z").map(value => Number(value.toFixed(6))), [2, 2, 2]);
    assert.deepEqual(axisSteps("y").map(value => Number(value.toFixed(6))), [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);

    const minX = Math.min(...pile.instances.map(instance => instance.x + pile.localBounds.minX));
    const maxX = Math.max(...pile.instances.map(instance => instance.x + pile.localBounds.maxX));
    const minY = Math.min(...pile.instances.map(instance => instance.y + pile.localBounds.minY));
    const maxY = Math.max(...pile.instances.map(instance => instance.y + pile.localBounds.maxY));
    const minZ = Math.min(...pile.instances.map(instance => instance.z + pile.localBounds.minZ));
    const maxZ = Math.max(...pile.instances.map(instance => instance.z + pile.localBounds.maxZ));

    assert.ok(Math.abs(minX - (cover.x - cover.width / 2)) < 1e-9, `${cover.id} min X`);
    assert.ok(Math.abs(maxX - (cover.x + cover.width / 2)) < 1e-9, `${cover.id} max X`);
    assert.ok(Math.abs(minY) < 1e-9, `${cover.id} min Y`);
    assert.ok(Math.abs(maxY - cover.height) < 1e-9, `${cover.id} max Y`);
    assert.ok(Math.abs(minZ - (cover.z - cover.depth / 2)) < 1e-9, `${cover.id} min Z`);
    assert.ok(Math.abs(maxZ - (cover.z + cover.depth / 2)) < 1e-9, `${cover.id} max Z`);
  }
});

test("COV-03 builds visual-only instanced container and tire cover companions", () => {
  const parent = new THREE.Group();
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x16191a });
  const visual = createCombatAlphaCoverVisuals({ THREE, parent, materials: { tire: tireMaterial } });
  try {
    assert.equal(visual.root.parent, parent);
    assert.equal(visual.root.userData.visualOnly, true);
    assert.equal(visual.root.userData.nativeColliderCount, 6);
    assert.equal(visual.metrics().drawCalls, 3);
    assert.ok(visual.metrics().triangles <= 52_000);
    assert.equal(visual.metrics().tireInstanceCount, 256);
    assert.equal(visual.root.getObjectByName("combat-alpha-container-covers").isInstancedMesh, true);
    assert.equal(visual.root.getObjectByName("combat-alpha-container-hazard-bands").isInstancedMesh, true);
    assert.equal(visual.root.getObjectByName("combat-alpha-tire-covers").isInstancedMesh, true);
    const tireMesh = visual.root.getObjectByName("combat-alpha-tire-covers");
    tireMesh.geometry.computeBoundingBox();
    const localBounds = tireMesh.geometry.boundingBox;
    const corners = [];
    for (const x of [localBounds.min.x, localBounds.max.x]) {
      for (const y of [localBounds.min.y, localBounds.max.y]) {
        for (const z of [localBounds.min.z, localBounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    const matrix = new THREE.Matrix4();
    const expectedCovers = visual.spec.covers.filter(cover => cover.visualKind === "tires");
    const instancesPerCover = tireMesh.count / expectedCovers.length;
    for (const [coverIndex, cover] of expectedCovers.entries()) {
      const min = new THREE.Vector3(Infinity, Infinity, Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (let index = coverIndex * instancesPerCover; index < (coverIndex + 1) * instancesPerCover; index += 1) {
        tireMesh.getMatrixAt(index, matrix);
        for (const corner of corners) {
          const point = corner.clone().applyMatrix4(matrix);
          min.min(point);
          max.max(point);
        }
      }
      assert.ok(Math.abs(min.x - (cover.x - cover.width / 2)) < 1e-5, `${cover.id} rendered min X`);
      assert.ok(Math.abs(max.x - (cover.x + cover.width / 2)) < 1e-5, `${cover.id} rendered max X`);
      assert.ok(Math.abs(min.y) < 1e-5, `${cover.id} rendered min Y`);
      assert.ok(Math.abs(max.y - cover.height) < 1e-5, `${cover.id} rendered max Y`);
      assert.ok(Math.abs(min.z - (cover.z - cover.depth / 2)) < 1e-5, `${cover.id} rendered min Z`);
      assert.ok(Math.abs(max.z - (cover.z + cover.depth / 2)) < 1e-5, `${cover.id} rendered max Z`);
    }
    visual.root.traverse(node => {
      assert.equal(node.userData?.visualOnly, true, `${node.name || node.type} must remain visual-only`);
      assert.equal("collider" in (node.userData || {}), false);
      assert.equal("body" in (node.userData || {}), false);
    });
  } finally {
    visual.dispose();
    tireMaterial.dispose();
  }
  assert.equal(visual.root.parent, null);
});

test("COV-03 wires the same cover companions into local and P2P renderers", async () => {
  const [localSource, p2pSource] = await Promise.all([
    readFile(new URL("../src/client.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/wasm-spike/p2p-wasm-three-presentation-renderer.mjs", import.meta.url), "utf8"),
  ]);
  for (const source of [localSource, p2pSource]) {
    assert.match(source, /createCombatAlphaCoverVisuals/);
    assert.match(source, /createScrapyardTireMaterial/);
  }
  assert.match(localSource, /coverVisuals\s*=\s*createCombatAlphaCoverVisuals/);
  assert.match(p2pSource, /arenaCovers\s*=\s*createCombatAlphaCoverVisuals/);
});
