export const WASM_TRACE_SCHEMA_VERSION = 1;
export const WASM_TRACE_FIXED_STEP_HZ = 120;
export const WASM_TRACE_FRAME_COUNT = 240;
export const WASM_TRACE_FIXTURE = "air-void-one-car-r1";

const finite = (value, label) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};

export function airVoidTraceInput(tick) {
  if (!Number.isSafeInteger(tick) || tick < 1 || tick > WASM_TRACE_FRAME_COUNT) {
    throw new Error("WASM trace tick is out of range");
  }
  // This portable input tape avoids floor/wall contact. It exercises boost and
  // two bounded steering directions after a neutral gravity segment.
  if (tick <= 60) return { throttle: 0, steer: 0, jump: false, boost: false };
  if (tick <= 120) return { throttle: 1, steer: 0, jump: false, boost: true };
  if (tick <= 180) return { throttle: 1, steer: 0.4, jump: false, boost: true };
  return { throttle: 0.25, steer: -0.25, jump: false, boost: true };
}

export function normalizeWasmTraceSnapshot(tick, values) {
  if (!Number.isSafeInteger(tick) || tick < 1) throw new Error("WASM trace tick is invalid");
  if (!Array.isArray(values) || values.length !== 9) throw new Error("WASM trace snapshot is invalid");
  const [x, y, z, vx, vy, vz, fx, fy, fz] = values.map((value, index) => finite(value, `WASM trace value ${index}`));
  // Native RocketSim is z-up; the public bridge is y-up and serializes
  // `{ x, y: native.z, z: native.y }`. Preserve that exact comparison basis.
  return {
    tick,
    state: {
      position: { x, y: z, z: y },
      velocity: { x: vx, y: vz, z: vy },
      forward: { x: fx, y: fz, z: fy },
    },
  };
}

export function forwardFromBridgeOrientation(orientation) {
  const x = finite(orientation?.x, "Bridge orientation.x");
  const y = finite(orientation?.y, "Bridge orientation.y");
  const z = finite(orientation?.z, "Bridge orientation.z");
  const w = finite(orientation?.w, "Bridge orientation.w");
  // The native bridge's quaternion converts to Three.js' x-forward/y-up/z-right
  // basis. Rotating its local +X gives the public forward vector.
  return {
    x: 1 - 2 * (y * y + z * z),
    y: 2 * (x * y + z * w),
    z: 2 * (x * z - y * w),
  };
}

function vectorDistance(left, right, label) {
  const delta = Math.hypot(
    finite(left?.x, `${label}.left.x`) - finite(right?.x, `${label}.right.x`),
    finite(left?.y, `${label}.left.y`) - finite(right?.y, `${label}.right.y`),
    finite(left?.z, `${label}.left.z`) - finite(right?.z, `${label}.right.z`),
  );
  return delta;
}

export function compareAirVoidTraces(wasmTrace, nativeTrace, { tolerance = 0.02 } = {}) {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("WASM trace tolerance is invalid");
  const validate = (trace, label) => {
    if (!trace || trace.schemaVersion !== WASM_TRACE_SCHEMA_VERSION || trace.fixture !== WASM_TRACE_FIXTURE
      || trace.fixedStepHz !== WASM_TRACE_FIXED_STEP_HZ || !Array.isArray(trace.samples)) {
      throw new Error(`${label} trace contract is invalid`);
    }
  };
  validate(wasmTrace, "WASM");
  validate(nativeTrace, "Native");
  if (wasmTrace.samples.length !== nativeTrace.samples.length || wasmTrace.samples.length !== WASM_TRACE_FRAME_COUNT) {
    throw new Error("WASM/native trace sample count differs");
  }
  const maximum = { position: 0, velocity: 0, forward: 0, tick: 0 };
  for (let index = 0; index < wasmTrace.samples.length; index += 1) {
    const wasmSample = wasmTrace.samples[index];
    const nativeSample = nativeTrace.samples[index];
    if (wasmSample.tick !== nativeSample.tick || wasmSample.tick !== index + 1) {
      throw new Error(`WASM/native trace tick differs at sample ${index + 1}`);
    }
    for (const key of ["position", "velocity", "forward"]) {
      const delta = vectorDistance(wasmSample.state?.[key], nativeSample.state?.[key], `${key}[${index}]`);
      if (delta > maximum[key]) {
        maximum[key] = delta;
        maximum.tick = wasmSample.tick;
      }
    }
  }
  const maxDelta = Math.max(maximum.position, maximum.velocity, maximum.forward);
  return { ok: maxDelta <= tolerance, tolerance, maximum, maxDelta };
}
