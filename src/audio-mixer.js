import { describeEventFeedback } from "./event-feedback.js";
import { SAMPLE_BANK, createSampleLoader } from "./audio-sample-bank.js";

// Locally generated cues keep the game usable when Web Audio or an external
// asset is unavailable. Loop voices are deliberately quiet and routed through
// the master gain so they cannot overpower the textual feedback.
const AUDIO_CUE_DEFINITIONS = Object.freeze({
  motor: Object.freeze({
    kind: "loop", waveform: "triangle", frequency: 66, minFrequency: 58, maxFrequency: 166,
    gain: .075, attack: .08, release: .08, filter: Object.freeze({ type: "lowpass", frequency: 920, Q: .65 }),
  }),
  engine: Object.freeze({
    kind: "loop", waveform: "triangle", frequency: 66, minFrequency: 58, maxFrequency: 166,
    gain: .075, attack: .08, release: .08, filter: Object.freeze({ type: "lowpass", frequency: 920, Q: .65 }),
  }),
  nitro: Object.freeze({
    kind: "loop", waveform: "triangle", frequency: 118, minFrequency: 90, maxFrequency: 238,
    gain: .07, attack: .05, release: .07, filter: Object.freeze({ type: "lowpass", frequency: 1400, Q: .55 }),
  }),
  // Kept as compatibility metadata for older callers; SILENT_CUES below
  // prevents either drift variant from ever reaching voice creation.
  "drift-loop": Object.freeze({
    kind: "loop", waveform: "triangle", frequency: 128, minFrequency: 112, maxFrequency: 188,
    gain: .036, attack: .04, release: .055, filter: Object.freeze({ type: "lowpass", frequency: 1050, Q: .45 }),
  }),
  brake: Object.freeze({ kind: "oneshot", waveform: "square", startFrequency: 165, endFrequency: 72, duration: .12, gain: .055, cooldown: .14, filter: Object.freeze({ type: "lowpass", frequency: 760, Q: .45 }) }),
  drift: Object.freeze({ kind: "oneshot", waveform: "triangle", startFrequency: 220, endFrequency: 96, duration: .16, gain: .065, cooldown: .16, filter: Object.freeze({ type: "lowpass", frequency: 1120, Q: .5 }) }),
  jump: Object.freeze({ kind: "oneshot", waveform: "sine", startFrequency: 260, endFrequency: 520, duration: .16, gain: .065, cooldown: .12 }),
  "double-jump": Object.freeze({ kind: "oneshot", waveform: "sine", startFrequency: 390, endFrequency: 760, duration: .19, gain: .075, cooldown: .12 }),
  dodge: Object.freeze({ kind: "oneshot", waveform: "triangle", startFrequency: 310, endFrequency: 112, duration: .14, gain: .07, cooldown: .12, filter: Object.freeze({ type: "lowpass", frequency: 1250, Q: .5 }) }),
  "rocket-fire": Object.freeze({ kind: "oneshot", waveform: "triangle", startFrequency: 238, endFrequency: 76, duration: .2, gain: .09, cooldown: .08, filter: Object.freeze({ type: "lowpass", frequency: 1450, Q: .55 }) }),
  "rocket-impact": Object.freeze({ kind: "oneshot", waveform: "triangle", startFrequency: 142, endFrequency: 34, duration: .3, gain: .115, cooldown: .08, filter: Object.freeze({ type: "lowpass", frequency: 980, Q: .55 }) }),
  respawn: Object.freeze({ kind: "oneshot", waveform: "sine", startFrequency: 380, endFrequency: 760, duration: .34, gain: .07, cooldown: .2 }),
  "ram-impact": Object.freeze({ kind: "oneshot", waveform: "triangle", startFrequency: 120, endFrequency: 48, duration: .2, gain: .07, cooldown: .1 }),
  elimination: Object.freeze({ kind: "oneshot", waveform: "sine", startFrequency: 300, endFrequency: 120, duration: .24, gain: .06, cooldown: .12 }),
  "round-result": Object.freeze({ kind: "oneshot", waveform: "sine", startFrequency: 440, endFrequency: 880, duration: .34, gain: .06, cooldown: .2 }),
  "round-state": Object.freeze({ kind: "oneshot", waveform: "sine", startFrequency: 220, endFrequency: 330, duration: .18, gain: .045, cooldown: .16 }),
  "boost-pad": Object.freeze({ kind: "oneshot", waveform: "sine", startFrequency: 520, endFrequency: 820, duration: .16, gain: .055, cooldown: .14 }),
});

