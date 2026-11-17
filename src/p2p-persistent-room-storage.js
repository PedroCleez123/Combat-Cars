// Origin-scoped persistence for the owner credential of a P2P room.  The
// short room code remains public; this record deliberately contains the
// separate owner secret so the browser that created a room can reconnect
// after a reload without minting a different key.
import { SIGNAL_SECRET_PATTERN, normalizeRoomId } from "./p2p-signaling-protocol.js";
import { isP2PMatchMode, p2pMatchPlayerRange } from "./p2p-room-config.js";

export const P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY = "arsenal.p2p.multi-room.host.v1";
export const P2P_PERSISTENT_GUEST_ROOM_STORAGE_KEY = "arsenal.p2p.multi-room.guest.v1";
const KEYS = ["roomCode", "roomId", "hostSecret", "expiresAt", "mode", "maxPlayers"];
const GUEST_KEYS = ["roomCode", "roomId", "participantId", "reconnectToken", "expiresAt", "mode", "maxPlayers"];
const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/u;
const PARTICIPANT_ID = /^[A-Za-z0-9_-]{16,64}$/u;

function validPersistentRoomCapacity(mode, maxPlayers) {
  const range = p2pMatchPlayerRange(mode);
  return Boolean(range && Number.isSafeInteger(maxPlayers)
    && ((maxPlayers >= range.min && maxPlayers <= range.max) || maxPlayers === 6));
}

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Returns a safe, immutable owner record or null; it never throws for bad storage. */
export function normalizeP2PPersistentHostRoom(value, { now = Date.now() } = {}) {
  if (!exact(value, KEYS)
    || typeof value.roomCode !== "string" || !ROOM_CODE.test(value.roomCode)
    || value.roomId !== value.roomCode || !normalizeRoomId(value.roomId)
    || typeof value.hostSecret !== "string" || !SIGNAL_SECRET_PATTERN.test(value.hostSecret)
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now
    || (value.mode !== null && !isP2PMatchMode(value.mode)) || !Number.isSafeInteger(value.maxPlayers)) return null;
  if (value.mode === null && value.maxPlayers !== 6) return null;
  if (value.mode !== null && !validPersistentRoomCapacity(value.mode, value.maxPlayers)) return null;
  return Object.freeze({ ...value });
}

export function loadP2PPersistentHostRoom({ storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (!storage || typeof storage.getItem !== "function") return null;
  let parsed;
  try { parsed = JSON.parse(storage.getItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY) || "null"); } catch { return null; }
  const room = normalizeP2PPersistentHostRoom(parsed, { now });
  if (!room && parsed !== null) {
    try { storage.removeItem?.(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY); } catch { /* Private browsers may deny writes. */ }
  }
  return room;
}

export function saveP2PPersistentHostRoom(room, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const normalized = normalizeP2PPersistentHostRoom(room, { now });
  if (!normalized || !storage || typeof storage.setItem !== "function") return false;
  try { storage.setItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY, JSON.stringify(normalized)); return true; } catch { return false; }
}

export function clearP2PPersistentHostRoom({ storage = globalThis.localStorage } = {}) {
  if (!storage || typeof storage.removeItem !== "function") return false;
  try { storage.removeItem(P2P_PERSISTENT_HOST_ROOM_STORAGE_KEY); return true; } catch { return false; }
}

export function normalizeP2PPersistentGuestRoom(value, { now = Date.now() } = {}) {
  if (!exact(value, GUEST_KEYS)
    || typeof value.roomCode !== "string" || !ROOM_CODE.test(value.roomCode)
    || value.roomId !== value.roomCode || !normalizeRoomId(value.roomId)
    || typeof value.participantId !== "string" || !PARTICIPANT_ID.test(value.participantId)
    || typeof value.reconnectToken !== "string" || !SIGNAL_SECRET_PATTERN.test(value.reconnectToken)
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now
    || (value.mode !== null && !isP2PMatchMode(value.mode)) || !Number.isSafeInteger(value.maxPlayers)) return null;
  if (value.mode === null && value.maxPlayers !== 6) return null;
  if (value.mode !== null && !validPersistentRoomCapacity(value.mode, value.maxPlayers)) return null;
  return Object.freeze({ ...value });
}

export function loadP2PPersistentGuestRoom({ storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (!storage || typeof storage.getItem !== "function") return null;
  let parsed;
  try { parsed = JSON.parse(storage.getItem(P2P_PERSISTENT_GUEST_ROOM_STORAGE_KEY) || "null"); } catch { return null; }
  const room = normalizeP2PPersistentGuestRoom(parsed, { now });
  if (!room && parsed !== null) {
    try { storage.removeItem?.(P2P_PERSISTENT_GUEST_ROOM_STORAGE_KEY); } catch { /* Optional browser storage. */ }
  }
  return room;
}

export function saveP2PPersistentGuestRoom(room, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  const normalized = normalizeP2PPersistentGuestRoom(room, { now });
  if (!normalized || !storage || typeof storage.setItem !== "function") return false;
  try { storage.setItem(P2P_PERSISTENT_GUEST_ROOM_STORAGE_KEY, JSON.stringify(normalized)); return true; } catch { return false; }
}

export function clearP2PPersistentGuestRoom({ storage = globalThis.localStorage } = {}) {
  if (!storage || typeof storage.removeItem !== "function") return false;
  try { storage.removeItem(P2P_PERSISTENT_GUEST_ROOM_STORAGE_KEY); return true; } catch { return false; }
}
