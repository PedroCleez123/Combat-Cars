/**
 * Planning contract for manual in-game test batches.
 *
 * This module never connects to a server or changes a match. It makes the
 * priority decision explicit so expensive browser playtests are grouped until
 * an actual P0 gameplay risk justifies an immediate interruption.
 */

export const PLAYTEST_PRIORITY = Object.freeze({
  P0: "P0-immediate",
  P1: "P1-next-grouped-batch",
  P2: "P2-planned-controlled-batch",
});

const P0_SIGNALS = Object.freeze([
  ["cannotControlVehicle", "el jugador no puede controlar el vehículo en una sesión normal"],
  ["cannotConnect", "el cliente no puede establecer o mantener una sesión autoritativa"],
  ["authoritativeStateCorrupt", "el estado autoritativo es inválido, retrocede o corrompe la partida"],
  ["criticalRegression", "un cambio reciente rompe una garantía de juego ya aceptada"],
]);

function validatePort(value, label) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`${label} debe ser un puerto entero entre 1 y 65535`);
  }
  return port;
}

function validateHost(value) {
  const host = String(value || "").trim();
  if (!host || /[/:?#[\]\\\s]/.test(host)) {
    throw new TypeError("host debe ser un nombre de host sin protocolo, ruta ni puerto");
  }
  return host;
}

function localhostUrl(host, port, query = "") {
  return `http://${host}:${port}/${query}`;
}

/**
 * P0 is reserved for a player-facing breakage. Everything else becomes part of
 * the next deliberate batch rather than causing a one-off in-game session.
 */
export function classifyPlaytestPriority(signals = {}) {
  if (!signals || typeof signals !== "object") throw new TypeError("signals debe ser un objeto");
  const reasons = P0_SIGNALS
    .filter(([key]) => signals[key] === true)
    .map(([, description]) => description);
  if (reasons.length) {
    return {
      priority: PLAYTEST_PRIORITY.P0,
      execution: "immediate",
      reasons,
    };
  }
  return {
    priority: PLAYTEST_PRIORITY.P1,
    execution: "group-with-next-batch",
    reasons: ["no hay una regresión P0 demostrada; se ahorra una sesión manual aislada"],
  };
}

/**
 * The first deliberate R19 browser batch. The ordered items share one setup,
 * but a single-pilot campaign must still be completed and closed before the
 * next one starts.
 */
export function createR19WebPlaytestBatch({
  host = "localhost",
  combatPort = 5300,
  practicePort = 5298,
} = {}) {
  const safeHost = validateHost(host);
  const safeCombatPort = validatePort(combatPort, "combatPort");
  const safePracticePort = validatePort(practicePort, "practicePort");
  const normalCombatUrl = localhostUrl(safeHost, safeCombatPort, "?arena=combat-alpha");

  return {
    id: "PLAYTEST-BATCH-01",
    title: "Lote web R19: contacto, techo y movilidad aérea",
    priority: PLAYTEST_PRIORITY.P1,
    execution: "group-with-next-batch",
    ports: { combat: safeCombatPort, practice: safePracticePort },
    preconditions: [
      "Los puertos de combate y práctica usan RocketSim R19 y publican snapshots vivos.",
      "Cerrar pestañas adicionales antes de HITBOX-01 y cada variante MOB-AIR: esas campañas requieren exactamente un piloto.",
      "No ejecutar la prueba de corte de snapshots contra una partida que alguien esté usando.",
    ],
    items: [
      {
        id: "normal-control-gate",
        priority: PLAYTEST_PRIORITY.P0,
        url: normalCombatUrl,
        goal: "Comprobar que una sesión normal acepta conducción, salto y nitro.",
        expected: "El coche responde y el HUD mantiene ACK creciente.",
        onFailure: "Detener el lote: es una incidencia P0 de controles o conexión.",
      },
      {
        id: "hitbox-visual",
        priority: PLAYTEST_PRIORITY.P1,
        url: localhostUrl(safeHost, safeCombatPort, "?arena=combat-alpha&hitbox01=1"),
        goal: "Observar la carrocería invertida sin penetración visible; el guion no debe autoenderezar el coche.",
        expected: "HUD con INV sí y CONTACTO sí; después, CONTROL DEL JUGADOR.",
        onFailure: "Guardar captura y clasificar fallida solo si el snapshot/HUD es completo; si no, no verificada.",
      },
      {
        id: "arena-ceiling-visual",
        priority: PLAYTEST_PRIORITY.P1,
        url: localhostUrl(safeHost, safePracticePort),
        goal: "Conducir una transición suelo-pared-techo de la arena R19 y comprobar continuidad visual.",
        expected: "Sin huecos visuales ni desajuste aparente entre curvas, pared y techo.",
        onFailure: "Guardar captura, perfil y bridge; no tocar geometría o física sin esa evidencia.",
      },
      {
        id: "mob-air-side",
        priority: PLAYTEST_PRIORITY.P1,
        url: localhostUrl(safeHost, safeCombatPort, "?arena=combat-alpha&mobair01=1&dodge=side"),
        goal: "Registrar la variante lateral aislada.",
        expected: "Un piloto, ACK creciente, seriales J/2/D y recuperación final.",
        onFailure: "Cerrar la campaña y clasificar no verificada si hay roster compartido o snapshots congelados.",
      },
      {
        id: "mob-air-diagonal",
        priority: PLAYTEST_PRIORITY.P1,
        url: localhostUrl(safeHost, safeCombatPort, "?arena=combat-alpha&mobair01=1&dodge=diagonal"),
        goal: "Registrar la variante diagonal aislada con air roll.",
        expected: "Un piloto, ACK creciente, seriales J/2/D y recuperación final.",
        onFailure: "Cerrar la campaña y clasificar no verificada si hay roster compartido o snapshots congelados.",
      },
      {
        id: "liveness-controlled-stall",
        priority: PLAYTEST_PRIORITY.P2,
        url: null,
        goal: "Ejecutar en un servidor desechable el corte controlado de snapshots para validar una sola reconexión del watchdog.",
        expected: "La prueba no afecta los puertos 5298/5300 ni una partida abierta.",
        onFailure: "Aplazar y conservar las pruebas unitarias; no interrumpir la sesión normal por esta comprobación.",
      },
    ],
    completion: {
      acceptedWhen: "Cada ítem P1 tiene evidencia suficiente o un estado explícito de no verificado; no se ajusta física durante el lote.",
      nextWhenGreen: "MOB-AIR-03 compara las trazas web y nativas antes de considerar una calibración.",
    },
  };
}

export function formatPlaytestBatchPlan(batch) {
  if (!batch || typeof batch !== "object" || !Array.isArray(batch.items)) {
    throw new TypeError("batch debe contener una lista de items");
  }
  const lines = [
    `${batch.id} · ${batch.priority}`,
    batch.title || "Lote de playtest",
    "",
    "Precondiciones:",
    ...batch.preconditions.map(item => `- ${item}`),
    "",
    "Secuencia:",
  ];
  for (const [index, item] of batch.items.entries()) {
    lines.push(`${index + 1}. [${item.priority}] ${item.id}: ${item.goal}`);
    if (item.url) lines.push(`   ${item.url}`);
    lines.push(`   Esperado: ${item.expected}`);
    lines.push(`   Si falla: ${item.onFailure}`);
  }
  lines.push("", `Cierre: ${batch.completion.acceptedWhen}`, `Siguiente si queda verde: ${batch.completion.nextWhenGreen}`);
  return lines.join("\n");
}
