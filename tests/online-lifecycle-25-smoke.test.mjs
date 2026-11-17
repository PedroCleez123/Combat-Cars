import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveWasmSmokeResource } from "../tools/wasm-spike/browser-smoke-server.mjs";

test("ONLINE-LIFECYCLE-25 fixture is allowlisted and documents the replacement contract", async () => {
  const source = await readFile(new URL("../tools/wasm-spike/browser-online-lifecycle-25-smoke.html", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(source, /ONLINE-LIFECYCLE-25/);
  assert.match(source, /BroadcastChannel/);
  assert.match(source, /RTCPeerConnection/);
  assert.match(source, /startPresence/);
  assert.match(source, /guest-one-active/);
  assert.match(source, /guestOneLeft/);
  assert.match(source, /hostFirstActive/);
  assert.match(source, /hostWaitingReplacement/);
  assert.match(source, /guestTwoAuthorized/);
  assert.match(source, /guestTwoActive/);
  assert.match(source, /__arsenalOnlineLifecycle25Cleanup/);
  assert.match(source, /idempotent: true/);
  assert.doesNotMatch(source, /https?:\/\//i);
  assert.equal(packageJson.scripts["smoke:online-lifecycle-25"], "electron --no-sandbox --disable-gpu --enable-unsafe-swiftshader tools/wasm-spike/browser-smoke.cjs --online-lifecycle-25");
  assert.equal(packageJson.scripts["test:online-lifecycle-25-contract"], "node --test tests/online-lifecycle-25-smoke.test.mjs");
  assert.equal(resolveWasmSmokeResource("GET", "/browser-online-lifecycle-25-smoke.html"), "browser-online-lifecycle-25-smoke.html");
  assert.equal(resolveWasmSmokeResource("GET", "/browser-online-lifecycle-25-smoke.html?role=host"), null);
  assert.equal(resolveWasmSmokeResource("POST", "/browser-online-lifecycle-25-smoke.html"), null);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-online-lifecycle-25-smoke.html/extra"), null);
});
