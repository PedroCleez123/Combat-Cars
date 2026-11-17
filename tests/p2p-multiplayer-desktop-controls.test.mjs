import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the active multiplayer page exposes an accessible fullscreen control and desktop surface guard", async () => {
  const [html, entry, input] = await Promise.all([
    readFile(`${root}/p2p-multiplayer.html`, "utf8"),
    readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8"),
    readFile(`${root}/src/p2p-causal-input.js`, "utf8"),
  ]);
  assert.match(html, /id="fullscreen-toggle"[^>]*aria-pressed="false"/);
  assert.match(html, /#multiplayer-arena:fullscreen/);
  assert.match(entry, /requestFullscreen/);
  assert.match(entry, /webkitRequestFullscreen/);
  assert.match(entry, /mozRequestFullScreen/);
  assert.match(entry, /msRequestFullscreen/);
  assert.match(entry, /fullscreenchange/);
  assert.match(entry, /preventBrowserContextMenu/);
  assert.match(entry, /preventGameplayRightMouseDefault/);
  assert.match(entry, /document\.addEventListener\("contextmenu", preventBrowserContextMenu, true\)/);
  assert.match(entry, /document\.addEventListener\("mousedown", preventGameplayRightMouseDefault, true\)/);
  assert.match(input, /event\.button === 2 \? "mouse-right"/);
  assert.match(input, /eventTarget\.addEventListener\("mousedown"/);
  assert.match(input, /closest\?\.\("button, summary"\)/);
  assert.match(html, /<option value="" selected>Sin modo seleccionado<\/option>/);
  assert.match(html, /canonicalHost = "combat-cars\.pages\.dev"/);
  assert.match(html, /window\.location\.hostname === `\$\{canonicalHost\}\.`/);
  assert.match(html, /id="retry-personal-room"/);
});

test("the active multiplayer route keeps a compact frame-rate readout across practice and online presentation", async () => {
  const [html, entry, practice] = await Promise.all([
    readFile(`${root}/p2p-multiplayer.html`, "utf8"),
    readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8"),
    readFile(`${root}/src/p2p-offline-practice.js`, "utf8"),
  ]);
  assert.match(html, /<output id="fps-counter" class="fps-counter"[^>]*>FPS —<\/output>/);
  assert.match(entry, /from "\.\/p2p-fps-counter\.js"/);
  assert.match(entry, /const fpsCounter = createP2PFpsCounter\(/);
  assert.match(entry, /onFrame: recordPresentationFrame/);
  assert.match(entry, /renderer\.recordFrame\?\.\(timestamp\)/);
  assert.match(entry, /fpsCounter\.recordFrame\(timestamp\)/);
  assert.match(entry, /__COMBAT_CARS_DIAGNOSTICS__/);
  assert.match(entry, /getRenderer\?\.\(\)\?\.metrics\?\.\(\)/);
  assert.match(entry, /document\.addEventListener\("visibilitychange", resetFpsCounterAfterVisibility\)/);
  assert.match(practice, /onFrame = \(\) => \{\}/);
  assert.match(practice, /renderer\.recordFrame\?\.\(timestamp\)/);
  assert.match(practice, /onFrame\(timestamp\)/);
});

test("the online presentation loop keeps scheduling frames when the visual adapter faults", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /const startPresentationLoop = \(\) => \{/);
  assert.match(entry, /try \{[\s\S]*?renderer\.render\?\.\(\)[\s\S]*?finally \{[\s\S]*?requestAnimationFrame\(render\)/);
});

test("the active multiplayer page exposes the Rocket Arena-style boost meter at the lower-right HUD edge", async () => {
  const [html, entry, meter] = await Promise.all([
    readFile(`${root}/p2p-multiplayer.html`, "utf8"),
    readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8"),
    readFile(`${root}/src/p2p-boost-meter.js`, "utf8"),
  ]);
  assert.match(html, /data-p2p-boost-meter[^>]*role="meter"/);
  assert.match(html, /data-p2p-boost-fill/);
  assert.match(html, /data-p2p-boost-value/);
  assert.match(html, /\.boost-meter\s*\{[^}]*bottom:/s);
  assert.match(entry, /from "\.\/p2p-boost-meter\.js"/);
  assert.match(entry, /createP2PBoostMeter\(document\)/);
  assert.match(entry, /updateBoostMeter\(/);
  assert.match(meter, /aria-valuetext/);
  assert.match(meter, /is-firing/);
});

test("multiplayer transport loss returns to the playable offline practice", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /function returnToOfflinePractice\(/);
  assert.match(entry, /snapshotInterpolator\.reset\(null\)/);
  assert.match(entry, /practice\?\.stop\?\.\(\)/);
  assert.match(entry, /startPractice\(\);/);
  assert.match(entry, /roomContext\?\.phase === "playing"/);
  assert.match(entry, /async function recoverFormerHostPersonalRoom\(reason = "closed"\)/);
  assert.match(entry, /const lostPersistentHostOwnership = error => error\?\.code === "room-not-owner"/);
  assert.match(entry, /await bootstrapPersonalRoom\(\);/);
  assert.match(entry, /client\.on\("closed", event => handleHostSignalTerminal\("closed", event\)\)/);
  assert.match(entry, /client\.on\("error", event => handleHostSignalTerminal\("error", event\)\)/);
  assert.match(entry, /activeClient !== watchedClient/);
  assert.match(entry, /pageUnloading/);
  assert.match(entry, /createP2PGuestConnectionRecovery/);
  assert.match(entry, /createP2PHostSlotRecovery/);
  assert.match(entry, /hostSlotRecovery\.begin\(event\.slot\)/);
  assert.match(entry, /resetSlotConnection/);
  assert.match(entry, /retryGuestTransport/);
  assert.match(entry, /resumePlaying/);
  assert.match(entry, /awaitHostPromotion/);
});

test("an active match replaces only a departed guest transport and preserves guest recovery state", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.doesNotMatch(entry, /handleOnlineTransportTerminal/);
  assert.match(entry, /hostSlotRecovery\.begin\(event\.slot\)/);
  assert.match(entry, /hostSlotRecovery\.reconnected\(event\.slot\)/);
  assert.match(entry, /const recoverable = context\?\.role === "guest" && \(isWaitingPhase\(context\.phase\) \|\| context\.phase === "playing"\)/);
  assert.match(entry, /const resumePlaying = retry && resume\?\.phase === "playing"/);
  assert.match(entry, /phase: resumePlaying \? "playing"/);
  assert.match(entry, /startGuestMatch\(\{ players: currentPlayers\(\), mode: roomContext\.mode/);
});

test("former host rotation is fenced during a real page unload and cannot duplicate", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /let hostPersonalRecoveryInProgress = false; let pageUnloading = false/);
  assert.match(entry, /hostPersonalRecoveryInProgress \|\| roomContext\?\.role !== "host"\) return false/);
  assert.match(entry, /hostPersonalRecoveryInProgress = true/);
  assert.match(entry, /hostPersonalRecoveryInProgress = false/);
  assert.match(entry, /window\.addEventListener\("beforeunload", \(\) => \{ pageUnloading = true/);
});

test("a former host discards only a confirmed stale owner credential before minting a new personal room", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /async function createFreshPersonalRoom\(\)/);
  assert.match(entry, /if \(lostPersistentHostOwnership\(error\)\) \{/);
  assert.match(entry, /clearP2PPersistentHostRoom\(\);/);
  assert.match(entry, /await createFreshPersonalRoom\(\);/);
  assert.doesNotMatch(entry, /clearP2PPersistentHostRoom\(\);\s*const detail/);
});

test("a promoted guest becomes the owner of the shared key and no longer offers a return to another personal room", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /roomContext\.role = "host"/);
  assert.match(entry, /guestSlot = null/);
  assert.match(entry, /clearP2PPersistentGuestRoom\(\)/);
  assert.match(entry, /saveP2PPersistentHostRoom\(/);
  assert.match(entry, /activeClient\?\.resetRoom\?\./);
  assert.match(entry, /roomContext\.mode = null/);
  assert.match(entry, /roomContext\.phase = "room-open"/);
  assert.match(entry, /team: null/);
  assert.match(entry, /if \(el\("mode"\)\) el\("mode"\)\.value = ""/);
  assert.match(entry, /returnPersonal\.hidden = roomContext\.role !== "guest"/);
});

