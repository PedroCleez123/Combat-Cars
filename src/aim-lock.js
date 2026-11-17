// Client-only target selection. Candidates are supplied by the caller after
// viewport/front/range checks; presentation geometry is deliberately not used
// for occlusion because it does not match RocketSim's authoritative collision.

function compareCandidates(left, right) {
  const leftScreen = Number.isFinite(left?.screenDistance) ? left.screenDistance : Number.POSITIVE_INFINITY;
  const rightScreen = Number.isFinite(right?.screenDistance) ? right.screenDistance : Number.POSITIVE_INFINITY;
  if (leftScreen !== rightScreen) return leftScreen - rightScreen;
  const leftDistance = Number.isFinite(left?.distance) ? left.distance : Number.POSITIVE_INFINITY;
  const rightDistance = Number.isFinite(right?.distance) ? right.distance : Number.POSITIVE_INFINITY;
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function eligibleCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .filter(candidate => candidate?.eligible && candidate.id != null)
    .slice()
    .sort(compareCandidates);
}

function clearAimLock(state) {
  state.targetId = null;
  state.targetDeaths = null;
  state.valid = false;
  state.visible = false;
  state.offscreen = false;
  state.direction = null;
  state.lastEligibleAt = -Infinity;
  return state;
}

function setAimLock(state, candidate, now) {
  const targetId = candidate?.id ?? null;
  state.targetId = targetId;
  state.targetDeaths = Number.isFinite(candidate?.deaths) ? candidate.deaths : null;
  state.valid = targetId !== null;
  state.visible = Boolean(targetId !== null && (candidate?.screenVisible ?? candidate?.visible ?? candidate?.eligible));
  state.offscreen = Boolean(targetId !== null && !state.visible);
  state.direction = null;
  state.lastEligibleAt = targetId === null ? -Infinity : now;
  return state;
}

export function createAimLockState() {
  return {
    targetId: null,
    targetDeaths: null,
    valid: false,
    // `visible` describes viewport projection only. Eligibility for a new
    // selection additionally requires range and forward-cone checks.
    visible: false,
    offscreen: false,
    direction: null,
    // Kept for compatibility with the existing client diagnostics. Visibility
    // never uses this value as a timeout; authoritative state is the source of
    // invalidation.
    lastEligibleAt: -Infinity,
  };
}

export function chooseAimTarget(candidates) {
  return eligibleCandidates(candidates)[0]?.id ?? null;
}

// A lock press starts a lock, then advances through the currently visible
// candidates in deterministic screen/distance/id order. An empty candidate
// set is an explicit cancel action, including when the previous target is
// currently offscreen.
export function cycleAimTarget(state, candidates, now = 0) {
  const choices = eligibleCandidates(candidates);
  if (!choices.length) return clearAimLock(state);
  if (state.targetId === null) return setAimLock(state, choices[0], now);

  const currentIndex = choices.findIndex(candidate => candidate.id === state.targetId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % choices.length;
  return setAimLock(state, choices[nextIndex], now);
}

// Retained as the client-facing name used by the input binding.
export function toggleAimLock(state, candidates, now = 0) {
  return cycleAimTarget(state, candidates, now);
}

function isAuthoritativeTarget(target) {
  if (!target) return false;
  if (target.hp != null && target.hp <= 0) return false;
  if (target.respawn != null && target.respawn > 0) return false;
  // Optional flags allow callers that expose a session membership bit to make
  // removal explicit without coupling this helper to a protocol shape.
  if (target.inSession === false || target.sessionActive === false || target.active === false) return false;
  return true;
}

// Keep the selected id while the authoritative snapshot still contains a live
// target. The target may leave the viewport for any duration; it is only
// cleared when the authoritative state removes/disables it. A fresh press is
// required to select another candidate.
export function updateAimLock(state, candidates, cars, now = 0) {
  if (state.targetId === null) {
    state.valid = false;
    state.visible = false;
    state.offscreen = false;
    state.direction = null;
    return state;
  }
  const target = Array.isArray(cars) ? cars.find(car => car?.id === state.targetId) : null;
  if (!isAuthoritativeTarget(target) || (state.targetDeaths !== null && Number.isFinite(target.deaths) && target.deaths > state.targetDeaths)) return clearAimLock(state);

  if (state.targetDeaths === null && Number.isFinite(target.deaths)) state.targetDeaths = target.deaths;
  const projection = Array.isArray(candidates) ? candidates.find(candidate => candidate?.id === state.targetId) : null;
  const visible = Boolean(projection?.screenVisible ?? projection?.visible ?? projection?.eligible);
  state.valid = true;
  state.visible = visible;
  state.offscreen = !visible;
  state.direction = null;
  if (visible) state.lastEligibleAt = now;
  return state;
}

// Convert a projected point (Three.js NDC coordinates) to a stable edge marker
// direction. Behind-camera points are flipped so the marker points toward the
// shortest screen-space direction back to the target.
export function computeAimDirection(projected, edge = .88) {
  const x = Number(projected?.x);
  const y = Number(projected?.y);
  const z = Number(projected?.z);
  if (![x, y, z].every(Number.isFinite)) return { visible: false, offscreen: false, directionX: 0, directionY: 0, edgeX: 0, edgeY: 0, angle: 0 };
  const behind = z < -1 || z > 1;
  let directionX = x;
  let directionY = y;
  if (behind) {
    directionX = -directionX;
    directionY = -directionY;
    if (Math.hypot(directionX, directionY) < Number.EPSILON) directionY = -1;
  }
  const visible = !behind && Math.abs(directionX) <= 1 && Math.abs(directionY) <= 1;
  if (visible) return { visible: true, offscreen: false, directionX, directionY, edgeX: directionX, edgeY: directionY, angle: Math.atan2(-directionY, directionX) };
  const extent = Math.max(Math.abs(directionX), Math.abs(directionY), Number.EPSILON);
  const normalizedX = directionX / extent;
  const normalizedY = directionY / extent;
  return {
    visible: false,
    offscreen: true,
    directionX,
    directionY,
    edgeX: normalizedX * edge,
    edgeY: normalizedY * edge,
    angle: Math.atan2(-normalizedY, normalizedX),
  };
}

// Alias with a verb that reads naturally at call sites and in tests.
export const getAimDirection = computeAimDirection;