const CUE_ALIASES = Object.freeze({ engine: "motor", derrape: "drift", boost: "nitro", ram: "ram-impact" });
// Deliberately disabled at the normalization boundary so old aliases and stale
// callers cannot create drift or ram voices if definitions are reintroduced.
const SILENT_CUES = Object.freeze(new Set(["drift", "derrape", "drift-loop", "ram", "ram-impact"]));
const LOOP_CUES = Object.freeze(new Set(["motor", "nitro"]));
const MAX_VOLUME = 1;
const DEFAULT_VOLUME = .3;
const SAMPLE_CUES = Object.freeze({
  jump: "jump", "double-jump": "double-jump", dodge: "dodge",
  "rocket-impact": "vehicle-impact", "ram-impact": "arena-impact",
});
const SAMPLE_LOOP_CUES = Object.freeze({ motor: "engine-idle", nitro: "boost-loop" });

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function callParam(param, method, ...args) {
  if (param && typeof param[method] === "function") {
    try { param[method](...args); return; } catch { /* unsupported fake/browser parameter */ }
  }
  if (param && args.length && method !== "cancelScheduledValues") param.value = args[0];
}

function contextConstructor(options) {
  if (typeof options.audioContextFactory === "function") return options.audioContextFactory;
  if (Object.prototype.hasOwnProperty.call(options, "audioContext")) return () => options.audioContext;
  const ctor = options.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
  return typeof ctor === "function" ? () => new ctor() : null;
}

function nowFor(context) { return Math.max(0, finite(context?.currentTime)); }

function createFilter(context, definition) {
  if (!definition.filter || typeof context?.createBiquadFilter !== "function") return null;
  try {
    const filter = context.createBiquadFilter();
    filter.type = definition.filter.type;
    callParam(filter.frequency, "setValueAtTime", definition.filter.frequency, nowFor(context));
    if (definition.filter.Q !== undefined) callParam(filter.Q, "setValueAtTime", definition.filter.Q, nowFor(context));
    return filter;
  } catch { return null; }
}

function connectVoice(oscillator, filter, gain, master) {
  oscillator.connect(filter || gain);
  if (filter) filter.connect(gain);
  gain.connect(master);
}

function startOscillator(oscillator, now) {
  try { oscillator.start(now); return true; } catch {
    try { oscillator.start(); return true; } catch { return false; }
  }
}

function createVoice(context, master, definition, now, { intensity = 1 } = {}) {
  if (!context?.createOscillator || !context?.createGain) return null;
  let oscillator;
  let gain;
  try {
    oscillator = context.createOscillator();
    gain = context.createGain();
    const filter = createFilter(context, definition);
    const amount = clamp(intensity) * (definition.gain ?? .06);
    oscillator.type = definition.waveform;
    connectVoice(oscillator, filter, gain, master);
    // A silent prewarm must not leak even a very short oscillator click. Real
    // cues retain the tiny non-zero attack floor needed by Web Audio ramps.
    const initialGain = intensity > 0 ? .0001 : 0;
    callParam(gain.gain, "setValueAtTime", initialGain, now);
    callParam(gain.gain, "linearRampToValueAtTime", amount, now + Math.min(.025, definition.attack ?? .012));
    callParam(gain.gain, "setTargetAtTime", .0001, now + Math.max(.01, definition.duration - .055), .035);
    callParam(oscillator.frequency, "setValueAtTime", Math.max(1, definition.startFrequency), now);
    callParam(oscillator.frequency, "exponentialRampToValueAtTime", Math.max(1, definition.endFrequency), now + definition.duration);
    if (!startOscillator(oscillator, now)) return null;
    try { oscillator.stop(now + definition.duration + .08); } catch { try { oscillator.stop(); } catch { /* fake contexts may not implement stop */ } }
    return { oscillator, filter, gain, duration: definition.duration };
  } catch { return null; }
}

