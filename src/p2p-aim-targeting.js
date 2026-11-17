// Presentation-only counterpart of src/client.js refreshAimCandidates().
// It intentionally accepts a projector from the active renderer: target
// selection depends on the displayed camera but never on decorative geometry
// or a client-side physics raycast.

export const P2P_AIM_LOCK_RANGE = 90;
export const P2P_AIM_LOCK_FORWARD_DOT = .12;
export const P2P_AIM_TARGET_HEIGHT = 1.2;

function finite(value) { return typeof value === "number" && Number.isFinite(value); }

function forwardFromOrientation(orientation) {
  if (!orientation || ![orientation.x, orientation.y, orientation.z, orientation.w].every(finite)) return null;
  // Rotate the local Arsenal forward vector (1, 0, 0) by the authoritative
  // quaternion. This is the same heading src/client.js derives from its car
  // mesh, without asking the presentation mesh to simulate a transform.
  const { x, y, z, w } = orientation;
  return {
    x: 1 - 2 * (y * y + z * z),
    y: 2 * (x * y + z * w),
    z: 2 * (x * z - y * w),
  };
}

function targetIsActive(car, local) {
  const sameTeam = local.team !== null && local.team !== undefined && car.team === local.team;
  return car && car.id !== local.id && !sameTeam
    && !(finite(car.hp) && car.hp <= 0)
    && !(finite(car.respawn) && car.respawn > 0)
    && car.alive !== false;
}

/**
 * Gather the same deterministic candidate facts consumed by aim-lock.js.
 * `project` maps a world point to Three.js-like NDC; it may return null when
 * the rendering surface is not initialized. The output is read-only input to
 * an intent sender, never a gameplay decision made by the host.
 */
export function collectP2PAimCandidates({ cars, focusCarId, project, range = P2P_AIM_LOCK_RANGE } = {}) {
  if (!Array.isArray(cars) || typeof focusCarId !== "string" || typeof project !== "function"
    || !finite(range) || range <= 0) return Object.freeze([]);
  const local = cars.find(car => car?.id === focusCarId);
  const forward = forwardFromOrientation(local?.orientation);
  if (!local || !forward || ![local.x, local.h, local.z].every(finite)
    || (finite(local.respawn) && local.respawn > 0) || local.alive === false) return Object.freeze([]);

  const candidates = [];
  for (const car of cars) {
    if (!targetIsActive(car, local) || ![car.x, car.h, car.z].every(finite)) continue;
    const dx = car.x - local.x;
    const dy = (car.h + P2P_AIM_TARGET_HEIGHT) - (local.h + P2P_AIM_TARGET_HEIGHT);
    const dz = car.z - local.z;
    const distance = Math.hypot(dx, dy, dz);
    let projected = null;
    try { projected = project({ x: car.x, h: car.h + P2P_AIM_TARGET_HEIGHT, z: car.z }); } catch { projected = null; }
    const projectionIsFinite = projected && [projected.x, projected.y, projected.z].every(finite);
    const screenVisible = Boolean(projectionIsFinite
      && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1);
    const forwardDot = distance > 0 ? (dx * forward.x + dy * forward.y + dz * forward.z) / distance : -1;
    candidates.push(Object.freeze({
      id: car.id,
      eligible: screenVisible && distance > 0 && distance <= range && forwardDot >= P2P_AIM_LOCK_FORWARD_DOT,
      screenVisible,
      distance,
      screenDistance: projectionIsFinite ? projected.x * projected.x + projected.y * projected.y : Number.POSITIVE_INFINITY,
      deaths: Number.isFinite(car.deaths) ? car.deaths : null,
    }));
  }
  return Object.freeze(candidates);
}

/**
 * Pick the presentation candidate that is closest to the reticle. The host
 * still validates the resulting target against its authoritative roster; this
 * helper only prevents the online client from choosing an arbitrary roster
 * entry when Q is pressed.
 */
export function chooseP2PAimTarget(candidates, allowedTargetIds = null) {
  if (!Array.isArray(candidates)) return null;
  const allowed = allowedTargetIds instanceof Set
    ? allowedTargetIds
    : new Set(Array.isArray(allowedTargetIds) ? allowedTargetIds : []);
  const eligible = candidates.filter(candidate => candidate?.eligible === true
    && typeof candidate.id === "string"
    && (allowed.size === 0 || allowed.has(candidate.id)));
  eligible.sort((a, b) => {
    const screen = (finite(a.screenDistance) ? a.screenDistance : Number.POSITIVE_INFINITY)
      - (finite(b.screenDistance) ? b.screenDistance : Number.POSITIVE_INFINITY);
    if (screen !== 0) return screen;
    const distance = (finite(a.distance) ? a.distance : Number.POSITIVE_INFINITY)
      - (finite(b.distance) ? b.distance : Number.POSITIVE_INFINITY);
    return distance || a.id.localeCompare(b.id);
  });
  return eligible[0]?.id || null;
}
