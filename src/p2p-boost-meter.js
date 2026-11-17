// Presentation-only Nitro meter. Its state is copied from the authoritative
// render snapshot; this component never changes RocketSim, input, audio or P2P
// transport. The dial/value/unlimited contract is adapted from the audited
// Rocket Arena Web HUD without importing its artwork or assets.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createP2PBoostMeter(root = typeof document !== "undefined" ? document : null) {
  const meter = root?.querySelector?.("[data-p2p-boost-meter]") || null;
  const fill = root?.querySelector?.("[data-p2p-boost-fill]") || null;
  const value = root?.querySelector?.("[data-p2p-boost-value]") || null;
  if (!meter || !fill || !value) return null;

  let previousValue = null;
  let previousUnlimited = null;
  let previousFiring = null;

  return Object.freeze({
    update(rawValue, spending = false, unlimited = false) {
      const infinite = unlimited === true;
      const amount = infinite ? 100 : clamp(Math.round(Number(rawValue) || 0), 0, 100);
      if (amount !== previousValue || infinite !== previousUnlimited) {
        value.textContent = infinite ? "∞" : String(amount);
        fill.style?.setProperty?.("--boost-level", `${amount}%`);
        fill.style?.setProperty?.("--boost-sweep", `${amount * 2.25}deg`);
        meter.setAttribute?.("aria-valuenow", String(amount));
        meter.classList?.toggle?.("is-unlimited", infinite);
        meter.classList?.toggle?.("is-empty", amount === 0);
        if (infinite) meter.setAttribute?.("aria-valuetext", "Nitro infinito");
        else meter.removeAttribute?.("aria-valuetext");
        previousValue = amount;
        previousUnlimited = infinite;
      }
      const firing = spending === true && !infinite && amount > 0;
      if (firing !== previousFiring) {
        meter.classList?.toggle?.("is-firing", firing);
        previousFiring = firing;
      }
    },
  });
}