function loopDrive(definition, state = {}) {
  const speed = clamp(finite(state.speed) / 56);
  const intensity = clamp(state.intensity);
  const acceleration = clamp(Math.max(0, finite(state.acceleration)) / 42);
  const drive = clamp(Math.max(intensity, speed));
  const base = finite(definition.frequency, 80);
  const min = finite(definition.minFrequency, base * .82);
  const max = finite(definition.maxFrequency, base * 1.8);
  return {
    frequency: Math.min(max, Math.max(min, min + (max - min) * drive + acceleration * 9)),
    gain: (definition.gain ?? .05) * (.25 + .75 * drive),
    filterFrequency: (definition.filter?.frequency ?? 1000) * (.72 + .48 * drive),
  };
}

function createLoopVoice(context, master, definition, now, state) {
  if (!context?.createOscillator || !context?.createGain) return null;
  let oscillator;
  let gain;
  try {
    oscillator = context.createOscillator();
    gain = context.createGain();
    const filter = createFilter(context, definition);
    const drive = loopDrive(definition, state);
    oscillator.type = definition.waveform;
    connectVoice(oscillator, filter, gain, master);
    callParam(gain.gain, "setValueAtTime", .0001, now);
    callParam(gain.gain, "linearRampToValueAtTime", drive.gain, now + (definition.attack ?? .05));
    callParam(oscillator.frequency, "setValueAtTime", drive.frequency, now);
    if (filter?.frequency) callParam(filter.frequency, "setValueAtTime", drive.filterFrequency, now);
    if (!startOscillator(oscillator, now)) return null;
    return { oscillator, filter, gain, state: { ...state }, lastUpdate: now };
  } catch { return null; }
}

function connectSample(source, gain, master) {
  source.connect(gain);
  gain.connect(master);
}

function startSample(source, now) {
  try { source.start(now); return true; } catch {
    try { source.start(); return true; } catch { return false; }
  }
}

function createSampleVoice(context, master, buffer, definition, now, { intensity = 1, loop = false, rate = 1 } = {}) {
  if (!buffer || typeof context?.createBufferSource !== "function" || typeof context?.createGain !== "function") return null;
  try {
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = Boolean(loop);
    callParam(source.playbackRate, "setValueAtTime", Math.max(.35, Math.min(2.4, rate)), now);
    connectSample(source, gain, master);
    const amount = clamp(intensity) * (definition.gain ?? .06);
    const initialGain = intensity > 0 ? .0001 : 0;
    callParam(gain.gain, "setValueAtTime", initialGain, now);
    callParam(gain.gain, "linearRampToValueAtTime", amount, now + Math.min(.05, definition.attack ?? .02));
    if (!loop) callParam(gain.gain, "setTargetAtTime", .0001, now + Math.max(.01, finite(buffer.duration, definition.duration ?? .2) - .055), .035);
    if (!startSample(source, now)) return null;
    if (!loop) {
      try { source.stop(now + Math.max(.04, finite(buffer.duration, definition.duration ?? .2)) + .08); } catch { /* no-op */ }
    }
    return { source, gain, sample: true, state: {}, lastUpdate: now };
  } catch { return null; }
}

function sampleEngineKey(state = {}) {
  const speed = Math.max(0, finite(state.speed));
  const intensity = clamp(state.intensity);
  if (speed < 6 && intensity < .35) return "engine-idle";
  if (speed < 28 && intensity < .72) return "engine-coast";
  return "engine-loaded";
}

