// P2P-WASM-46: player-facing HUD projection for the causal beta.
// The HUD is presentation-only: it reads an already validated render state and
// never derives or mutates combat rules.
import { normalizeP2PPlayerName } from "./p2p-player-identity.js";
import { createP2PScoreboardModel } from "./p2p-scoreboard.js";

const ROLE_TO_CAR = Object.freeze({ host: "p2p-host", pilot: "p2p-pilot" });

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function text(documentRef, id, value) {
  const element = documentRef?.getElementById?.(id);
  if (element) element.textContent = value;
  return element;
}

function surfaceLabel(car) {
  const labels = { ground: "SUELO", wall: "PARED", ceiling: "TECHO", air: "AIRE" };
  return labels[car?.surfaceType] || "—";
}

function stateLabel(car, state = null) {
  if (!car?.alive) return "FUERA";
  // The lock is optional presentation data. It is shown only when an
  // authoritative adapter provides it; the HUD never derives a target.
  if (state?.targetId || car?.targetId) return "BLOQUEO";
  if (car?.jumpState === "dodge") return "DODGE";
  if (car?.jumpState === "doubleJump") return "DOBLE SALTO";
  if (car?.jumpState === "jump") return "SALTO";
  if (car?.boosting) return "NITRO";
  return surfaceLabel(car);
}

const EVENT_LABELS = Object.freeze({
  fire: "DISPARO",
  hit: "IMPACTO",
  miss: "FALLO",
  elimination: "BAJA",
  respawn: "REAPARICIÓN",
  winner: "RESULTADO",
  round: "RONDA",
});

function latestEventText(events) {
  if (!Array.isArray(events) || events.length === 0) return "SIN EVENTOS RECIENTES";
  const event = events.at(-1);
  const label = EVENT_LABELS[event?.kind] || "EVENTO";
  const detail = typeof event?.text === "string" && event.text.trim() ? ` · ${event.text.trim()}` : "";
  // Keep the event affordance useful at a glance even when an authority sends
  // a verbose diagnostic description.
  return ` ${label}${detail}`.trim().slice(0, 72);
}

function cardText(car, label, state = null) {
  const hp = Math.max(0, Math.round(finite(car?.hp)));
  const boost = Math.max(0, Math.min(100, Math.round(finite(car?.boost))));
  return `${label} · VIDA ${hp}% · NITRO ${boost}% · ${stateLabel(car, state)}`;
}

function connectionLabel(connection, rival) {
  const value = typeof connection === "string" ? connection.toLowerCase() : "";
  if (value.includes("práctica") || value.includes("practica")) return "PRÁCTICA";
  if (value.includes("error") || value.includes("sin snapshot")) return "ERROR";
  if (value.includes("esperando") || value.includes("negociando")) return rival ? "ONLINE" : "ESPERANDO";
  if (value.includes("p2p") || value.includes("sincronizado") || value.includes("activo")) return "ONLINE";
  return rival ? "ONLINE" : "ESPERANDO";
}

function renderScoreboard(documentRef, model) {
  const board = documentRef?.getElementById?.("causal-hud-scoreboard");
  if (!board) return false;
  const modeElement = documentRef.getElementById("causal-hud-scoreboard-mode");
  const groupElements = [
    documentRef.getElementById("causal-hud-scoreboard-blue"),
    documentRef.getElementById("causal-hud-scoreboard-red"),
  ];
  const rows = Array.from({ length: 6 }, (_, index) => documentRef.getElementById(`causal-hud-scoreboard-row-${index}`));
  if (!model) {
    board.hidden = true;
    return true;
  }
  if (modeElement) modeElement.textContent = model.mode.toUpperCase();
  const groupsByTeam = new Map(model.groups.map(group => [group.team, group]));
  if (groupElements[0]) {
    const group = groupsByTeam.get("blue");
    groupElements[0].textContent = group ? `${group.label} ${group.points}` : "";
    groupElements[0].hidden = !group;
  }
  if (groupElements[1]) {
    const group = groupsByTeam.get("red");
    groupElements[1].textContent = group ? `${group.label} ${group.points}` : "";
    groupElements[1].hidden = !group;
  }
  const modelRows = model.kind === "ffa" ? model.rows : model.groups.flatMap(group => group.rows);
  rows.forEach((element, index) => {
    const row = modelRows[index];
    if (!element) return;
    element.textContent = row ? `${row.name}  ${row.points}` : "";
    element.hidden = !row;
    if (row) {
      element.dataset.team = row.team || "ffa";
      element.setAttribute("aria-label", `${row.name}, ${row.points} puntos`);
    } else {
      delete element.dataset.team;
      element.removeAttribute?.("aria-label");
    }
  });
  board.hidden = false;
  return true;
}

