# Boost regeneration design

## Goal

Replace combat-alpha floor boost pickups with a deterministic, authoritative
boost loop that feels immediate without introducing a second simulation
authority:

- a car that has actually consumed boost waits 2.0 seconds after the last
  consumed tick;
- it then regenerates continuously for one second with a gentle linear ramp
  from 50 to 150 boost units/second, reaching 100 from an empty tank in that
  second (100 units/second on average);
- any later tick that consumes boost resets the delay to 2.0 seconds;
- lobby and offline practice retain their current infinite-boost rule;
- the combat snapshot, HUD, audio and replayable tests all observe the same
  RocketSim-native value.

## Non-goals

- No JavaScript-only or client-predicted refill.
- No change to RocketSim movement, boost consumption, dodge or collision
  constants.
- No change to the P2P host-authoritative architecture.
- No replacement of legacy pickup metadata used by unrelated practice
  experiments unless the public combat-alpha contract requires it.

## Authority and timing contract

The fixed simulation is 120 Hz. The native wrapper owns one regen timer per
car, measured in fixed ticks. The public contract is:

```text
BOOST_REGEN_DELAY_TICKS = 240  // 2.0 s at 120 Hz
BOOST_REGEN_DURATION_TICKS = 120 // 1.0 s
BOOST_REGEN_RATE = 50.0 -> 150.0 / s // linear ramp, 100/s average
```

At every native tick, after RocketSim has applied controls and consumed boost:

1. If the car's boost decreased by more than epsilon, set its timer to 240.
2. Otherwise, if the timer is positive, decrement it by one.
3. When the timer reaches zero, add the linearly interpolated rate between
   `50 / 120` and `150 / 120` units for the current regeneration tick,
   clamped to 100.
4. A full tank never starts or advances a pending timer.

This ordering means a boost press during regeneration is measured by the actual
native consumption, not merely by a held input flag. The next fixed tick starts
a fresh two-second delay, including when the press happens halfway through a
refill.

## Pickup removal

Combat-alpha will initialize no pickup colliders and will publish an empty pad
list. The renderer and presentation state will advertise `rules.pads: false`.
The map keeps a named empty pickup contract so old diagnostic/practice fixtures
remain explicit rather than silently spawning visual-only pads. Any legacy
pickup-only tests are updated to assert the new combat contract.

## Feedback

The authoritative car boost remains the sole HUD source. Existing pad pickup
events are not emitted for regeneration; a future refill cue may be added only
if the current audio matrix has a distinct, non-spammy cue. This slice must not
reintroduce per-frame allocations or remote messages.

## Acceptance criteria

- The same fixed input tape produces identical boost values in the native bridge
  and generated WASM wrapper.
- A car that stops boosting stays unchanged for exactly 240 ticks, then rises
  monotonically with an increasing rate and reaches 100 after 120 further
  ticks (subject to clamp).
- A boost consumption during refill resets the timer and prevents any refill on
  the following 239 idle ticks.
- Lobby/practice snapshots still expose `unlimitedBoost: true` and remain full.
- Combat snapshots expose `pads: []` and `rules.pads === false`.
- Existing simulation, P2P protocol, build and static-page tests remain green.
