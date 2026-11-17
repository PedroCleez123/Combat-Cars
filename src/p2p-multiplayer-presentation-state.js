// Presentation-only adapter for the v6 six-car envelope. It is intentionally
// independent from the 1v1 adapter so the deployed path cannot accidentally
// accept a larger roster without the explicit multiparty session.
import { attitudeFromRocketSimOrientation } from "./rocketsim-practice-match.js";
import { decodeP2PWasmMultiplayerEnvelope } from "../tools/wasm-spike/p2p-wasm-multiplayer-protocol.mjs";

function contactFor(telemetry) { return telemetry.wheelContact.hasContact ? telemetry.wheelContact : telemetry.worldContact.hasContact ? telemetry.worldContact : null; }
function surfaceFor(telemetry) { const contact = contactFor(telemetry); if (!contact) return telemetry.grounded ? { kind: "ground", contact: null } : { kind: "air", contact: null }; if (contact.normal.y < -.65) return { kind: "ceiling", contact }; if (Math.abs(contact.normal.y) < .35) return { kind: "wall", contact }; return { kind: "ground", contact }; }

export function createP2PMultiplayerPresentationState(envelope, { roomId = null, sessionId = null } = {}) {
  const decoded = typeof envelope === "string" ? decodeP2PWasmMultiplayerEnvelope(envelope) : envelope;
  if (!decoded || decoded.protocolVersion !== 6 || !decoded.snapshot || (roomId !== null && decoded.roomId !== roomId) || (sessionId !== null && decoded.sessionId !== sessionId)) throw new TypeError("El sobre multijugador no coincide con el contexto de presentación.");
  const cars = decoded.snapshot.cars.map(car => {
    const physical = car.physical; const telemetry = car.presentation; const combat = car.combat; const surface = surfaceFor(telemetry); const contact = surface.contact; const attitude = attitudeFromRocketSimOrientation(telemetry.orientation);
    const velocity = { x: physical.vx, y: physical.vh, z: physical.vz };
    return {
      id: car.id, team: car.team, name: combat.name || (car.id === "p2p-host" ? "HOST" : car.id.replace(/^p2p-guest-?/u, "PILOTO ")), x: physical.x, h: physical.h, z: physical.z, yaw: physical.yaw, pitch: attitude.pitch, roll: attitude.roll, orientation: { ...telemetry.orientation }, vx: physical.vx, vh: physical.vh, vz: physical.vz, velocity, speed: Math.hypot(physical.vx, physical.vh, physical.vz), forwardSpeed: physical.vx * Math.cos(physical.yaw) + physical.vz * Math.sin(physical.yaw), hp: combat.hp, respawn: combat.respawn, kills: combat.kills, deaths: combat.deaths, rocketCooldown: combat.rocketCooldown, alive: combat.alive, boost: telemetry.boost, jumps: telemetry.jumps, grounded: telemetry.grounded, boosting: telemetry.boosting, supersonic: telemetry.supersonic, powerslide: telemetry.powerslide, angularVelocity: { ...telemetry.angularVelocity }, wheelCount: telemetry.wheelCount, wheelContact: { ...telemetry.wheelContact, normal: { ...telemetry.wheelContact.normal } }, worldContact: { ...telemetry.worldContact, normal: { ...telemetry.worldContact.normal } }, surfaceType: surface.kind, surfaceNormal: contact ? { ...contact.normal } : null, contacts: contact ? [{ kind: surface.kind, normal: { ...contact.normal }, point: { x: physical.x, y: physical.h, z: physical.z }, wheelCount: telemetry.wheelCount, normalVelocity: null, separation: 0 }] : [], wallRide: surface.kind === "wall", ceilingContact: surface.kind === "ceiling", jumpState: telemetry.jumpState, actionSerials: { ...telemetry.actionSerials },
    };
  });
  const pads = [];
  const freeForAll = !Object.hasOwn(decoded.snapshot.score, "blue") || !Object.hasOwn(decoded.snapshot.score, "red");
  const timed = Number.isSafeInteger(decoded.snapshot.round.durationTicks);
  return { time: decoded.snapshot.tick / 60, score: { ...decoded.snapshot.score }, winner: decoded.snapshot.round.winner, settings: { arena: "combat-alpha", practiceArena: "combat-alpha", humans: cars.length, bots: 0, vehicleLimit: cars.length, profile: "COMBATE ROCKETSIM MULTI", movementBackend: "rocketsim", roundState: decoded.snapshot.round.state, scoreToWin: decoded.snapshot.round.scoreToWin, roundSerial: decoded.snapshot.round.serial, p2p: true, p2pPresentationProtocol: 6, matchMode: freeForAll ? "ffa" : "teams", roomId: decoded.roomId, sessionId: decoded.sessionId, matchDurationSeconds: timed ? decoded.snapshot.round.durationTicks / 60 : null, matchRemainingSeconds: timed ? decoded.snapshot.round.remainingTicks / 60 : null }, rules: { pads: false, combat: true, unlimitedBoost: false, ramps: true, covers: false, freeForAll, scoreToWin: decoded.snapshot.round.scoreToWin }, cars, rockets: decoded.snapshot.rockets.map(rocket => ({ ...rocket })), pads, events: decoded.snapshot.events.map(event => ({ ...event })), inputAcknowledged: decoded.snapshot.lastInputSequence };
}
