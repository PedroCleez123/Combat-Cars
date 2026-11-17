import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildPagesBeta,
  PAGES_BETA_DIRECTORY,
  PAGES_BETA_FILES,
  verifyPagesBeta,
} from "../tools/build-pages-beta.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("Pages beta package keeps legacy room links inside the reviewed playable P2P/WASM surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "combat-cars-pages-"));
  const output = join(root, PAGES_BETA_DIRECTORY);
  try {
    // Build from the actual project but stage into an isolated temporary
    // repository-shaped directory: the output guard remains part of the test.
    const result = await buildPagesBeta({ root: projectRoot, output: join(projectRoot, PAGES_BETA_DIRECTORY) });
    assert.equal(result.entry, "p2p-room-lobby.html");
    assert.equal(result.fileCount, PAGES_BETA_FILES.length);
    assert.equal(PAGES_BETA_FILES.filter((route) => route === "src/arena-scrapyard-material.js").length, 1);
    assert.deepEqual(result.files, [...PAGES_BETA_FILES].sort());
    const entry = await readFile(join(result.output, result.entry), "utf8");
    assert.match(entry, /Combat Cars/);
    assert.match(entry, /p2p-causal-beta/);
    assert.match(entry, /window\.location\.replace\(arena\.href\)/);
    assert.doesNotMatch(entry, /client\.js|server\.mjs|rocketsim-bridge/i);
    const rootEntry = await readFile(join(result.output, "index.html"), "utf8");
    assert.match(rootEntry, /<canvas id="scene"/);
    assert.match(rootEntry, /src="\/src\/p2p-multiplayer-entry\.js"/);
    assert.match(rootEntry, /id="name"[^>]*required/);
    assert.match(rootEntry, /id="mode"/);
    assert.match(rootEntry, /id="join-code"/);
    assert.match(rootEntry, /canonicalHost = "combat-cars\.pages\.dev"/);
    assert.doesNotMatch(rootEntry, /src="\/src\/p2p-causal-beta-entry\.js"/);
    const multiplayerEntry = await readFile(join(result.output, "src", "p2p-multiplayer-entry.js"), "utf8");
    assert.match(multiplayerEntry, /searchParams\.get\("join"\)/);
    assert.match(multiplayerEntry, /else if \(!bootingFromInvite\).*bootstrapPersonalRoom/s);
    assert.doesNotMatch(multiplayerEntry, /searchParams\.get\("create"\)/);
    assert.match(multiplayerEntry, /const requirePlayerName\s*=\s*\(\)\s*=>/);
    assert.match(multiplayerEntry, /from "\.\/p2p-persistent-room-storage\.js"/);
    assert.match(multiplayerEntry, /async function openHostRoom\(/);
    assert.match(multiplayerEntry, /const saved = loadP2PPersistentHostRoom\(\);/);
    assert.match(multiplayerEntry, /saveP2PPersistentHostRoom\(\{/);
    assert.match(multiplayerEntry, /async function joinRoomByCode\(\)\s*\{\s*const name = requirePlayerName\(\); if \(!name\) return;/);
    assert.match(multiplayerEntry, /const activeLobbyChannel = lobbyChannel;/);
    assert.match(multiplayerEntry, /phase === "playing"\) \{ void channel\?\.receive\(event\.slot, event\.data\); \}/);
    assert.match(multiplayerEntry, /isWaitingPhase\(roomContext\?\.phase\)/);
    assert.match(multiplayerEntry, /configureHostRoom/);
    assert.match(multiplayerEntry, /if \(lobbyChannel === lobbyGuestChannel\) lobbyChannel = null/);
    assert.match(multiplayerEntry, /ROOM_PHASE_ORDER/);
    assert.match(multiplayerEntry, /canAdvanceRoomPhase/);
    assert.match(multiplayerEntry, /setRoomVisible\(false\)/);
    assert.match(multiplayerEntry, /setFocusCarId/);
    const legacy = await readFile(join(result.output, "p2p-causal-beta.html"), "utf8");
    assert.match(legacy, /src="\/src\/p2p-causal-beta-entry\.js"/);
    await assert.doesNotReject(verifyPagesBeta({ root: projectRoot, output: result.output }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pages beta package rejects a destination outside its canonical isolated directory", async () => {
  await assert.rejects(
    buildPagesBeta({ root: projectRoot, output: join(tmpdir(), "not-combat-cars-pages") }),
    /canonical isolated directory|inside the repository/,
  );
});
