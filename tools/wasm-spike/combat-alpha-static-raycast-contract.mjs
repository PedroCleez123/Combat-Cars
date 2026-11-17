// P2P-WASM-15/16 shared browser-safe geometry and throughput contract.
// Keep this module free of Node-only imports: the Electron browser gate uses
// the exact same segments and workload as the local diagnostic runner.

export const P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS = Object.freeze([
  Object.freeze({ id: 1, from: Object.freeze({ x: 0, y: 100, z: 0 }), to: Object.freeze({ x: 0, y: -100, z: 0 }) }),
  // The public combat shell is 264 × 408 × 108.  These rays reach the
  // expanded lower/upper side curves and ceiling rather than stopping in the
  // previous 204 × 54 volume.
  Object.freeze({ id: 2, from: Object.freeze({ x: 2400, y: 82.142857, z: 0 }), to: Object.freeze({ x: 6000, y: 82.142857, z: 0 }) }),
  Object.freeze({ id: 3, from: Object.freeze({ x: 2400, y: 800, z: 0 }), to: Object.freeze({ x: 6000, y: 800, z: 0 }) }),
  Object.freeze({ id: 4, from: Object.freeze({ x: 0, y: 5000, z: 0 }), to: Object.freeze({ x: 0, y: 0, z: 0 }) }),
  Object.freeze({ id: 5, from: Object.freeze({ x: 2400, y: 800, z: 1600 }), to: Object.freeze({ x: 6000, y: 800, z: 4800 }) }),
  Object.freeze({ id: 6, from: Object.freeze({ x: -2400, y: 82.142857, z: -821.4286 }), to: Object.freeze({ x: 2400, y: 82.142857, z: -821.4286 }) }),
  Object.freeze({ id: 7, from: Object.freeze({ x: 2400, y: 62.18, z: 821.4286 }), to: Object.freeze({ x: -2400, y: 62.18, z: 821.4286 }) }),
  Object.freeze({ id: 8, from: Object.freeze({ x: -2400, y: 62.18, z: 0 }), to: Object.freeze({ x: 2400, y: 62.18, z: 0 }) }),
]);

// Twelve queries are deliberately above the two-player P2P diagnostic load:
// they reserve headroom for several overlapping projectiles without claiming
// a six-player public game. Two milliseconds P95 is 12% of one 60 Hz tick.
export const P2P_WASM_COMBAT_ALPHA_RAYCAST_WORKLOAD = Object.freeze({
  schemaVersion: 1,
  story: "P2P-WASM-16",
  profile: "combat-alpha",
  warmupFrames: 240,
  sampleFrames: 600,
  raysPerFrame: 12,
  maxP95Ms: 2,
  maxP99Ms: 4,
});

