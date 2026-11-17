import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/client.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("audio controls expose an accessible volume slider and mute action", () => {
  assert.match(indexSource, /id="audio-volume"[^>]+type="range"/);
  assert.match(indexSource, /id="audio-mute"[^>]+aria-pressed="false"/);
  assert.match(indexSource, /id="audio-status"[^>]+role="status"/);
  assert.match(clientSource, /AUDIO_VOLUME_STORAGE_KEY/);
  assert.match(clientSource, /AUDIO_MUTED_STORAGE_KEY/);
  assert.match(clientSource, /audioMixer\.setVolume\(event\.target\.value\)/);
  assert.match(clientSource, /audioMixer\.setMuted\(!audioMixer\.getState\(\)\.muted\)/);
  assert.match(styleSource, /\.audio-row input\[type="range"\]/);
});
