#!/usr/bin/env node

/**
 * Small public-route smoke for the causal beta.
 *
 * The runner is intentionally injected. A normal checkout can run this with
 * the optional `playwright` package, while a Playwright MCP runner can import
 * `runPublicCausalKeyboardSmoke` and pass its `chromium` browser type. This
 * keeps the smoke independent from the simulation, WASM authority, and
 * renderer implementation.
 */

import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_PUBLIC_CAUSAL_BETA_URL = "https://combat-cars.pages.dev/p2p-causal-beta.html";
export const DEFAULT_SMOKE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 100;
const MAX_TIMEOUT_MS = 120_000;

function boundedTimeout(value, fallback = DEFAULT_SMOKE_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.round(parsed)));
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.hash) url.hash = "#p2p=[redacted]";
    return url.href;
  } catch {
    return "[invalid-url]";
  }
}

/** Keep reports useful without echoing invite credentials, ICE candidates, or peer addresses. */
export function sanitizeDiagnostic(value) {
  let text = value instanceof Error ? value.message : String(value ?? "");
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, match => redactUrl(match));
  text = text.replace(/#p2p=[^\s"'<>]+/gi, "#p2p=[redacted]");
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[ip-redacted]");
  text = text.replace(/\b(?:candidate|candidates|srflx|relay|typ\s+host)\b[^\n]{0,180}/gi, "[ice-redacted]");
  return text.slice(0, 240);
}

function describeError(error) {
  return sanitizeDiagnostic(error);
}

async function networkPreflight(url, timeoutMs, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "fetch-unavailable" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, reason: response.ok ? null : `http-${response.status}` };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "network-unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

async function loadPlaywright() {
  for (const moduleName of ["playwright", "@playwright/test"]) {
    try {
      return await import(moduleName);
    } catch {
      // Playwright is optional in this repository. The CLI reports a bounded
      // skip when neither package is installed.
    }
  }
  return null;
}

function browserTypeFromRunner(runner) {
  if (!runner) return null;
  if (typeof runner.launch === "function") return runner;
  if (runner.chromium && typeof runner.chromium.launch === "function") return runner.chromium;
  if (runner.browserType && typeof runner.browserType.launch === "function") return runner.browserType;
  return null;
}

async function readObservation(page) {
  return page.evaluate(() => {
    const text = id => document.getElementById(id)?.textContent?.trim() || "";
    const canvas = document.getElementById("causal-scene") || document.getElementById("causal-canvas");
    const snapshot = text("causal-snapshot");
    const tickMatch = snapshot.match(/(?:^|\n)tick\s+(-?\d+)/i);
    const hudTickMatch = text("causal-hud-tick").match(/\bTICK\s+(-?\d+)/i);
    const rocketMatch = snapshot.match(/cohetes activos:\s*(\d+)/i);
    const positions = [...snapshot.matchAll(/posición\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/gi)]
      .map(match => ({ x: Number(match[1]), z: Number(match[2]), h: Number(match[3]) }));
    return {
      state: text("causal-state"),
      snapshot,
      hudTick: text("causal-hud-tick"),
      tick: tickMatch ? Number(tickMatch[1]) : hudTickMatch ? Number(hudTickMatch[1]) : null,
      rocketsActive: rocketMatch ? Number(rocketMatch[1]) : null,
      positions,
      actionDisabled: Boolean(document.getElementById("causal-action")?.disabled),
      hudHidden: document.getElementById("causal-hud")?.hidden ?? true,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      } : null,
    };
  });
}

async function waitForObservation(page, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const observation = await readObservation(page);
      if (predicate(observation)) return observation;
    } catch (error) {
      lastError = error;
    }
    await sleep(DEFAULT_POLL_MS);
  }
  const suffix = lastError ? `: ${describeError(lastError)}` : "";
  throw new Error(`${label} (timeout ${timeoutMs}ms${suffix})`);
}

async function waitForEnabled(locator, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (!(await locator.isDisabled())) return;
    } catch {
      // The page may still be attaching its module listeners.
    }
    await sleep(DEFAULT_POLL_MS);
  }
  throw new Error(`${label} (timeout ${timeoutMs}ms)`);
}

