import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../src/client.js", import.meta.url), "utf8");

test("updateCars derives audio acceleration from its dt parameter", () => {
  const start = clientSource.indexOf("function updateCars(dt, frameState)");
  const end = clientSource.indexOf("function createRocket", start);
  assert.ok(start >= 0, "client updateCars function must remain discoverable");
  assert.ok(end > start, "client updateCars function must end before rocket rendering");

  const updateCarsSource = clientSource.slice(start, end);
  assert.match(
    updateCarsSource,
    /const acceleration = \(speed - audioMotionState\.speed\) \/ Math\.max\(dt, \.016\);/,
  );
  assert.doesNotMatch(updateCarsSource, /\bframeDt\b/);
});
