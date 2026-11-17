import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_CUE_DEFINITIONS, DEFAULT_VOLUME, SAMPLE_BANK, createAudioMixer } from "../src/audio-mixer.js";

class FakeParam {
  constructor(value = 0) { this.value = value; this.calls = []; }
  setValueAtTime(value, ...args) { this.value = value; this.calls.push(["setValueAtTime", value, ...args]); }
  linearRampToValueAtTime(value, ...args) { this.value = value; this.calls.push(["linearRampToValueAtTime", value, ...args]); }
  exponentialRampToValueAtTime(value, ...args) { this.value = value; this.calls.push(["exponentialRampToValueAtTime", value, ...args]); }
  setTargetAtTime(value, ...args) { this.value = value; this.calls.push(["setTargetAtTime", value, ...args]); }
  cancelScheduledValues(...args) { this.calls.push(["cancelScheduledValues", ...args]); }
}

class FakeNode {
  constructor() { this.connections = []; this.disconnected = false; }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
}

class FakeOscillator extends FakeNode {
  constructor() { super(); this.frequency = new FakeParam(); this.startCount = 0; this.stopCount = 0; this.type = "sine"; }
  start() { this.startCount += 1; }
  stop() { this.stopCount += 1; }
}

class FakeGain extends FakeNode {
  constructor() { super(); this.gain = new FakeParam(); }
}

class FakeBufferSource extends FakeNode {
  constructor() { super(); this.playbackRate = new FakeParam(1); this.buffer = null; this.loop = false; this.startCount = 0; this.stopCount = 0; }
  start() { this.startCount += 1; }
  stop() { this.stopCount += 1; }
}

class FakeFilter extends FakeNode {
  constructor() { super(); this.frequency = new FakeParam(); this.Q = new FakeParam(); this.type = "lowpass"; }
}

