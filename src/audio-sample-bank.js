/**
 * Small, user-authorized offline sample bank. Keep this list intentionally
 * short: more variants can be added without changing mixer call sites.
 */
export const SAMPLE_BANK = Object.freeze({
  "engine-idle": "assets/audio/engine/idle.wav",
  "engine-coast": "assets/audio/engine/coast-01.wav",
  "engine-loaded": "assets/audio/engine/loaded-01.wav",
  "boost-start": "assets/audio/boost/start.wav",
  "boost-loop": "assets/audio/boost/loop.wav",
  "boost-release": "assets/audio/boost/release.wav",
  jump: "assets/audio/vehicle/jump-01.wav",
  "double-jump": "assets/audio/vehicle/double-jump-01.wav",
  dodge: "assets/audio/vehicle/dodge-01.wav",
  "vehicle-impact": "assets/audio/impacts/vehicle-body-01.wav",
  "arena-impact": "assets/audio/impacts/arena-01.wav",
});

function defaultBaseUrl() {
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  if (typeof location !== "undefined" && location.href) return location.href;
  return "http://localhost/";
}

export function resolveSampleUrl(path, baseUrl) {
  try { return new URL(path, baseUrl || defaultBaseUrl()).href; } catch { return path; }
}

/** Lazy, failure-tolerant decoder. It never throws for a missing asset. */
export function createSampleLoader({ context, fetchImpl = globalThis.fetch, baseUrl, sampleBank = SAMPLE_BANK } = {}) {
  const buffers = new Map();
  const failed = new Set();
  let loading = null;

  async function decode(arrayBuffer) {
    if (typeof context?.decodeAudioData !== "function") return null;
    try {
      const result = context.decodeAudioData(arrayBuffer);
      return result && typeof result.then === "function" ? await result : result;
    } catch {
      return null;
    }
  }

  async function loadOne(key) {
    if (buffers.has(key) || failed.has(key)) return buffers.get(key) || null;
    const path = sampleBank[key];
    if (!path || typeof fetchImpl !== "function" || typeof context?.decodeAudioData !== "function") { failed.add(key); return null; }
    try {
      const response = await fetchImpl(resolveSampleUrl(path, baseUrl));
      if (!response?.ok) throw new Error(`sample HTTP ${response?.status || 0}`);
      const decoded = await decode(await response.arrayBuffer());
      if (!decoded) throw new Error("sample decode unavailable");
      buffers.set(key, decoded);
      return decoded;
    } catch {
      failed.add(key);
      return null;
    }
  }

  function loadAll(keys = Object.keys(sampleBank)) {
    if (!loading) loading = Promise.all(keys.map(loadOne)).then(() => true, () => false);
    return loading;
  }

  return Object.freeze({
    load: loadOne,
    loadAll,
    get: key => buffers.get(key) || null,
    has: key => buffers.has(key),
    getState: () => ({ loaded: [...buffers.keys()], failed: [...failed.keys()], loading: Boolean(loading) }),
  });
}
