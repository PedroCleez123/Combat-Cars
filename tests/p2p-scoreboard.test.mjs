import test from "node:test";
import assert from "node:assert/strict";
import { createP2PScoreboardModel, shouldShowP2PScoreboard } from "../src/p2p-scoreboard.js";

function car(id, team, kills = 0, name = id, deaths = 0) {
  return { id, team, kills, deaths, name };
}

function teamState(count, { names = true } = {}) {
  const cars = Array.from({ length: count }, (_, index) => {
    const team = index % 2 === 0 ? "blue" : "red";
    return car(`p2p-${index === 0 ? "host" : `guest-${index}`}`, team, index, names ? `Jugador ${index}` : "");
  });
  return { cars, score: { blue: 3, red: 2 } };
}

test("1v1 scoreboard exposes stable team rows and team totals", () => {
  const model = createP2PScoreboardModel({
    cars: [car("p2p-host", "blue", 2, "Ana"), car("p2p-pilot", "red", 1, "Luis")],
    score: { blue: 4, red: 2 },
  });
  assert.equal(model.mode, "1v1");
  assert.equal(model.kind, "teams");
  assert.deepEqual(model.rows.map(row => [row.name, row.points, row.kills, row.deaths]), [["Ana", 2, 2, 0], ["Luis", 1, 1, 0]]);
  assert.deepEqual(model.groups.map(group => [group.team, group.points]), [["red", 1], ["blue", 2]]);
});

test("2v2 and 3v3 group an equal roster without inventing player scores", () => {
  for (const [count, mode] of [[4, "2v2"], [6, "3v3"]]) {
    const model = createP2PScoreboardModel(teamState(count));
    assert.equal(model.mode, mode);
    assert.equal(model.groups[0].rows.length, count / 2);
    assert.equal(model.groups[1].rows.length, count / 2);
    assert.deepEqual(model.rows.map(row => row.points), Array.from({ length: count }, (_, index) => index));
  }
});

test("FFA supports two through six pilots and sorts by score with stable ties", () => {
  for (let count = 2; count <= 6; count += 1) {
    const cars = Array.from({ length: count }, (_, index) => car(`p2p-${index}`, null, index % 2, `P${index}`));
    const score = Object.fromEntries(cars.map((entry, index) => [entry.id, index % 2]));
    const model = createP2PScoreboardModel({ cars, score, settings: { matchMode: "ffa" } });
    assert.equal(model.mode, "ffa");
    assert.equal(model.kind, "ffa");
    assert.equal(model.rows.length, count);
    assert.deepEqual(model.rows.filter(row => row.points === 1).map(row => row.id), cars.filter((_, index) => index % 2 === 1).map(row => row.id));
  }
});

test("names are normalized and missing names receive safe fallbacks", () => {
  const model = createP2PScoreboardModel({
    cars: [car("p2p-host", "blue", 0, "  Ána !\n"), car("p2p-pilot", "red", 0, "")],
    score: { blue: 0, red: 0 },
  });
  assert.equal(model.rows[0].name, "Ána");
  assert.equal(model.rows[1].name, "PILOTO 2");
});

test("the projection does not mutate its state or score input", () => {
  const state = teamState(2);
  const before = structuredClone(state);
  const model = createP2PScoreboardModel(state);
  assert.deepEqual(state, before);
  assert.throws(() => { model.rows.push({}); }, TypeError);
  assert.throws(() => { model.groups[0].rows[0].points = 99; }, TypeError);
});

test("invalid state and missing authoritative score return null", () => {
  assert.equal(createP2PScoreboardModel(null), null);
  assert.equal(createP2PScoreboardModel({ cars: [car("a", "blue"), car("b", "red")], score: {} }), null);
  assert.equal(createP2PScoreboardModel({ cars: [{ id: "a", team: null }, { id: "b", team: null }], score: {}, settings: { matchMode: "ffa" } }), null);
  assert.equal(createP2PScoreboardModel({ cars: [car("a", "blue"), car("a", "red")], score: { blue: 0, red: 0 } }), null);
});

test("scoreboard stays hidden for lobby and incomplete transitions", () => {
  const state = {
    mode: "1v1",
    cars: [car("p2p-host", "blue"), car("p2p-pilot", "red")],
    score: { blue: 0, red: 0 },
    settings: { roundState: "lobby", lobby: true },
  };
  const model = createP2PScoreboardModel(state);
  assert.equal(shouldShowP2PScoreboard(state, model), false);
  assert.equal(shouldShowP2PScoreboard({ ...state, settings: { roundState: "active" } }, model), true);
  assert.equal(shouldShowP2PScoreboard({ ...state, settings: { roundState: "active" } }, null), false);
});
