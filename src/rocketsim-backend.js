import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  encodeBridgeInit,
  encodeBridgeCombatActive,
  encodeBridgeRespawn,
  encodeBridgeRaycast,
  encodeBridgeShutdown,
  encodeBridgeTick,
  normalizeBridgeStateFrame,
  normalizeBridgeRaycastFrame,
  parseBridgeLine,
  ROCKETSIM_FIXED_STEP_HZ,
  ROCKETSIM_MAX_CARS,
} from "./rocketsim-protocol.js";

export const ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS = 250;

// The native bridge does not need the server's deployment configuration. Keep
// its environment deliberately small so online credentials cannot cross the
// process boundary, while retaining the runtime and loader variables used by
// native executables on Windows, macOS and Linux.
export const ROCKETSIM_BRIDGE_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_ARCHITEW6432",
  "NUMBER_OF_PROCESSORS",
  "LD_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "LANG",
  "LC_ALL",
  "TZ",
]);

const bridgeEnvNames = new Set(ROCKETSIM_BRIDGE_ENV_ALLOWLIST.map(name => name.toLowerCase()));

/**
 * Build the environment for the native bridge process.
 *
 * `overrides` is intentionally filtered through the same allowlist as the
 * parent environment. This keeps callers from accidentally reintroducing a
 * deployment secret while still allowing explicit runtime/loader overrides.
 */
export function createRocketSimProcessEnv(baseEnv = process.env, overrides = {}) {
  const result = {};
  for (const source of [baseEnv, overrides]) {
    for (const [name, value] of Object.entries(source || {})) {
      if (!bridgeEnvNames.has(name.toLowerCase()) || value === undefined || value === null) continue;
      result[name] = String(value);
    }
  }
  return result;
}

export class RocketSimBridge {
  constructor({ executable, cwd, env, requestTimeoutMs = ROCKETSIM_DEFAULT_REQUEST_TIMEOUT_MS, startupTimeoutMs = 3000 } = {}) {
    if (!executable) throw new Error("RocketSimBridge needs an executable path");
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("RocketSimBridge requestTimeoutMs is invalid");
    if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) throw new Error("RocketSimBridge startupTimeoutMs is invalid");
    this.executable = executable;
    this.cwd = cwd;
    this.env = env;
    this.requestTimeoutMs = requestTimeoutMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.process = null;
    this.lines = null;
    this.pending = [];
    this.closed = false;
    this.stderr = "";
  }

  async start(options = {}) {
    if (this.process) throw new Error("RocketSim bridge is already running");
    this.closed = false;
    this.stderr = "";
    this.process = spawn(this.executable, [], {
      cwd: this.cwd,
      env: createRocketSimProcessEnv(process.env, this.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process.once("error", error => {
      this.closed = true;
      this.#rejectAll(error);
    });
    this.process.once("exit", (code, signal) => {
      const detail = this.stderr ? ` · ${this.stderr.slice(-400)}` : "";
      this.closed = true;
      this.process = null;
      this.lines?.close();
      this.#rejectAll(new Error(`RocketSim bridge exited (${code ?? "?"}/${signal ?? ""})${detail}`));
    });
    this.process.stderr.on("data", chunk => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4096);
    });
    this.lines = createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    this.lines.on("line", line => {
      try {
        const message = parseBridgeLine(line);
        const pending = this.pending.shift();
        if (!pending) return;
        clearTimeout(pending.timer);
        if (message.type === "error") pending.reject(new Error(message.message || "RocketSim bridge error"));
        else pending.resolve(message);
      } catch (error) {
        const pending = this.pending.shift();
        if (pending) { clearTimeout(pending.timer); pending.reject(error); }
      }
    });
    try {
      const ready = await this.#request(encodeBridgeInit({ fixedStepHz: ROCKETSIM_FIXED_STEP_HZ, ...options }), this.startupTimeoutMs);
      if (ready.type !== "ready") throw new Error(`RocketSim bridge did not become ready: ${ready.type}`);
      if (ready.schemaVersion !== 1 || ready.fixedStepHz !== ROCKETSIM_FIXED_STEP_HZ || ready.arena !== (options.arena || "clean-six-planes")) {
        throw new Error("RocketSim bridge ready frame does not match the requested contract");
      }
      const expectedCars = Array.isArray(options.cars) ? options.cars : [{ id: 1, team: "blue" }];
      if (!Array.isArray(ready.cars) || ready.cars.length < 1 || ready.cars.length > ROCKETSIM_MAX_CARS) {
        throw new Error("RocketSim bridge ready frame does not expose a valid car list");
      }
      const expectedIds = expectedCars.map(car => car.id).sort((a, b) => a - b);
      const readyIds = ready.cars.map(car => car.id).sort((a, b) => a - b);
      if (expectedIds.length !== readyIds.length || expectedIds.some((id, index) => id !== readyIds[index])) {
        throw new Error("RocketSim bridge ready frame does not expose the requested car IDs");
      }
      return ready;
    } catch (error) {
      await this.#terminate();
      throw error;
    }
  }

  async tick(tick, cars) {
    if (!this.process || this.closed) throw new Error("RocketSim bridge is not running");
    return normalizeBridgeStateFrame(await this.#request(encodeBridgeTick(tick, cars)));
  }

  async raycast(segments) {
    if (!this.process || this.closed) throw new Error("RocketSim bridge is not running");
    return normalizeBridgeRaycastFrame(await this.#request(encodeBridgeRaycast(segments)));
  }

  async respawn(id) {
    if (!this.process || this.closed) throw new Error("RocketSim bridge is not running");
    return normalizeBridgeStateFrame(await this.#request(encodeBridgeRespawn(id)));
  }

  async setCombatActive(id, active) {
    if (!this.process || this.closed) throw new Error("RocketSim bridge is not running");
    return normalizeBridgeStateFrame(await this.#request(encodeBridgeCombatActive(id, active)));
  }

  async shutdown() {
    if (!this.process || this.closed) return;
    this.closed = true;
    const process = this.process;
    try {
      const stopped = await this.#request(encodeBridgeShutdown(), this.startupTimeoutMs);
      if (stopped.type !== "stopped") throw new Error(`RocketSim bridge did not stop cleanly: ${stopped.type}`);
    } finally {
      await this.#terminate(process);
    }
  }

  #request(line, timeoutMs = this.requestTimeoutMs) {
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, timer: null };
      pending.timer = setTimeout(() => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        const detail = this.stderr ? ` · stderr: ${this.stderr.slice(-400).replace(/\s+/g, " ")}` : "";
        const error = new Error(`RocketSim bridge request timed out after ${timeoutMs}ms${detail}`);
        reject(error);
        this.#rejectAll(error);
        void this.#terminate();
      }, timeoutMs);
      this.pending.push(pending);
      this.process.stdin.write(`${line}\n`, error => {
        if (error) {
          const index = this.pending.indexOf(pending);
          if (index >= 0) this.pending.splice(index, 1);
          clearTimeout(pending.timer);
          pending.reject(error);
        }
      });
    });
  }

  #rejectAll(error) {
    while (this.pending.length) {
      const pending = this.pending.shift();
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  async #terminate(processOverride = null) {
    const process = processOverride || this.process;
    if (!process) return;
    this.closed = true;
    this.#rejectAll(new Error("RocketSim bridge terminated"));
    this.lines?.close();
    if (this.process === process) this.process = null;
    try { process.stdin.end(); } catch { /* process may already be closed */ }
    if (!process.killed) process.kill();
  }
}
