import { rocketSimCombatBounds } from "./rocketsim-arena-profile.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const length3 = (x, y, z) => Math.hypot(x, y, z);

export const ROCKETSIM_DEFAULT_COMBAT_BOUNDS = Object.freeze(rocketSimCombatBounds("combat-alpha"));

export const ROCKETSIM_COMBAT = Object.freeze({
  scoreToWin: 15,
  maxHealth: 100,
  rocketDamage: 65,
  rocketSpeed: 74,
  rocketLife: 2.1,
  fireCooldown: .72,
  hitRadius: 3.5,
  respawnDelay: 2.35,
  guidanceRange: 90,
  guidanceConeRadians: Math.PI / 3,
  // Guided launches are aligned with the validated target direction. The
  // bounded turn rate is intentionally stronger than the original visual
  // assist, while the cone and total correction cap remain hard safety limits.
  guidanceTurnRadiansPerSecond: Math.PI * 1.5,
  guidanceMaxCorrectionRadians: Math.PI / 3,
  // A native RocketSim body can reach the supersonic band before a remote
  // snapshot arrives.  The host uses a swept contact test for this case so a
  // fast enemy ram is one authoritative elimination, rather than a client
  // side teleport or a repeated kill on subsequent snapshots.
  ramSpeedThreshold: 48,
  ramRelativeSpeedThreshold: 28,
  ramHitRadius: 5.2,
});

const safeTargetId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(value) ? value : null;

export function winnerForRocketSimScore(score, scoreToWin = ROCKETSIM_COMBAT.scoreToWin, mode = "teams") {
  if (!score || !Number.isSafeInteger(scoreToWin) || scoreToWin < 1) return null;
  if (mode === "ffa") {
    return Object.keys(score).sort().find(id => Number(score[id]) >= scoreToWin) || null;
  }
  if (Number(score.blue) >= scoreToWin) return "blue";
  if (Number(score.red) >= scoreToWin) return "red";
  return null;
}

function rotateVector(quaternion, vector) {
  const ix = quaternion.w * vector.x + quaternion.y * vector.z - quaternion.z * vector.y;
  const iy = quaternion.w * vector.y + quaternion.z * vector.x - quaternion.x * vector.z;
  const iz = quaternion.w * vector.z + quaternion.x * vector.y - quaternion.y * vector.x;
  const iw = -quaternion.x * vector.x - quaternion.y * vector.y - quaternion.z * vector.z;
  return {
    x: ix * quaternion.w + iw * -quaternion.x + iy * -quaternion.z - iz * -quaternion.y,
    y: iy * quaternion.w + iw * -quaternion.y + iz * -quaternion.x - ix * -quaternion.z,
    z: iz * quaternion.w + iw * -quaternion.z + ix * -quaternion.y - iy * -quaternion.x,
  };
}

function event(text, kind, at) {
  return { text, kind, at: Math.round(at * 100) / 100 };
}

function segmentSphereHitFraction(start, end, centre, radius) {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const ox = start.x - centre.x, oy = start.y - centre.y, oz = start.z - centre.z;
  const a = dx * dx + dy * dy + dz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  if (a <= 1e-9) return null;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  if (second >= 0 && second <= 1) return second;
  return null;
}

export function createRocketSimCombatState({ mode = "teams" } = {}) {
  if (mode !== "teams" && mode !== "ffa") throw new TypeError("El modo de combate RocketSim no es válido.");
  return {
    mode,
    time: 0,
    nextRocket: 1,
    rockets: [],
    players: new Map(),
    score: mode === "ffa" ? {} : { blue: 0, red: 0 },
    events: [],
  };
}

function playerState(state, car) {
  let player = state.players.get(car.id);
  if (!player) {
    player = { hp: ROCKETSIM_COMBAT.maxHealth, cooldown: 0, fireHeld: false, respawn: 0, kills: 0, deaths: 0 };
    state.players.set(car.id, player);
  }
  return player;
}

