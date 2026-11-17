// Presentation contract for authoritative match events. `audioCue` is an
// intention for a future mixer, never a command to mutate match state. The
// textual event remains the accessible fallback while audio is unavailable or
// muted.
const EVENT_FEEDBACK = Object.freeze({
  fire: Object.freeze({ audioCue: "rocket-fire", priority: "combat", visualKind: "fire" }),
  hit: Object.freeze({ audioCue: "rocket-impact", priority: "combat", visualKind: "hit" }),
  // Vehicle-to-arena/body contact stays silent. The old procedural fallback
  // for `ram-impact` was the synthetic noise reported in playtest; rocket
  // impacts keep their separate approved cue.
  ram: Object.freeze({ audioCue: null, priority: "combat", visualKind: "ram" }),
  elimination: Object.freeze({ audioCue: "elimination", priority: "critical", visualKind: "elimination" }),
  respawn: Object.freeze({ audioCue: "respawn", priority: "critical", visualKind: "respawn" }),
  winner: Object.freeze({ audioCue: "round-result", priority: "critical", visualKind: "winner" }),
  round: Object.freeze({ audioCue: "round-state", priority: "system", visualKind: "round" }),
  jump: Object.freeze({ audioCue: "jump", priority: "movement", visualKind: "jump" }),
  "double-jump": Object.freeze({ audioCue: "double-jump", priority: "movement", visualKind: "double-jump" }),
  dodge: Object.freeze({ audioCue: "dodge", priority: "movement", visualKind: "dodge" }),
  brake: Object.freeze({ audioCue: "brake", priority: "movement", visualKind: "brake" }),
  drift: Object.freeze({ audioCue: "drift", priority: "movement", visualKind: "drift" }),
  pad: Object.freeze({ audioCue: "boost-pad", priority: "movement", visualKind: "pad" }),
});

const NEUTRAL_FEEDBACK = Object.freeze({ audioCue: null, priority: "system", visualKind: "system", text: "" });

export function describeEventFeedback(event = {}) {
  const text = typeof event.text === "string" ? event.text.trim() : "";
  const descriptor = EVENT_FEEDBACK[event.kind] || NEUTRAL_FEEDBACK;
  return Object.freeze({ ...descriptor, text });
}

export { EVENT_FEEDBACK };