test("an open room preserves the host's pending mode choice until it is explicitly applied", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /if \(roomContext\.mode\) modeControl\.value = roomContext\.mode/);
  assert.doesNotMatch(entry, /modeControl\.value = roomContext\.mode \|\| ""/);
});

test("the host can restore its origin-scoped persistent room rather than minting a new key", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /loadP2PPersistentHostRoom/);
  assert.match(entry, /saveP2PPersistentHostRoom/);
  assert.match(entry, /async function openHostRoom\(/);
  assert.match(entry, /Sala restaurada · misma clave/);
});

test("the personal-room bootstrap is visible immediately and exposes a retry after a failed room request", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /function showPersonalRoomBootstrap\(error = null\)/);
  assert.match(entry, /setRoomVisible\(true\)/);
  assert.match(entry, /function bootstrapPersonalRoom\(\)/);
  assert.match(entry, /showPersonalRoomBootstrap\(error instanceof Error/);
  assert.match(entry, /retry-personal-room/);
});

test("launching a persisted personal room clears its prior mode before publishing its key", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /async function hostRoom\(\)/);
  assert.match(entry, /await client\.resetRoom\(\{ roomCode: saved\.roomCode \|\| saved\.roomId, hostSecret: saved\.hostSecret \}\)/);
  assert.match(entry, /mode: null, maxPlayers: P2P_MATCH_MAX_PLAYERS/);
  assert.match(entry, /await openHostRoom\(room, \{ restored: true \}\)/);
});

test("the public join action ignores a duplicate retry while the same guest transport is active", async () => {
  const entry = await readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8");
  assert.match(entry, /let roomJoinInFlight = false/);
  assert.match(entry, /if \(roomJoinInFlight\) return status\("Ya se está intentando unir a una sala\."\)/);
  assert.match(entry, /const activeGuestRoom = roomContext\?\.role === "guest"/);
  assert.match(entry, /guestRecovery\.snapshot\(\)\.retryPending/);
  assert.match(entry, /roomJoinInFlight = true/);
  assert.match(entry, /roomJoinInFlight = false/);
});

test("the active match closes the room menu on both host and guest", async () => {
  const [html, entry] = await Promise.all([
    readFile(`${root}/p2p-multiplayer.html`, "utf8"),
    readFile(`${root}/src/p2p-multiplayer-entry.js`, "utf8"),
  ]);
  assert.match(html, /id="multiplayer-menu"[^>]*class="menu"/);
  assert.match(entry, /const closeMatchMenu = \(\) =>/);
  assert.match(entry, /el\("multiplayer-menu"\)/);
  assert.match(entry, /setRoomVisible\(false\); closeMatchMenu\(\);/);
  assert.match(entry, /setRoomVisible\(false\); closeMatchMenu\(\); renderLobby\(\);/);
});