function attachDiagnostics(page, diagnostics) {
  page.on("console", message => {
    if (message.type() === "error") diagnostics.consoleErrors.push(sanitizeDiagnostic(message.text()));
  });
  page.on("pageerror", error => diagnostics.pageErrors.push(describeError(error)));
}

function pageSummary(observation) {
  return {
    state: observation.state,
    hudTick: observation.hudTick,
    tick: observation.tick,
    rocketsActive: observation.rocketsActive,
    positions: observation.positions,
    canvas: observation.canvas,
  };
}

function changedSnapshot(before, after) {
  return before.snapshot !== after.snapshot
    || before.tick !== after.tick
    || before.hudTick !== after.hudTick;
}

/**
 * Run the two-context public beta flow. `runner` may be Playwright's
 * `chromium` object or a compatible MCP-provided browser type.
 */
export async function runPublicCausalKeyboardSmoke({
  runner = null,
  url = process.env.P2P_CAUSAL_BETA_URL || DEFAULT_PUBLIC_CAUSAL_BETA_URL,
  timeoutMs = boundedTimeout(process.env.P2P_CAUSAL_BETA_TIMEOUT_MS),
  fetchImpl = globalThis.fetch,
  headless = process.env.P2P_CAUSAL_BETA_HEADLESS !== "false",
} = {}) {
  const startedAt = Date.now();
  const report = {
    status: "failed",
    publicRoute: "not-verified",
    externalNat: "not-verified",
    assessment: {
      publicRoute: "public route not verified",
      externalNat: "external NAT not verified",
    },
    url: redactUrl(url),
    timeoutMs,
    invite: null,
    keyboard: { wHeldMs: 250, fPressed: false },
    peers: {},
    diagnostics: { consoleErrors: [], pageErrors: [] },
    durationMs: null,
  };

  const preflight = await networkPreflight(url, Math.min(timeoutMs, 10_000), fetchImpl);
  report.preflight = preflight;
  if (!preflight.ok) {
    report.status = "skipped";
    report.skipReason = `network-unavailable:${preflight.reason}`;
    report.durationMs = Date.now() - startedAt;
    return report;
  }
  report.publicRoute = "verified";
  report.assessment.publicRoute = "public route verified";

  const browserType = browserTypeFromRunner(runner || await loadPlaywright());
  if (!browserType) {
    report.status = "skipped";
    report.skipReason = "playwright-runner-unavailable";
    report.durationMs = Date.now() - startedAt;
    return report;
  }

  let browser;
  let hostContext;
  let guestContext;
  try {
    browser = await browserType.launch({ headless });
    hostContext = await browser.newContext();
    guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    attachDiagnostics(host, report.diagnostics);
    attachDiagnostics(guest, report.diagnostics);

    await host.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const hostPrimary = host.locator("#primary");
    await hostPrimary.waitFor({ state: "visible", timeout: timeoutMs });
    await waitForEnabled(hostPrimary, timeoutMs, "host create-room action did not become available");
    await hostPrimary.click({ timeout: timeoutMs });
    await host.locator("#room-panel").waitFor({ state: "visible", timeout: timeoutMs });
    const inviteUrl = await host.locator("#invite-url").inputValue();
    if (!inviteUrl || !inviteUrl.includes("#p2p=")) throw new Error("host did not create a private invite");
    report.invite = redactUrl(inviteUrl);

    await guest.goto(inviteUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const guestPrimary = guest.locator("#primary");
    await guestPrimary.waitFor({ state: "visible", timeout: timeoutMs });
    await waitForEnabled(guestPrimary, timeoutMs, "guest join-room action did not become available");
    await guestPrimary.click({ timeout: timeoutMs });

    const readyPredicate = observation => /listo|snapshot recibido|sincronizado/i.test(observation.state)
      && !/error|falló|cerrada/i.test(observation.state);
    const [hostReady, guestReady] = await Promise.all([
      waitForObservation(host, readyPredicate, timeoutMs, "host causal-ready"),
      waitForObservation(guest, readyPredicate, timeoutMs, "guest causal-ready"),
    ]);
    const [hostBefore, guestBefore] = await Promise.all([
      waitForObservation(host, observation => observation.tick !== null
        && observation.canvas?.width > 0 && observation.canvas?.height > 0
        && observation.canvas?.clientWidth > 0 && observation.canvas?.clientHeight > 0
        && !observation.hudHidden, timeoutMs, "host first snapshot"),
      waitForObservation(guest, observation => observation.tick !== null
        && observation.canvas?.width > 0 && observation.canvas?.height > 0
        && observation.canvas?.clientWidth > 0 && observation.canvas?.clientHeight > 0
        && !observation.hudHidden, timeoutMs, "guest first snapshot"),
    ]);

    await guest.locator("#causal-scene").click({ timeout: timeoutMs });
    await guest.keyboard.down("w");
    await sleep(report.keyboard.wHeldMs);
    await guest.keyboard.up("w");
    await guest.keyboard.press("f");
    report.keyboard.fPressed = true;

    const [hostAfter, guestAfter] = await Promise.all([
      waitForObservation(host, observation => changedSnapshot(hostBefore, observation), timeoutMs, "host snapshots after keyboard input"),
      waitForObservation(guest, observation => changedSnapshot(guestBefore, observation), timeoutMs, "guest snapshots after keyboard input"),
    ]);
    report.peers = {
      host: { causalReady: pageSummary(hostReady), before: pageSummary(hostBefore), after: pageSummary(hostAfter), snapshotsContinued: changedSnapshot(hostBefore, hostAfter) },
      guest: { causalReady: pageSummary(guestReady), before: pageSummary(guestBefore), after: pageSummary(guestAfter), snapshotsContinued: changedSnapshot(guestBefore, guestAfter) },
    };
    report.keyboard.observation = {
      hostTick: hostAfter.tick,
      guestTick: guestAfter.tick,
      hostPositions: hostAfter.positions,
      guestPositions: guestAfter.positions,
      hostRocketsActive: hostAfter.rocketsActive,
      guestRocketsActive: guestAfter.rocketsActive,
    };
    report.keyboard.fireObservation = {
      hostRocketsBefore: hostBefore.rocketsActive,
      hostRocketsAfter: hostAfter.rocketsActive,
      guestRocketsBefore: guestBefore.rocketsActive,
      guestRocketsAfter: guestAfter.rocketsActive,
      textualFireState: /fire|fuego|dispar/i.test(`${hostAfter.state}\n${guestAfter.state}\n${hostAfter.snapshot}\n${guestAfter.snapshot}`),
    };
    if (!report.peers.host.snapshotsContinued || !report.peers.guest.snapshotsContinued) {
      throw new Error("one peer stopped receiving causal snapshots");
    }
    if (!(hostAfter.canvas?.width > 0 && hostAfter.canvas?.height > 0
      && hostAfter.canvas?.clientWidth > 0 && hostAfter.canvas?.clientHeight > 0
      && !hostAfter.hudHidden)
      || !(guestAfter.canvas?.width > 0 && guestAfter.canvas?.height > 0
        && guestAfter.canvas?.clientWidth > 0 && guestAfter.canvas?.clientHeight > 0
        && !guestAfter.hudHidden)) {
      throw new Error("one peer lost its causal canvas");
    }
    if (report.diagnostics.consoleErrors.length || report.diagnostics.pageErrors.length) {
      throw new Error("browser console errors were reported");
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = describeError(error);
  } finally {
    try { await guestContext?.close(); } catch { /* best effort */ }
    try { await hostContext?.close(); } catch { /* best effort */ }
    try { await browser?.close(); } catch { /* best effort */ }
    report.durationMs = Date.now() - startedAt;
  }
  return report;
}

async function main() {
  const report = await runPublicCausalKeyboardSmoke();
  // Invite credentials are redacted in `report.invite`; do not add raw URL or
  // browser diagnostics that could contain a signaling payload here.
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href) {
  await main();
}

