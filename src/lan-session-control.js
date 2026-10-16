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
