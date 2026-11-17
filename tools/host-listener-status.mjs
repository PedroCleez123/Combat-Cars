import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectLocalHttpEndpoint } from "./live-probe-http-preflight.mjs";

export const DEFAULT_ROCKETSIM_HOSTS = Object.freeze([
  Object.freeze({ id: "combat", port: 5300, url: "http://localhost:5300" }),
  Object.freeze({ id: "practice", port: 5298, url: "http://localhost:5298" }),
]);

function normalizePort(value, name) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`${name} debe ser un puerto entero entre 1 y 65535`);
  }
  return port;
}

/**
 * Checks only each HTTP listener. It deliberately does not open a WebSocket or
 * send a `hello`, so it cannot create a temporary pilot or alter a live match.
 */
export async function inspectRocketSimHostListeners({
  inspectEndpoint = inspectLocalHttpEndpoint,
  combatPort = process.env.COMBAT_HOST_PORT ?? 5300,
  practicePort = process.env.PRACTICE_HOST_PORT ?? 5298,
} = {}) {
  if (typeof inspectEndpoint !== "function") throw new TypeError("inspectEndpoint debe ser una función");
  const targets = [
    { id: "combat", port: normalizePort(combatPort, "COMBAT_HOST_PORT") },
    { id: "practice", port: normalizePort(practicePort, "PRACTICE_HOST_PORT") },
  ];
  const hosts = await Promise.all(targets.map(async target => {
    const httpPreflight = await inspectEndpoint({ port: target.port });
    const ready = httpPreflight.reachable && httpPreflight.statusCode === 200;
    return {
      ...target,
      url: `http://localhost:${target.port}`,
      status: ready ? "ready" : "unavailable",
      httpPreflight,
    };
  }));
  return {
    schemaVersion: 1,
    story: "ROCKETSIM-HOST-LISTENER-STATUS",
    status: hosts.every(host => host.status === "ready") ? "ready" : "unavailable",
    detail: "Comprueba únicamente HTTP local; no abre WebSocket ni modifica una sesión.",
    hosts,
  };
}

async function main() {
  const report = await inspectRocketSimHostListeners();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ready") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
