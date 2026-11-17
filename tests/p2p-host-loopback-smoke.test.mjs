import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const smoke = await readFile(new URL("../tools/p2p-loopback-smoke.cjs", import.meta.url), "utf8");
const page = await readFile(new URL("../p2p-host-loopback.html", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("P2P host Electron smoke is opt-in and retains the original smoke defaults", () => {
  assert.match(smoke, /const hostMode = process\.argv\.includes\("--host"\)/);
  assert.match(smoke, /sessionMode \? "\/p2p-session-loopback\.html" : hostMode \? "\/p2p-host-loopback\.html" : "\/p2p-loopback\.html"/);
  assert.match(smoke, /const story = sessionMode \? "P2P-SESSION-04" : hostMode \? "P2P-HOST-01" : "P2P-WEBRTC-02"/);
  assert.match(smoke, /forbiddenPorts = new Set\(\[5298, 5300\]\)/);
  assert.match(smoke, /"127\.0\.0\.1"/);
  assert.match(smoke, /JSON\.stringify\(finalReport\)/);
  assert.match(smoke, /await cleanup\(\)/);
  assert.equal(packageJson.scripts["smoke:p2p"], "electron --no-sandbox --disable-gpu --enable-unsafe-swiftshader tools/p2p-loopback-smoke.cjs");
  assert.equal(packageJson.scripts["smoke:p2p-host"], "electron --no-sandbox --disable-gpu --enable-unsafe-swiftshader tools/p2p-loopback-smoke.cjs --host");
});

test("P2P host page explains local authority scope and reports observable evidence", () => {
  assert.match(page, /Esto no es una partida ni comprueba conectividad exterior/);
  assert.match(page, /sólo el host avanza la física/);
  assert.match(page, /transcript de la prueba/i);
  assert.match(page, /result\.peersClosed/);
  assert.match(page, /result\.snapshots\.length/);
  assert.match(page, /result\.tickCount/);
  assert.match(page, /result\.movedDistance/);
  assert.doesNotMatch(page, /index\.html|client\.js|style\.css|\.glb/i);
});
