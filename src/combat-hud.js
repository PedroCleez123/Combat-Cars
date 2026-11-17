export function formatCombatHudReadout(car = {}) {
  const cooldown = Number.isFinite(car.rocketCooldown) ? Math.max(0, car.rocketCooldown) : 0;
  const kills = Number.isFinite(car.kills) ? Math.max(0, Math.trunc(car.kills)) : 0;
  const deaths = Number.isFinite(car.deaths) ? Math.max(0, Math.trunc(car.deaths)) : 0;
  const rocket = cooldown > 0 ? `RECARGA ${cooldown.toFixed(2)}s` : "LISTO · F PARA LANZAR";
  return `\nCOHETE     ${rocket}\nBAJAS      ${kills} · CAÍDAS ${deaths}`;
}
