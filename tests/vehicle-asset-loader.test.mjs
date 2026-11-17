import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { createVehicleVisualModel } from "../src/vehicle-visual-model.js";
import { attachVehicleAsset, countGeometryMetrics, prepareAsset, setVehicleAssetTeam } from "../src/vehicle-asset-loader.js";

function sourceScene() {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x168ed3 });
  material.name = "body-shell";
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), material);
  body.name = "body-shell";
  scene.add(body);
  for (const name of ["front-left", "front-right", "rear-left", "rear-right"]) {
    const wheel = new THREE.Group();
    wheel.name = `wheel-${name}`;
    scene.add(wheel);
  }
  return scene;
}

function baseModel() {
  // Keep the model's own default skin attach out of these focused loader
  // tests; each case controls the loader request explicitly below.
  const root = createVehicleVisualModel({ THREE, team: "blue", vehicleAsset: { enabled: false } });
  return { root, attitude: root.userData.attitude, references: root.userData.references };
}

function callbackLoader(scene, error) {
  return {
    load(url, onLoad, _progress, onError) {
      queueMicrotask(() => error ? onError(error) : onLoad({ scene }));
    },
  };
}

test("authorized offline vehicle files are present and the source fits the visual envelope", async () => {
  const [gltf, geometry] = await Promise.all([
    readFile(new URL("../src/assets/vehicle/model.gltf", import.meta.url)),
    readFile(new URL("../src/assets/vehicle/geometry.bin", import.meta.url)),
  ]);
  assert.ok(gltf.byteLength > 1000);
  assert.ok(geometry.byteLength > 1000);
  const prepared = prepareAsset(THREE, { scene: sourceScene() }, { targetWidth: 3.55, targetHeight: 1.68, targetDepth: 1.72, floorY: .09, url: "/src/assets/vehicle/model.gltf" }, "blue");
  prepared.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(prepared);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 3.55) < 1e-5);
  assert.ok(Math.abs(size.y - 1.68) < 1e-5);
  assert.ok(Math.abs(size.z - 1.72) < 1e-5);
  assert.ok(Math.abs(bounds.min.y - .09) < 1e-5);
});

test("asset attach is loading/non-blocking, then redirects wheel aliases on success", async () => {
  const { root, attitude, references } = baseModel();
  const loader = callbackLoader(sourceScene());
  const promise = attachVehicleAsset({ THREE, root, attitude, references, loader, config: { enabled: true, url: "/src/assets/vehicle/model.gltf" } });
  assert.equal(root.userData.assetState.status, "loading");
  assert.equal(root.userData.assetReady, promise);
  const state = await promise;
  assert.equal(state.status, "ready");
  assert.equal(state.source, "asset-plus-procedural-effects");
  assert.deepEqual(state.assetFiles, ["/src/assets/vehicle/model.gltf", "/src/assets/vehicle/geometry.bin"]);
  assert.equal(state.triangles, state.metrics.triangles);
  assert.equal(state.drawCalls, state.metrics.drawCalls);
  assert.equal(references.wheels[0].carrier.name, "wheel-front-left");
  assert.equal(references.wheelSpinners.length, 4);
  assert.equal(references.steeringWheels.length, 2);
  assert.equal(references.lights.headlights[0].mesh.visible, true);
  assert.equal(root.userData.assetMetrics, state.metrics);
  assert.equal(countGeometryMetrics(attitude.children.at(-1)).triangles, state.triangles);
});

test("attached authored asset can be recolored in place for team changes", async () => {
  const { root, attitude, references } = baseModel();
  await attachVehicleAsset({ THREE, root, attitude, references, loader: callbackLoader(sourceScene()), config: { enabled: true, url: "/src/assets/vehicle/model.gltf" } });
  const assetBody = attitude.children.at(-1).children.find(child => child.name === "body-shell");
  assert.equal(assetBody.material.color.getHex(), 0x168ed3);
  assert.equal(setVehicleAssetTeam(root, "red"), true);
  assert.equal(assetBody.material.color.getHex(), 0xd03d43);
  assert.equal(setVehicleAssetTeam(root, null), true);
  assert.equal(assetBody.material.color.getHex(), 0xaebcc2);
  assert.equal(root.userData.team, null);
});

test("final asset promotion disposes the procedural chassis when requested", async () => {
  const { root, attitude, references } = baseModel();
  const state = await attachVehicleAsset({
    THREE,
    root,
    attitude,
    references,
    loader: callbackLoader(sourceScene()),
    config: { enabled: true, url: "/src/assets/vehicle/model.gltf", disposeProceduralOnAssetReady: true },
  });
  assert.equal(state.status, "ready");
  assert.ok(state.proceduralMeshesDisposed > 0);
  const meshNames = [];
  attitude.traverse(child => { if (child.isMesh) meshNames.push(child.name); });
  assert.ok(meshNames.includes("body-shell"), "the authored asset remains the only chassis paint");
  assert.equal(meshNames.includes("main-chassis"), false, "the procedural chassis is reclaimed after promotion");
});

test("explicitly disabled asset requests stay procedural without invoking the loader", async () => {
  const { root, attitude, references } = baseModel();
  let calls = 0;
  const state = await attachVehicleAsset({
    THREE,
    root,
    attitude,
    references,
    loader: { load() { calls += 1; } },
    config: { enabled: false },
  });
  assert.equal(state.status, "disabled");
  assert.equal(state.source, "procedural");
  assert.equal(calls, 0);
  assert.equal(references.wheels.length, 4);
});

test("loader failures and triangle budget violations retain procedural fallback", async () => {
  for (const [loader, config] of [
    [callbackLoader(null, new Error("offline load failed")), { enabled: true }],
    [callbackLoader(sourceScene()), { enabled: true, maxTriangles: 1 }],
  ]) {
    const { root, attitude, references } = baseModel();
    const proceduralWheel = references.wheels[0];
    const state = await attachVehicleAsset({ THREE, root, attitude, references, loader, config });
    assert.equal(state.status, "fallback");
    assert.equal(state.source, "procedural");
    assert.ok(state.failures.length >= 1);
    assert.equal(references.wheels[0], proceduralWheel);
  }
});

test("a stalled loader times out without blocking the procedural model", async () => {
  const { root, attitude, references } = baseModel();
  const started = performance.now();
  const statePromise = attachVehicleAsset({
    THREE, root, attitude, references, config: { enabled: true, timeoutMs: 10 },
    loader: { load() {} },
  });
  assert.ok(performance.now() - started < 50);
  const state = await statePromise;
  assert.equal(state.status, "fallback");
  assert.match(state.failures[0].reason, /timeout|unavailable/i);
});

