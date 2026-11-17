import assert from "node:assert/strict";
import test from "node:test";
import { describeEventFeedback } from "../src/event-feedback.js";

test("event feedback maps combat events to sound intent and a visual fallback", () => {
  assert.deepEqual(describeEventFeedback({ kind: "hit", text: "IMPACTO" }), {
    audioCue: "rocket-impact",
    priority: "combat",
    visualKind: "hit",
    text: "IMPACTO",
  });
  assert.deepEqual(describeEventFeedback({ kind: "winner", text: "AZUL GANA" }), {
    audioCue: "round-result",
    priority: "critical",
    visualKind: "winner",
    text: "AZUL GANA",
  });
});

test("event feedback remains readable when an event has no registered sound", () => {
  assert.deepEqual(describeEventFeedback({ kind: "join", text: "PILOTO ENTRA" }), {
    audioCue: null,
    priority: "system",
    visualKind: "system",
    text: "PILOTO ENTRA",
  });
});

test("movement event intents stay discrete and distinguish brake from drift", () => {
  assert.equal(describeEventFeedback({ kind: "brake", text: "FRENO" }).audioCue, "brake");
  assert.equal(describeEventFeedback({ kind: "drift", text: "DERRAPE" }).audioCue, "drift");
  assert.equal(describeEventFeedback({ kind: "double-jump", text: "DOBLE SALTO" }).audioCue, "double-jump");
  assert.equal(describeEventFeedback({ kind: "ram", text: "EMBESTIDA" }).audioCue, null);
});
