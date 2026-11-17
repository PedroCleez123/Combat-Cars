import assert from "node:assert/strict";
import test from "node:test";
import { createP2PWasmCausalAudioPresenter } from "../tools/wasm-spike/p2p-wasm-causal-audio.mjs";

function state({ id = "p2p-host", time = 0, speed = 0, boosting = false, boost = boosting ? 80 : 20, powerslide = 0, events = [], actionSerials = { jump: 0, doubleJump: 0, dodge: 0, respawn: 0 }, roundSerial = 1 } = {}) {
  return {
    time,
    settings: { roundSerial },
    cars: [{ id, alive: true, speed, forwardSpeed: speed, boost, boosting, powerslide, actionSerials }],
    events,
  };
}

test("online causal audio derives bounded motor acceleration and nitro state from snapshots", () => {
  const calls = { motor: [], nitro: [], feedback: [] };
  const mixer = {
    setMotorState(value) { calls.motor.push(value); },
    setNitroState(value) { calls.nitro.push(value); },
    playFeedback(value) { calls.feedback.push(value); },
    clear() {},
  };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "host" });
  presenter.present(state({ time: 0, speed: 0 }));
  presenter.present(state({ time: 1 / 60, speed: 28, boosting: true }));
  assert.equal(calls.motor.at(-1).active, true);
  assert.ok(calls.motor.at(-1).acceleration > 0);
  assert.equal(calls.nitro.at(-1).active, true);
  assert.equal(calls.nitro.at(-1).intensity, .8);
  presenter.dispose();
});

test("online causal audio resolves a multiparty guest by its authoritative slot id", () => {
  const nitroStates = [];
  const mixer = { setMotorState() {}, setNitroState(value) { nitroStates.push(value); }, clear() {} };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "pilot" });
  presenter.present(state({ id: "p2p-guest-3", time: 1, speed: 24, boosting: true }), { role: "pilot", carId: "p2p-guest-3" });
  assert.equal(nitroStates.at(-1).active, true);
  presenter.dispose();
});

test("online causal audio follows the authoritative boosting edge at depletion", () => {
  const nitroStates = [];
  const mixer = {
    setMotorState() {},
    setNitroState(value) { nitroStates.push(value); },
    clear() {},
  };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "host" });
  presenter.present(state({ time: 0, speed: 18, boosting: true, boost: 0 }));
  assert.equal(nitroStates.at(-1).active, true);
  assert.equal(nitroStates.at(-1).intensity, 0);
  presenter.dispose();
});

test("online causal audio mirrors authoritative brake and drift transitions", () => {
  const cues = [];
  const driftStates = [];
  const mixer = {
    setMotorState() {},
    setNitroState() {},
    setDriftState(value) { driftStates.push(value); },
    playCue(cue) { cues.push(cue); },
    clear() {},
  };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "host" });
  presenter.present(state({ time: 0, speed: 40 }));
  presenter.present(state({ time: 1 / 60, speed: 35, boosting: false }));
  assert.deepEqual(cues, ["brake"]);
  presenter.present(state({ time: 2 / 60, speed: 34, boosting: false }));
  assert.deepEqual(cues, ["brake"], "a sustained deceleration must not burst repeatedly");
  presenter.present(state({ time: 3 / 60, speed: 34, boosting: false, powerslide: .8 }));
  assert.deepEqual(cues, ["brake", "drift"]);
  assert.equal(driftStates.at(-1).active, true);
  presenter.present(state({ time: 4 / 60, speed: 34, boosting: false, powerslide: 0 }));
  assert.equal(driftStates.at(-1).active, false);
  presenter.dispose();
});

test("online causal audio plays each authoritative event once and clears its history", () => {
  const calls = [];
  const mixer = { setMotorState() {}, setNitroState() {}, playFeedback(value) { calls.push(value); }, clear() {} };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "host" });
  const event = { kind: "fire", text: "DISPARO", at: 2 };
  presenter.present(state({ events: [event] }));
  presenter.present(state({ time: 1 / 60, events: [event] }));
  assert.equal(calls.length, 1);
  presenter.clear();
  presenter.present(state({ time: 2 / 60, events: [event] }));
  assert.equal(calls.length, 2);
  presenter.dispose();
});

test("online causal audio maps movement serial edges to local cues without inventing reset actions", () => {
  const cues = [];
  const mixer = { setMotorState() {}, setNitroState() {}, playCue(cue) { cues.push(cue); }, clear() {} };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "host" });
  presenter.present(state());
  presenter.present(state({
    time: 1 / 60,
    actionSerials: { jump: 1, doubleJump: 1, dodge: 1, respawn: 0 },
  }));
  assert.deepEqual(cues, ["jump", "double-jump", "dodge"]);
  presenter.present(state({
    time: 2 / 60,
    roundSerial: 2,
    actionSerials: { jump: 0, doubleJump: 0, dodge: 0, respawn: 1 },
  }));
  assert.deepEqual(cues, ["jump", "double-jump", "dodge"], "a round reset must not synthesize a movement cue");
  presenter.dispose();
});

test("online causal audio replays the latest frame after the gesture unlocks Web Audio", async () => {
  const calls = { unlock: 0, preload: 0, motor: [] };
  const mixer = {
    async unlock() { calls.unlock += 1; return true; },
    async preloadCombat() { calls.preload += 1; return { ready: true, timedOut: false }; },
    setMotorState(value) { calls.motor.push(value); },
    setNitroState() {},
    clear() {},
  };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "host" });
  presenter.present(state({ time: 2, speed: 28, boosting: false }));
  assert.equal(calls.motor.length, 1);
  await presenter.unlock();
  assert.equal(calls.unlock, 1);
  assert.equal(calls.preload, 1);
  assert.equal(calls.motor.length, 2, "unlock must re-apply the latest state");
  assert.equal(calls.motor.at(-1).active, true);
  await presenter.dispose();
});

test("online causal audio exposes the local mixer volume and mute controls without affecting authority", () => {
  const calls = [];
  const mixer = {
    setMotorState() {}, setNitroState() {}, clear() {},
    setVolume(value) { calls.push(["volume", value]); return Number(value); },
    setMuted(value) { calls.push(["muted", value]); return Boolean(value); },
    getState() { return { volume: .42, muted: true, supported: true }; },
  };
  const presenter = createP2PWasmCausalAudioPresenter({ mixer, role: "host" });
  assert.equal(presenter.setVolume(.42), .42);
  assert.equal(presenter.setMuted(true), true);
  assert.deepEqual(presenter.getAudioState(), { volume: .42, muted: true, supported: true });
  assert.deepEqual(calls, [["volume", .42], ["muted", true]]);
  presenter.dispose();
});
