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
 * The only player-facing entry is final RocketSim R20 combat. This grouped
 * batch protects that contract without reviving retired practice URLs or
 * repeating accepted physics probes.
 */
export function createCombatExperiencePlaytestBatch({
  host = "localhost",
  combatPort = 5300,
} = {}) {
  const safeHost = validateHost(host);
  const safeCombatPort = validatePort(combatPort, "combatPort");
  const combatUrl = localhostUrl(safeHost, safeCombatPort, "?arena=combat-alpha");

  return {
    id: "COMBAT-EXPERIENCE-02",
    title: "Lote final R20: combate, cámara, arena y primera baja",
    priority: PLAYTEST_PRIORITY.P1,
    execution: "group-with-next-batch",
    ports: { combat: safeCombatPort },
    preconditions: [
      "Iniciar únicamente npm run play y esperar el mensaje del backend RocketSim R20.",
      "La cubierta PREPARANDO COMBATE debe desaparecer sólo después de ACTIVAR Y CARGAR.",
      "Para la parte multijugador, abrir el enlace LAN en un segundo navegador o usar otro piloto de la misma red.",
      "No iniciar servidores de práctica ni detener el puerto 5300 durante la sesión.",
    ],
    items: [
      {
        id: "normal-control-gate",
        priority: PLAYTEST_PRIORITY.P0,
        url: combatUrl,
        goal: "Comprobar que el combate final acepta conducción, salto, nitro y disparo.",
        expected: "El coche responde, el HUD mantiene ACK creciente y el botón de carga no reaparece.",
        onFailure: "Detener el lote: es una incidencia P0 de controles o conexión.",
      },
      {
        id: "first-kill-loading-and-performance",
        priority: PLAYTEST_PRIORITY.P1,
        url: combatUrl,
        goal: "Con un rival, bloquear con Q y disparar con F hasta la primera baja tras la pantalla de preparación.",
        expected: "La primera baja no congela perceptiblemente; FPS/ms siguen legibles y BAJAS aumenta.",
        onFailure: "Anotar FPS, ms, instante y si fue al disparar, impactar o eliminar; no diagnosticar por intuición.",
      },
      {
        id: "aim-camera-continuity",
        priority: PLAYTEST_PRIORITY.P1,
        url: combatUrl,
        goal: "Alternar Q con un rival visible, moverse y alejarse sin perder el coche propio de composición.",
        expected: "Car Cam y Enemy Cam conservan escala/encuadre; láser y arma indican el objetivo bloqueado.",
        onFailure: "Guardar una captura y describir el salto, zoom o dirección concreta antes de tocar la cámara.",
      },
      {
        id: "arena-readability-and-pickups",
        priority: PLAYTEST_PRIORITY.P1,
        url: combatUrl,
        goal: "Recorrer pared, curvas, esquinas, rampa y pickups en combat-alpha.",
        expected: "La arena se percibe continua y profunda; pickups restauran nitro y no aparecen huecos o atravesamientos nuevos.",
        onFailure: "Indicar ubicación, dirección de aproximación y captura; distinguir visual, colisión y transparencia.",
      },
      {
        id: "audio-and-session-finish",
        priority: PLAYTEST_PRIORITY.P1,
        url: combatUrl,
        goal: "Comprobar motor, nitro y salto durante combate y volver a abrir/cerrar la sesión una vez.",
        expected: "Audio reconocible y no molesto; no quedan loops al salir y la reconexión devuelve estado autoritativo.",
        onFailure: "Indicar el evento exacto, volumen y si el problema persiste tras soltar la entrada o cerrar la sesión.",
      },
    ],
    completion: {
      acceptedWhen: "Cada ítem P1 tiene evidencia suficiente o un estado explícito de no verificado; no se ajusta física durante el lote.",
      nextWhenGreen: "Cerrar COMBAT-EXPERIENCE-02 y priorizar online público o arte final según los resultados, sin reabrir modos retirados.",
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
