// Presentation-only snapshot buffering. The server remains authoritative; this
// module never predicts, integrates, or feeds values back into the simulation.
export const SNAPSHOT_INTERPOLATION_DELAY = 1 / 60;

const MAX_CONTINUOUS_GAP = .25;
const MAX_CONTINUOUS_CAR_DISTANCE = 12;

const clamp01 = value => Math.max(0, Math.min(1, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

function normalizedQuaternion(quaternion) {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
  return {
    x: quaternion.x / length, y: quaternion.y / length,
    z: quaternion.z / length, w: quaternion.w / length
  };
}

export function slerpQuaternion(from, to, amount) {
  const t = clamp01(amount);
  const start = normalizedQuaternion(from);
  let end = normalizedQuaternion(to);
  let dot = start.x * end.x + start.y * end.y + start.z * end.z + start.w * end.w;
  // q and -q describe the same attitude. Taking the short arc prevents a
  // visible full spin when snapshots use opposite quaternion signs.
  if (dot < 0) { end = { x: -end.x, y: -end.y, z: -end.z, w: -end.w }; dot = -dot; }
  if (dot > .9995) return normalizedQuaternion({
    x: lerp(start.x, end.x, t), y: lerp(start.y, end.y, t),
    z: lerp(start.z, end.z, t), w: lerp(start.w, end.w, t)
  });
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sine = Math.sin(angle);
  const left = Math.sin((1 - t) * angle) / sine;
  const right = Math.sin(t * angle) / sine;
  return {
    x: start.x * left + end.x * right, y: start.y * left + end.y * right,
    z: start.z * left + end.z * right, w: start.w * left + end.w * right
  };
}

export function canInterpolateCar(previous, current) {
  if (!previous || !current || previous.id !== current.id) return false;
  if (previous.respawn > 0 || current.respawn > 0) return false;
  const distance = Math.hypot(current.x - previous.x, current.h - previous.h, current.z - previous.z);
  return Number.isFinite(distance) && distance <= MAX_CONTINUOUS_CAR_DISTANCE;
}

export function interpolateState(previous, current, amount) {
  if (!previous || !current) return current || previous || null;
  const previousCars = new Map(previous.cars.map(car => [car.id, car]));
  const t = clamp01(amount);
  return {
    ...current,
    cars: current.cars.map(car => {
      const prior = previousCars.get(car.id);
      if (!canInterpolateCar(prior, car)) return car;
      const pose = {
        x: lerp(prior.x, car.x, t), h: lerp(prior.h, car.h, t), z: lerp(prior.z, car.z, t)
      };
      if (prior.orientation && car.orientation) pose.orientation = slerpQuaternion(prior.orientation, car.orientation, t);
      return { ...car, ...pose };
    })
  };
}

function continuous(previous, current) {
  if (!previous || !current || !Number.isFinite(previous.time) || !Number.isFinite(current.time)) return false;
  if (current.time <= previous.time || current.time - previous.time > MAX_CONTINUOUS_GAP) return false;
  if (previous.settings?.arena !== current.settings?.arena) return false;
  if (previous.settings?.roundSerial !== undefined
    && current.settings?.roundSerial !== undefined
    && previous.settings.roundSerial !== current.settings.roundSerial) return false;
  return true;
}

export class SnapshotInterpolator {
  constructor(delay = SNAPSHOT_INTERPOLATION_DELAY) {
    this.delay = delay;
    this.snapshots = [];
  }

  reset(snapshot = null) {
    this.snapshots = snapshot ? [{ state: snapshot, receivedAt: null }] : [];
  }

  push(snapshot, receivedAt = null) {
    const latest = this.snapshots.at(-1);
    if (latest && !continuous(latest.state, snapshot)) this.reset();
    this.snapshots.push({ state: snapshot, receivedAt });
    if (this.snapshots.length > 4) this.snapshots.shift();
  }

  sample(now = null) {
    const latest = this.snapshots.at(-1);
    if (!latest || this.snapshots.length < 2 || !Number.isFinite(latest.state.time)) return latest?.state || null;
    // Advance from the most recently received authoritative tick using wall
    // time, but render one network interval behind it. With steady 60 Hz
    // state delivery, this samples smoothly from the previous pose to the
    // newest pose between packets. If a packet stalls, it stops at the last
    // known pose instead of turning a stale velocity into an uncontrolled
    // extrapolation.
    const elapsed = Number.isFinite(now) && Number.isFinite(latest.receivedAt)
      ? Math.max(0, now - latest.receivedAt)
      : 0;
    const targetTime = Math.min(latest.state.time, latest.state.time + elapsed - this.delay);
    const first = this.snapshots[0].state;
    if (targetTime <= first.time) return first;
    for (let index = 1; index < this.snapshots.length; index += 1) {
      const current = this.snapshots[index].state;
      const previous = this.snapshots[index - 1].state;
      if (targetTime <= current.time) {
        const span = current.time - previous.time;
        return interpolateState(previous, current, span > 0 ? (targetTime - previous.time) / span : 1);
      }
    }
    // The buffer deliberately freezes on the latest known state rather than
    // extrapolating an unbounded ghost after a slow or stalled connection.
    return latest.state;
  }
}