/**
 * Render the compact player HUD from one authoritative render state.
 * `role` is the local WebRTC slot, not a gameplay rule or a wire secret.
 */
export function renderP2PCausalBetaHud(documentRef, state, {
  role = null,
  connection = "Conectando…",
  localName = null,
  remoteName = null,
} = {}) {
  const root = documentRef?.getElementById?.("causal-hud");
  if (!root) return null;
  if (!state || !Array.isArray(state.cars) || state.cars.length < 1 || state.cars.length > 6) {
    root.hidden = true;
    renderScoreboard(documentRef, null);
    return null;
  }
  const ownId = ROLE_TO_CAR[role] || null;
  const own = state.cars.find(car => car.id === ownId) || state.cars[0];
  const rival = state.cars.find(car => car !== own) || null;
  const ownLabel = typeof localName === "string" && localName.trim()
    ? normalizeP2PPlayerName(localName, role === "host" ? "HOST" : "PILOTO")
    : "TÚ";
  const rivalLabel = typeof remoteName === "string" && remoteName.trim()
    ? normalizeP2PPlayerName(remoteName, role === "host" ? "PILOTO" : "HOST")
    : "RIVAL";
  const score = state.score || { blue: 0, red: 0 };
  const roleName = role === "host" ? "HOST" : role === "pilot" ? "PILOTO" : "ESPECTADOR";
  const scoreboard = createP2PScoreboardModel(state, {
    namesById: Object.fromEntries(state.cars.map(car => [car.id, car.name]).filter(([, name]) => typeof name === "string")),
  });
  renderScoreboard(documentRef, scoreboard);

  // Gameplay HUD is deliberately only the authoritative scoreboard. The
  // player already reads movement, boost and contact state from the arena;
  // those values remain available to diagnostics and accessibility adapters,
  // but do not cover the play path.
  text(documentRef, "causal-hud-connection", connectionLabel(connection, rival));
  text(documentRef, "causal-hud-role", `TÚ · ${roleName}`);
  text(documentRef, "causal-hud-score", `${Math.max(0, Math.round(finite(score.blue)))}  —  ${Math.max(0, Math.round(finite(score.red)))}`);
  text(documentRef, "causal-hud-own", cardText(own, ownLabel, state));
  const rivalElement = text(documentRef, "causal-hud-rival", rival ? cardText(rival, rivalLabel) : "");
  if (rivalElement) rivalElement.hidden = !rival;
  const eventElement = text(documentRef, "causal-hud-event", latestEventText(state.events));
  if (eventElement) eventElement.hidden = !Array.isArray(state.events) || state.events.length === 0;
  const padsElement = documentRef?.getElementById?.("causal-hud-pads");
  // Pickups, ticks and FPS remain available to diagnostics, never in the
  // player-facing HUD. Keep their IDs and text contract for existing harnesses.
  if (padsElement) padsElement.hidden = true;
  const tickElement = text(documentRef, "causal-hud-tick", "");
  if (tickElement) tickElement.hidden = true;
  const fpsElement = documentRef?.getElementById?.("causal-hud-fps");
  if (fpsElement) fpsElement.hidden = true;
  for (const id of ["causal-hud-role", "causal-hud-connection", "causal-hud-own", "causal-hud-rival", "causal-hud-event", "causal-hud-pads", "causal-hud-tick", "causal-hud-fps"]) {
    const element = documentRef?.getElementById?.(id);
    if (element) {
      element.hidden = true;
      element.setAttribute?.("aria-hidden", "true");
    }
  }
  // A solo practice state has no match scoreboard yet. The arena remains
  // playable, while the player-facing board appears as soon as an
  // authoritative two-to-six-player snapshot arrives.
  root.hidden = !scoreboard && state.cars.length < 2;
  if (!scoreboard && state.cars.length >= 2) root.hidden = false;
  return Object.freeze({ ownId: own?.id || null, rivalId: rival?.id || null, role: roleName });
}