function updateLoopVoice(voice, definition, context, state) {
  if (!voice || !context) return;
  const now = nowFor(context);
  const next = {
    intensity: clamp(state.intensity),
    speed: Math.max(0, finite(state.speed)),
    acceleration: finite(state.acceleration),
  };
  const previous = voice.state || {};
  const changed = Math.abs(next.intensity - previous.intensity) > .012
    || Math.abs(next.speed - previous.speed) > .75
    || Math.abs(next.acceleration - previous.acceleration) > 2;
  if (!changed && now - voice.lastUpdate < .045) return;
  const drive = loopDrive(definition, next);
  if (voice.sample) {
    callParam(voice.gain?.gain, "setTargetAtTime", drive.gain, now, .055);
    callParam(voice.source?.playbackRate, "setTargetAtTime", Math.max(.45, Math.min(2.2, .72 + drive.frequency / 260)), now, .07);
    voice.state = next;
    voice.lastUpdate = now;
    return;
  }
  callParam(voice.gain?.gain, "setTargetAtTime", drive.gain, now, .055);
  callParam(voice.oscillator?.frequency, "setTargetAtTime", drive.frequency, now, .07);
  if (voice.filter?.frequency) callParam(voice.filter.frequency, "setTargetAtTime", drive.filterFrequency, now, .08);
  voice.state = next;
  voice.lastUpdate = now;
}

function stopVoice(voice, context, release = .035) {
  if (!voice) return;
  const now = nowFor(context);
  callParam(voice.gain?.gain, "cancelScheduledValues", now);
  callParam(voice.gain?.gain, "setValueAtTime", voice.gain?.gain?.value ?? .0001, now);
  callParam(voice.gain?.gain, "linearRampToValueAtTime", .0001, now + release);
  try { (voice.source || voice.oscillator)?.stop(now + release + .01); } catch { try { (voice.source || voice.oscillator)?.stop(); } catch { /* already stopped */ } }
  for (const node of [voice.source, voice.oscillator, voice.filter, voice.gain]) {
    try { node?.disconnect?.(); } catch { /* no-op */ }
  }
}

