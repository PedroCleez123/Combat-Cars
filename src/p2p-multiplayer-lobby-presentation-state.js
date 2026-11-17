// Presentation-only projection of the non-combat WASM waiting-room protocol.
// The host is the sole source of the roster and poses; this adapter never
// derives a score, damage, projectile or another gameplay rule.
import { decodeP2PWasmMultiplayerLobbyEnvelope } from "../tools/wasm-spike/p2p-wasm-multiplayer-lobby-protocol.mjs";

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function stateFromSnapshot(snapshot) {
  const freeForAll = snapshot.mode === "ffa";
  const score = freeForAll
    ? Object.fromEntries(snapshot.players.map(player => [player.id, 0]))
    : { blue: 0, red: 0 };
  const cars = snapshot.players.map(player => {
    const contact = player.wheelContact?.hasContact ? player.wheelContact
      : player.worldContact?.hasContact ? player.worldContact : null;
    const surfaceType = !contact ? (player.grounded ? "ground" : "air")
      : contact.normal.y < -.65 ? "ceiling"
        : Math.abs(contact.normal.y) < .35 ? "wall" : "ground";
    return Object.freeze({
      id: player.id, name: player.name, team: player.team,
      x: finite(player.x), h: finite(player.h), z: finite(player.z),
      yaw: finite(player.yaw), pitch: finite(player.pitch), roll: finite(player.roll),
      orientation: { ...player.orientation },
      vx: finite(player.vx), vh: finite(player.vh), vz: finite(player.vz),
      velocity: { x: finite(player.vx), y: finite(player.vh), z: finite(player.vz) },
      speed: Math.hypot(finite(player.vx), finite(player.vh), finite(player.vz)),
      forwardSpeed: finite(player.vx) * Math.cos(finite(player.yaw)) + finite(player.vz) * Math.sin(finite(player.yaw)),
      hp: 100, alive: true, respawn: 0, kills: 0, deaths: 0, rocketCooldown: 0,
      boost: finite(player.boost, 100), jumps: player.jumps, grounded: player.grounded,
      boosting: player.boosting, supersonic: player.supersonic, powerslide: player.powerslide,
      angularVelocity: { ...player.angularVelocity }, wheelCount: player.wheelCount,
      wheelContact: { ...player.wheelContact, normal: { ...player.wheelContact.normal } },
      worldContact: { ...player.worldContact, normal: { ...player.worldContact.normal } },
      surfaceType, surfaceNormal: contact ? { ...contact.normal } : null,
      contacts: contact ? [{ kind: surfaceType, normal: { ...contact.normal }, point: { x: player.x, y: player.h, z: player.z }, wheelCount: player.wheelCount, normalVelocity: null, separation: 0 }] : [],
      wallRide: surfaceType === "wall", ceilingContact: surfaceType === "ceiling", jumpState: player.jumpState,
      actionSerials: { ...player.actionSerials }, score: 0,
    });
  });
  return Object.freeze({
    time: snapshot.tick / 60, score, winner: null, mode: snapshot.mode,
    settings: { arena: "combat-alpha", practiceArena: "combat-alpha", humans: cars.length, bots: 0, vehicleLimit: snapshot.maxPlayers, profile: "LOBBY ROCKETSIM WASM", movementBackend: "rocketsim", roundState: "lobby", scoreToWin: null, roundSerial: 0, p2p: true, lobby: true, mode: snapshot.mode, matchMode: snapshot.mode, roomId: snapshot.roomId, sessionId: snapshot.sessionId },
    rules: { pads: false, combat: false, unlimitedBoost: true, ramps: true, covers: false, scoreToWin: null, freeForAll },
    cars: Object.freeze(cars), rockets: Object.freeze([]), pads: Object.freeze([]), events: Object.freeze([]), inputAcknowledged: 0,
  });
}

/** Convert a validated lobby envelope (or snapshot) to the common renderer state. */
export function createP2PMultiplayerLobbyPresentationState(value, { roomId = null, sessionId = null } = {}) {
  const decoded = typeof value === "string" ? decodeP2PWasmMultiplayerLobbyEnvelope(value) : null;
  const snapshot = decoded ? decoded.snapshot : value;
  const actualRoomId = decoded?.roomId || snapshot?.roomId;
  const actualSessionId = decoded?.sessionId || snapshot?.sessionId;
  if (!snapshot || !["room-open", "lobby"].includes(snapshot.phase) || (roomId !== null && actualRoomId !== roomId) || (sessionId !== null && actualSessionId !== sessionId)
    || !Array.isArray(snapshot.players) || snapshot.players.length < 1 || snapshot.players.length > 6) {
    throw new TypeError("El snapshot del lobby no coincide con el contexto de presentación.");
  }
  return stateFromSnapshot(snapshot);
}