class FakeAudioContext {
  constructor() {
    this.state = "suspended"; this.currentTime = 0; this.destination = new FakeNode();
    this.oscillators = []; this.filters = []; this.closed = false;
  }
  async resume() { this.state = "running"; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  createGain() { return new FakeGain(); }
  createBiquadFilter() { const node = new FakeFilter(); this.filters.push(node); return node; }
  async close() { this.closed = true; this.state = "closed"; }
}

class SampleAudioContext extends FakeAudioContext {
  constructor() { super(); this.sources = []; }
  createBufferSource() { const node = new FakeBufferSource(); this.sources.push(node); return node; }
  decodeAudioData() { return Promise.resolve({ duration: .2 }); }
}

test("mixer remains gesture-gated, quiet by default, and deduplicates motor/nitro loops", async () => {
  const context = new FakeAudioContext();
  const mixer = createAudioMixer({ audioContextFactory: () => context });
  assert.equal(DEFAULT_VOLUME, .3);
  assert.equal(mixer.getState().volume, .3);
  assert.equal(mixer.playCue("rocket-fire"), false);
  assert.equal(await mixer.unlock(), true);
  assert.equal(mixer.startMotor(.8), true);
  assert.equal(mixer.setMotorState({ active: true, intensity: .9, speed: 44, acceleration: 18 }), false);
  assert.equal(mixer.startMotor(.2), false);
  assert.equal(mixer.startNitro(.8), true);
  assert.equal(mixer.startNitro(.2), false);
  assert.deepEqual(mixer.getState().activeLoops, ["motor", "nitro"]);
  assert.equal(context.oscillators.length, 2, "state updates must not create a new oscillator per frame");
  assert.equal(context.filters.length, 2, "motor and nitro use a softened filter stage");
  assert.equal(context.oscillators[0].type, "triangle");
  assert.ok(context.oscillators[0].frequency.calls.some(call => call[0] === "setTargetAtTime"));
  mixer.stopNitro();
  mixer.stopMotor();
  assert.deepEqual(mixer.getState().activeLoops, []);
});

test("movement and rocket cues are discrete, filtered, and cooldown protected", async () => {
  const context = new FakeAudioContext();
  const mixer = createAudioMixer({ audioContextFactory: () => context });
  await mixer.unlock();
  for (const cue of ["brake", "jump", "double-jump", "dodge", "rocket-fire", "rocket-impact"]) {
    assert.equal(mixer.playCue(cue), true, cue);
  }
  for (const cue of ["drift", "derrape", "drift-loop", "ram-impact", "ram"]) {
    assert.equal(mixer.playCue(cue), false, `${cue} is intentionally silent`);
  }
  assert.equal(mixer.startDrift(.9), false, "startDrift must not create a voice");
  assert.equal(mixer.setDriftState({ active: true, intensity: .9, speed: 32 }), false, "setDriftState must be a no-op");
  assert.equal(mixer.stopDrift(), false, "stopDrift remains a no-op");
  assert.equal(mixer.playCue("rocket-fire"), false, "same-frame rocket event is not a burst");
  context.currentTime = .25;
  assert.equal(mixer.playFeedback({ kind: "fire", text: "LANZAMIENTO" }), true);
  assert.equal(mixer.playFeedback({ kind: "hit", text: "IMPACTO" }), true);
  assert.equal(mixer.playFeedback({ kind: "ram", text: "EMBESTIDA" }), false, "arena/body contacts stay silent");
  assert.equal(mixer.playFeedback({ kind: "join", text: "PILOTO" }), false);
  assert.equal(context.oscillators.length, 8, "silent drift cues must not add oscillators");
  assert.ok(context.filters.length >= 4);
  assert.equal(AUDIO_CUE_DEFINITIONS.motor.waveform, "triangle");
  assert.ok(AUDIO_CUE_DEFINITIONS.motor.gain <= .1);
  assert.ok(AUDIO_CUE_DEFINITIONS.nitro && AUDIO_CUE_DEFINITIONS.nitro.kind === "loop");
});

test("mute, volume, clear, disposal, and unavailable Web Audio fail safely", async () => {
  const context = new FakeAudioContext();
  const mixer = createAudioMixer({ audioContextFactory: () => context });
  await mixer.unlock();
  assert.equal(mixer.setVolume(2), 1);
  assert.equal(mixer.setMuted(true), true);
  assert.equal(mixer.playCue("rocket-impact"), true);
  mixer.startMotor(.5);
  mixer.clear();
  assert.deepEqual(mixer.getState().activeLoops, []);
  await mixer.dispose();
  assert.equal(mixer.playCue("rocket-fire"), false);

  const silent = createAudioMixer({ audioContextFactory: () => { throw new Error("blocked"); } });
  assert.equal(await silent.unlock(), false);
  assert.equal(silent.playCue("rocket-fire"), false);
  assert.equal(silent.getState().supported, true);
});

test("sample bank loads lazily after unlock and keeps one source per loop", async () => {
  const context = new SampleAudioContext();
  const requested = [];
  const mixer = createAudioMixer({
    audioContextFactory: () => context,
    fetchImpl: async url => { requested.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    sampleBaseUrl: "https://assets.example/game/",
  });
  assert.equal(mixer.playCue("jump"), false, "gesture gate is retained before unlock");
  await mixer.unlock();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(requested.length >= Object.keys(SAMPLE_BANK).length);
  assert.equal(mixer.startMotor(.8), true);
  assert.equal(mixer.setMotorState({ active: true, speed: 40, intensity: .9 }), false);
  assert.equal(context.sources.filter(source => source.loop).length, 1);
  assert.equal(mixer.playCue("jump"), true);
  assert.equal(context.sources.some(source => !source.loop && source.buffer), true);
  mixer.stopMotor();
  assert.deepEqual(mixer.getState().activeLoops, []);
});

test("combat preload decodes samples and silently warms the first kill feedback paths", async () => {
  const context = new SampleAudioContext();
  const requested = [];
  const mixer = createAudioMixer({
    audioContextFactory: () => context,
    fetchImpl: async url => { requested.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; },
    sampleBaseUrl: "https://assets.example/game/",
  });
  assert.deepEqual(await mixer.preloadCombat(), { ready: false, timedOut: false }, "trusted gesture remains required");
  await mixer.unlock();
  const result = await mixer.preloadCombat({ timeoutMs: 50 });
  assert.deepEqual(result, { ready: true, timedOut: false });
  assert.ok(requested.length >= Object.keys(SAMPLE_BANK).length);
  assert.ok(context.sources.some(source => source.buffer), "sample-backed impact path is allocated under the cover");
  assert.ok(context.oscillators.length >= 1, "generated fallback cue path is allocated under the cover");
});
