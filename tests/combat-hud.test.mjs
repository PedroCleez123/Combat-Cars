import test from "node:test";
import assert from "node:assert/strict";
import { formatCombatHudReadout } from "../src/combat-hud.js";

test("combat HUD formats a ready rocket and neutral score", () => {
  assert.equal(formatCombatHudReadout({ rocketCooldown: 0, kills: 0, deaths: 0 }),
    "\nCOHETE     LISTO · F PARA LANZAR\nBAJAS      0 · CAÍDAS 0");
});

test("combat HUD formats authoritative cooldown and K/D without changing them", () => {
  assert.equal(formatCombatHudReadout({ rocketCooldown: 0.721, kills: 3, deaths: 2 }),
    "\nCOHETE     RECARGA 0.72s\nBAJAS      3 · CAÍDAS 2");
});

test("combat HUD clamps malformed presentation values to a safe neutral state", () => {
  assert.equal(formatCombatHudReadout({ rocketCooldown: -1, kills: -3.8, deaths: Number.NaN }),
    "\nCOHETE     LISTO · F PARA LANZAR\nBAJAS      0 · CAÍDAS 0");
});
