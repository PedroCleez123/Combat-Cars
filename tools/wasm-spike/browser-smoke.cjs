/*
 * P2P-WASM-02 runs the isolated WASM fixture in Chromium/Electron. It has its
 * own privileged local protocol and never starts server.mjs or the game.
 */
const { app, BrowserWindow, protocol } = require("electron");
const { randomBytes } = require("node:crypto");
const { existsSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

protocol.registerSchemesAsPrivileged([{
  scheme: "arsenal",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const projectRoot = path.join(__dirname, "..", "..");
const spikeRoot = __dirname;
const startedAt = Date.now();
const multi = process.argv.includes("--multi");
const ground = process.argv.includes("--ground");
const wall = process.argv.includes("--wall");
const carContact = process.argv.includes("--car-contact");
const p2pHost = process.argv.includes("--p2p-host");
const p2pCombatAlphaHost = process.argv.includes("--p2p-combat-alpha-host");
const p2pCausalCombat = process.argv.includes("--p2p-causal-combat");
const p2pCausalPresentation = process.argv.includes("--p2p-causal-presentation");
const p2pCausalPresentationThree = process.argv.includes("--p2p-causal-presentation-three");
const p2pFullCombat = process.argv.includes("--p2p-full-combat");
const p2pCausalCombatWebRTC = process.argv.includes("--p2p-causal-combat-webrtc");
const p2pCausalCombatWebRTCPair = process.argv.includes("--p2p-causal-combat-webrtc-pair");
const onlineQa24 = process.argv.includes("--online-qa-24");
const onlineLifecycle25 = process.argv.includes("--online-lifecycle-25");
const combatAlphaRaycast = process.argv.includes("--combat-alpha-raycast");
const timeoutMs = Number(process.env.WASM_SPIKE_BROWSER_TIMEOUT_MS || (onlineQa24 || onlineLifecycle25 ? 60000 : 15000));
const browserErrors = [];
const browserErrorsByWindow = new WeakMap();
let window = null;
let artifactPath = null;

function selectedStory() {
  if (onlineLifecycle25) return "ONLINE-LIFECYCLE-25";
  if (onlineQa24) return "ONLINE-QA-24";
  if (combatAlphaRaycast) return "P2P-WASM-16";
  if (p2pCausalPresentationThree) return "P2P-WASM-44";
  if (p2pFullCombat) return "P2P-WASM-FULL-01";
  if (p2pCausalPresentation) return "P2P-WASM-42";
  if (p2pCausalCombatWebRTCPair) return "P2P-WASM-24";
  if (p2pCausalCombatWebRTC) return "P2P-WASM-23";
  if (p2pCausalCombat) return "P2P-WASM-20";
  if (p2pCombatAlphaHost) return "P2P-WASM-19";
  if (p2pHost) return "P2P-WASM-07";
  if (carContact) return "P2P-WASM-06";
  if (wall) return "P2P-WASM-05";
  if (ground) return "P2P-WASM-04";
  if (multi) return "P2P-WASM-03";
  return "P2P-WASM-02";
}

function selectedPage() {
  if (onlineLifecycle25) return "browser-online-lifecycle-25-smoke.html";
  if (onlineQa24) return "browser-online-qa-24-smoke.html";
  if (combatAlphaRaycast) return "browser-combat-alpha-raycast-benchmark.html";
  if (p2pCausalPresentationThree) return "browser-p2p-causal-presentation-three-smoke.html";
  if (p2pFullCombat) return "browser-p2p-full-combat-smoke.html";
  if (p2pCausalPresentation) return "browser-p2p-causal-presentation-smoke.html";
  if (p2pCausalCombatWebRTCPair) return "browser-p2p-causal-combat-webrtc-pair-smoke.html";
  if (p2pCausalCombatWebRTC) return "browser-p2p-causal-combat-webrtc-smoke.html";
  if (p2pCausalCombat) return "browser-p2p-causal-combat-smoke.html";
  if (p2pCombatAlphaHost) return "browser-p2p-combat-alpha-host-smoke.html";
  if (p2pHost) return "browser-p2p-host-smoke.html";
  if (carContact) return "browser-car-contact-smoke.html";
  if (wall) return "browser-wall-smoke.html";
  if (ground) return "browser-ground-smoke.html";
  if (multi) return "browser-multicar-smoke.html";
  return "browser-smoke.html";
}

function fail(message) {
  const error = new Error(message);
  error.safeMessage = message;
  throw error;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requireBuiltArtifact() {
  for (const resource of ["browser-smoke.html", "browser-multicar-smoke.html", "browser-ground-smoke.html", "browser-wall-smoke.html", "browser-car-contact-smoke.html", "browser-p2p-host-smoke.html", "browser-p2p-combat-alpha-host-smoke.html", "browser-p2p-causal-combat-smoke.html", "browser-p2p-causal-presentation-smoke.html", "browser-p2p-causal-presentation-three-smoke.html", "browser-p2p-full-combat-smoke.html", "browser-p2p-causal-combat-webrtc-smoke.html", "browser-p2p-causal-combat-webrtc-pair-smoke.html", "browser-online-qa-24-smoke.html", "browser-online-lifecycle-25-smoke.html", "browser-combat-alpha-raycast-benchmark.html", "trace-contract.mjs", "multi-car.mjs", "ground-trace.mjs", "ground-trace-contract.mjs", "wall-trace-contract.mjs", "car-contact-trace.mjs", "car-contact-trace-contract.mjs", "p2p-wasm-host-match.mjs", "p2p-wasm-combat-host.mjs", "p2p-wasm-full-combat-host.mjs", "p2p-wasm-host-clock.mjs", "p2p-wasm-causal-combat-protocol.mjs", "p2p-wasm-causal-combat-presentation-protocol.mjs", "p2p-wasm-presentation-render-state.mjs", "p2p-wasm-arena-presentation.mjs", "p2p-wasm-camera-framing.mjs", "p2p-wasm-three-presentation-renderer.mjs", "p2p-wasm-causal-combat-channel.mjs", "p2p-wasm-causal-room-session.mjs", "p2p-wasm-metadata-channel.mjs", "combat-alpha-static-raycast-contract.mjs", "build/rocketsim_wasm.mjs", "build/rocketsim_wasm.wasm"]) {
    if (!existsSync(path.join(spikeRoot, resource))) fail(`Falta el artefacto WASM aislado: ${resource}. Ejecuta build.ps1.`);
  }
  if (p2pCausalPresentationThree && (!existsSync(path.join(projectRoot, "node_modules", "three", "build", "three.module.js"))
    || !existsSync(path.join(projectRoot, "node_modules", "three", "build", "three.core.js")))) {
    fail("Falta el módulo Three.js permitido para el smoke de presentación.");
  }
  for (const resource of ["rocketsim-combat.js", "rocketsim-practice-match.js", "rocketsim-arena-profile.js", "combat-alpha-map.js", "rocketsim-protocol.js", "lan-session-protocol.js", "p2p-session-protocol.js", "p2p-room-config.js", "p2p-wasm-render-state.js", "online-full-presentation-state.js", "camera-follow.js", "snapshot-interpolation.js", "p2p-webrtc-session.js", "p2p-player-identity.js"]) {
    if (!existsSync(path.join(projectRoot, "src", resource))) fail(`Falta el módulo fuente causal permitido: src/${resource}.`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) fail("WASM_SPIKE_BROWSER_TIMEOUT_MS debe estar entre 1000 y 60000.");
}

async function registerLocalProtocol() {
  const { resolveWasmSmokeResource, resolveWasmSmokeFile, wasmSmokeContentType } = await import("./browser-smoke-server.mjs");
  protocol.handle("arsenal", async request => {
    const url = new URL(request.url);
    if (process.env.WASM_SPIKE_BROWSER_PROTOCOL_DEBUG === "1") console.error(`[arsenal-protocol] ${request.method} ${url.pathname}`);
    // Fragments are client-only, but Electron's privileged protocol can keep
    // `#host`/`#pilot` on the request URL. The allowlist resolver deliberately
    // rejects query strings and fragments, so resolve only the resource path.
    const relative = resolveWasmSmokeResource(request.method, url.pathname);
    if (!relative) return new Response("not found", { status: 404 });
    const file = resolveWasmSmokeFile(relative);
    if (!file || !existsSync(file)) return new Response("not built", { status: 404 });
    const body = await readFile(file);
    return new Response(body, { status: 200, headers: { "Content-Type": wasmSmokeContentType(file), "Cache-Control": "no-store" } });
  });
}

async function createArtifactPath() {
  const root = path.join(projectRoot, "artifacts");
  await mkdir(root, { recursive: true });
  const name = `rocketsim-wasm-browser-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${randomBytes(4).toString("hex")}`;
  const directory = path.join(root, name);
  await mkdir(directory);
  artifactPath = path.join(directory, "result.json");
}

function attachBrowserDiagnostics(target = window) {
  // Electron 35 delivers one Event<WebContentsConsoleMessageEventParams>.
  // Using the former positional parameters emits a deprecation warning that
  // obscures actual renderer diagnostics in this gate.
  const targetErrors = [];
  browserErrorsByWindow.set(target, targetErrors);
  target.webContents.on("console-message", details => {
    const level = details?.level;
    const text = String(details?.message || "");
    const isError = typeof level === "string" ? level.toLowerCase() === "error" : Number(level) >= 2;
    if (isError && !text.includes("Electron Security Warning")) {
      const message = text.slice(0, 500);
      if (targetErrors.length < 20) targetErrors.push(message);
      if (browserErrors.length < 20) browserErrors.push(message);
    }
  });
  target.webContents.on("did-fail-load", (_event, code, description, url) => {
    const message = `load ${code} ${description} ${url}`;
    targetErrors.push(message);
    browserErrors.push(message);
  });
}

async function readResult() {
  const key = onlineLifecycle25 ? "__arsenalOnlineLifecycle25Smoke" : combatAlphaRaycast ? "__arsenalWasmBrowserCombatAlphaRaycastBenchmark" : p2pFullCombat ? "__arsenalWasmBrowserP2PFullCombatSmoke" : p2pCausalPresentationThree ? "__arsenalWasmBrowserP2PCausalPresentationThreeSmoke" : p2pCausalPresentation ? "__arsenalWasmBrowserP2PCausalPresentationSmoke" : p2pCausalCombatWebRTC ? "__arsenalWasmBrowserP2PCausalCombatWebRTCSmoke" : p2pCausalCombat ? "__arsenalWasmBrowserP2PCausalCombatSmoke" : p2pCombatAlphaHost ? "__arsenalWasmBrowserP2PCombatAlphaHostSmoke" : p2pHost ? "__arsenalWasmBrowserP2PHostSmoke" : carContact ? "__arsenalWasmBrowserCarContactSmoke" : wall ? "__arsenalWasmBrowserWallSmoke" : ground ? "__arsenalWasmBrowserGroundSmoke" : multi ? "__arsenalWasmBrowserMulticarSmoke" : "__arsenalWasmBrowserSmoke";
  return window.webContents.executeJavaScript(`window.${key} || null`);
}

async function readPairResult(target) {
  const key = onlineQa24 ? "__arsenalOnlineQa24Smoke" : "__arsenalWasmBrowserP2PCausalCombatWebRTCPairSmoke";
  return target.webContents.executeJavaScript(`window.${key} || null`);
}

async function readPairDiagnostic(target) {
  return target.webContents.executeJavaScript(`({
    status: document.querySelector("#status")?.textContent || "",
    scope: document.querySelector("#scope")?.textContent || "",
    readyState: document.readyState,
    bodyText: document.body?.innerText || "",
    href: location.href,
    pair: window.__arsenalWasmBrowserP2PCausalCombatWebRTCPairDebug?.() || null,
    lifecycle: window.__onlineLifecycle25Debug?.() || null,
  })`).then(value => ({ ...value, consoleErrors: browserErrorsByWindow.get(target) || [] }));
}

async function waitForResult() {
  const deadline = Date.now() + timeoutMs;
  let result = null;
  while (Date.now() < deadline) {
    result = await readResult();
    if (result?.ok === true || result?.ok === false) return result;
    await delay(50);
  }
  const diagnostic = await window.webContents.executeJavaScript(`({
    status: document.querySelector("#status")?.textContent || "",
    readyState: document.readyState,
    location: location.href,
    result: window.__arsenalWasmBrowserP2PFullCombatSmoke || null,
  })`);
  fail(`La fixture WASM no terminó dentro de ${timeoutMs} ms. Diagnóstico=${JSON.stringify(diagnostic)}`);
}

async function waitForPairResults(hostWindow, pilotWindow) {
  const deadline = Date.now() + timeoutMs;
  let host = null;
  let pilot = null;
  while (Date.now() < deadline) {
    [host, pilot] = await Promise.all([readPairResult(hostWindow), readPairResult(pilotWindow)]);
    if (host?.ok === false || pilot?.ok === false) {
      fail(`La pareja causal informó un error: ${host?.error || pilot?.error || JSON.stringify({ host, pilot })}`);
    }
    if (host?.ok === true && pilot?.ok === true) return { host, pilot };
    await delay(50);
  }
  const [hostDiagnostic, pilotDiagnostic] = await Promise.all([
    readPairDiagnostic(hostWindow),
    readPairDiagnostic(pilotWindow),
  ]);
  fail(`La pareja causal no terminó dentro de ${timeoutMs} ms. Diagnóstico host=${JSON.stringify(hostDiagnostic)} pilot=${JSON.stringify(pilotDiagnostic)}`);
}

async function waitForLifecycleResult(hostWindow, guestOneWindow, guestTwoWindow) {
  const deadline = Date.now() + timeoutMs;
  let result = null;
  while (Date.now() < deadline) {
    result = await hostWindow.webContents.executeJavaScript("window.__arsenalOnlineLifecycle25Smoke || null");
    if (result?.ok === true || result?.ok === false) return result;
    await delay(50);
  }
  const diagnostic = await Promise.all([hostWindow, guestOneWindow, guestTwoWindow].map(readPairDiagnostic));
  fail(`ONLINE-LIFECYCLE-25 no terminó dentro de ${timeoutMs} ms. Diagnóstico=${JSON.stringify(diagnostic)}`);
}

function createHiddenWindow() {
  return new BrowserWindow({
    width: 960,
    height: 540,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
}

async function run() {
  if ([p2pHost, p2pCombatAlphaHost, p2pCausalCombat, p2pCausalPresentation, p2pCausalPresentationThree, p2pFullCombat, p2pCausalCombatWebRTC, p2pCausalCombatWebRTCPair, onlineQa24, onlineLifecycle25].filter(Boolean).length > 1) fail("Selecciona sólo un smoke de host P2P por ejecución.");
  requireBuiltArtifact();
  await createArtifactPath();
  await registerLocalProtocol();
  const page = selectedPage();
  if (onlineLifecycle25) {
    const hostWindow = createHiddenWindow();
    const guestOneWindow = createHiddenWindow();
    const guestTwoWindow = createHiddenWindow();
    for (const target of [hostWindow, guestOneWindow, guestTwoWindow]) {
      window = target;
      attachBrowserDiagnostics();
    }
    await guestTwoWindow.loadURL(`arsenal://smoke/${page}#guest2`);
    await guestOneWindow.loadURL(`arsenal://smoke/${page}#guest1`);
    await hostWindow.loadURL(`arsenal://smoke/${page}#host`);
    const lifecycle = await waitForLifecycleResult(hostWindow, guestOneWindow, guestTwoWindow);
    // Call each fixture cleanup twice: the first call closes the boundary and
    // the second proves the lifecycle transition is safe to repeat.
    const cleanup = await Promise.all([hostWindow, guestOneWindow, guestTwoWindow].map(async target => {
      const first = await target.webContents.executeJavaScript("window.__arsenalOnlineLifecycle25Cleanup?.() || null");
      const second = await target.webContents.executeJavaScript("window.__arsenalOnlineLifecycle25Cleanup?.() || null");
      return { ...second, firstClosed: first?.closed === true, firstIdempotent: first?.idempotent === true };
    }));
    window = hostWindow;
    var smoke = { ok: true, lifecycle, cleanup };
  } else if (p2pCausalCombatWebRTCPair || onlineQa24) {
    const pilotWindow = createHiddenWindow();
    const hostWindow = createHiddenWindow();
    const previousWindow = window;
    window = pilotWindow;
    attachBrowserDiagnostics();
    window = hostWindow;
    attachBrowserDiagnostics();
    window = previousWindow;
    await pilotWindow.loadURL(`arsenal://smoke/${page}#pilot`);
    await hostWindow.loadURL(`arsenal://smoke/${page}#host`);
    const pair = await waitForPairResults(hostWindow, pilotWindow);
    const cleanupKey = onlineQa24 ? "__arsenalOnlineQa24Cleanup" : "__arsenalWasmBrowserP2PCausalCombatWebRTCPairCleanup";
    const cleanup = await Promise.all([
      hostWindow.webContents.executeJavaScript(`window.${cleanupKey}?.() || null`),
      pilotWindow.webContents.executeJavaScript(`window.${cleanupKey}?.() || null`),
    ]);
    window = hostWindow;
    var smoke = { ok: true, ...pair, cleanup };
  } else {
    window = createHiddenWindow();
    attachBrowserDiagnostics();
    await window.loadURL(`arsenal://smoke/${page}`);
    var smoke = await waitForResult();
  }
  if (!smoke.ok) fail(`La página informó un error: ${smoke.error || "desconocido"}`);
  if (p2pHost && (JSON.stringify(smoke.ticks) !== JSON.stringify([6, 12, 18, 24])
    || smoke.internalWasmTick !== 48
    || smoke.twoCarSnapshots !== true
    || smoke.velocityContractValid !== true
    || smoke.payloadWithinLimit !== true
    || smoke.cleanupIdempotent !== true)) fail("La página no validó la cadencia, el contrato compacto o la limpieza P2P-WASM-07.");
  if (p2pCombatAlphaHost && (smoke.story !== "P2P-WASM-19"
    || smoke.fixture !== "combat-alpha-pair"
    || JSON.stringify(smoke.ticks) !== JSON.stringify([1, 2])
    || smoke.internalWasmTick !== 4
    || smoke.spawnContractValid !== true
    || smoke.hostAdvanced !== true
    || smoke.lifecycleContractValid !== true
    || smoke.velocityContractValid !== true
    || smoke.cleanupIdempotent !== true)) {
    fail(`La página no validó el host combat-alpha, lifecycle o limpieza P2P-WASM-19: ${JSON.stringify(smoke)}`);
  }
  if (p2pCausalCombat && (smoke.story !== "P2P-WASM-20"
    || smoke.fixture !== "combat-lineup"
    || smoke.fixedDt !== 1 / 60
    || smoke.staticInterception !== true
    || !Array.isArray(smoke.combatEvents)
    || ["fire", "hit", "elimination", "respawn"].some(kind => !smoke.combatEvents.includes(kind))
    || !Number.isSafeInteger(smoke.finalTick) || smoke.finalTick < 1 || smoke.finalTick > 520
    || smoke.internalWasmTick !== smoke.finalTick * 2
    || smoke.physicalLifecycleValid !== true
    || smoke.targetPersistenceValid !== true
    || smoke.causalEnvelopeValid !== true
    || !Number.isSafeInteger(smoke.maxCausalEnvelopeBytes) || smoke.maxCausalEnvelopeBytes < 1 || smoke.maxCausalEnvelopeBytes > 2048
    || smoke.cleanupIdempotent !== true)) {
    fail(`La página no validó combate causal, oclusión estática o lifecycle P2P-WASM-20: ${JSON.stringify(smoke)}`);
  }
  if (p2pCausalPresentation && (smoke.story !== "P2P-WASM-42"
    || smoke.protocolVersion !== 5
    || smoke.type !== "wasm-causal-combat-presentation"
    || smoke.tick !== 1
    || smoke.vehicleCount !== 2
    || smoke.fullAttitude !== true
    || smoke.boostTelemetry !== true
    || smoke.mobilityTelemetry !== true
    || smoke.surfaceTelemetry !== true
    || smoke.bufferSampled !== true
    || smoke.compactSnapshotUntouched !== true
    || !Number.isSafeInteger(smoke.bytes) || smoke.bytes < 1 || smoke.bytes > 4096
    || smoke.bytesWithinLimit !== true
    || smoke.cleanupIdempotent !== true)) {
    fail(`La página no validó el adaptador de presentación v2 P2P-WASM-42: ${JSON.stringify(smoke)}`);
  }
  if (p2pCausalPresentationThree && (smoke.story !== "P2P-WASM-44"
    || smoke.renderer !== "three.js"
    || smoke.protocolVersion !== 5
    || smoke.vehicleCount !== 2
    || smoke.fullAttitude !== true
    || smoke.mobilityTelemetry !== true
    || smoke.canvasVisible !== true
    || !Number.isSafeInteger(smoke.renderCalls) || smoke.renderCalls < 1
    || !Number.isSafeInteger(smoke.pixelDiversity) || smoke.pixelDiversity < 4
    || smoke.cameraFocusId !== "p2p-host"
    || smoke.cameraInitialized !== true
    || !Number.isFinite(smoke.cameraRivalDistance)
    || !Number.isFinite(smoke.cameraFollowDistance)
    || smoke.arena !== "combat-alpha"
    || !Number.isFinite(smoke.arenaWidth)
    || !Number.isFinite(smoke.arenaDepth)
    || !Number.isFinite(smoke.arenaHeight)
    || smoke.arenaSurfaceContract !== "unified-interior-shell-v1"
    || smoke.effectPrewarmStatus !== "ready"
    || smoke.effectPrewarmCompilePasses !== 3
    || smoke.vehicleWheelCount !== 8
    || !Number.isSafeInteger(smoke.vehiclePartCount) || smoke.vehiclePartCount < 24
    || !["combat-rally-lite-v1", "authored-game-car-v1"].includes(smoke.vehicleVisualContract)
    || (smoke.vehicleVisualContract === "authored-game-car-v1"
      && (smoke.authoredVehicleCount !== 2 || smoke.authoredAssetReadyCount !== 2))
    || smoke.cleanupIdempotent !== true)) {
    fail(`La página no validó la presentación Three.js P2P-WASM-44: ${JSON.stringify(smoke)}`);
  }
  if (p2pFullCombat && (smoke.story !== "P2P-WASM-FULL-01"
    || smoke.tick !== 2
    || smoke.vehicleCount !== 2
    || smoke.authoredAssetReadyCount !== 2
    || smoke.rocketCount !== 1
    || smoke.pickupCount !== 0
    || smoke.pickupActiveCount !== 0
    || smoke.mobilityTelemetry !== true
    || smoke.arena !== "combat-alpha"
    || smoke.arenaSurfaceContract !== "unified-interior-shell-v1"
    || smoke.effectPrewarmStatus !== "ready"
    || smoke.effectPrewarmCompilePasses !== 3
    || !Number.isSafeInteger(smoke.renderCalls) || smoke.renderCalls < 1
    || !Number.isSafeInteger(smoke.pixelDiversity) || smoke.pixelDiversity < 4
    || smoke.cleanupIdempotent !== true)) {
    fail(`La página no validó el host WASM completo P2P-WASM-FULL-01: ${JSON.stringify(smoke)}`);
  }
  if (p2pCausalCombatWebRTC && (smoke.story !== "P2P-WASM-23"
    || smoke.transport !== "webrtc-local"
    || smoke.channelLabel !== "arsenal-controls"
    || smoke.commandSequence !== 1
    || smoke.snapshotSequence !== 1
    || smoke.acknowledgedCommandSequence !== 1
    || smoke.tick !== 1
    || !Array.isArray(smoke.eventKinds) || !smoke.eventKinds.includes("fire")
    || smoke.targetId !== "p2p-host"
    || !Number.isSafeInteger(smoke.causalBytes) || smoke.causalBytes < 1 || smoke.causalBytes > 2048
    || smoke.stateBeforeCleanup?.host !== "active"
    || smoke.stateBeforeCleanup?.pilot !== "active"
    || smoke.transportsClosed !== true
    || smoke.cleanupIdempotent !== true)) {
    fail(`La página no validó el DataChannel causal P2P-WASM-23: ${JSON.stringify(smoke)}`);
  }
  if (p2pCausalCombatWebRTCPair && (smoke.host?.story !== "P2P-WASM-24"
    || smoke.host?.coordinatorStory !== "P2P-WASM-27"
    || smoke.host?.presentationStory !== "P2P-WASM-30"
    || smoke.host?.presentationBufferStory !== "P2P-WASM-31"
    || smoke.pilot?.story !== "P2P-WASM-24"
    || smoke.pilot?.coordinatorStory !== "P2P-WASM-27"
    || smoke.pilot?.presentationStory !== "P2P-WASM-30"
    || smoke.pilot?.presentationBufferStory !== "P2P-WASM-31"
    || smoke.host?.role !== "host" || smoke.pilot?.role !== "pilot"
    || smoke.host?.channelLabel !== "arsenal-controls" || smoke.pilot?.channelLabel !== "arsenal-controls"
    || smoke.host?.commandSequence !== 1 || smoke.host?.snapshotSequence !== 1
    || smoke.pilot?.commandSequence !== 1 || smoke.pilot?.snapshotSequence !== 1 || smoke.pilot?.acknowledgedCommandSequence !== 1
    || smoke.host?.tick !== 1 || smoke.pilot?.tick !== 1
    || !smoke.host?.eventKinds?.includes("fire") || !smoke.pilot?.eventKinds?.includes("fire")
    || smoke.host?.targetId !== "p2p-host" || smoke.pilot?.targetId !== "p2p-host"
    || smoke.host?.presentation?.arena !== "combat-alpha" || smoke.pilot?.presentation?.arena !== "combat-alpha"
    || smoke.host?.presentation?.vehicleCount !== 2 || smoke.pilot?.presentation?.vehicleCount !== 2
    || smoke.host?.presentation?.rocketTargetId !== "p2p-host" || smoke.pilot?.presentation?.rocketTargetId !== "p2p-host"
    || smoke.host?.presentation?.localCarId !== "p2p-host" || smoke.pilot?.presentation?.localCarId !== "p2p-pilot"
    || !Number.isFinite(smoke.host?.presentation?.time) || smoke.host.presentation.time <= 0
    || !Number.isFinite(smoke.pilot?.presentation?.time) || smoke.pilot.presentation.time <= 0
    || !Number.isSafeInteger(smoke.pilot?.causalBytes) || smoke.pilot.causalBytes < 1 || smoke.pilot.causalBytes > 2048
    || !Array.isArray(smoke.cleanup) || smoke.cleanup.some(result => result?.closed !== true || result?.idempotent !== true))) {
    fail(`La pareja Chromium no validó P2P-WASM-24: ${JSON.stringify(smoke)}`);
  }
  if (onlineLifecycle25 && (smoke.lifecycle?.story !== "ONLINE-LIFECYCLE-25"
    || smoke.lifecycle?.transport !== "webrtc-local"
    || smoke.lifecycle?.lifecycle?.guestOneActive !== true
    || !Number.isSafeInteger(smoke.lifecycle?.lifecycle?.guestOneSnapshotTick)
    || smoke.lifecycle.lifecycle.guestOneSnapshotTick < 1
    || smoke.lifecycle?.lifecycle?.hostFirstActive !== true
    || !Number.isSafeInteger(smoke.lifecycle?.lifecycle?.firstHostSnapshotTick)
    || smoke.lifecycle.lifecycle.firstHostSnapshotTick < 1
    || smoke.lifecycle?.lifecycle?.guestOneLeft !== true
    || smoke.lifecycle?.lifecycle?.hostWaitingReplacement !== true
    || smoke.lifecycle?.lifecycle?.guestTwoAuthorized !== true
    || smoke.lifecycle?.lifecycle?.guestTwoReady !== true
    || smoke.lifecycle?.lifecycle?.guestTwoActive !== true
    || !Number.isSafeInteger(smoke.lifecycle?.lifecycle?.guestTwoSnapshotTick)
    || smoke.lifecycle.lifecycle.guestTwoSnapshotTick < 1
    || smoke.lifecycle?.lifecycle?.hostReplacementSession !== true
    || !Number.isSafeInteger(smoke.lifecycle?.lifecycle?.replacementHostSnapshotTick)
    || smoke.lifecycle.lifecycle.replacementHostSnapshotTick < 1
    || !Number.isSafeInteger(smoke.lifecycle?.lifecycle?.replacementHostSnapshots)
    || smoke.lifecycle.lifecycle.replacementHostSnapshots < 1
    || !Array.isArray(smoke.cleanup) || smoke.cleanup.some(result => result?.closed !== true || result?.idempotent !== true
      || result?.firstClosed !== true || result?.firstIdempotent !== true))) {
    fail(`ONLINE-LIFECYCLE-25 no validó el abandono y reemplazo del invitado: ${JSON.stringify(smoke)}`);
  }
  if (onlineQa24 && (smoke.host?.story !== "ONLINE-QA-24"
    || smoke.pilot?.story !== "ONLINE-QA-24"
    || smoke.host?.role !== "host" || smoke.pilot?.role !== "pilot"
    || smoke.host?.contract?.twoPeers !== true || smoke.pilot?.contract?.twoPeers !== true
    // The pilot owns local input. The host validates the replicated result;
    // requiring a host-side W key would incorrectly fail a two-peer session.
    || smoke.pilot?.input?.wBoostRequested !== true
    || smoke.host?.input?.boostObserved !== true || smoke.pilot?.input?.boostObserved !== true
    || !smoke.host?.fire?.valid || !smoke.pilot?.fire?.valid
    || smoke.host?.round?.scoreToWin !== 1 || smoke.pilot?.round?.scoreToWin !== 1
    || smoke.host?.round?.completed !== true || smoke.pilot?.round?.completed !== true
    || smoke.host?.round?.restarted !== true || smoke.pilot?.round?.restarted !== true
    || smoke.host?.round?.campaignRounds !== 10 || smoke.pilot?.round?.campaignRounds !== 10
    || smoke.host?.round?.restartedRounds !== 10 || smoke.pilot?.round?.restartedRounds !== 10
    || smoke.host?.round?.serialAfterRestart !== smoke.host?.round?.serialBeforeRestart + 10
    || smoke.pilot?.round?.serialAfterRestart !== smoke.pilot?.round?.serialBeforeRestart + 10
    || !Number.isSafeInteger(smoke.host?.metadata?.received) || smoke.host.metadata.received < 1
    || !Number.isSafeInteger(smoke.pilot?.metadata?.received) || smoke.pilot.metadata.received < 1
    || !Array.isArray(smoke.cleanup) || smoke.cleanup.some(result => result?.closed !== true || result?.idempotent !== true))) {
    fail(`ONLINE-QA-24 no validó la sesión causal host/pilot: ${JSON.stringify(smoke)}`);
  }
  if (combatAlphaRaycast && (smoke.story !== "P2P-WASM-16"
    || smoke.profile !== "combat-alpha"
    || smoke.accepted !== true
    || smoke.status !== "pass"
    || smoke.workload?.raysPerFrame !== 12
    || smoke.integrity?.initialTick !== smoke.integrity?.finalTick
    || smoke.integrity?.warmupRaycasts !== 240 * 12
    || smoke.integrity?.measuredRaycasts !== 600 * 12)) {
    fail(`La página no validó el benchmark P2P-WASM-16, su presupuesto o la integridad sin avance de tick: ${JSON.stringify(smoke)}`);
  }
  if (!combatAlphaRaycast && !p2pHost && !p2pCombatAlphaHost && !p2pCausalCombat && !p2pCausalPresentation && !p2pCausalPresentationThree && !p2pFullCombat && !p2pCausalCombatWebRTC && !p2pCausalCombatWebRTCPair && !onlineQa24 && !onlineLifecycle25 && smoke.ticks !== (carContact || wall ? 180 : 240)) fail(`La página ejecutó ${smoke.ticks} ticks, no ${carContact || wall ? 180 : 240}.`);
  if (multi && smoke.count !== 6) fail(`La página ejecutó ${smoke.count} coches, no 6.`);
  if (ground && smoke.groundedSamples !== 240) fail(`La página observó ${smoke.groundedSamples} muestras apoyadas, no 240.`);
  if (wall && (!smoke.inputContractValid || Math.abs(smoke.firstContactTick - 119) > 2
    || smoke.firstContact?.grounded !== true || smoke.firstContact?.contact?.hasContact !== true
    || smoke.firstContact?.contact?.normal?.x >= -0.9)) fail("La página no validó la entrada ni el primer contacto con la pared +X cerca del tick 119.");
  if (carContact && (!smoke.inputContractValid || Math.abs(smoke.firstTransferTick - 108) > 2)) fail("La página no validó la cinta ni la transferencia de impulso cerca del tick 108.");
  if (browserErrors.length) fail(`El renderer registró errores: ${browserErrors.join(" | ")}`);
  return {
    schemaVersion: 1,
    story: selectedStory(),
    status: "pass",
    url: onlineQa24 || onlineLifecycle25 ? "local-chromium" : `arsenal://smoke/${page}`,
    versions: { electron: process.versions.electron || null, chromium: process.versions.chrome || null },
    smoke,
    consoleErrors: onlineQa24 ? browserErrors.map(value => String(value).replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[ip-redacted]")) : browserErrors,
    artifactPath: path.relative(projectRoot, artifactPath),
    durationMs: Date.now() - startedAt,
  };
}

app.whenReady().then(async () => {
  let report;
  let exitCode = 0;
  try {
    report = await run();
  } catch (error) {
    exitCode = 1;
    report = {
      schemaVersion: 1,
      story: selectedStory(),
      status: "fail",
      url: onlineQa24 || onlineLifecycle25 ? "local-chromium" : `arsenal://smoke/${selectedPage()}`,
      versions: { electron: process.versions.electron || null, chromium: process.versions.chrome || null },
      consoleErrors: onlineQa24 ? browserErrors.map(value => String(value).replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[ip-redacted]")) : browserErrors,
      detail: error?.safeMessage || error?.message || "Error inesperado del smoke WASM.",
      artifactPath: artifactPath ? path.relative(projectRoot, artifactPath) : null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    try { if (artifactPath) await writeFile(artifactPath, `${JSON.stringify(report)}\n`, { flag: "wx" }); } catch { exitCode = 1; }
    try {
      for (const target of BrowserWindow.getAllWindows()) target.destroy();
    } catch { /* The hidden windows may already be gone. */ }
  }
  console.log(JSON.stringify(report));
  app.exit(exitCode);
});
