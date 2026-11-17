const CONNECTION_TEXT = {
  loading: "CARGANDO ARENA…",
  connecting: "CONECTANDO A LA ARENA…",
  synchronizing: "SINCRONIZANDO PARTIDA…",
  reconnecting: "SERVIDOR DESCONECTADO · RECONECTANDO…"
};

function teamLabel(team) {
  return team === "blue" ? "AZUL" : team === "red" ? "ROJO" : null;
}

function localCarFor(state, localId) {
  if (!state || !Array.isArray(state.cars) || !localId) return null;
  return state.cars.find(car => car?.id === localId) || null;
}

/**
 * Pure presentation state for the player's immediate loop. The server and
 * RocketSim remain authoritative; this only selects a text state from their
 * published snapshot plus the local transport lifecycle.
 */
export function describePlayerExperienceState({
  connection = "loading",
  connectionDetail = "",
  state = null,
  localId = null,
  localTeam = null
} = {}) {
  const detail = typeof connectionDetail === "string" ? connectionDetail.trim() : "";
  if (connection === "error") {
    return { id: "connection-error", text: detail || "ERROR DE CONEXIÓN · REVISA EL SERVIDOR" };
  }
  if (!state) {
    return { id: CONNECTION_TEXT[connection] ? connection : "loading", text: CONNECTION_TEXT[connection] || CONNECTION_TEXT.loading };
  }

  const winner = state.winner;
  if (winner === "blue" || winner === "red") {
    const won = winner === localTeam;
    return { id: won ? "victory" : "defeat", text: won ? "VICTORIA · PULSA R PARA OTRA RONDA" : "DERROTA · PULSA R PARA OTRA RONDA" };
  }

  const car = localCarFor(state, localId);
  const respawn = Number(car?.respawn);
  if (Number.isFinite(respawn) && respawn > 0) {
    return { id: "respawning", text: `REAPARICIÓN · ${respawn.toFixed(1)} S` };
  }

  const roundState = state.settings?.roundState;
  if (roundState === "waiting") {
    return { id: "waiting-rival", text: "ESPERANDO RIVAL…" };
  }
  if (roundState === "complete") {
    return { id: "round-complete", text: "RONDA CERRADA · PULSA R PARA OTRA RONDA" };
  }

  const team = teamLabel(localTeam);
  if (team) return { id: "playing", text: `TÚ · EQUIPO ${team}` };
  return { id: "synchronizing", text: CONNECTION_TEXT.synchronizing };
}
