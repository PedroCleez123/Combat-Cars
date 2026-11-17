import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveWasmSmokeResource } from "../tools/wasm-spike/browser-smoke-server.mjs";

test("ONLINE-QA-24 keeps its local Chromium fixture and contract allowlisted", async () => {
  const page = await readFile(new URL("../tools/wasm-spike/browser-online-qa-24-smoke.html", import.meta.url), "utf8");
  assert.match(page, /ONLINE-QA-24/);
  assert.match(page, /BroadcastChannel/);
  assert.match(page, /scoreToWin: 1/);
  assert.match(page, /wBoostRequested/);
  assert.match(page, /restart: true/);
  assert.match(page, /serialAfterRestart/);
  assert.match(page, /CAMPAIGN_ROUNDS = 10/);
  assert.match(page, /restartedRounds/);
  assert.match(page, /P2PWasmCausalRoomSession/);
  assert.match(page, /metadata: true/);
  assert.match(page, /metadataCount/);
  assert.match(page, /winnerSeen \|\| metadataCount < 1/);
  assert.match(page, /campaignRounds: completedRounds/);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-online-qa-24-smoke.html"), "browser-online-qa-24-smoke.html");
  assert.equal(resolveWasmSmokeResource("POST", "/browser-online-qa-24-smoke.html"), null);
  assert.equal(resolveWasmSmokeResource("GET", "/browser-online-qa-24-smoke.html?role=host"), null);
  assert.doesNotMatch(page, /https?:\/\//i);
});