/** Gesture-gated Web Audio mixer with safe no-op behaviour when unavailable. */
export function createAudioMixer(options = {}) {
  const factory = contextConstructor(options);
  const initialVolume = clamp(options.volume ?? DEFAULT_VOLUME);
  let context = null;
  let master = null;
  let volume = initialVolume;
  let muted = Boolean(options.muted);
  let unlocked = false;
  let disposed = false;
  const loops = new Map();
  const lastCueAt = new Map();
  let sampleLoader = null;
  let sampleLoadStarted = false;
  let combatPreload = null;

  function ensureContext() {
    if (context || !factory || disposed) return context;
    try { context = factory() || null; } catch { context = null; }
    if (!context) return null;
    try {
      master = context.createGain?.() || null;
      master?.connect?.(context.destination);
      sampleLoader = typeof options.sampleLoaderFactory === "function"
        ? options.sampleLoaderFactory({ context })
        : createSampleLoader({ context, fetchImpl: options.fetchImpl, baseUrl: options.sampleBaseUrl });
      updateMaster();
    } catch { master = null; }
    return context;
  }

  function updateMaster() {
    if (!master?.gain) return;
    const target = muted ? 0 : volume;
    callParam(master.gain, "cancelScheduledValues", nowFor(context));
    callParam(master.gain, "setValueAtTime", target, nowFor(context));
  }

  async function unlock() {
    if (disposed) return false;
    const current = ensureContext();
    if (!current) return false;
    try { if (typeof current.resume === "function") await current.resume(); }
    catch { unlocked = false; return false; }
    unlocked = current.state === undefined || current.state === "running";
    if (unlocked && sampleLoader && !sampleLoadStarted) {
      sampleLoadStarted = true;
      // Loading is intentionally detached from the gesture path: startup and
      // input remain responsive even when an asset is slow or unavailable.
      void sampleLoader.loadAll();
    }
    return unlocked;
  }

  function prewarmCue(canonical) {
    const definition = AUDIO_CUE_DEFINITIONS[canonical];
    if (!definition || LOOP_CUES.has(canonical) || !context || !master) return false;
    const now = nowFor(context);
    const sampleKey = SAMPLE_CUES[canonical];
    const sample = sampleKey ? sampleLoader?.get(sampleKey) : null;
    const voice = sample
      ? createSampleVoice(context, master, sample, definition, now, { intensity: 0 })
      : createVoice(context, master, definition, now, { intensity: 0 });
    return Boolean(voice);
  }

  /**
   * Resolves after combat samples are decoded and their first voice paths have
   * been instantiated silently. It is intentionally available only after a
   * trusted gesture unlocked Web Audio. A bounded fallback keeps an unavailable
   * file or a broken browser fetch from trapping the loading UI forever.
   */
  function preloadCombat({ timeoutMs = 6000 } = {}) {
    if (!unlocked || !ensureContext() || !sampleLoader) return Promise.resolve(Object.freeze({ ready: false, timedOut: false }));
    if (combatPreload) return combatPreload;
    const boundedTimeout = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 6000;
    let timeoutId = null;
    const timeout = new Promise(resolve => { timeoutId = setTimeout(() => resolve("timeout"), boundedTimeout); });
    const loading = Promise.resolve(sampleLoader.loadAll()).then(() => "loaded", () => "failed");
    combatPreload = Promise.race([loading, timeout]).then(result => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      // These are the first one-shot paths that may coincide with a kill.
      // They are created at zero gain while the loading cover is still shown.
      for (const cue of ["rocket-fire", "rocket-impact", "elimination", "respawn"]) prewarmCue(cue);
      return Object.freeze({ ready: result === "loaded", timedOut: result === "timeout" });
    });
    return combatPreload;
  }

  function canonicalCue(cue) {
    const key = typeof cue === "string" ? cue.trim().toLowerCase() : "";
    if (SILENT_CUES.has(key)) return null;
    const alias = CUE_ALIASES[key] || key;
    if (SILENT_CUES.has(alias)) return null;
    return AUDIO_CUE_DEFINITIONS[alias] ? alias : null;
  }

  function loopKey(canonical) { return canonical; }

  function sampleLoopKey(canonical, state) {
    if (canonical === "motor") return sampleEngineKey(state);
    return SAMPLE_LOOP_CUES[canonical] || null;
  }

  function startSampleCue(key, definition, intensity = 1) {
    const buffer = sampleLoader?.get(key);
    if (!buffer || !context || !master) return null;
    return createSampleVoice(context, master, buffer, definition, nowFor(context), { intensity });
  }

  function setLoop(cue, active, state = {}) {
    const canonical = canonicalCue(cue);
    if (!canonical || !LOOP_CUES.has(canonical)) return false;
    const key = loopKey(canonical);
    if (!active) {
      const voice = loops.get(key);
      if (voice?.sample && canonical === "nitro") {
        const release = startSampleCue("boost-release", AUDIO_CUE_DEFINITIONS[canonical], .65);
        if (release) release.gain && callParam(release.gain.gain, "setValueAtTime", .045, nowFor(context));
      }
      stopVoice(voice, context, AUDIO_CUE_DEFINITIONS[canonical].release);
      loops.delete(key);
      return true;
    }
    if (!unlocked || !ensureContext() || !master) return false;
    const definition = AUDIO_CUE_DEFINITIONS[canonical];
    const nextState = { intensity: clamp(state.intensity ?? 1), speed: Math.max(0, finite(state.speed)), acceleration: finite(state.acceleration) };
    const existing = loops.get(key);
    if (existing) {
      const desiredSampleKey = sampleLoopKey(canonical, nextState);
      const desiredBuffer = desiredSampleKey ? sampleLoader?.get(desiredSampleKey) : null;
      if (desiredBuffer && (!existing.sample || existing.sampleKey !== desiredSampleKey)) {
        const replacement = createSampleVoice(context, master, desiredBuffer, definition, nowFor(context), {
          intensity: nextState.intensity, loop: true, rate: canonical === "motor" ? .78 : 1,
        });
        if (replacement) {
          replacement.state = nextState;
          replacement.sampleKey = desiredSampleKey;
          stopVoice(existing, context, .025);
          loops.set(key, replacement);
          return true;
        }
      }
      updateLoopVoice(existing, definition, context, nextState);
      return false;
    }
    const sampleKey = sampleLoopKey(canonical, nextState);
    const sample = sampleKey ? sampleLoader?.get(sampleKey) : null;
    if (sample) {
      const voice = createSampleVoice(context, master, sample, definition, nowFor(context), {
        intensity: nextState.intensity, loop: true, rate: canonical === "motor" ? .78 : 1,
      });
      if (voice) {
        voice.state = nextState;
        voice.sampleKey = sampleKey;
        loops.set(key, voice);
        if (canonical === "nitro") startSampleCue("boost-start", definition, nextState.intensity);
        return true;
      }
    }
    const voice = createLoopVoice(context, master, definition, nowFor(context), nextState);
    if (!voice) return false;
    loops.set(key, voice);
    return true;
  }

  function playCue(cue, { intensity = 1, force = false } = {}) {
    const canonical = canonicalCue(cue);
    if (!canonical || LOOP_CUES.has(canonical) || !unlocked || !ensureContext() || !master) return false;
    const definition = AUDIO_CUE_DEFINITIONS[canonical];
    const now = nowFor(context);
    const cooldown = Math.max(0, finite(definition.cooldown));
    const previous = lastCueAt.get(canonical);
    if (!force && previous !== undefined && now - previous < cooldown) return false;
    const sampleKey = SAMPLE_CUES[canonical];
    const sample = sampleKey ? sampleLoader?.get(sampleKey) : null;
    const voice = sample
      ? createSampleVoice(context, master, sample, definition, now, { intensity })
      : createVoice(context, master, definition, now, { intensity });
    if (!voice) return false;
    lastCueAt.set(canonical, now);
    return true;
  }

  function playFeedback(event) {
    const feedback = describeEventFeedback(event);
    return feedback.audioCue ? playCue(feedback.audioCue, { intensity: feedback.priority === "critical" ? .9 : .75 }) : false;
  }

  function setMotorState({ active = false, intensity = 1, speed = 0, acceleration = 0 } = {}) { return setLoop("motor", active, { intensity, speed, acceleration }); }
  function setNitroState({ active = false, intensity = 1, speed = 0, acceleration = 0 } = {}) { return setLoop("nitro", active, { intensity, speed, acceleration }); }
  function setDriftState({ active = false, intensity = 1, speed = 0, acceleration = 0 } = {}) { return setLoop("drift-loop", active, { intensity, speed, acceleration }); }
  function setVolume(nextVolume) { volume = clamp(nextVolume, 0, MAX_VOLUME); updateMaster(); return volume; }
  function setMuted(nextMuted) { muted = Boolean(nextMuted); updateMaster(); return muted; }
  function clear() { for (const voice of loops.values()) stopVoice(voice, context); loops.clear(); }

  async function dispose() {
    if (disposed) return;
    clear(); disposed = true;
    try { master?.disconnect?.(); } catch { /* no-op */ }
    try { if (context?.close) await context.close(); } catch { /* no-op */ }
    context = null; master = null; sampleLoader = null; sampleLoadStarted = false; combatPreload = null; unlocked = false; lastCueAt.clear();
  }

  return Object.freeze({
    unlock, unlockFromGesture: unlock, preloadCombat, playCue, play: playCue, playFeedback,
    startMotor: intensity => setMotorState({ active: true, intensity }), stopMotor: () => setMotorState({ active: false }),
    startNitro: intensity => setNitroState({ active: true, intensity }), stopNitro: () => setNitroState({ active: false }),
    startDrift: intensity => setDriftState({ active: true, intensity }), stopDrift: () => setDriftState({ active: false }),
    setMotorState, setNitroState, setDriftState, setVolume, setMuted, clear, dispose,
    getState: () => ({ supported: Boolean(factory), contextState: context?.state || "unavailable", unlocked, volume, muted, activeLoops: [...loops.keys()], samples: sampleLoader?.getState?.() || { loaded: [], failed: [], loading: false }, disposed }),
  });
}

export { AUDIO_CUE_DEFINITIONS, CUE_ALIASES, DEFAULT_VOLUME, MAX_VOLUME, SAMPLE_BANK, SAMPLE_CUES };
