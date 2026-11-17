// Versioned host-star signaling contract. v1 remains the deployed 1v1 pair;
// this pure boundary prepares up to five guest slots without coupling the
// browser renderer or causal authority to signaling payloads.
import {
  SIGNAL_MAX_FRAME_BYTES,
  SIGNAL_MAX_PAYLOAD_BYTES,
  SIGNAL_RATE_LIMIT_MAX_MESSAGES,
  SIGNAL_RATE_LIMIT_WINDOW_MS,
  SIGNAL_ROOM_TTL_MS,
  SIGNAL_SECRET_PATTERN,
  normalizeRoomId,
} from "./p2p-signaling-protocol.js";

export const P2P_MULTI_SIGNAL_PROTOCOL_VERSION = 2;
export const P2P_MULTI_MAX_PLAYERS = 6;
export const P2P_MULTI_MAX_GUEST_SLOTS = P2P_MULTI_MAX_PLAYERS - 1;
// A multi-party room is a rendezvous record, not a five-minute connection.
// Keep retention finite for cleanup while allowing a player to close/reopen
// the browser and reuse the same public key during the next days.
export const P2P_MULTI_ROOM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const P2P_MULTI_PARTICIPANT_GRACE_MS = 10 * 60 * 1000;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MODE_VALUES = new Set(["1v1", "2v2", "3v3", "ffa"]);
const encoder = new TextEncoder();

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys) {
  if (!record(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validSlot(value, { nullable = false } = {}) {
  return (nullable && value === null) || (Number.isSafeInteger(value) && value >= 1 && value <= P2P_MULTI_MAX_GUEST_SLOTS);
}

function boundedJson(value, limit) {
  if (typeof value !== "string" || encoder.encode(value).byteLength > limit) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function normalizeP2PMultiRoomRecord(value) {
  if (!exact(value, ["roomId", "hostHash", "guestHashes", "expiresAt", "mode", "maxPlayers"])) return null;
  if (!normalizeRoomId(value.roomId) || !HASH_PATTERN.test(value.hostHash)
    || !Array.isArray(value.guestHashes) || value.guestHashes.length < 1 || value.guestHashes.length > P2P_MULTI_MAX_GUEST_SLOTS
    || value.guestHashes.some(hash => typeof hash !== "string" || !HASH_PATTERN.test(hash))
    || new Set(value.guestHashes).size !== value.guestHashes.length
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0
    || !Number.isSafeInteger(value.maxPlayers) || value.maxPlayers < 2 || value.maxPlayers > P2P_MULTI_MAX_PLAYERS
  // A persistent room is allowed to exist before its owner chooses a match
  // mode. Keep all five guest hashes after configuration too: the owner may
  // change mode/capacity repeatedly before starting without shifting a slot.
    || (value.mode === null
      ? (value.maxPlayers !== P2P_MULTI_MAX_PLAYERS || value.guestHashes.length !== P2P_MULTI_MAX_GUEST_SLOTS)
      : (!MODE_VALUES.has(value.mode) || (value.guestHashes.length !== value.maxPlayers - 1 && value.guestHashes.length !== P2P_MULTI_MAX_GUEST_SLOTS)))) return null;
  return Object.freeze({
    roomId: value.roomId,
    hostHash: value.hostHash,
    guestHashes: Object.freeze([...value.guestHashes]),
    expiresAt: value.expiresAt,
    mode: value.mode,
    maxPlayers: value.maxPlayers,
  });
}

export function normalizeP2PMultiJoinMessage(value) {
  if (!exact(value, ["protocolVersion", "type", "role", "slot", "secret"])
    || value.protocolVersion !== P2P_MULTI_SIGNAL_PROTOCOL_VERSION || value.type !== "join"
    || (value.role !== "host" && value.role !== "guest")
    || !validSlot(value.slot, { nullable: value.role === "host" })
    || (value.role === "host" && value.slot !== null)
    || (value.role === "guest" && !Number.isSafeInteger(value.slot))
    || typeof value.secret !== "string" || !SIGNAL_SECRET_PATTERN.test(value.secret)) return null;
  return { protocolVersion: P2P_MULTI_SIGNAL_PROTOCOL_VERSION, type: "join", role: value.role, slot: value.slot, secret: value.secret };
}

export function createP2PMultiJoinMessage({ role, slot = role === "host" ? null : undefined, secret } = {}) {
  const value = normalizeP2PMultiJoinMessage({ protocolVersion: P2P_MULTI_SIGNAL_PROTOCOL_VERSION, type: "join", role, slot, secret });
  if (!value) throw new TypeError("La unión P2P multiusuario no es válida.");
  return value;
}

export function normalizeP2PMultiSignalFrame(value, { lastSequence = 0 } = {}) {
  if (!exact(value, ["protocolVersion", "type", "sequence", "targetSlot", "sourceSlot", "payload"])
    || value.protocolVersion !== P2P_MULTI_SIGNAL_PROTOCOL_VERSION || value.type !== "signal"
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence <= lastSequence
    || !validSlot(value.targetSlot, { nullable: true }) || !validSlot(value.sourceSlot, { nullable: true }) || typeof value.payload !== "string"
    || encoder.encode(value.payload).byteLength > SIGNAL_MAX_PAYLOAD_BYTES || boundedJson(value.payload, SIGNAL_MAX_PAYLOAD_BYTES) === null) return null;
  return { protocolVersion: P2P_MULTI_SIGNAL_PROTOCOL_VERSION, type: "signal", sequence: value.sequence, targetSlot: value.targetSlot, sourceSlot: value.sourceSlot, payload: value.payload };
}

export function createP2PMultiSignalFrame(payload, { sequence, targetSlot = null, sourceSlot = null } = {}) {
  let serialized;
  try { serialized = JSON.stringify(payload); } catch { throw new TypeError("La señal P2P multiusuario no es serializable."); }
  const frame = normalizeP2PMultiSignalFrame({ protocolVersion: P2P_MULTI_SIGNAL_PROTOCOL_VERSION, type: "signal", sequence, targetSlot, sourceSlot, payload: serialized });
  if (!frame || encoder.encode(JSON.stringify(frame)).byteLength > SIGNAL_MAX_FRAME_BYTES) throw new TypeError("La señal P2P multiusuario supera el límite permitido.");
  return frame;
}

function equal(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function notice(type, slot = null, extra = null) {
  return JSON.stringify({ protocolVersion: P2P_MULTI_SIGNAL_PROTOCOL_VERSION, type, slot, ...(extra || {}) });
}

export class P2PMultiPeerSignalRoomCore {
  constructor({ room, now = () => Date.now(), digestSecret, enableHostFailover = false, hostEpoch = 0 } = {}) {
    const normalized = normalizeP2PMultiRoomRecord(room);
    if (!normalized || typeof digestSecret !== "function") throw new TypeError("La sala P2P multiusuario no es válida.");
    this.room = normalized;
    this.now = now;
    this.digestSecret = digestSecret;
    // v2 remains fail-closed. The persistent-room contract enables this
    // switch only after its versioned promotion/reconnect messages are live.
    this.enableHostFailover = enableHostFailover === true;
    this.peers = new Map();
    this.nextJoinOrder = 0;
    this.hostEpoch = enableHostFailover && Number.isSafeInteger(hostEpoch) && hostEpoch >= 0 ? hostEpoch : 0;
  }

  rehydrate(peerAttachments = []) {
    this.peers.clear();
    for (const [index, peer] of peerAttachments.entries()) {
      const attachment = peer?.attachment;
      if (peer?.id === undefined || !record(attachment) || (attachment.role !== "host" && attachment.role !== "guest")
        || !validSlot(attachment.slot, { nullable: attachment.role === "host" })
        || !Number.isSafeInteger(attachment.lastSequence) || attachment.lastSequence < 0) continue;
      const key = attachment.role === "host" ? "host" : `guest-${attachment.slot}`;
      if (this.peers.has(key)) continue;
      const joinOrder = this.enableHostFailover && Number.isSafeInteger(attachment.joinOrder) && attachment.joinOrder >= 0
        ? attachment.joinOrder
        : index;
      const hostEpoch = this.enableHostFailover && Number.isSafeInteger(attachment.hostEpoch) && attachment.hostEpoch >= 0
        ? attachment.hostEpoch
        : 0;
      this.peers.set(key, { id: peer.id, role: attachment.role, slot: attachment.slot, joinOrder, hostEpoch, lastSequence: attachment.lastSequence, rateWindowStartedAt: attachment.rateWindowStartedAt ?? null, rateWindowCount: attachment.rateWindowCount ?? 0 });
      this.nextJoinOrder = Math.max(this.nextJoinOrder, joinOrder + 1);
      this.hostEpoch = Math.max(this.hostEpoch, hostEpoch);
    }
    return this;
  }

  async join(peerId, serialized, refreshPeers = null) {
    if (this.now() >= this.room.expiresAt || peerId === null || peerId === undefined) return { ok: false, code: 1008, reason: "Room expired or peer invalid." };
    const parsed = boundedJson(serialized, 1024);
    const join = normalizeP2PMultiJoinMessage(parsed);
    if (!join) return { ok: false, code: 1008, reason: "Invalid multi-party join." };
    if (typeof refreshPeers === "function") this.rehydrate(refreshPeers());
    const key = join.role === "host" ? "host" : `guest-${join.slot}`;
    if ([...this.peers.values()].some(peer => peer.id === peerId) || this.peers.has(key)) return { ok: false, code: 1008, reason: "Role or slot already connected." };
    const expected = join.role === "host" ? this.room.hostHash : this.room.guestHashes[join.slot - 1];
    if (!expected) return { ok: false, code: 1008, reason: "Guest slot unavailable." };
    let digest;
    try { digest = await this.digestSecret(join.secret); } catch { return { ok: false, code: 1008, reason: "Invalid multi-party join." }; }
    if (typeof digest !== "string" || !equal(digest, expected)) return { ok: false, code: 1008, reason: "Invalid multi-party join." };
    if (this.peers.size >= this.room.maxPlayers) return { ok: false, code: 1008, reason: "Room full." };
    const attachment = { role: join.role, slot: join.slot, ...(this.enableHostFailover ? { joinOrder: this.nextJoinOrder++, hostEpoch: this.hostEpoch } : {}), lastSequence: 0, rateWindowStartedAt: null, rateWindowCount: 0 };
    this.peers.set(key, { id: peerId, ...attachment });
    const notices = [];
    if (join.role === "guest") {
      const host = this.peers.get("host");
      if (host) notices.push({ recipientId: peerId, serialized: notice("peer-ready", null) }, { recipientId: host.id, serialized: notice("peer-ready", join.slot) });
    }
    return { ok: true, attachment, notices };
  }

  relay(peerId, serialized) {
    if (this.now() >= this.room.expiresAt) return { ok: false, code: 1008, reason: "Room expired." };
    const sender = [...this.peers.values()].find(peer => peer.id === peerId);
    if (!sender) return { ok: false, code: 1008, reason: "Peer unavailable." };
    const parsed = boundedJson(serialized, SIGNAL_MAX_FRAME_BYTES);
    const frame = normalizeP2PMultiSignalFrame(parsed, { lastSequence: sender.lastSequence });
    if (!frame || frame.sourceSlot !== null
      || (sender.role === "guest" && frame.targetSlot !== null)
      || (sender.role === "host" && frame.targetSlot === null)) return { ok: false, code: 1008, reason: "Invalid multi-party signal." };
    const receiver = sender.role === "host" ? this.peers.get(`guest-${frame.targetSlot}`) : this.peers.get("host");
    if (!receiver) return { ok: false, code: 1008, reason: "Peer unavailable." };
    const now = this.now();
    let started = sender.rateWindowStartedAt;
    let count = sender.rateWindowCount;
    if (started === null || now - started >= SIGNAL_RATE_LIMIT_WINDOW_MS) { started = now; count = 0; }
    if (!Number.isSafeInteger(count) || count >= SIGNAL_RATE_LIMIT_MAX_MESSAGES) return { ok: false, code: 1008, reason: "Signaling rate limit exceeded." };
    sender.lastSequence = frame.sequence;
    sender.rateWindowStartedAt = started;
    sender.rateWindowCount = count + 1;
    // Socket ids are runtime-only. Durable-object attachments must contain
    // only the bounded replay/rate state required after a hibernation wake.
    return {
      ok: true,
      recipientId: receiver.id,
      serialized: JSON.stringify({ ...frame, sourceSlot: sender.role === "guest" ? sender.slot : null }),
      senderAttachment: {
        role: sender.role,
        slot: sender.slot,
        ...(this.enableHostFailover ? { joinOrder: sender.joinOrder, hostEpoch: sender.hostEpoch } : {}),
        lastSequence: sender.lastSequence,
        rateWindowStartedAt: sender.rateWindowStartedAt,
        rateWindowCount: sender.rateWindowCount,
      },
    };
  }

  disconnect(peerId, attachment) {
    const peer = [...this.peers.values()].find(entry => entry.id === peerId)
      || [...this.peers.values()].find(entry => entry.role === attachment?.role && entry.slot === attachment?.slot);
    if (!peer) return { notices: [], closeIds: [] };
    this.peers.delete(peer.role === "host" ? "host" : `guest-${peer.slot}`);
    const remaining = [...this.peers.values()];
    if (peer.role === "host") {
      if (this.enableHostFailover) {
        const successor = remaining.filter(entry => entry.role === "guest").sort((left, right) => left.joinOrder - right.joinOrder || left.slot - right.slot)[0] || null;
        if (successor) {
          const successorSlot = successor.slot;
          this.hostEpoch = Math.max(this.hostEpoch, successor.hostEpoch || 0) + 1;
          this.peers.delete(`guest-${successorSlot}`);
          const promoted = { ...successor, role: "host", slot: null, hostEpoch: this.hostEpoch };
          this.peers.set("host", promoted);
          const connectedSlots = remaining.filter(entry => entry.role === "guest").map(entry => entry.slot).sort((left, right) => left - right);
          const promotedAttachment = {
            role: "host", slot: null, joinOrder: promoted.joinOrder, hostEpoch: promoted.hostEpoch,
            // Signal sequence space belongs to an authority epoch. Do not
            // let a former guest's candidate sequence fence its own new
            // host offers after promotion.
            lastSequence: 0, rateWindowStartedAt: null, rateWindowCount: 0,
          };
          return {
            notices: remaining.map(entry => ({ recipientId: entry.id, serialized: notice("host-promoted", successorSlot, { hostEpoch: this.hostEpoch, connectedSlots }) })),
            closeIds: [],
            promotedPeerId: promoted.id,
            promotedAttachment,
            hostEpoch: this.hostEpoch,
            promotedSlot: successorSlot,
            promotedHostHash: this.room.guestHashes[successorSlot - 1],
          };
        }
      }
      return { notices: remaining.map(entry => ({ recipientId: entry.id, serialized: notice("host-left", null) })), closeIds: remaining.map(entry => entry.id) };
    }
    const host = this.peers.get("host");
    return host ? { notices: [{ recipientId: host.id, serialized: notice("guest-left", peer.slot) }], closeIds: [] } : { notices: [], closeIds: [] };
  }
}
