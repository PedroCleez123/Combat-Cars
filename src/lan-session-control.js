export const LAN_HELLO_TIMEOUT_MS = 5000;

export function assignSessionOwner(ownerId, peerId) {
  return ownerId || peerId || null;
}

export function isSessionOwner(ownerId, peerId) {
  return Boolean(ownerId && peerId && ownerId === peerId);
}

export function releaseSessionOwner(ownerId, peerId) {
  return isSessionOwner(ownerId, peerId) ? null : ownerId || null;
}

// Input sequences belong to one WebSocket incarnation. A browser reload or
// campaign navigation can reconnect the same session with a fresh client
// counter, so retaining the old high-water mark would discard every input.
export function resetPeerInputWindow(peer, now = Date.now()) {
  if (!peer || typeof peer !== "object") throw new TypeError("peer debe ser un objeto");
  peer.lastInputSequence = 0;
  peer.inputWindowStarted = now;
  peer.inputCount = 0;
  return peer;
}
