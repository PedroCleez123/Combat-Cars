import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { aimWeaponMountAt, createVehicleVisualModel, spinVehicleWheels } from "../src/vehicle-visual-model.js";

test("vehicle visual factory exposes the complete wheel contract", () => {
  const model = createVehicleVisualModel({ THREE, vehicleAsset: { enabled: false } });
  assert.equal(model.type, "Group");
  assert.equal(model.name, "vehicle-visual-model-blue");
  assert.equal(model.userData.references.wheels, model.userData.wheels);
  assert.equal(model.userData.wheels.length, 4);
  assert.equal(model.userData.wheelSpinners.length, 4);
  assert.equal(model.userData.steeringWheels.length, 2);
  assert.equal(model.userData.boosterFlames.length, 2);
  assert.equal(model.userData.propulsors.length, 2);
  assert.equal(model.userData.localChassisBounds.minY, .09);
  assert.equal(model.userData.localChassisBounds.maxY, 1.77);
});

test("wheel spin uses the local longitudinal y axis and does not double-spin aliases", () => {
  const model = createVehicleVisualModel({ THREE, vehicleAsset: { enabled: false } });
  const wheel = model.userData.wheelSpinners[0];
  const beforeY = wheel.tire.rotation.y;
  const beforeZ = wheel.tire.rotation.z;
  spinVehicleWheels([wheel], .37);
  assert.ok(Math.abs(wheel.tire.rotation.y - beforeY - .37) < 1e-12);
  assert.equal(wheel.tire.rotation.z, beforeZ);
  assert.equal(wheel.rim.rotation.y, wheel.tire.rotation.y);
});

test("procedural wheel and presentation helpers preserve the vehicle envelope", () => {
  const model = createVehicleVisualModel({ THREE, team: "orange", vehicleAsset: { enabled: false } });
  assert.equal(model.userData.body.color.getHex(), 0xf27f19);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model.userData.attitude);
  assert.ok(Math.abs(bounds.min.y - .09) < 1e-5);
  assert.ok(bounds.max.y > 1.7);
  assert.equal(model.userData.setHealth(42), .42);
  assert.equal(model.userData.setBoostVisible(true), true);
  assert.ok(model.userData.propulsors.every(({ flame }) => flame.visible));
});

test("procedural detail metrics remain deterministic and within budget", () => {
  const first = createVehicleVisualModel({ THREE, vehicleAsset: { enabled: false } }).userData.visualMetrics;
  const second = createVehicleVisualModel({ THREE, vehicleAsset: { enabled: false } }).userData.visualMetrics;
  assert.deepEqual(first, second);
  assert.equal(first.detailRevision, 2);
  assert.ok(first.meshCount >= 150);
  assert.ok(first.triangleCount >= 4500);
  assert.ok(first.triangleCount <= first.budget.maxTriangles);
  assert.ok(first.drawCallEstimate <= first.budget.maxDrawCalls);
});

test("semantic lights and body parts stay addressable", () => {
  const model = createVehicleVisualModel({ THREE, team: "orange", vehicleAsset: { enabled: false } });
  const { references } = model.userData;
  assert.equal(references.headlights.length, 2);
  assert.equal(references.brakeLights.length, 2);
  assert.equal(references.sidePanels.length, 6);
  assert.equal(references.intakes.length, 2);
  assert.equal(references.decals.length, 4);
  assert.equal(references.rollCage.children.length >= 7, true);
  assert.ok(references.wheels.every(wheel => wheel.spokes.length === 5 && wheel.brakeCaliper.isMesh));
});

test("roof weapon mount exposes a muzzle and aims its barrel in world space", () => {
  const model = createVehicleVisualModel({ THREE, vehicleAsset: { enabled: false } });
  const mount = model.userData.references.weaponMount;
  assert.equal(model.userData.weaponMount, mount);
  assert.equal(mount.root.name, "weapon-mount");
  assert.equal(mount.muzzle.name, "weapon-muzzle");
  model.rotation.y = Math.PI / 2;
  model.updateMatrixWorld(true);
  const target = new THREE.Vector3(-4, 2.2, 8);
  assert.equal(aimWeaponMountAt(mount, target), true);
  model.updateMatrixWorld(true);
  const muzzle = mount.muzzle.getWorldPosition(new THREE.Vector3());
  const muzzleTip = mount.muzzle.localToWorld(new THREE.Vector3(.2, 0, 0));
  const barrelDirection = muzzleTip.sub(muzzle).normalize();
  const targetDirection = target.sub(muzzle).normalize();
  assert.ok(barrelDirection.dot(targetDirection) > .995);
});

test("authored skin is the default while procedural presentation remains an explicit opt-out", async () => {
  const model = createVehicleVisualModel({ THREE, team: "blue" });
  assert.equal(model.userData.assetState.status, "loading");
  const state = await model.userData.assetReady;
  // Node has no browser GLTFLoader, so this focused unit test observes the
  // immediate procedural fallback after the default request fails to resolve.
  assert.equal(state.status, "fallback");
  assert.equal(state.source, "procedural");
  assert.equal(model.userData.wheels.length, 4);
  const optOut = createVehicleVisualModel({ THREE, team: "blue", vehicleAsset: { enabled: false } });
  const optOutState = await optOut.userData.assetReady;
  assert.equal(optOutState.status, "disabled");
  assert.equal(optOutState.source, "procedural");
  const explicitConfig = createVehicleVisualModel({ THREE, team: "blue", vehicleAsset: { url: "/src/assets/vehicle/model.gltf" } });
  const explicitConfigState = await explicitConfig.userData.assetReady;
  assert.equal(explicitConfigState.status, "fallback");
  assert.equal(explicitConfigState.source, "procedural");
  const colours = ["blue", "orange", "red"].map(team => createVehicleVisualModel({ THREE, team, vehicleAsset: { enabled: false } }).userData.body.color.getHex());
  assert.deepEqual(colours, [0x168ed3, 0xf27f19, 0xd03d43]);
});
