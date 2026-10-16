// Input acknowledgement is observability only. It never changes simulation input
// or predicts a local pose.
export function acceptInputSequence(latest, incoming) {
  const known = Number.isSafeInteger(latest) && latest >= 0 ? latest : 0;
  return Number.isSafeInteger(incoming) && incoming > known ? incoming : known;
}

export function recordInputTransmission(pending, sequence, at) {
  pending.set(sequence, at);
  for (const [candidate, sentAt] of pending) {
    if (candidate <= sequence - 180 || at - sentAt > 5) pending.delete(candidate);
  }
}

export function consumeInputAcknowledgement(pending, previousAcknowledged, incomingAcknowledged, now) {
  const acknowledged = acceptInputSequence(previousAcknowledged, incomingAcknowledged);
  if (acknowledged === previousAcknowledged) return { acknowledged, roundTripMs: null };
  const sentAt = pending.get(acknowledged);
  for (const sequence of pending.keys()) if (sequence <= acknowledged) pending.delete(sequence);
  return {
    acknowledged,
    roundTripMs: Number.isFinite(sentAt) && Number.isFinite(now) ? Math.max(0, (now - sentAt) * 1000) : null
  };
}