function fireRocket(state, car, player, requestedTargetId) {
  const forward = rotateVector(car.orientation, { x: 1, y: 0, z: 0 });
  const directionLength = length3(forward.x, forward.y, forward.z) || 1;
  forward.x /= directionLength; forward.y /= directionLength; forward.z /= directionLength;
  requestedTargetId = safeTargetId(requestedTargetId);
  const target = requestedTargetId === null ? null : state._activeCars?.get(requestedTargetId);
  const targetPlayer = target ? playerState(state, target) : null;
  const dx = target ? target.x - car.x : 0, dy = target ? target.h - car.h : 0, dz = target ? target.z - car.z : 0;
  const distance = length3(dx, dy, dz);
  const targetForward = target ? distance > 0 && distance <= ROCKETSIM_COMBAT.guidanceRange
    && (state.mode === "ffa" ? target.id !== car.id : target.team !== car.team)
    && targetPlayer.hp > 0 && targetPlayer.respawn <= 0
    && (dx * forward.x + dy * forward.y + dz * forward.z) / distance >= Math.cos(ROCKETSIM_COMBAT.guidanceConeRadians) : false;
  const guided = Boolean(targetForward);
  // Once the server accepts a target, the launch vector and the laser's
  // world-space aim share the same direction. Preserve only forward vehicle
  // momentum as extra speed; never let lateral momentum bend a guided shot.
  const launch = guided ? { x: dx / distance, y: dy / distance, z: dz / distance } : forward;
  const launchMomentum = guided
    ? Math.max(0, (car.velocity?.x || 0) * launch.x + (car.velocity?.y || 0) * launch.y + (car.velocity?.z || 0) * launch.z)
    : 0;
  const vx = launch.x * (ROCKETSIM_COMBAT.rocketSpeed + launchMomentum) + (guided ? 0 : (car.velocity?.x || 0));
  const vh = launch.y * (ROCKETSIM_COMBAT.rocketSpeed + launchMomentum) + (guided ? 0 : (car.velocity?.y || 0));
  const vz = launch.z * (ROCKETSIM_COMBAT.rocketSpeed + launchMomentum) + (guided ? 0 : (car.velocity?.z || 0));
  const speed = length3(vx, vh, vz) || ROCKETSIM_COMBAT.rocketSpeed;
  const spawnDirection = guided ? launch : forward;
  state.rockets.push({
    id: state.nextRocket++, owner: car.id, team: car.team,
    x: car.x + spawnDirection.x * 2.5, h: car.h + 1.1 + spawnDirection.y * 2.5, z: car.z + spawnDirection.z * 2.5,
    vx, vh, vz,
    ...(guided ? { targetId: target.id, targetTeam: target.team, guidanceSpeed: speed, initialDirection: { x: vx / speed, y: vh / speed, z: vz / speed } } : {}),
    life: ROCKETSIM_COMBAT.rocketLife,
  });
  player.cooldown = ROCKETSIM_COMBAT.fireCooldown;
  state.events.push(event(`${car.name || "PILOTO"} lanza un cohete.`, "fire", state.time));
}

function steerRocketTowardCapturedTarget(state, rocket, active, dt) {
  const target = rocket.targetId ? active.get(rocket.targetId) : null;
  const targetState = target ? playerState(state, target) : null;
  if (!target || (state.mode === "ffa" ? target.id === rocket.owner : target.team !== rocket.targetTeam) || targetState.hp <= 0 || targetState.respawn > 0) return;
  const desiredX = target.x - rocket.x, desiredY = target.h - rocket.h, desiredZ = target.z - rocket.z;
  const desiredLength = length3(desiredX, desiredY, desiredZ);
  const velocityLength = length3(rocket.vx, rocket.vh, rocket.vz);
  if (desiredLength <= 1e-6 || velocityLength <= 1e-6) return;
  const current = { x: rocket.vx / velocityLength, y: rocket.vh / velocityLength, z: rocket.vz / velocityLength };
  const desired = { x: desiredX / desiredLength, y: desiredY / desiredLength, z: desiredZ / desiredLength };
  // A captured id is never retargeted, and guidance stops if the same target
  // leaves the validated range or front cone during flight.
  if (desiredLength > ROCKETSIM_COMBAT.guidanceRange
    || desired.x * rocket.initialDirection.x + desired.y * rocket.initialDirection.y + desired.z * rocket.initialDirection.z < Math.cos(ROCKETSIM_COMBAT.guidanceConeRadians)) return;
  const angle = Math.acos(clamp(current.x * desired.x + current.y * desired.y + current.z * desired.z, -1, 1));
  const correctionLeft = Math.acos(clamp(current.x * rocket.initialDirection.x + current.y * rocket.initialDirection.y + current.z * rocket.initialDirection.z, -1, 1));
  const step = Math.min(angle, ROCKETSIM_COMBAT.guidanceTurnRadiansPerSecond * dt, Math.max(0, ROCKETSIM_COMBAT.guidanceMaxCorrectionRadians - correctionLeft));
  if (step <= 1e-9) return;
  const sinAngle = Math.sin(angle);
  const steer = angle < 1e-6 ? desired : sinAngle > 1e-6
    ? { x: (Math.sin(angle - step) * current.x + Math.sin(step) * desired.x) / sinAngle, y: (Math.sin(angle - step) * current.y + Math.sin(step) * desired.y) / sinAngle, z: (Math.sin(angle - step) * current.z + Math.sin(step) * desired.z) / sinAngle }
    : current;
  rocket.vx = steer.x * rocket.guidanceSpeed; rocket.vh = steer.y * rocket.guidanceSpeed; rocket.vz = steer.z * rocket.guidanceSpeed;
}

