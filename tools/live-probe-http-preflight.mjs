import { request } from "node:http";

function normalizePort(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("port debe ser un entero entre 1 y 65535");
  }
  return port;
}

/**
 * A non-invasive local HTTP check used only by the observer probes. It turns a
 * generic WebSocket error into an actionable distinction between a missing
 * listener and a listener that rejects or fails its WebSocket upgrade.
 */
export function inspectLocalHttpEndpoint({ port, timeoutMs = 1_200, requestImpl = request } = {}) {
  const safePort = normalizePort(port);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs debe ser positivo");
  return new Promise(resolve => {
    let settled = false;
    const finish = report => {
      if (settled) return;
      settled = true;
      resolve({ host: "127.0.0.1", port: safePort, ...report });
    };
    const probe = requestImpl({
      hostname: "127.0.0.1",
      port: safePort,
      path: "/",
      method: "GET",
      timeout: timeoutMs,
    }, response => {
      response.resume();
      finish({
        reachable: true,
        statusCode: response.statusCode || null,
        contentType: response.headers["content-type"] || null,
      });
    });
    probe.once("error", error => finish({
      reachable: false,
      errorCode: error?.code || "UNKNOWN",
      detail: error?.message || "No se pudo abrir HTTP local.",
    }));
    probe.once("timeout", () => {
      probe.destroy();
      finish({ reachable: false, errorCode: "HTTP_TIMEOUT", detail: "HTTP local no respondió dentro del plazo." });
    });
    probe.end();
  });
}
