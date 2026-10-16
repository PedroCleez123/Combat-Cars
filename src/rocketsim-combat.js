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
});

export function winnerForRocketSimScore(score, scoreToWin = ROCKETSIM_COMBAT.scoreToWin) {
  if (!score || !Number.isSafeInteger(scoreToWin) || scoreToWin < 1) return null;
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

export function createRocketSimCombatState() {
  return {
    time: 0,
    nextRocket: 1,
    rockets: [],
    players: new Map(),
    score: { blue: 0, red: 0 },
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

function fireRocket(state, car, player) {
  const forward = rotateVector(car.orientation, { x: 1, y: 0, z: 0 });
  const directionLength = length3(forward.x, forward.y, forward.z) || 1;
  forward.x /= directionLength; forward.y /= directionLength; forward.z /= directionLength;
  state.rockets.push({
    id: state.nextRocket++, owner: car.id, team: car.team,
    x: car.x + forward.x * 2.5, h: car.h + 1.1 + forward.y * 2.5, z: car.z + forward.z * 2.5,
    vx: forward.x * ROCKETSIM_COMBAT.rocketSpeed + (car.velocity?.x || 0),
    vh: forward.y * ROCKETSIM_COMBAT.rocketSpeed + (car.velocity?.y || 0),
    vz: forward.z * ROCKETSIM_COMBAT.rocketSpeed + (car.velocity?.z || 0),
    life: ROCKETSIM_COMBAT.rocketLife,
  });
  player.cooldown = ROCKETSIM_COMBAT.fireCooldown;
  state.events.push(event(`${car.name || "PILOTO"} lanza un cohete.`, "fire", state.time));
}

export function stepRocketSimCombat(state, cars, dt, inputs = new Map(), {
  halfWidth = ROCKETSIM_DEFAULT_COMBAT_BOUNDS.halfWidth,
  halfDepth = ROCKETSIM_DEFAULT_COMBAT_BOUNDS.halfDepth,
  ceilingHeight = ROCKETSIM_DEFAULT_COMBAT_BOUNDS.ceilingHeight,
  staticHits = new Map(),
} = {}) {
  if (!state || !Array.isArray(cars)) throw new Error("RocketSim combat needs state and cars");
  if (!Number.isFinite(dt) || dt <= 0 || dt > .25) throw new Error("RocketSim combat dt is invalid");
  state.time += dt;
  state.events = [];
  const active = new Map(cars.map(car => [car.id, car]));
  for (const car of cars) {
    const player = playerState(state, car);
    player.cooldown = Math.max(0, player.cooldown - dt);
    if (player.respawn > 0) player.respawn = Math.max(0, player.respawn - dt);
    const input = inputs instanceof Map ? (inputs.get(car.id) || {}) : (inputs[car.id] || {});
    const fire = Boolean(input.fire);
    if (fire && !player.fireHeld && player.cooldown <= 0 && player.respawn <= 0 && player.hp > 0) fireRocket(state, car, player);
    player.fireHeld = fire;
  }
  const remaining = [];
  const eliminated = [];
  for (const rocket of state.rockets) {
    rocket.life -= dt;
    const start = { x: rocket.x, y: rocket.h, z: rocket.z };
    rocket.x += rocket.vx * dt; rocket.h += rocket.vh * dt; rocket.z += rocket.vz * dt;
    const end = { x: rocket.x, y: rocket.h, z: rocket.z };
    let victim = null;
    let victimFraction = Infinity;
    for (const car of active.values()) {
      const player = playerState(state, car);
      if (car.team === rocket.team || car.id === rocket.owner || player.respawn > 0) continue;
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
    if (target.hp <= 0 && target.respawn <= 0) {
      target.respawn = ROCKETSIM_COMBAT.respawnDelay;
      target.deaths += 1;
      eliminated.push(victim.id);
      const attacker = playerState(state, active.get(rocket.owner) || { id: rocket.owner });
      attacker.kills += 1;
      if (rocket.owner && active.get(rocket.owner)?.team) state.score[active.get(rocket.owner).team] += 1;
      state.events.push(event(`${victim.name || "PILOTO"} queda fuera de combate.`, "elimination", state.time));
    }
  }
  state.rockets = remaining;
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
  return { hp: player.hp, respawn: player.respawn, kills: player.kills, deaths: player.deaths };
}