function finiteVector(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function finiteTiming(value) {
  return Number.isFinite(value) && value >= 0;
}

function safeWorkload(workload) {
  const merged = { ...P2P_WASM_COMBAT_ALPHA_RAYCAST_WORKLOAD, ...workload };
  if (!Number.isSafeInteger(merged.warmupFrames) || merged.warmupFrames < 0 || merged.warmupFrames > 10_000
    || !Number.isSafeInteger(merged.sampleFrames) || merged.sampleFrames < 10 || merged.sampleFrames > 100_000
    || !Number.isSafeInteger(merged.raysPerFrame) || merged.raysPerFrame < 1 || merged.raysPerFrame > 64
    || !finiteTiming(merged.maxP95Ms) || merged.maxP95Ms <= 0
    || !finiteTiming(merged.maxP99Ms) || merged.maxP99Ms < merged.maxP95Ms) {
    throw new TypeError("P2P-WASM-16 workload is invalid.");
  }
  return merged;
}

export function percentile(samples, ratio) {
  if (!Array.isArray(samples) || samples.length === 0 || !Number.isFinite(ratio) || ratio < 0 || ratio > 1
    || samples.some(value => !finiteTiming(value))) {
    throw new TypeError("P2P-WASM-16 percentile input is invalid.");
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

function assertModule(module) {
  const functions = ["_malloc", "_free", "_rs_destroy", "_rs_init_trace_combat_alpha", "_rs_raycast_static", "_rs_snapshot_car"];
  if (!module || functions.some(name => typeof module[name] !== "function")
    || !(module.HEAPF32 instanceof Float32Array) || !(module.HEAPU32 instanceof Uint32Array)) {
    throw new TypeError("RocketSim WASM module does not expose the P2P-WASM-16 benchmark ABI.");
  }
}

function readTick(module, tickPointer, statePointer) {
  if (module._rs_snapshot_car(0, tickPointer, statePointer) !== 1) {
    throw new Error("P2P-WASM-16 could not read the fixture tick.");
  }
  return module.HEAPU32[tickPointer >>> 2];
}

function assertRayResult(module, statePointer) {
  const values = module.HEAPF32.subarray(statePointer >>> 2, (statePointer >>> 2) + 8);
  if (![...values].every(Number.isFinite) || ![0, 1].includes(values[0]) || values[1] < 0 || values[1] > 1) {
    throw new Error("P2P-WASM-16 static raycast returned an invalid result.");
  }
  const result = {
    hit: values[0] === 1,
    fraction: values[1],
    point: { x: values[2], y: values[3], z: values[4] },
    normal: { x: values[5], y: values[6], z: values[7] },
  };
  if (!finiteVector(result.point) || !finiteVector(result.normal)) throw new Error("P2P-WASM-16 returned a non-finite vector.");
  return result;
}

function query(module, statePointer, segment) {
  if (module._rs_raycast_static(
    segment.from.x, segment.from.y, segment.from.z,
    segment.to.x, segment.to.y, segment.to.z,
    statePointer,
  ) !== 1) throw new Error(`P2P-WASM-16 raycast failed for segment ${segment.id}.`);
  return assertRayResult(module, statePointer);
}

export function evaluateP2PWasmCombatAlphaRaycastBenchmark({ samples, workload = {} } = {}) {
  const profile = safeWorkload(workload);
  const p50Ms = percentile(samples, .5);
  const p95Ms = percentile(samples, .95);
  const p99Ms = percentile(samples, .99);
  const maxMs = Math.max(...samples);
  return {
    workload: {
      sampleFrames: profile.sampleFrames,
      raysPerFrame: profile.raysPerFrame,
      totalRaycasts: profile.sampleFrames * profile.raysPerFrame,
      maxP95Ms: profile.maxP95Ms,
      maxP99Ms: profile.maxP99Ms,
    },
    timing: { p50Ms, p95Ms, p99Ms, maxMs },
    accepted: p95Ms <= profile.maxP95Ms && p99Ms <= profile.maxP99Ms,
  };
}

export function runP2PWasmCombatAlphaRaycastBenchmark({ module, now = () => performance.now(), workload = {} } = {}) {
  if (typeof now !== "function") throw new TypeError("P2P-WASM-16 clock must be a function.");
  const profile = safeWorkload(workload);
  assertModule(module);
  let tickPointer = 0;
  let statePointer = 0;
  let initialized = false;
  try {
    if (module._rs_init_trace_combat_alpha() !== 1) throw new Error("P2P-WASM-16 combat-alpha fixture failed to initialize.");
    initialized = true;
    tickPointer = module._malloc(Uint32Array.BYTES_PER_ELEMENT);
    statePointer = module._malloc(9 * Float32Array.BYTES_PER_ELEMENT);
    if (!Number.isSafeInteger(tickPointer) || tickPointer <= 0 || !Number.isSafeInteger(statePointer) || statePointer <= 0) {
      throw new Error("P2P-WASM-16 could not allocate its query buffers.");
    }
    const initialTick = readTick(module, tickPointer, statePointer);
    let queries = 0;
    let hitCount = 0;
    const executeFrame = frame => {
      for (let ray = 0; ray < profile.raysPerFrame; ray += 1) {
        const result = query(module, statePointer, P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS[(frame + ray) % P2P_WASM_COMBAT_ALPHA_STATIC_RAY_SEGMENTS.length]);
        queries += 1;
        if (result.hit) hitCount += 1;
      }
    };
    for (let frame = 0; frame < profile.warmupFrames; frame += 1) executeFrame(frame);
    const samples = [];
    for (let frame = 0; frame < profile.sampleFrames; frame += 1) {
      const startedAt = now();
      executeFrame(frame + profile.warmupFrames);
      const elapsed = now() - startedAt;
      if (!finiteTiming(elapsed)) throw new Error("P2P-WASM-16 clock returned an invalid elapsed duration.");
      samples.push(elapsed);
    }
    const finalTick = readTick(module, tickPointer, statePointer);
    if (initialTick !== finalTick) throw new Error("P2P-WASM-16 static raycasts advanced the fixture tick.");
    const measured = evaluateP2PWasmCombatAlphaRaycastBenchmark({ samples, workload: profile });
    return {
      schemaVersion: profile.schemaVersion,
      story: profile.story,
      profile: profile.profile,
      status: measured.accepted ? "pass" : "budget-exceeded",
      accepted: measured.accepted,
      ...measured,
      integrity: { initialTick, finalTick, warmupRaycasts: profile.warmupFrames * profile.raysPerFrame, measuredRaycasts: queries - profile.warmupFrames * profile.raysPerFrame, hitCount },
    };
  } finally {
    for (const pointer of [statePointer, tickPointer]) if (Number.isSafeInteger(pointer) && pointer > 0) module._free(pointer);
    if (initialized) module._rs_destroy();
  }
}