// The Node session calls this before native static raycasts so the authoritative
// collision segment follows exactly the same bounded turn as the combat step.
export function prepareRocketSimGuidance(state, cars, dt) {
  if (!state || !Array.isArray(cars) || !Number.isFinite(dt) || dt <= 0 || dt > .25) throw new Error("RocketSim guidance preparation is invalid");
  const active = new Map(cars.map(car => [car.id, car]));
  for (const rocket of state.rockets) steerRocketTowardCapturedTarget(state, rocket, active, dt);
}

export function stepRocketSimCombat(state, cars, dt, inputs = new Map(), {
  halfWidth = ROCKETSIM_DEFAULT_COMBAT_BOUNDS.halfWidth,
  halfDepth = ROCKETSIM_DEFAULT_COMBAT_BOUNDS.halfDepth,
  ceilingHeight = ROCKETSIM_DEFAULT_COMBAT_BOUNDS.ceilingHeight,
  staticHits = new Map(),
  guidancePrepared = false,
  ramHits = [],
} = {}) {
  if (!state || !Array.isArray(cars)) throw new Error("RocketSim combat needs state and cars");
  if (!Number.isFinite(dt) || dt <= 0 || dt > .25) throw new Error("RocketSim combat dt is invalid");
  state.time += dt;
  state.events = [];
  const active = new Map(cars.map(car => [car.id, car]));
  state._activeCars = active;
  if (state.mode === "ffa") {
    for (const car of cars) state.score[car.id] ??= 0;
  }
  for (const car of cars) {
    const player = playerState(state, car);
    player.cooldown = Math.max(0, player.cooldown - dt);
    if (player.respawn > 0) player.respawn = Math.max(0, player.respawn - dt);
    const input = inputs instanceof Map ? (inputs.get(car.id) || {}) : (inputs[car.id] || {});
    const fire = Boolean(input.fire);
    if (fire && !player.fireHeld && player.cooldown <= 0 && player.respawn <= 0 && player.hp > 0) fireRocket(state, car, player, input.targetId);
    player.fireHeld = fire;
  }
  const remaining = [];
  const eliminated = [];
  const eliminatedSet = new Set();
  const eliminate = (victim, attacker, { text = null } = {}) => {
    if (!victim || eliminatedSet.has(victim.id)) return false;
    const target = playerState(state, victim);
    if (target.respawn > 0) return false;
    target.hp = 0;
    target.respawn = ROCKETSIM_COMBAT.respawnDelay;
    target.deaths += 1;
    eliminatedSet.add(victim.id);
    eliminated.push(victim.id);
    const killer = attacker ? playerState(state, attacker) : null;
    if (killer) killer.kills += 1;
    const scoreKey = state.mode === "ffa" ? attacker?.id : attacker?.team;
    if (scoreKey) state.score[scoreKey] = (state.score[scoreKey] || 0) + 1;
    state.events.push(event(text || `${victim.name || "PILOTO"} queda fuera de combate.`, "elimination", state.time));
    return true;
  };
  for (const rocket of state.rockets) {
    rocket.life -= dt;
    if (!guidancePrepared) steerRocketTowardCapturedTarget(state, rocket, active, dt);
    const start = { x: rocket.x, y: rocket.h, z: rocket.z };
    rocket.x += rocket.vx * dt; rocket.h += rocket.vh * dt; rocket.z += rocket.vz * dt;
    const end = { x: rocket.x, y: rocket.h, z: rocket.z };
    let victim = null;
    let victimFraction = Infinity;
    for (const car of active.values()) {
      const player = playerState(state, car);
      if ((state.mode === "ffa" ? car.id === rocket.owner : car.team === rocket.team) || player.respawn > 0) continue;
      const fraction = segmentSphereHitFraction(start, end, { x: car.x, y: car.h, z: car.z }, ROCKETSIM_COMBAT.hitRadius);
      if (fraction !== null && fraction < victimFraction) { victim = car; victimFraction = fraction; }
    }
    const staticHit = staticHits instanceof Map ? staticHits.get(rocket.id) : staticHits?.[rocket.id];
    if (staticHit?.hit === true && staticHit.fraction <= victimFraction) {
      state.events.push(event("COHETE INTERCEPTADO", "miss", state.time));
      continue;
    }
    const outOfBounds = Math.abs(rocket.x) > halfWidth || Math.abs(rocket.z) > halfDepth || rocket.h < -2 || rocket.h > ceilingHeight;
    if (!victim && !outOfBounds && rocket.life > 0) { remaining.push(rocket); continue; }
    if (!victim) {
      state.events.push(event("COHETE DETONADO", "miss", state.time));
      continue;
    }
    const target = playerState(state, victim);
    target.hp = Math.max(0, target.hp - ROCKETSIM_COMBAT.rocketDamage);
    state.events.push(event(`IMPACTO EN ${victim.name || "PILOTO"} · -${ROCKETSIM_COMBAT.rocketDamage} blindaje`, "hit", state.time));
    if (target.hp <= 0 && target.respawn <= 0) eliminate(victim, active.get(rocket.owner) || { id: rocket.owner, team: rocket.team });
  }
  // Ramming is resolved after projectile contacts in the same fixed tick. The
  // host supplies only swept, native-derived contacts; clients never infer or
  // replay this list. A victim is removed from the active physics slot once,
  // then the normal authoritative respawn path restores it at its spawn.
  for (const hit of Array.isArray(ramHits) ? ramHits : []) {
    if (!hit || typeof hit !== "object") continue;
    const attacker = active.get(hit.attackerId);
    const victim = active.get(hit.victimId);
    const impactSpeed = Number(hit.impactSpeed);
    if (!attacker || !victim || attacker.id === victim.id || !Number.isFinite(impactSpeed)
      || impactSpeed < ROCKETSIM_COMBAT.ramSpeedThreshold
      || (state.mode === "ffa" ? attacker.id === victim.id : attacker.team === victim.team)) continue;
    const attackerState = playerState(state, attacker);
    const victimState = playerState(state, victim);
    if (attackerState.hp <= 0 || attackerState.respawn > 0 || victimState.hp <= 0 || victimState.respawn > 0) continue;
    if (Number.isFinite(hit.relativeSpeed) && hit.relativeSpeed < ROCKETSIM_COMBAT.ramRelativeSpeedThreshold) continue;
    eliminate(victim, attacker, { text: `${attacker.name || "PILOTO"} embiste a ${victim.name || "PILOTO"}.` });
  }
  state.rockets = remaining;
  delete state._activeCars;
  const respawns = [];
  for (const car of cars) {
    const player = playerState(state, car);
    if (player.respawn === 0 && player.hp === 0) {
      player.hp = ROCKETSIM_COMBAT.maxHealth;
      player.fireHeld = false;
      respawns.push(car.id);
      state.events.push(event(`${car.name || "PILOTO"} reaparece.`, "respawn", state.time));
    }
  }
  return {
    eliminated,
    respawns,
    rockets: state.rockets.map(rocket => ({ ...rocket })),
    score: { ...state.score },
    events: state.events.slice(),
  };
}

export function combatViewFor(state, car) {
  const player = playerState(state, car);
  return {
    hp: player.hp,
    respawn: player.respawn,
    kills: player.kills,
    deaths: player.deaths,
    rocketCooldown: Math.max(0, Math.round(player.cooldown * 100) / 100),
  };
}
