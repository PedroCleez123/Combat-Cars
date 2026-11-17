import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const smokePath = new URL("../tools/p2p-loopback-smoke.cjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const smoke = await readFile(smokePath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

test("P2P Electron smoke is statically bounded to a localhost child host and the opt-in route", () => {
  assert.match(smoke, /spawn\(runtime, \[serverPath\]/);
  assert.match(smoke, /MOVEMENT_BACKEND: "js"/);
  assert.match(smoke, /ARSENAL_NETWORK_MODE: "online"/);
  assert.match(smoke, /ARSENAL_ONLINE_ALLOWED_ORIGINS: `http:\/\/127\.0\.0\.1:\$\{port\}`/);
  assert.match(smoke, /hostname: "127\.0\.0\.1"/);
  assert.match(smoke, /const sessionMode = process\.argv\.includes\("--session"\)/);
  assert.match(smoke, /const pagePath = sessionMode \? "\/p2p-session-loopback\.html" : hostMode \? "\/p2p-host-loopback\.html" : "\/p2p-loopback\.html"/);
  assert.match(smoke, /http:\/\/127\.0\.0\.1:\$\{port\}\$\{pagePath\}/);
  assert.match(smoke, /\/p2p-loopback\.html/);
  assert.match(smoke, /\/p2p-session-loopback\.html/);
  assert.match(smoke, /5298, 5300/);
  assert.doesNotMatch(smoke, /client\.js|rocketsim-bridge/i);
  assert.doesNotMatch(smoke, /\.\.\.process\.env/);
});

test("P2P Electron smoke has bounded waits, a compact JSON artifact and cleanup paths", () => {
  assert.match(smoke, /P2P_SMOKE_STARTUP_TIMEOUT_MS/);
  assert.match(smoke, /P2P_SMOKE_TIMEOUT_MS/);
  assert.match(smoke, /const deadline = Date\.now\(\) \+ startupTimeoutMs/);
  assert.match(smoke, /const deadline = Date\.now\(\) \+ clientTimeoutMs/);
  assert.match(smoke, /P2P_SMOKE_OUTPUT_DIR/);
  assert.match(smoke, /path\.join\(projectRoot, "artifacts"\)/);
  assert.match(smoke, /await mkdir\(candidate\)/);
  assert.doesNotMatch(smoke, /(?:rmSync|unlink|rmdir)\(/);
  assert.match(smoke, /JSON\.stringify\(finalReport\)/);
  assert.match(smoke, /finally \{/);
  assert.match(smoke, /window\.destroy\(\)/);
  assert.match(smoke, /await stopServer\(\)/);
  assert.match(smoke, /app\.exit\(/);
  assert.equal(packageJson.scripts["smoke:p2p"], "electron --no-sandbox --disable-gpu --enable-unsafe-swiftshader tools/p2p-loopback-smoke.cjs");
  assert.equal(packageJson.scripts["smoke:p2p-session"], "electron --no-sandbox --disable-gpu --enable-unsafe-swiftshader tools/p2p-loopback-smoke.cjs --session");
});

test("P2P Electron smoke stays alive through HTTP startup and finalizes one result", () => {
  const windowCreation = smoke.indexOf("createSmokeWindow();");
  const httpWait = smoke.indexOf("await waitForHttp();");
  assert.ok(windowCreation >= 0 && windowCreation < httpWait, "the hidden BrowserWindow must exist before HTTP polling");
  assert.match(smoke, /app\.on\("before-quit", event => \{/);
  assert.match(smoke, /quitPreventedBeforeReport = true/);
  assert.match(smoke, /event\.preventDefault\(\)/);
  assert.match(smoke, /quitPreventedBeforeReport,/);
  assert.match(smoke, /async function emitFinalReport\(report\)/);
  assert.match(smoke, /if \(reportEmitted\) return;/);
  assert.equal((smoke.match(/await writeFile\(/g) || []).length, 1, "the artifact writer must have one call site");
  assert.equal((smoke.match(/console\.log\(JSON\.stringify\(finalReport\)\)/g) || []).length, 1, "the final stdout JSON must have one call site");
  assert.match(smoke, /run\(\)\.catch\(async \(\) => \{/);
  assert.match(smoke, /reason: "Electron no pudo completar el smoke WebRTC local\."/);
});
