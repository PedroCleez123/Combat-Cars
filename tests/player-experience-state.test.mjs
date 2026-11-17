import assert from "node:assert/strict";
import test from "node:test";
import { describePlayerExperienceState } from "../src/player-experience-state.js";

const activeState = (overrides = {}) => ({
  cars: [{ id: "pilot", respawn: 0 }],
  settings: { roundState: "active" },
  winner: null,
  ...overrides
});

test("player experience status distinguishes loading, connection and synchronization", () => {
  assert.deepEqual(describePlayerExperienceState(), { id: "loading", text: "CARGANDO ARENA…" });
  assert.deepEqual(describePlayerExperienceState({ connection: "connecting" }), { id: "connecting", text: "CONECTANDO A LA ARENA…" });
  assert.deepEqual(describePlayerExperienceState({ connection: "error", connectionDetail: "Servidor no responde" }), { id: "connection-error", text: "Servidor no responde" });
  assert.deepEqual(describePlayerExperienceState({ state: activeState(), localId: "pilot" }), { id: "synchronizing", text: "SINCRONIZANDO PARTIDA…" });
});

test("player experience status presents the authoritative waiting, playing and respawn loop", () => {
  assert.deepEqual(describePlayerExperienceState({ state: activeState({ settings: { roundState: "waiting" } }), localId: "pilot", localTeam: "blue" }), { id: "waiting-rival", text: "ESPERANDO RIVAL…" });
  assert.deepEqual(describePlayerExperienceState({ state: activeState(), localId: "pilot", localTeam: "red" }), { id: "playing", text: "TÚ · EQUIPO ROJO" });
  assert.deepEqual(describePlayerExperienceState({ state: activeState({ cars: [{ id: "pilot", respawn: 1.26 }] }), localId: "pilot", localTeam: "blue" }), { id: "respawning", text: "REAPARICIÓN · 1.3 S" });
});

test("player experience status gives result priority over local transient state", () => {
  const state = activeState({ winner: "blue", cars: [{ id: "pilot", respawn: 1 }] });
  assert.deepEqual(describePlayerExperienceState({ state, localId: "pilot", localTeam: "blue" }), { id: "victory", text: "VICTORIA · PULSA R PARA OTRA RONDA" });
  assert.deepEqual(describePlayerExperienceState({ state, localId: "pilot", localTeam: "red" }), { id: "defeat", text: "DERROTA · PULSA R PARA OTRA RONDA" });
  assert.deepEqual(describePlayerExperienceState({ state: activeState({ settings: { roundState: "complete" } }), localId: "pilot", localTeam: "blue" }), { id: "round-complete", text: "RONDA CERRADA · PULSA R PARA OTRA RONDA" });
});
